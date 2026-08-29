import { cookies } from "next/headers";
import { routing } from "@/i18n/routing";
import { SESSION_COOKIE, unseal } from "@/lib/session/seal";
import {
  EXPORT_SUBJECTS,
  EXPORT_LIMIT_MAX,
  isExportSubject,
  type ExportSubject,
} from "@/lib/transfer";

/**
 * Stream a CSV export back without the credential leaving the server, and
 * without the envelope client ever seeing it.
 *
 * **Why this exists**, and it is the same argument `app/api/label/[id]` makes
 * one resource over. An export is a **file**: `text/csv`, a
 * `Content-Disposition` filename that is the API's, `Cache-Control: no-store`,
 * and a body opening with a UTF-8 BOM that Excel needs. The `/api/ac/*` proxy
 * forwards only `content-type` and `retry-after`, so a download routed through
 * it would arrive with no filename and no `no-store` — and `acRead()` would try
 * to `JSON.parse` a spreadsheet.
 *
 * ADMIN_PANEL.md names this as the one place the envelope-unwrapping client must
 * be bypassed deliberately. It is the second, and `/api/label/[id]` was the
 * first.
 *
 * **The browser does the download itself.** The `href` is this path, so the
 * navigation carries the session cookie, the server attaches the Application
 * Password, and the credential is never in the document, never in an RSC payload
 * and never in a log line here. A `fetch` into a blob would work and would put
 * the whole catalogue in the tab's memory to no purpose.
 *
 * ## What this route refuses, and why each refusal is here
 *
 * The subject is matched against `EXPORT_SUBJECTS` rather than interpolated, so
 * `/api/export/../../wp/v2/users` cannot become a path. That is belt and braces
 * over the same guard `checkAllowed()` runs, and it is here because this handler
 * does **not** go through the allowlist — the four export routes are
 * deliberately off it, with a unit test saying so.
 *
 * `limit` is the only parameter forwarded, clamped to the API's own cap.
 * Anything else a caller appends is dropped: the export routes accept
 * `date_from`/`date_to` on some subjects and the panel offers no control for
 * them, so forwarding an arbitrary query string would make this a wider surface
 * than the screen. `from` below is read here and forwarded nowhere.
 *
 * ## A refusal is a redirect back into the panel, not an envelope at the reader
 *
 * This handler used to answer a non-2xx as `application/json`, with a comment
 * saying "the screen renders it as a screen". **Nothing did.** Every one of the
 * five callers is a real top-level navigation, so a 403 or a 502 navigated the
 * tab away from the panel and printed `{"success":false,…}` at a shopkeeper,
 * whose only way back was the Back button. It was recorded under "Carried
 * forward" in DECISIONS.md for three branches.
 *
 * So a caller passes `from=<its own path>` and a refusal answers **303** to it,
 * with the failure in two parameters the panel renders itself
 * (`components/ui/ExportNotice.tsx`). The browser returns to the screen the
 * reader left, filters intact, and never renders an envelope.
 *
 * **With no `from`, today's JSON is unchanged, byte for byte.** A non-panel
 * client hitting this route directly is entitled to the envelope, and
 * `lib/transfer.ts:80-83` records that an export error arriving inside it is the
 * API's own guarantee. The same is true of an unknown *subject*: the notice can
 * only name one of the four, so a 404 is never redirected — there would be
 * nothing to say on arrival.
 *
 * **The success path is untouched.** `from` is read once, is never sent
 * upstream, and is never consulted on a 2xx.
 */

/** Long enough for 886 orders; the API buffers rather than streams. */
const EXPORT_TIMEOUT_MS = 60_000;

const BASE = process.env.AC_API_BASE ?? "http://localhost:8090/wp-json/algerian-commerce/v1";

function problem(status: number, code: string, message: string): Response {
  return Response.json({ success: false, error: { code, message } }, { status });
}

/* ---------------------------------------------------------- the redirect --- */

/**
 * The shape a panel URL has: a locale segment from `i18n/routing.ts`, then path
 * segments of the characters a route in this panel can actually hold.
 */
const PANEL_PATH = new RegExp(`^/(${routing.locales.join("|")})(/[A-Za-z0-9._~-]+)*/?$`);

/**
 * **The open-redirect guard**, written as a list of refusals so a reader can see
 * that is what it is.
 *
 * `from` is a string a *caller* supplies and it becomes a `Location` header, so
 * it is validated as a same-origin panel path or refused outright. A refusal
 * falls through to the JSON below rather than redirecting somewhere unvalidated
 * — the failure mode is the old behaviour, never a redirect nobody checked.
 *
 *   `https://evil.example`  a scheme, so it parses to a foreign origin
 *   `//evil.example`        protocol-relative, the same foreign origin
 *   `/\evil.example`        a backslash, which the WHATWG parser folds to `/`
 *                           for a special scheme — `//evil.example` again
 *   `/../../etc`            same origin, and not a panel path
 *   `/api/export/customers` same origin, a real path, and not a *panel* one —
 *                           which is the refusal that stops a redirect loop
 *
 * The first three are settled by **comparing origins after parsing**, which is
 * the one test that cannot be fooled by a spelling nobody anticipated; the last
 * two by requiring the panel's own shape, against a normalised `pathname` whose
 * `..` segments the parser has already resolved away.
 *
 * The **query string is not shape-checked** and does not need to be: it is
 * carried through exactly as the parser encoded it, so a control character in it
 * is already `%0D%0A` by the time it could reach a header. All eight of these,
 * and the loop, are driven against the built panel rather than reasoned about.
 */
