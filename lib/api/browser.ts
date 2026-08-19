/**
 * The browser's side of the proxy.
 *
 * `lib/api/client.ts` is the server's: it holds the Application Password and is
 * `server-only`. This one holds nothing. It talks to `/api/ac/*`, the Route
 * Handler attaches the credential, and the browser never sees one.
 *
 * It exists because the same twenty lines of envelope-unwrapping had been written
 * by hand in three query modules and two components before this branch would have
 * made it seven. The differences between the copies were not intentional — one
 * handled `details.params` arriving as an array and the others did not — which is
 * the failure mode duplicated error handling always has: the copy that gets fixed
 * is the one whose screen someone happened to test.
 *
 * `orders/query.ts` and `products/query.ts` still carry their own and are not
 * swept here; their fetchers read bespoke `meta` (facets) and rewriting three
 * tested screens is not this branch's work.
 */

/** The envelope, as every route in this API answers it. */
type Envelope = {
  success?: boolean;
  data?: unknown;
  meta?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

/**
 * An error carrying what the API said, not a flattened string.
 *
 * The form needs `fields` intact — **a 400 lists every bad field at once** and
 * each one binds to its own control — and the coupon screen needs `code` and
 * `details` to tell a duplicate-code 409 from a validation 400. A thrown
 * `Error("…")` with the first message pasted in loses both, which is what every
 * hand-rolled copy of this did.
 */
export class BrowserApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: Record<string, unknown>;

  constructor(init: {
    status: number;
    code?: string;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(init.message);
    this.name = "BrowserApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? {};
  }

  /** `details.fields` — the per-field messages a form binds to its controls. */
  get fields(): Record<string, string> | null {
    const fields = this.details.fields;
    return fields !== null && typeof fields === "object" && !Array.isArray(fields)
      ? (fields as Record<string, string>)
      : null;
  }
}

/**
 * The most useful sentence in a failure.
 *
 * **`details.params` has two shapes on this API** and only one of them is a
 * message. For a bad value it is an object keyed by parameter
 * (`{"per_page": "per_page must be between 1 and 100"}`); for a *missing* required
 * parameter it is an array of names (`{"params": ["sku"]}`, measured on
 * `/inventory/lookup`). Rendering the second would put `sku` on screen as though
 * it were an explanation, so the array falls through to the generic message.
 */
function firstMessage(body: Envelope, status: number): string {
  const details = body.error?.details ?? {};
  const params = details.params;
  const fields = details.fields as Record<string, string> | undefined;

  const fromParams =
    params !== null && typeof params === "object" && !Array.isArray(params)
      ? Object.values(params as Record<string, string>)[0]
      : undefined;

  return (
    fromParams ??
    (fields && Object.values(fields)[0]) ??
    body.error?.message ??
    `Request failed (${status})`
  );
}

/**
 * One request, one place that decides whether it succeeded.
 *
 * The body is read as text before it is parsed. A 204, or a 200 with an empty
 * body, is legal — nothing in the contract promises `DELETE` returns one — and
 * `response.json()` throws on an empty string, so a successful delete would
 * otherwise fail inside the parser.
 */
async function request(path: string, init?: RequestInit): Promise<Envelope> {
  const response = await fetch(`/api/ac${path}`, init);
  const text = await response.text();

  let body: Envelope = {};

  if (text !== "") {
    try {
      body = JSON.parse(text) as Envelope;
    } catch {
      throw new BrowserApiError({
        status: response.status,
        code: "unparseable_response",
        message: `The API answered with something that is not JSON (${response.status}).`,
      });
    }
  }

  if (!response.ok || body.success === false) {
    throw new BrowserApiError({
      status: response.status,
      code: body.error?.code,
      message: firstMessage(body, response.status),
      details: body.error?.details,
    });
  }

  return body;
}

/** A read. `total` comes from `meta.total`, which every list route sends. */
export async function acRead<T>(path: string): Promise<{ data: T; total: number }> {
  const body = await request(path, { headers: { Accept: "application/json" } });

  return {
    data: (body.data ?? []) as T,
    total: typeof body.meta?.total === "number" ? body.meta.total : 0,
  };
}

/** A write. Throws `BrowserApiError` with `fields`, `code` and `details` intact. */
export async function acWrite<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  payload?: unknown,
): Promise<T> {
  const body = await request(path, {
    method,
    headers: {
      Accept: "application/json",
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });

  return body.data as T;
}
