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
 * RFC 4122's shape, for the one path segment that is neither a literal nor an
 * id: an application password's uuid.
 *
 * Composed from a hex class rather than written out, and that is not only
 * tidiness — `scripts/check-design.sh` refuses an arbitrary Tailwind value by
 * matching a hyphen, an opening bracket and a digit, which is exactly the
 * sequence a hyphen-separated hex class produces when the uuid is spelled out.
 * A regular expression is not a class name and the script has no way to know
 * that, so the pattern is built where the two cannot collide. The alternative
 * was an exemption in the script, and an exemption is how a rule stops being
 * one.
 */
const HEX = "[0-9a-fA-F]";
const UUID = `${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12}`;

/**
 * Only what this step's screens actually call. The list grows one route group per
 * branch, which is the point of it being a list: a screen that has not been built
 * cannot be reached through the proxy by guessing a URL.
 */
const RULES: readonly Rule[] = [
  rule("/auth/me", "GET"),
  /*
   * `POST /orders` is here now, and it is the first write this list has allowed
   * on a collection route.
   *
   * The rule the whole file follows is that a route is allowed when a screen
   * reaches it and not before — the products block below refuses `POST
   * /products` on exactly that ground. `NewOrderDrawer` is that screen: it is
   * the panel's back-office order entry, for an order taken over the phone or
   * at a counter, which is the one order this shop creates that no checkout
   * ever will.
   *
   * The route is `ac_manage_orders`, the same capability the list and the
   * detail already require, so this widens no credential — it widens what the
   * panel can ask for with one it already holds.
   */
  rule("/orders", "GET", "POST"),
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
   * **`DELETE /media/{id}` was deliberately absent until 2026-08-28, and the
   * reason it was absent is the reason it is here now.** The entry this replaces
   * read: the route exists and `ac_manage_content` allows it, but an attachment
   * referenced by a banner, a page thumbnail or a homepage section has **no
   * back-reference anywhere in this API**, so the panel could not tell a person
   * what a delete would break — and a library offering an irreversible action it
   * cannot explain is worse than one that does not offer it. The route stays
   * unreachable, it said, "until a screen can answer *used by what?*".
   *
   * The API grew the answer. **`GET /media/{id}/usage`** — `MediaUsageRepository`
   * — reads the five stores this codebase can put an attachment id in
   * (`featured_image`, `gallery`, `option_choice_image`, `seo_image`,
   * `store_logo`) and returns what holds it, alongside `checked` and
   * `incomplete`: the places it looked and the two documents no query can search,
   * a homepage section's untyped `data` and any `<img>` inside content HTML. So
   * `total: 0` means *nothing known uses this* and never *nothing uses this*, and
   * the panel can now write exactly that sentence.
   *
   * Both routes are allowlisted together and neither is useful alone. `DELETE` is
   * `wp_delete_attachment($id, true)` — trash bypassed, file unlinked from disk —
   * and the API deliberately does **not** refuse it for an image in use: a hard
   * refusal would make a deliberately-unused picture undeletable, so the endpoint
   * informs and the operator decides. That is only true if the panel asks; the
   * delete without the usage read would be the unexplained irreversible action
   * the old comment refused, wearing an allowlist entry.
   *
   * `/media/\d+/usage` is a third segment, so it needs its own rule —
   * `/media/\d+` does not match it — and it is `GET` only. Nothing else under an
   * attachment is reachable.
   */
  rule("/media", "GET", "POST"),
  rule("/media/\\d+", "GET", "PATCH", "DELETE"),
  rule("/media/\\d+/usage", "GET"),

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

  /*
   * Marketing. `ac_manage_marketing`, with a **second capability on three of
   * them** — `send`, `recipients` and a segment's count also need
   * `ac_manage_customers`, because a campaign reaches every customer record in
   * the shop and a count of an audience is a count of customers.
   *
   * That compound rule finally has a fixture again. Part V records the two-tier
   * collapse having made "drafts but cannot send" a state no role reaches;
   * measured 2026-08-21, the retired `ac_marketing_manager` that
   * `scripts/test.sh` already mints is **200** on `/campaigns`, the detail and
   * the preview, and **403** on exactly those three.
   *
   * `POST /marketing/events/purchase` is deliberately absent, and it is the one
   * write on this subject the API offers here. It records a *storefront*
   * conversion — the browser and the server each report their half and share an
   * `event_id` so Meta does not count it twice — and a panel that could post one
   * would be inventing purchases in somebody's ad reporting. §85 assigns it to
   * the storefront; nothing in this panel calls it.
   *
   * `/marketing/unsubscribe` is likewise absent. It is public, signed-token, and
   * belongs to the customer following a link in their mail. Proxying it through
   * a staff credential would let the panel unsubscribe people, which is a
   * consent record it has no business writing — `PATCH /customers/{id}` already
   * refuses `marketing_consent` by name for the same reason.
   *
   * There is no `DELETE /email-templates/{id}` and no write of any kind: §85
   * makes a template a `ac_email_template` post authored in wp-admin, where the
   * revisions and the media library already are, and the API only reads them.
   */
  rule("/campaigns", "GET", "POST"),
  rule("/campaigns/\\d+", "GET", "PATCH", "DELETE"),
  rule("/campaigns/\\d+/preview", "GET"),
  rule("/campaigns/\\d+/test", "POST"),
  rule("/campaigns/\\d+/cancel", "POST"),
  rule("/campaigns/\\d+/send", "POST"),
  rule("/campaigns/\\d+/recipients", "GET"),
  rule("/segments", "GET", "POST"),
  rule("/segments/\\d+", "GET", "PATCH", "DELETE"),
  rule("/segments/\\d+/preview", "GET"),
  rule("/email-templates", "GET"),
  rule("/email-templates/\\d+", "GET"),
  rule("/marketing/config", "GET"),

  /*
   * Settings. `ac_manage_settings`, which is Super Admin alone — measured, a
   * Manager holding ten other management capabilities is 403 on both verbs.
   * That is the boundary that stops an Admin escalating, and the forbidden
   * screen names Super Admin rather than the capability string.
   *
   * `PATCH` writes four blocks and refuses `features`, `providers` and every
   * secret **by name with the reason**, which is what the screen renders. The
   * refusals never reach the wire from here — no control offers them — but the
   * route is one route and the method is the whole verb.
   */
  rule("/settings", "GET", "PATCH"),

  /*
   * Staff users and roles. `ac_manage_users`, Super Admin alone.
   *
   * **`GET /users/{id}` was refused for eleven branches and is allowed now**,
   * and the reason it was refused is worth keeping: the inventory ledger wanted
   * it to turn a movement's `actor_id` into a name, and it is Super Admin only
   * while `ac_manage_inventory` is held by four roles — so allowing it there
   * would have put a user-directory route behind the proxy to label rows three
   * quarters of the staff would never see. It is allowed here because this is
   * the screen the route exists for, and its capability and this screen's gate
   * are the same capability. `tests/boundary.test.ts` asserts the change and the
   * ledger's own note is updated rather than deleted.
   *
   * `POST /users/{id}/application-passwords` is the onboarding step and the
   * reason §87 exists — WordPress shows a password once, in wp-admin, which
   * PLAN §52 says routine administration must not require.
   *
   * The uuid pattern is pinned to the RFC 4122 shape rather than left as
   * `[^/]+`: it comes from a row the panel is holding, never from a person, and
   * a permissive segment on a `DELETE` is a revoke aimed by guessing.
   */
  rule("/users", "GET", "POST"),
  rule("/users/\\d+", "GET", "PATCH", "DELETE"),
  rule("/users/\\d+/application-passwords", "GET", "POST"),
  rule(`/users/\\d+/application-passwords/${UUID}`, "DELETE"),
  rule("/roles", "GET"),

  /*
   * The audit trail. `ac_view_audit_logs`, and read-only because the route is:
   * audit records are append-only and there is no POST, PATCH or DELETE on the
   * API to allow.
   */
  rule("/audit-logs", "GET"),

  /*
   * Imports. **The only routes in this panel whose body is not JSON** — the CSV
   * is the raw request body with `Content-Type: text/csv`, which differs from
   * `/media`, the only other upload here, and which ADMIN_PANEL.md says outright
   * will be got wrong once. `acWriteRaw()` exists for exactly these two.
   *
   * `dry_run` defaults to **true**, so a request that lost the parameter
   * previews and never writes.
   *
   * There is no `/import/orders` and no `/import/customers`, and that is the
   * API's shape rather than an omission here: an order comes from a checkout and
   * a customer from a registration, and a CSV that invented either would be
   * inventing money and consent.
   */
  rule("/import/(products|inventory)", "POST"),

  /*
   * **The four exports are deliberately NOT on this list**, and this comment is
   * the second half of the two unit tests that assert it.
   *
   * An export is a file, not an envelope — `text/csv`, a `Content-Disposition`
   * filename that is the API's, and a UTF-8 BOM Excel needs. This proxy forwards
   * only `content-type` and `retry-after`, so a download routed through it would
   * arrive with no filename and no `no-store`, and `acRead()` would try to
   * `JSON.parse` a spreadsheet.
   *
   * `app/api/export/[subject]/route.ts` is the second deliberate bypass of the
   * envelope client, after `app/api/label/[id]`. It carries its own subject
   * allowlist, so nothing is reachable that this file refuses.
   */
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
