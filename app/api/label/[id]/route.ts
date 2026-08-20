import { cookies } from "next/headers";
import { SESSION_COOKIE, unseal } from "@/lib/session/seal";
import { acFetch } from "@/lib/api/client";
import { shipment as shipmentSchema } from "@/lib/api/schemas/shipping";
import { ApiError } from "@/lib/api/errors";
import { LABEL_KEY, LABELS_KEY } from "@/lib/shipping";

/**
 * Open a shipment's label without its URL ever reaching the browser.
 *
 * **Why this exists.** A courier's label URL carries an access token to one
 * customer's name, phone and full address, and anyone holding the URL can fetch
 * it without a credential of their own. `Shipment::toArray()` emits `metadata`
 * verbatim, so the URL is in every API response about that parcel. The panel's
 * rule — never in a client component, never in an `href` the browser can
 * prefetch, never logged, never cached by a service worker — is only enforceable
 * if the URL is resolved on the server and the bytes are streamed back.
 *
 * So the browser asks for `/api/label/220`. This re-reads the shipment with the
 * staff credential, finds the label in `metadata`, fetches it, and pipes the
 * response through. The `href` in the DOM is this path; the credential is never
 * in the document, never in the RSC payload, and never in a log line here.
 *
 * **No shipment in this shop has one.** `manual` is the only configured provider
 * and in-house delivery issues no labels — measured across all 111 shipments,
 * 2026-08-20. That is exactly why the absent case is a built screen rather than
 * a defensive branch: this route's only reachable answer today is the 404, and a
 * 404 that says "this parcel has no label" is the thing an operator will
 * actually meet.
 */

const LABEL_TIMEOUT_MS = 15_000;

/** What a label may be fetched over. A courier that sends `http` is a courier
 *  handing a customer's address to the network in clear text. */
const ALLOWED_PROTOCOLS = new Set(["https:"]);

function problem(status: number, code: string, message: string): Response {
  return Response.json({ success: false, error: { code, message } }, { status });
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  const shipmentId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(shipmentId) || shipmentId <= 0) {
    return problem(404, "not_found", "No shipment with that id.");
  }

  const jar = await cookies();
  const session = await unseal(jar.get(SESSION_COOKIE)?.value);
  if (!session) return problem(401, "unauthenticated", "No session.");

  /*
   * Read the shipment with the staff credential. This is also the authorization
   * check and it is the API's, not ours: `GET /shipments/{id}` is
   * `ac_manage_shipping`, so a caller without it gets the API's 403 here rather
   * than a label.
   */
  let parcel;
  try {
    parcel = (await acFetch(shipmentSchema, session, `/shipments/${shipmentId}`)).data;
  } catch (error) {
    if (error instanceof ApiError) {
      return problem(error.status, error.code ?? "error", error.message);
    }
    return problem(502, "upstream_unreachable", "Could not reach the API.");
  }

  /*
   * `label` first, then the first entry of `labels`. Both are keys the backend's
   * own logger masks by exact name, and both are shapes a Yalidine parcel comes
   * back with.
   */
  const metadata = parcel.metadata as Record<string, unknown>;
  const single = metadata[LABEL_KEY];
  const many = metadata[LABELS_KEY];
  const href =
    typeof single === "string" && single !== ""
      ? single
      : Array.isArray(many) && typeof many[0] === "string"
        ? many[0]
        : null;

  if (href === null) {
    return problem(
      404,
      "no_label",
      "This shipment carries no label. The configured provider does not issue one.",
    );
  }

  let target: URL;
  try {
    target = new URL(href);
  } catch {
    return problem(502, "bad_label", "The provider stored a label that is not a URL.");
  }

  /*
   * The label URL is a value from the courier's response, stored in the shop's
   * database. It is not a value a panel user typed, but it is not the panel's
   * either — so it is checked before it becomes an outbound request. `https`
   * only, and redirects are not followed: a 302 into `169.254.169.254` or
   * `localhost` would turn this handler into a request forge with the server's
   * own network position.
   */
  if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
    return problem(502, "bad_label", "The provider stored a label that is not an https URL.");
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(LABEL_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Deliberately does not include the URL. This is the log line that would
    // otherwise outlive the parcel with a live token in it.
    return problem(502, "label_unreachable", "The provider did not return the label.");
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    return problem(502, "label_redirected", "The provider redirected the label request.");
  }

  if (!upstream.ok) {
    return problem(502, "label_unreachable", "The provider did not return the label.");
  }

  /*
   * Streamed through, with only the headers that describe the bytes. Nothing
   * from the courier's response is forwarded that could carry state — no
   * `Set-Cookie`, no caching directives of theirs.
   *
   * `no-store` is the one this file exists for: Part VI forbids a service worker
   * or any intermediary caching a response containing a label, and a PDF of a
   * customer's address is exactly that response.
   */
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/pdf",
      "content-disposition": `inline; filename="label-${shipmentId}.pdf"`,
      "cache-control": "no-store, no-cache, must-revalidate, private",
      "referrer-policy": "no-referrer",
    },
  });
}
