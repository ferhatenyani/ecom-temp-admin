import "server-only";
import type { z } from "zod";
import { unwrap, type Unwrapped } from "./envelope";
import { ApiError, NetworkError, isRetryable } from "./errors";
import type { Session } from "@/lib/session/seal";

/**
 * The typed client. Server-side only — it is the thing that holds the
 * Application Password, so `server-only` above is a build-time guarantee rather
 * than a convention.
 *
 * `AC_CORS_ORIGINS` is irrelevant to the panel: requests come from the Next.js
 * server, which is not a browser and sends no `Origin`. Needing to add the
 * panel's origin to that allowlist means something is calling the API from the
 * browser, and that is the bug.
 */

const BASE =
  process.env.AC_API_BASE ?? "http://localhost:8090/wp-json/algerian-commerce/v1";

function basic(session: Session): string {
  return `Basic ${Buffer.from(`${session.username}:${session.password}`).toString("base64")}`;
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  /** Server-rendered reads want a fresh answer; the API caches its own. */
  cache?: RequestCache;
  signal?: AbortSignal;
  /**
   * Opt this one request out of `acFetch`'s single retry. Default `true`, so
   * every existing call site is unchanged.
   *
   * **Added for `/api/session`, and the reason is a measured ten-second hang.**
   * `isRetryable` is true for a GET that answered 429, and `/auth/me` is a GET —
   * so a sign-in against a locked-out address slept `min(retryAfter, 10)` and
   * asked again. The failed-login bucket is **10 per 15 minutes**, so the second
   * ask cannot succeed and the reader watched a spinner for ten seconds before
   * being told to wait fifteen minutes.
   *
   * It is a per-call flag rather than a change to `isRetryable` because the retry
   * is right in general: the read bucket is 600/min and its `Retry-After` is
   * often a second or two, where asking again is exactly what a screen should do.
   * What is different about the login route is that its 429 is a *different
   * bucket* with a fifteen-minute window, and that its screen has a retry control
   * of its own — so a hidden retry only delays a sentence the reader can act on.
   */
  retry?: boolean;
};

function url(path: string, query?: RequestOptions["query"]): string {
  const u = new URL(`${BASE}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

async function once<T>(
  schema: z.ZodType<T>,
  session: Session | null,
  path: string,
  opts: RequestOptions,
): Promise<Unwrapped<T>> {
  const method = opts.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(url(path, opts.query), {
      method,
      headers: {
        Accept: "application/json",
        ...(session ? { Authorization: basic(session) } : {}),
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: opts.cache ?? "no-store",
      signal: opts.signal,
    });
  } catch (cause) {
    // `navigator.onLine` is a hint; a failed fetch is the real signal.
    throw new NetworkError(`Could not reach the API at ${BASE}.`, cause);
  }

  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;

  let payload: unknown;
  const text = await response.text();
  try {
    payload = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    throw new ApiError({
      status: response.status,
      code: "unparseable_response",
      message: "The API answered with something that is not JSON.",
      retryAfter,
    });
  }

  return unwrap(schema, payload, response.status, Number.isFinite(retryAfter) ? retryAfter : null);
}

/**
 * One retry, and only for a GET. Never a POST — a retried write is a duplicate
 * write, and the campaign-send route in particular answers 409 to a second
 * attempt precisely because the first one counted.
 */
export async function acFetch<T>(
  schema: z.ZodType<T>,
  session: Session | null,
  path: string,
  opts: RequestOptions = {},
): Promise<Unwrapped<T>> {
  const method = opts.method ?? "GET";
  try {
    return await once(schema, session, path, opts);
  } catch (error) {
    if (opts.retry === false || !isRetryable(error, method)) throw error;
    const wait =
      error instanceof ApiError && error.retryAfter ? Math.min(error.retryAfter, 10) : 1;
    await new Promise((r) => setTimeout(r, wait * 1000));
    return once(schema, session, path, opts);
  }
}
