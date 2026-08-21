import { cookies } from "next/headers";
import { SESSION_COOKIE, unseal } from "@/lib/session/seal";
import { EXPORT_SUBJECTS, EXPORT_LIMIT_MAX, isExportSubject } from "@/lib/transfer";

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
 * than the screen.
 */

/** Long enough for 886 orders; the API buffers rather than streams. */
const EXPORT_TIMEOUT_MS = 60_000;

const BASE = process.env.AC_API_BASE ?? "http://localhost:8090/wp-json/algerian-commerce/v1";

function problem(status: number, code: string, message: string): Response {
  return Response.json({ success: false, error: { code, message } }, { status });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ subject: string }> },
): Promise<Response> {
  const { subject } = await ctx.params;

  if (!isExportSubject(subject)) {
    return problem(
      404,
      "not_found",
      `No export for "${subject}". The four are ${EXPORT_SUBJECTS.join(", ")}.`,
    );
  }

  const jar = await cookies();
  const session = await unseal(jar.get(SESSION_COOKIE)?.value);
  if (!session) return problem(401, "unauthenticated", "No session.");

  const target = new URL(`${BASE}/export/${subject}`);

  /*
   * The only forwarded parameter, and clamped rather than passed through: the
   * API answers 400 above 2000 with the range in `details.params`, and a 400
   * arriving as a *download* is the one thing this route must not produce. A
   * clamp here means the screen's own control cannot ask for a file the API
   * refuses.
   */
  const limit = Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "", 10);
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
    return problem(502, "upstream_unreachable", "Could not reach the shop.");
  }

  /*
   * **An export error is still the envelope**, with its 4xx — that is the API's
   * own guarantee and it is what stops a client saving an error message as
   * `products.csv`. So a non-2xx is passed through as JSON and the screen renders
   * it as a screen, which is the whole reason the download is a link the panel
   * controls rather than one it hands to the browser blind.
   *
   * A 403 in particular is a real answer here: a Support Agent is 200 on
   * `/export/customers` and 403 on the other three, so the refusal is per subject
   * and the screen has to be able to say which.
   */
  if (!upstream.ok) {
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