function returnPath(raw: string | null, base: string): URL | null {
  if (raw === null || raw === "") return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;

  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }

  if (url.origin !== new URL(base).origin) return null;
  if (!PANEL_PATH.test(url.pathname)) return null;

  return url;
}

/**
 * 303, because the reader is being sent to a *different resource* that reports
 * what happened rather than to another copy of the file they asked for.
 *
 * **Relative, and that is deliberate**: `request.url` carries the origin the
 * server was reached on rather than the one the browser used, and behind a
 * reverse proxy those differ. RFC 7231 §7.1.2 permits a relative reference and
 * every browser resolves it against the request URL.
 *
 * The two parameter names are `components/ui/ExportNotice.tsx`'s; that file says
 * why they are spelled out in both places instead of shared. `set` rather than
 * `append`, so a second refusal replaces the first rather than stacking.
 *
 * **Only the status travels, never the API's sentence.** DECISIONS.md §11: the
 * panel asks its own mirror which refusal this is rather than parsing the API's
 * prose — and a message in a URL is also foreign text in a reflected parameter.
 */
function seeOther(back: URL, subject: ExportSubject, status: number): Response {
  back.searchParams.set("export_error", subject);
  back.searchParams.set("export_status", String(status));

  return new Response(null, {
    status: 303,
    headers: {
      location: `${back.pathname}${back.search}`,
      "cache-control": "no-store",
    },
  });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ subject: string }> },
): Promise<Response> {
  const { subject } = await ctx.params;

  /* Before `from` is even read: an unknown subject is a 404 the notice could not
     render, because it names the subject's capability and there is none. */
  if (!isExportSubject(subject)) {
    return problem(
      404,
      "not_found",
      `No export for "${subject}". The four are ${EXPORT_SUBJECTS.join(", ")}.`,
    );
  }

  const requestUrl = new URL(request.url);
  const back = returnPath(requestUrl.searchParams.get("from"), request.url);

  /** A refusal: back into the panel where the caller came from, or the envelope. */
  const refuse = (status: number, code: string, message: string): Response =>
    back === null ? problem(status, code, message) : seeOther(back, subject, status);

  const jar = await cookies();
  const session = await unseal(jar.get(SESSION_COOKIE)?.value);
  if (!session) return refuse(401, "unauthenticated", "No session.");

  const target = new URL(`${BASE}/export/${subject}`);

  /*
   * The only forwarded parameter, and clamped rather than passed through: the
   * API answers 400 above 2000 with the range in `details.params`, and a 400
   * arriving as a *download* is the one thing this route must not produce. A
   * clamp here means the screen's own control cannot ask for a file the API
   * refuses.
   */
  const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "", 10);
  if (Number.isSafeInteger(limit) && limit > 0) {
    target.searchParams.set("limit", String(Math.min(limit, EXPORT_LIMIT_MAX)));
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: {
        Accept: "text/csv",
        Authorization: `Basic ${Buffer.from(`${session.username}:${session.password}`).toString("base64")}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    });
  } catch {
    return refuse(502, "upstream_unreachable", "Could not reach the shop.");
  }

  /*
   * **An export error is still the envelope**, with its 4xx — that is the API's
   * own guarantee and it is what stops a client saving an error message as
   * `products.csv`. So a caller that did not say where it came from still gets
   * the JSON, unchanged.
   *
   * A caller that did gets a 303 back to it. The download is a link the panel
   * controls rather than one it hands to the browser blind, and this is what
   * that control was always for.
   *
   * A 403 in particular is a real answer here: a Support Agent is 200 on
   * `/export/customers` and 403 on the other three, so the refusal is per subject
   * and the screen has to be able to say which.
   */
  if (!upstream.ok) {
    if (back !== null) return seeOther(back, subject, upstream.status);

    const body = await upstream.text();
    return new Response(body === "" ? "{}" : body, {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  }

  /*
   * Streamed through with the API's own filename, and the headers it needs and
   * nothing else. `no-store` is Part VI's rule and this is exactly the response
   * it is about: one shop's whole customer list is not a thing a service worker
   * or a shared cache may hold.
   */
  const disposition =
    upstream.headers.get("content-disposition") ?? `attachment; filename="${subject}.csv"`;

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "text/csv; charset=utf-8",
      "content-disposition": disposition,
      "cache-control": "no-store, no-cache, must-revalidate, private",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
