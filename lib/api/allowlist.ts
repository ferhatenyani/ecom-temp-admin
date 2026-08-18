/**
 * The proxy is an allowlist, not a pass-through.
 *
 * A generic proxy that forwards anything under `/wp-json/` is an open relay to
 * `/wp/v2/users` with an admin credential attached — the exact thing
 * docs/API.md opens by telling you not to touch. So the incoming path is matched
 * against patterns, and an unmatched path never reaches the API.
 *
 * This module is deliberately free of `server-only` so the unit suite can import
 * it directly; it holds no credential and no secret, only rules.
 */

type Rule = { pattern: RegExp; methods: ReadonlySet<string> };

const rule = (source: string, ...methods: string[]): Rule => ({
  pattern: new RegExp(`^${source}$`),
  methods: new Set(methods),
});

/**
 * Only what this step's screens actually call. The list grows one route group per
 * branch, which is the point of it being a list: a screen that has not been built
 * cannot be reached through the proxy by guessing a URL.
 */
const RULES: readonly Rule[] = [
  rule("/auth/me", "GET"),
  rule("/orders", "GET"),
  rule("/orders/\\d+", "GET", "PATCH"),
  rule("/orders/\\d+/notes", "GET"),
  rule("/orders/\\d+/timeline", "GET"),
  rule("/orders/\\d+/cod", "GET"),
  rule("/orders/\\d+/shipments", "GET"),
  rule("/orders/\\d+/payments", "GET"),
  rule("/locations/wilayas", "GET"),

  // Products. `DELETE` is here because the detail screen trashes and
  // force-deletes; `POST /products` is not, because nothing creates a product
  // yet and a route the panel cannot reach through the UI must not be reachable
  // by guessing a URL.
  rule("/products", "GET"),
  rule("/products/\\d+", "GET", "PATCH", "DELETE"),
  rule("/products/\\d+/variations", "GET"),
  rule("/product-categories", "GET"),
  rule("/attributes", "GET"),
  rule("/attributes/\\d+/terms", "GET"),

  /*
   * Inventory. The literal segments are listed before `/inventory/\d+` for
   * readability only — `\d+` cannot match `low-stock`, `lookup`, `movements` or
   * `bulk`, so no ordering is load-bearing here the way it is in the backend's
   * own route registration.
   *
   * Two absences are deliberate and each is asserted by a unit test:
   *
   * `POST /inventory/bulk` — a batch stocktake is a screen nobody has built.
   * The route exists, takes up to 100 items and inherits every single-item rule,
   * and it stays unreachable until something in the panel calls it.
   *
   * `GET /users/{id}` — the one route that would turn a movement's `actor_id`
   * into a name. It is Super Admin only (measured: 403 for Admin, Manager and
   * Product Manager, the other three roles holding `ac_manage_inventory`), so
   * the ledger cannot be built on it; see `movementActor()` for what the row
   * shows instead. Allowing it "just for Super Admins" would put a user-directory
   * route behind the panel's proxy for the sake of a label three quarters of the
   * staff would never see.
   */
  rule("/inventory", "GET"),
  rule("/inventory/low-stock", "GET"),
  rule("/inventory/lookup", "GET"),
  rule("/inventory/movements", "GET"),
  rule("/inventory/movements/summary", "GET"),
  // PATCH is the settings — tracking, backorders, the low-stock threshold. The
  // quantity is not settable there and answers 400 naming the adjust endpoint,
  // which is what keeps the movement ledger gapless.
  rule("/inventory/\\d+", "GET", "PATCH"),
  rule("/inventory/\\d+/adjust", "POST"),
];

export type AllowResult =
  | { allowed: true; path: string }
  | { allowed: false; reason: "path" | "method" };

/**
 * `segments` is the `[...path]` catch-all, already URL-decoded by Next.
 *
 * A segment containing a slash or a `..` is refused before the patterns run: the
 * catch-all cannot produce one from a normal URL, so its presence means someone
 * is trying to escape the namespace.
 */
export function checkAllowed(segments: string[], method: string): AllowResult {
  if (segments.length === 0) return { allowed: false, reason: "path" };
  if (segments.some((s) => s.includes("/") || s === ".." || s === "." || s === "")) {
    return { allowed: false, reason: "path" };
  }

  const path = `/${segments.join("/")}`;
  const matches = RULES.filter((r) => r.pattern.test(path));
  if (matches.length === 0) return { allowed: false, reason: "path" };
  if (!matches.some((r) => r.methods.has(method))) return { allowed: false, reason: "method" };
  return { allowed: true, path };
}

/**
 * Response headers worth forwarding. Everything else is dropped, and
 * `Set-Cookie` is never forwarded in either direction — WordPress has no
 * business setting a cookie on the panel's origin, and the panel's session
 * cookie has no business reaching WordPress.
 */
export const FORWARD_RESPONSE_HEADERS = ["content-type", "retry-after"] as const;
