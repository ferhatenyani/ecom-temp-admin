/**
 * One error type, and one place that decides what a status means.
 *
 * The mapping lives here rather than in components because docs/ADMIN_PANEL.md's
 * table is a behaviour contract, and the two rules it is easiest to get wrong —
 * a 403 is not a logout, and a 409 body is worth reading — are exactly the ones
 * that get reinvented per screen if this file does not exist.
 */

/** The `details` object shapes this API actually sends. */
export type FieldErrors = Record<string, string>;

export type ConflictDetails = {
  /** An order status transition refusal: `{from, to, allowed}`. */
  from?: string;
  to?: string;
  allowed?: string[];
  [key: string]: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The API's own French message. Surfaced only where it is actionable. */
  readonly apiMessage: string;
  readonly details: Record<string, unknown>;
  readonly retryAfter: number | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryAfter?: number | null;
  }) {
    super(`${init.status} ${init.code}: ${init.message}`);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.apiMessage = init.message;
    this.details = init.details ?? {};
    this.retryAfter = init.retryAfter ?? null;
  }

  /**
   * A 400 lists every bad field on purpose, so render this and not
   * `apiMessage` — a toast saying "The product data is invalid" throws the list
   * away.
   */
  get fields(): FieldErrors | null {
    const f = this.details.fields;
    if (!f || typeof f !== "object") return null;
    const out: FieldErrors = {};
    for (const [k, v] of Object.entries(f as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  /**
   * Query-parameter validation arrives under `details.params`, not
   * `details.fields`. Measured 2026-08-18: `?per_page=500` answers
   * 400 `{"params": {"per_page": "per_page must be between 1 …"}}`.
   */
  get params(): FieldErrors | null {
    const p = this.details.params;
    if (!p || typeof p !== "object") return null;
    const out: FieldErrors = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  /**
   * The 409 body is the authority on which status moves are legal. An empty
   * array is a real answer — a terminal order has no moves — and is different
   * from the field being absent.
   */
  get conflict(): ConflictDetails | null {
    if (this.status !== 409) return null;
    return this.details as ConflictDetails;
  }

  /**
   * Only a 401 clears the session. Getting this wrong makes a Support Agent
   * unable to stay signed in, because a 403 arrives constantly and legitimately.
   *
   * Keyed on the status and never on the code: measured 2026-08-18, a wrong
   * Application Password answers 401 with `code: "incorrect_password"`, and a
   * suspended account answers 401 `account_suspended`. Neither is
   * `unauthenticated`, which is what docs/API.md's error table lists.
   */
  get isAuthFailure(): boolean {
    return this.status === 401;
  }

  /** A suspended account will not be fixed by signing in again. Say so. */
  get isSuspended(): boolean {
    return this.status === 401 && this.code === "account_suspended";
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/** A transport or parse failure — no HTTP status reached us. */
export class NetworkError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "NetworkError";
    this.cause = cause;
  }
}

/**
 * The panel's own error vocabulary. API messages are French-only because the
 * API emits one language, so every code the panel can provoke gets a localised
 * message of its own and the API's `message` is the fallback for codes the panel
 * does not know.
 */
export function errorMessageKey(error: unknown): string {
  if (error instanceof NetworkError) return "errors.network";
  if (!(error instanceof ApiError)) return "errors.unknown";
  switch (error.status) {
    case 400:
      return "errors.invalid";
    case 401:
      return error.isSuspended ? "errors.suspended" : "errors.unauthenticated";
    case 403:
      return "errors.forbidden";
    case 404:
      return "errors.notFound";
    case 409:
      return "errors.conflict";
    case 413:
      return "errors.tooLarge";
    case 415:
      return "errors.badType";
    case 429:
      return "errors.rateLimited";
    default:
      return error.status >= 500 ? "errors.server" : "errors.unknown";
  }
}

/**
 * 429 backs off by Retry-After and retries once — but never a POST, and never
 * anything else automatically. Reads are 600/min per credential and shared
 * across every tab that person has open.
 */
export function isRetryable(error: unknown, method: string): boolean {
  if (method !== "GET") return false;
  if (error instanceof NetworkError) return true;
  return error instanceof ApiError && (error.status === 429 || error.status >= 500);
}
