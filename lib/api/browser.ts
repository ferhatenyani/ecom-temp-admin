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
 * **`orders/query.ts` and `products/query.ts` are now swept in too**, and the two
 * defects that survived in them are worth naming, because both were real and
 * neither was visible from the code:
 *
 *   orders    read `body.error.message` and nothing else, so `?per_page=500`
 *             showed *"Invalid parameter(s): per_page"* where the API had said
 *             *"per_page must be between 1 (inclusive) and 100 (inclusive)"*.
 *             The useful half was in `details.params` and was thrown away.
 *
 *   products  read `details.params` but only in its object shape, so the array
 *             form — measured on `/inventory/lookup`, `{"params": ["sku"]}` —
 *             would have put the bare word `sku` on screen as though it were an
 *             explanation.
 *
 * Both also called `response.json()` directly, which throws on an empty body: a
 * 204, or a 200 with nothing in it, failed inside the parser rather than
 * succeeding.
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

/**
 * A read. `total` comes from `meta.total`, which every list route sends.
 *
 * `meta` is returned whole beside it, because `total` is not the only thing that
 * arrives there: `/products` puts its facet counts in `meta.facets`, and the
 * analytics routes put `money_visible`, `money_requires`, `cache_ttl` and
 * `generated_at` there. Returning only `total` is what kept the products fetcher
 * hand-rolled through three branches — it needed one more key than this gave it,
 * so it kept its own copy of the whole reader to get it.
 *
 * Typed `Record<string, unknown>`, so a caller narrows what it wants and nothing
 * here has to know every route's `meta` shape.
 */
export async function acRead<T>(
  path: string,
): Promise<{ data: T; total: number; meta: Record<string, unknown> }> {
  const body = await request(path, { headers: { Accept: "application/json" } });
  const meta = body.meta ?? {};

  return {
    data: (body.data ?? []) as T,
    total: typeof meta.total === "number" ? meta.total : 0,
    meta,
  };
}

/**
 * A write. Throws `BrowserApiError` with `fields`, `code` and `details` intact.
 *
 * **`PUT` arrived with the content branch**, and it is not a synonym for `PATCH`
 * here. Two routes use it and both mean *replace the whole thing*:
 * `PUT /cms/homepage` and `PUT /cms/menus/{location}` each take an ordered array
 * and swap it for what is stored. §89 argues why they are not PATCHes — sections
 * and menu items are ordered, and an API that let two clients insert at index 2
 * concurrently would have invented a merge problem the shop does not have — so
 * spelling it `PUT` at the call site is the difference between "change this
 * field" and "this is now the document".
 */
export async function acWrite<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  payload?: unknown,
): Promise<T> {
  return (await acWriteWithMeta<T>(method, path, payload)).data;
}

/**
 * The same write, with the envelope's `meta` beside the data.
 *
 * **`acWrite` drops `meta`, and on one route that is where the entire answer
 * lives.** `POST /notifications/{id}/retry` answers 202 with the row in `data`
 * and `{queued, already_pending, drain}` in `meta` — whether the row was
 * actually requeued or was already in the queue, and the name of the command
 * that will send it. A caller holding only `data` cannot tell those two apart,
 * and both are 202.
 *
 * Added rather than changing `acWrite`'s return shape, which twenty-odd call
 * sites depend on, and `acWrite` now delegates here so there is still exactly
 * one place that decides whether a request succeeded. This is the same reason
 * `acRead` returns `meta` whole: `/products` puts facet counts there and the
 * analytics routes put `money_visible` there, and the fetcher that needed one
 * more key than the reader gave it kept its own copy of the whole reader for
 * three branches.
 */
export async function acWriteWithMeta<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  payload?: unknown,
): Promise<{ data: T; meta: Record<string, unknown> }> {
  const body = await request(path, {
    method,
    headers: {
      Accept: "application/json",
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });

  return { data: body.data as T, meta: body.meta ?? {} };
}
