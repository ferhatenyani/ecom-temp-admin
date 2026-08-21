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
  // The order detail's own sub-resources. `PATCH /cod` and `POST /shipments`
  // arrived with the shipping branch, which is what turned three read-only
  // sections into two that write; see the shipping block below for both.
  rule("/orders/\\d+/cod", "GET", "PATCH"),
  rule("/orders/\\d+/cod/attempts", "POST"),
  rule("/orders/\\d+/shipments", "GET", "POST"),
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

  /*
   * Customers. Three routes, which is every route the API has for them.
   *
   * `POST /customers` is absent because it does not exist: measured 2026-08-19,
   * it answers **404 `no_route`**, not 403. Staff cannot create a shopper — an
   * account comes from `POST /account/register`, which is the shopper's own — so
   * the panel has no create screen and there is nothing here to allow.
   *
   * `DELETE` is likewise not a route. Deleting a WordPress user reassigns or
   * destroys their orders, and that is `ac_manage_users` territory.
   */
  rule("/customers", "GET"),
  rule("/customers/\\d+", "GET", "PATCH"),
  rule("/customers/\\d+/orders", "GET"),

  /*
   * Coupons. `POST` is here, unlike products, because this screen does create:
   * a coupon has no counterpart to a product's variations, media or option sets,
   * so a create form is the same form as the edit form with an empty object
   * behind it. `DELETE` covers both the trash and `?force=true`.
   *
   * The two `eligible-*` routes are the restriction picker's sources and are the
   * reason the picker exists at all. `/products` and `/product-categories` are
   * already on this list from the products branch, so labelling a coupon's
   * restrictions through *those* would have cost nothing — except that a
   * Marketing Manager is **403** on both while holding `ac_manage_coupons`
   * (measured), and they are one of the three roles that can manage coupons.
   * These two sit behind `ac_manage_coupons` and carry id, name and SKU only.
   *
   * Ordering is not load-bearing: `\d+` cannot match `eligible-products`.
   */
  rule("/coupons", "GET", "POST"),
  rule("/coupons/eligible-products", "GET"),
  rule("/coupons/eligible-categories", "GET"),
  rule("/coupons/\\d+", "GET", "PATCH", "DELETE"),

  /*
   * Shipping. The tariff, the resolver, and the parcels.
   *
   * `/shipping/rates` is a read that takes `wilaya_id` and `commune_id` and is
   * the authority the rules editor previews against — the panel resolves its own
   * winner for the live preview and shows the server's answer beside it.
   *
   * `/locations/wilayas/\d+/communes` joins this list here rather than with the
   * orders branch: the rule form and the rate tester both need a commune picker,
   * and `/locations/wilayas` alone cannot fill one. Both are public routes on the
   * API — an address form needs them before anyone signs in — so this widens the
   * proxy's surface by nothing that was not already reachable without a
   * credential.
   *
   * `DELETE /shipping/rules/{id}` is here because the rules table deletes. There
   * is no `POST /shipments` — a parcel is created against an order, and the
   * order-scoped route below is the only way in.
   */
  rule("/shipping/providers", "GET"),
  rule("/shipping/rates", "GET"),
  rule("/shipping/rules", "GET", "POST"),
  rule("/shipping/rules/\\d+", "GET", "PATCH", "DELETE"),
  rule("/shipments", "GET"),
  rule("/shipments/\\d+", "GET", "PATCH"),
  rule("/shipments/\\d+/cancel", "POST"),
  rule("/shipments/\\d+/sync", "POST"),
  rule("/locations/wilayas/\\d+/communes", "GET"),

  /*
   * Payments. Read and verify, and nothing that starts one.
   *
   * **`POST /orders/{id}/payments` is deliberately absent**, and it is the only
   * write on this subject the API offers. It opens a checkout at the provider and
   * returns a `checkout_url` for the *customer* to pay through — measured, with
   * `provider: "chargily"` it reached the live sandbox and handed back a real
   * `pay.chargily.dz` link. That is a shopper action taken by the storefront, not
   * an operator action taken from an admin panel, and a staff member who could
   * mint payment links for an order is a fraud surface the panel has no reason to
   * open. It also answers a shape that is not a payment — `{provider_payment_id,
   * status, checkout_url, metadata}`, with no id and no amount — so nothing on
   * this screen could even render the result.
   *
   * `verify` is a POST because it asks the gateway a question and writes down the
   * answer, which may settle an order and reduce stock.
   */
  rule("/payments", "GET"),
  rule("/payments/methods", "GET"),
  rule("/payments/\\d+", "GET"),
  rule("/payments/\\d+/verify", "POST"),

  /*
   * Cash on delivery. `/orders/{id}/cod` and its `attempts` are listed with the
   * order's other sub-resources above, because that is the screen they belong to.
   *
   * `PATCH /orders/{id}/cod` toggles `enabled` and nothing else — every other
   * field is read-only and dropped silently, so the whole GET body PATCHes back.
   *
   * `/cod/statistics` is `ac_view_analytics`, which both tiers hold, unlike
   * `ac_manage_orders` on the two routes above — so this is the one place on the
   * branch where a figure can render for a reader who cannot open the orders
   * behind it.
   */
  rule("/cod/statistics", "GET"),

  /*
   * Analytics. Seven reads, and reads are all they are — there is no write on
   * this subject anywhere in the API.
   *
   * `/analytics/revenue` is on the list despite being the one route a caller can
   * be refused. It has to be: the panel *asks* and renders the refusal, which is
   * the only way the money gate can be honest. Measured 2026-08-21 with a
   * credential holding `ac_view_analytics` without `ac_manage_orders` — a flat
   * **403**, while the other six answer 200 with their money keys *absent*
   * rather than nulled. Keeping it off the list would turn a 403 the panel can
   * explain into a 404 it cannot.
   *
   * Nothing else under `/analytics/` is added. The API registers exactly these
   * seven and a guessed eighth must not reach it.
   */
  rule("/analytics/overview", "GET"),
  rule("/analytics/revenue", "GET"),
  rule("/analytics/orders", "GET"),
  rule("/analytics/products", "GET"),
  rule("/analytics/customers", "GET"),
  rule("/analytics/shipping", "GET"),
  rule("/analytics/cod", "GET"),

  /*
   * Content. `ac_manage_content`, which after the two-tier collapse is the Super
   * Admin tier alone — a **Manager is 403 on every route in this block**,
   * measured, which makes one credential a real forbidden fixture for the whole
   * branch.
   *
   * `GET /cms/pages` did not exist when this branch started. It was added to the
   * backend on `feat/cms-page-index` because the screen was not buildable
   * without it: the API could address a page by path and could not list one, so
   * a Pages screen had no index and no way to discover a page whose path nobody
   * remembered — and worse, a draft and a path that does not exist are the same
   * 404 with the same message, so the screen could not even say which had
   * happened. The `feat/coupon-pickers` precedent, one collection over.
   *
   * `/cms/pages/.+` is the one pattern here that is not a literal or an id, and
   * it is deliberately greedy: a page is addressed by its **full path**, so
   * `legal/terms` arrives as two segments and a `[^/]+` would refuse every child
   * page in the shop. The traversal guard in `checkAllowed()` runs first and is
   * what makes that safe — a segment containing `..` or a slash is refused
   * before any pattern is tried, so the greedy match can only ever see segments
   * the catch-all produced from a real URL.
   */
  rule("/cms/pages", "GET", "POST"),
  rule("/cms/pages/.+", "GET", "PATCH", "DELETE"),
  rule("/cms/homepage", "GET", "PUT"),
  rule("/cms/banners", "GET", "POST"),
  rule("/cms/banners/\\d+", "PATCH", "DELETE"),
  rule("/cms/faqs", "GET", "POST"),
  rule("/cms/faqs/\\d+", "PATCH", "DELETE"),
  rule("/cms/faq-categories", "GET", "POST"),
  rule("/cms/faq-categories/\\d+", "PATCH", "DELETE"),
  /*
   * `{location}` is `primary` or `footer` and nothing else — pinned to the two
   * rather than left as `[a-z0-9_-]+`, because `PUT` to an unregistered location
   * **creates and assigns a menu** there. Measured: `PUT /cms/menus/footer`
   * against a location with nothing assigned answered 200 having created
   * "Footer navigation". A permissive pattern would let a guessed URL invent
   * navigation the theme has no slot for.
   */
  rule("/cms/menus/(primary|footer)", "GET", "PUT"),

  /*
   * Media. `POST` is the upload and is the only `multipart/form-data` request
   * the panel makes — every other write here is JSON.
   *
   * **`DELETE /media/{id}` is deliberately absent.** The route exists and the
   * capability allows it, but nothing on this branch deletes a file: an
   * attachment referenced by a banner, a page thumbnail or a homepage section
   * has no back-reference anywhere in this API, so the panel cannot tell a
   * person what a delete would break. A library that offers an irreversible
   * action it cannot explain is worse than one that does not offer it, and the
   * route stays unreachable until a screen can answer "used by what?".
   */
  rule("/media", "GET", "POST"),
  rule("/media/\\d+", "GET", "PATCH"),

  /*
   * Notifications. **`ac_manage_customers`, not `ac_manage_content`** — which is
   * why this is its own branch and not part of the block above. A row holds a
   * customer's address and, on the single read, the frozen body of their order
   * confirmation: their name and what they bought. §90 gates it on the
   * capability that already reads a customer's record and explicitly refuses to
   * invent one, so a Manager is **200** here and 403 on every `/cms/` route
   * above — the two fixtures invert, measured.
   *
   * Three routes, which is every route the API has for them. There is no write
   * beyond the retry and nothing here sends: §59d put the drain behind
   * `wp algerian-commerce send-notifications` precisely so an SMTP server that
   * hangs cannot hang the panel, and the retry answers 202 naming that command.
   *
   * `POST /notifications` is absent because it does not exist — a queue row is
   * written by an order save, never by a person — and there is no `DELETE`: a
   * sent notification is a record of something that left the building.
   */
  rule("/notifications", "GET"),
  rule("/notifications/\\d+", "GET"),
  rule("/notifications/\\d+/retry", "POST"),
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
