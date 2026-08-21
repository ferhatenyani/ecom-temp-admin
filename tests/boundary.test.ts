/**
 * @vitest-environment node
 *
 * Pure logic — no DOM. It also has to be node: under jsdom, `jose` receives a
 * Uint8Array from the wrong realm and refuses it ("plaintext must be an instance
 * of Uint8Array"), which is an artefact of the test environment and not of the
 * code under test.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { unwrap } from "@/lib/api/envelope";
import { ApiError, errorMessageKey, isRetryable } from "@/lib/api/errors";
import { checkAllowed } from "@/lib/api/allowlist";
import { BrowserApiError, acRead } from "@/lib/api/browser";
import { seal, unseal } from "@/lib/session/seal";
import { canSeeMoney, canSendCampaigns, canManageOrders } from "@/lib/capabilities";
import { customerName, orderPlace, STATUS_TONE } from "@/lib/orders";
import { order as orderSchema, type Identity, type Order, type Wilaya } from "@/lib/api/schemas/order";
import { readFileSync } from "node:fs";
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "@/lib/theme-color";

const anyObject = z.looseObject({});

describe("the envelope", () => {
  it("returns data and meta on success", () => {
    const { data, meta } = unwrap(
      z.array(anyObject),
      { success: true, data: [{ id: 1 }], meta: { total: 633, page: 1 } },
      200,
    );
    expect(data).toHaveLength(1);
    expect(meta?.total).toBe(633);
  });

  it("throws a typed error carrying details, not a string", () => {
    let thrown: unknown;
    try {
      unwrap(
        anyObject,
        {
          success: false,
          error: {
            code: "conflict",
            message: 'An order cannot move from "processing" to "pending".',
            details: { from: "processing", to: "pending", allowed: ["completed"] },
          },
        },
        409,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    const error = thrown as ApiError;
    expect(error.status).toBe(409);
    expect(error.conflict?.allowed).toEqual(["completed"]);
  });

  it("keeps unknown fields, so an added field is not a breaking change", () => {
    const { data } = unwrap(
      z.looseObject({ id: z.number() }),
      { success: true, data: { id: 1, a_field_added_later: "kept" } },
      200,
    );
    expect(data).toMatchObject({ a_field_added_later: "kept" });
  });

  it("fails at the boundary when a field is retyped, not three components deep", () => {
    expect(() =>
      unwrap(z.looseObject({ total: z.string() }), { success: true, data: { total: 4200 } }, 200),
    ).toThrow(ApiError);
  });

  it("treats a non-2xx outside the envelope as a failure", () => {
    // 413 and 415 can come from the web server rather than the API.
    expect(() => unwrap(anyObject, "<html>Payload Too Large</html>", 413)).toThrow(ApiError);
    // Positive control: the same non-envelope body at 200 is a malformed envelope,
    // also an error, but a different one.
    expect(() => unwrap(anyObject, { nope: true }, 200)).toThrow(ApiError);
  });
});

describe("error behaviour", () => {
  const make = (status: number, code = "x") =>
    new ApiError({ status, code, message: "m" });

  it("treats only a 401 as an auth failure — a 403 is not a logout", () => {
    expect(make(401).isAuthFailure).toBe(true);
    // The bug this guards: a 403 arrives constantly and legitimately, and
    // clearing the session over one makes a Support Agent unable to stay signed in.
    expect(make(403).isAuthFailure).toBe(false);
    expect(make(403).isForbidden).toBe(true);
  });

  it("detects a 401 by status, never by code", () => {
    /**
     * docs/API.md's error table says a 401 carries `unauthenticated`. Measured, a
     * wrong Application Password answers 401 `incorrect_password`, and a suspended
     * account answers 401 `account_suspended`. Keying on the code would have
     * missed both.
     */
    expect(make(401, "incorrect_password").isAuthFailure).toBe(true);
    expect(make(401, "account_suspended").isAuthFailure).toBe(true);
    expect(make(401, "account_suspended").isSuspended).toBe(true);
    expect(make(401, "incorrect_password").isSuspended).toBe(false);
  });

  it("exposes the field list a 400 sends, not just the message", () => {
    const error = new ApiError({
      status: 400,
      code: "invalid_request",
      message: "The product data is invalid.",
      details: { fields: { sale_price: "Cannot exceed the regular price.", sku: "Required." } },
    });
    // Two simultaneously bad fields, both rendered — a toast with the top-level
    // message throws the list away.
    expect(Object.keys(error.fields ?? {})).toEqual(["sale_price", "sku"]);
  });

  it("reads query-parameter errors from details.params", () => {
    // Measured: ?per_page=500 answers 400 with `params`, not `fields`.
    const error = new ApiError({
      status: 400,
      code: "invalid_request",
      message: "m",
      details: { params: { per_page: "per_page must be between 1 and 100" } },
    });
    expect(error.params?.per_page).toContain("100");
    expect(error.fields).toBeNull();
  });

  it("distinguishes an empty allowed list from a missing one", () => {
    // `allowed: []` is a real answer: the order is terminal.
    const terminal = new ApiError({
      status: 409,
      code: "conflict",
      message: "m",
      details: { from: "cancelled", to: "processing", allowed: [] },
    });
    expect(terminal.conflict?.allowed).toEqual([]);
    // A 409's details are only read as a conflict on a 409.
    expect(make(400).conflict).toBeNull();
  });

  it("never retries a write", () => {
    const rateLimited = new ApiError({ status: 429, code: "x", message: "m" });
    expect(isRetryable(rateLimited, "GET")).toBe(true);
    // A retried POST is a duplicate write.
    expect(isRetryable(rateLimited, "POST")).toBe(false);
    expect(isRetryable(rateLimited, "PATCH")).toBe(false);
    // A 400 is never retryable: the payload will not fix itself.
    expect(isRetryable(make(400), "GET")).toBe(false);
  });

  it("maps every status the panel can provoke to its own message", () => {
    for (const [status, key] of [
      [400, "errors.invalid"],
      [403, "errors.forbidden"],
      [404, "errors.notFound"],
      [409, "errors.conflict"],
      [429, "errors.rateLimited"],
      [500, "errors.server"],
    ] as const) {
      expect(errorMessageKey(make(status))).toBe(key);
    }
    expect(errorMessageKey(make(401, "account_suspended"))).toBe("errors.suspended");
  });
});

describe("the proxy allowlist", () => {
  it("permits exactly the routes this step's screens call", () => {
    // Positive controls first: without these the refusals below prove nothing,
    // because a refusal and an unreachable route look identical from outside.
    expect(checkAllowed(["orders"], "GET").allowed).toBe(true);
    expect(checkAllowed(["orders", "3078"], "GET").allowed).toBe(true);
    expect(checkAllowed(["orders", "3078"], "PATCH").allowed).toBe(true);
    expect(checkAllowed(["orders", "3078", "timeline"], "GET").allowed).toBe(true);
    expect(checkAllowed(["auth", "me"], "GET").allowed).toBe(true);
  });

  it("permits the products routes and no more of them than the screens use", () => {
    expect(checkAllowed(["products"], "GET").allowed).toBe(true);
    expect(checkAllowed(["products", "12"], "GET").allowed).toBe(true);
    expect(checkAllowed(["products", "12"], "PATCH").allowed).toBe(true);
    // The detail screen trashes and force-deletes, so DELETE is on the list.
    expect(checkAllowed(["products", "12"], "DELETE").allowed).toBe(true);
    expect(checkAllowed(["products", "12", "variations"], "GET").allowed).toBe(true);
    expect(checkAllowed(["product-categories"], "GET").allowed).toBe(true);
    expect(checkAllowed(["attributes"], "GET").allowed).toBe(true);
    expect(checkAllowed(["attributes", "100", "terms"], "GET").allowed).toBe(true);

    // Nothing creates a product yet, and a route no screen reaches must not be
    // reachable by guessing a URL — the list grows one branch at a time.
    expect(checkAllowed(["products"], "POST").allowed).toBe(false);
    expect(checkAllowed(["products", "12", "duplicate"], "POST").allowed).toBe(false);
    expect(checkAllowed(["products", "bulk"], "POST").allowed).toBe(false);
    expect(checkAllowed(["products", "12", "variations"], "POST").allowed).toBe(false);
    // §88's writes belong to the attributes screen, on its own branch. Reading a
    // term list is what the facet vocabulary needs; writing one is not.
    expect(checkAllowed(["attributes"], "POST").allowed).toBe(false);
    expect(checkAllowed(["attributes", "100", "terms"], "POST").allowed).toBe(false);
    expect(checkAllowed(["attributes", "100"], "DELETE").allowed).toBe(false);
  });

  it("permits the inventory routes the screens call, and only those", () => {
    // Positive controls: the four reads and the two writes this branch built.
    expect(checkAllowed(["inventory"], "GET").allowed).toBe(true);
    expect(checkAllowed(["inventory", "low-stock"], "GET").allowed).toBe(true);
    expect(checkAllowed(["inventory", "lookup"], "GET").allowed).toBe(true);
    expect(checkAllowed(["inventory", "movements"], "GET").allowed).toBe(true);
    expect(checkAllowed(["inventory", "movements", "summary"], "GET").allowed).toBe(true);
    expect(checkAllowed(["inventory", "20"], "GET").allowed).toBe(true);
    // The stock settings — tracking, backorders, the per-product threshold.
    expect(checkAllowed(["inventory", "20"], "PATCH").allowed).toBe(true);
    expect(checkAllowed(["inventory", "20", "adjust"], "POST").allowed).toBe(true);

    // A batch stocktake is a screen nobody has built, so the route stays
    // unreachable even though the API answers it.
    expect(checkAllowed(["inventory", "bulk"], "POST").allowed).toBe(false);
    // The quantity moves through `adjust` and nowhere else; a POST to the item
    // itself is not a route the panel has any use for.
    expect(checkAllowed(["inventory"], "POST").allowed).toBe(false);
    expect(checkAllowed(["inventory", "20"], "DELETE").allowed).toBe(false);
    expect(checkAllowed(["inventory", "20", "adjust"], "GET").allowed).toBe(false);
    // Literal segments are paths, not ids: `\d+` must not have swallowed them.
    expect(checkAllowed(["inventory", "low-stock"], "PATCH").allowed).toBe(false);
    expect(checkAllowed(["inventory", "movements"], "PATCH").allowed).toBe(false);
  });

  it("refuses the routes that would have named a movement's actor", () => {
    /*
     * The ledger carries `actor_id: 475` and no name. Both routes that could
     * resolve one are refused here on purpose, and the decision is measured
     * rather than cautious:
     *
     *   GET /users/{id}   403 for Admin, Manager and Product Manager — three of
     *                     the four roles holding `ac_manage_inventory`
     *   GET /audit-logs   403 for Manager and Product Manager, and carries no
     *                     movement id to join on even where it is readable
     *
     * So neither could produce a ledger that reads the same for everyone, and
     * putting a user-directory route behind the panel's proxy to label rows for
     * a quarter of the staff is not a trade worth making. `movementActor()`
     * documents what the row shows instead.
     */
    expect(checkAllowed(["users", "475"], "GET").allowed).toBe(false);
    expect(checkAllowed(["audit-logs"], "GET").allowed).toBe(false);
  });

  it("permits the seven analytics reports, and no eighth", () => {
    for (const report of [
      "overview",
      "revenue",
      "orders",
      "products",
      "customers",
      "shipping",
      "cod",
    ]) {
      expect(checkAllowed(["analytics", report], "GET").allowed).toBe(true);
    }

    /*
     * `/analytics/revenue` is on the list **because** it is the one route a
     * caller can be refused. Measured 2026-08-21 with a credential holding
     * `ac_view_analytics` without `ac_manage_orders`: a flat 403, while the
     * other six answer 200 with their money keys absent. The panel asks and
     * renders the refusal, naming the capability off `meta.money_requires`.
     * Keeping it off this list would turn a 403 the panel can explain into a
     * 404 it cannot.
     */
    expect(checkAllowed(["analytics", "revenue"], "GET").allowed).toBe(true);
  });

  it("refuses an analytics route that does not exist, and every write", () => {
    // The API registers exactly seven. A guessed eighth must not reach it.
    expect(checkAllowed(["analytics"], "GET").allowed).toBe(false);
    expect(checkAllowed(["analytics", "margin"], "GET").allowed).toBe(false);
    expect(checkAllowed(["analytics", "profit"], "GET").allowed).toBe(false);
    expect(checkAllowed(["analytics", "overview", "export"], "GET").allowed).toBe(false);

    // There is no write on this subject anywhere in the API, so there is none
    // here either.
    for (const method of ["POST", "PATCH", "DELETE"]) {
      expect(checkAllowed(["analytics", "overview"], method).allowed).toBe(false);
      expect(checkAllowed(["analytics", "revenue"], method).allowed).toBe(false);
    }

    /*
     * `/export/orders` stays refused. It is the neighbouring route a reader of
     * this screen will reach for — the same figures, as a file — and it is
     * `ac_manage_orders` territory behind a screen nobody has built. A route no
     * screen calls must not be reachable by guessing a URL.
     */
    expect(checkAllowed(["export", "orders"], "GET").allowed).toBe(false);
    expect(checkAllowed(["export", "customers"], "GET").allowed).toBe(false);
  });

  it("permits the CMS routes the content screens call", () => {
    expect(checkAllowed(["cms", "pages"], "GET").allowed).toBe(true);
    expect(checkAllowed(["cms", "pages"], "POST").allowed).toBe(true);
    expect(checkAllowed(["cms", "pages", "livraison"], "GET").allowed).toBe(true);
    expect(checkAllowed(["cms", "pages", "livraison"], "PATCH").allowed).toBe(true);
    expect(checkAllowed(["cms", "pages", "livraison"], "DELETE").allowed).toBe(true);

    /*
     * A page is addressed by its **full path**, so a child arrives as more than
     * one segment. `legal/conditions-generales` is a real page in this shop and
     * a `[^/]+` pattern would have refused every child page in it — the kind of
     * thing that looks like a 404 from the screen and like a working allowlist
     * from the test that only ever tried a root page.
     */
    expect(checkAllowed(["cms", "pages", "legal", "conditions-generales"], "GET").allowed).toBe(
      true,
    );
    expect(checkAllowed(["cms", "pages", "a", "b", "c"], "PATCH").allowed).toBe(true);

    expect(checkAllowed(["cms", "homepage"], "GET").allowed).toBe(true);
    expect(checkAllowed(["cms", "homepage"], "PUT").allowed).toBe(true);
    expect(checkAllowed(["cms", "banners"], "GET").allowed).toBe(true);
    expect(checkAllowed(["cms", "banners"], "POST").allowed).toBe(true);
    expect(checkAllowed(["cms", "banners", "58"], "PATCH").allowed).toBe(true);
    expect(checkAllowed(["cms", "banners", "58"], "DELETE").allowed).toBe(true);
    expect(checkAllowed(["cms", "faqs"], "GET").allowed).toBe(true);
    expect(checkAllowed(["cms", "faqs", "61"], "PATCH").allowed).toBe(true);
    expect(checkAllowed(["cms", "faq-categories"], "GET").allowed).toBe(true);
    expect(checkAllowed(["cms", "faq-categories"], "POST").allowed).toBe(true);
    expect(checkAllowed(["cms", "faq-categories", "21"], "DELETE").allowed).toBe(true);
    expect(checkAllowed(["cms", "menus", "primary"], "GET").allowed).toBe(true);
    expect(checkAllowed(["cms", "menus", "primary"], "PUT").allowed).toBe(true);
    expect(checkAllowed(["cms", "menus", "footer"], "PUT").allowed).toBe(true);

    expect(checkAllowed(["media"], "GET").allowed).toBe(true);
    expect(checkAllowed(["media"], "POST").allowed).toBe(true);
    expect(checkAllowed(["media", "4234"], "GET").allowed).toBe(true);
    expect(checkAllowed(["media", "4234"], "PATCH").allowed).toBe(true);
  });

  it("refuses the CMS routes no content screen calls", () => {
    /*
     * A menu location is `primary` or `footer` and nothing else. `PUT` to a
     * location with nothing assigned **creates and assigns a menu there** —
     * measured, `PUT /cms/menus/footer` answered 200 having created "Footer
     * navigation" — so a permissive pattern would let a guessed URL invent
     * navigation the theme has no slot for.
     */
    expect(checkAllowed(["cms", "menus", "sidebar"], "PUT").allowed).toBe(false);
    expect(checkAllowed(["cms", "menus", "mobile"], "GET").allowed).toBe(false);

    /*
     * **`DELETE /media/{id}` is absent on purpose.** The route exists and
     * `ac_manage_content` allows it. Nothing in this API tells the panel what an
     * attachment is used by — a banner's `image`, a page thumbnail and a
     * homepage section all reference it with no back-reference anywhere — so the
     * library cannot say what a delete would break. An irreversible action a
     * screen cannot explain is worse than one it does not offer.
     */
    expect(checkAllowed(["media", "4234"], "DELETE").allowed).toBe(false);

    // The homepage is replaced whole. There is no section-level route, and PUT
    // is the only write — a PATCH would imply a merge the API does not do.
    expect(checkAllowed(["cms", "homepage"], "PATCH").allowed).toBe(false);
    expect(checkAllowed(["cms", "homepage"], "DELETE").allowed).toBe(false);
    expect(checkAllowed(["cms", "homepage", "sections"], "PUT").allowed).toBe(false);

    // The index lists and creates; it does not take a body write of its own.
    expect(checkAllowed(["cms", "pages"], "PATCH").allowed).toBe(false);
    expect(checkAllowed(["cms", "pages"], "DELETE").allowed).toBe(false);
    expect(checkAllowed(["cms", "banners"], "PATCH").allowed).toBe(false);
    expect(checkAllowed(["cms", "faqs"], "DELETE").allowed).toBe(false);

    // Guessed neighbours. None of these is a route.
    expect(checkAllowed(["cms"], "GET").allowed).toBe(false);
    expect(checkAllowed(["cms", "settings"], "GET").allowed).toBe(false);
    expect(checkAllowed(["cms", "menus"], "GET").allowed).toBe(false);

    /*
     * The rest of Part X's step 14, which this branch scoped out and split into
     * `feat/notifications` and `feat/campaigns`. Each is a different capability
     * with no screen behind it yet, and a route no screen calls must not be
     * reachable by guessing a URL.
     */
    for (const path of [
      ["campaigns"],
      ["segments"],
      ["email-templates"],
      ["notifications"],
      ["marketing", "config"],
    ]) {
      expect(checkAllowed(path, "GET").allowed).toBe(false);
    }
  });

  it("refuses a traversal before the greedy page pattern can see it", () => {
    /*
     * `/cms/pages/.+` is the one non-literal, non-id pattern on the list, and it
     * has to be greedy because a page's address is a path. What makes that safe
     * is that `checkAllowed()` refuses a segment carrying a slash, a `..` or a
     * `.` **before any pattern is tried** — so the greedy match only ever sees
     * segments Next's catch-all produced from a real URL.
     *
     * Asserted here rather than assumed, because the guard and the pattern were
     * written on different branches and nothing else pairs them.
     */
    expect(checkAllowed(["cms", "pages", ".."], "DELETE").allowed).toBe(false);
    expect(checkAllowed(["cms", "pages", "..", "..", "wp-config"], "GET").allowed).toBe(false);
    expect(checkAllowed(["cms", "pages", "legal/terms"], "GET").allowed).toBe(false);
    expect(checkAllowed(["cms", "pages", ""], "GET").allowed).toBe(false);
    expect(checkAllowed(["cms", "pages", "."], "GET").allowed).toBe(false);
  });

  it("permits the customer routes the screens call, and only those", () => {
    expect(checkAllowed(["customers"], "GET").allowed).toBe(true);
    expect(checkAllowed(["customers", "24"], "GET").allowed).toBe(true);
    expect(checkAllowed(["customers", "24"], "PATCH").allowed).toBe(true);
    expect(checkAllowed(["customers", "24", "orders"], "GET").allowed).toBe(true);

    /*
     * `POST /customers` is refused because **it is not a route** — measured
     * 2026-08-19, it answers 404 `no_route` rather than 403. Staff do not create
     * shoppers; `POST /account/register` is the shopper's own. Asserting it here
     * keeps that fact written down where a future create screen would have to
     * read it before adding the rule.
     */
    expect(checkAllowed(["customers"], "POST").allowed).toBe(false);
    // Deleting a WordPress user reassigns or destroys their orders. That is
    // `ac_manage_users` territory and §87's screen, not this one.
    expect(checkAllowed(["customers", "24"], "DELETE").allowed).toBe(false);
    // The orders sub-resource is a read. Nothing places an order for a customer.
    expect(checkAllowed(["customers", "24", "orders"], "POST").allowed).toBe(false);
    expect(checkAllowed(["customers", "24", "notes"], "GET").allowed).toBe(false);
  });

  it("permits the coupon routes, including the two the picker needs", () => {
    expect(checkAllowed(["coupons"], "GET").allowed).toBe(true);
    // Unlike products, this branch does create: a coupon has no variations, no
    // media and no option set, so the create form is the edit form.
    expect(checkAllowed(["coupons"], "POST").allowed).toBe(true);
    expect(checkAllowed(["coupons", "30"], "GET").allowed).toBe(true);
    expect(checkAllowed(["coupons", "30"], "PATCH").allowed).toBe(true);
    expect(checkAllowed(["coupons", "30"], "DELETE").allowed).toBe(true);

    /*
     * The restriction picker's two sources.
     *
     * `/products` and `/product-categories` are already allowed from the products
     * branch, so labelling a coupon's restrictions through those would have cost
     * nothing here — except that a **Marketing Manager is 403 on both** while
     * holding `ac_manage_coupons`, and they are one of the three roles that can
     * manage coupons. These two sit behind `ac_manage_coupons` instead and carry
     * id, name and SKU only.
     */
    expect(checkAllowed(["coupons", "eligible-products"], "GET").allowed).toBe(true);
    expect(checkAllowed(["coupons", "eligible-categories"], "GET").allowed).toBe(true);

    // Literal segments are paths, not ids — `\d+` must not have swallowed them,
    // and they are reads.
    expect(checkAllowed(["coupons", "eligible-products"], "POST").allowed).toBe(false);
    expect(checkAllowed(["coupons", "eligible-categories"], "DELETE").allowed).toBe(false);
    // A coupon's redemptions are not a route the API has; `used_by` is emitted by
    // nothing, so nothing may go looking for it.
    expect(checkAllowed(["coupons", "30", "usage"], "GET").allowed).toBe(false);
  });

  it("permits the shipping routes the screens call, and only those", () => {
    expect(checkAllowed(["shipping", "providers"], "GET").allowed).toBe(true);
    expect(checkAllowed(["shipping", "rates"], "GET").allowed).toBe(true);
    expect(checkAllowed(["shipping", "rules"], "GET").allowed).toBe(true);
    expect(checkAllowed(["shipping", "rules"], "POST").allowed).toBe(true);
    expect(checkAllowed(["shipping", "rules", "162"], "PATCH").allowed).toBe(true);
    expect(checkAllowed(["shipping", "rules", "162"], "DELETE").allowed).toBe(true);

    expect(checkAllowed(["shipments"], "GET").allowed).toBe(true);
    expect(checkAllowed(["shipments", "220"], "GET").allowed).toBe(true);
    // The only writable field is `status`; an empty body is a 400 asking for it.
    expect(checkAllowed(["shipments", "220"], "PATCH").allowed).toBe(true);
    expect(checkAllowed(["shipments", "220", "cancel"], "POST").allowed).toBe(true);
    expect(checkAllowed(["shipments", "220", "sync"], "POST").allowed).toBe(true);

    // A parcel is created against an order, never at the collection.
    expect(checkAllowed(["orders", "3939", "shipments"], "POST").allowed).toBe(true);
    expect(checkAllowed(["shipments"], "POST").allowed).toBe(false);
    // Neither is a shipment deletable — the API has no such route, and history
    // accumulating is what makes "one *live* shipment per order" the constraint.
    expect(checkAllowed(["shipments", "220"], "DELETE").allowed).toBe(false);

    // The commune picker the rule form and the rate tester both need.
    expect(checkAllowed(["locations", "wilayas", "16", "communes"], "GET").allowed).toBe(true);
    expect(checkAllowed(["locations", "communes", "484"], "GET").allowed).toBe(false);
    expect(checkAllowed(["locations", "coverage"], "GET").allowed).toBe(false);
  });

  it("permits reading and verifying a payment, and never starting one", () => {
    expect(checkAllowed(["payments"], "GET").allowed).toBe(true);
    expect(checkAllowed(["payments", "methods"], "GET").allowed).toBe(true);
    expect(checkAllowed(["payments", "37"], "GET").allowed).toBe(true);
    expect(checkAllowed(["payments", "37", "verify"], "POST").allowed).toBe(true);
    expect(checkAllowed(["orders", "3939", "payments"], "GET").allowed).toBe(true);

    /*
     * `POST /orders/{id}/payments` is the one write on this subject the API
     * offers and it is deliberately refused.
     *
     * It opens a checkout at the provider and returns a `checkout_url` for the
     * customer to pay through — measured, with `provider: "chargily"` it reached
     * the live sandbox and handed back a real `pay.chargily.dz` link. That is a
     * shopper action taken by the storefront, and a staff member who could mint
     * payment links against an order is a fraud surface with no screen behind it.
     */
    expect(checkAllowed(["orders", "3939", "payments"], "POST").allowed).toBe(false);

    // There is no PATCH on a payment at all — `paid → refunded` is enforced
    // inside verification, not through a route the panel could reach.
    expect(checkAllowed(["payments", "37"], "PATCH").allowed).toBe(false);
    expect(checkAllowed(["payments", "37"], "DELETE").allowed).toBe(false);
    // `methods` is a literal segment, not an id, and it is a read.
    expect(checkAllowed(["payments", "methods"], "POST").allowed).toBe(false);
  });

  it("permits the COD writes the order detail makes, and the statistics read", () => {
    expect(checkAllowed(["orders", "3939", "cod"], "GET").allowed).toBe(true);
    // Toggles `enabled` and nothing else; the whole GET body PATCHes back
    // because every other field is dropped as read-only.
    expect(checkAllowed(["orders", "3939", "cod"], "PATCH").allowed).toBe(true);
    expect(checkAllowed(["orders", "3939", "cod", "attempts"], "POST").allowed).toBe(true);
    expect(checkAllowed(["cod", "statistics"], "GET").allowed).toBe(true);

    // An attempt is recorded, never listed or unrecorded: the history lives in
    // the order timeline as audit rows, which the detail already reads.
    expect(checkAllowed(["orders", "3939", "cod", "attempts"], "GET").allowed).toBe(false);
    expect(checkAllowed(["orders", "3939", "cod"], "DELETE").allowed).toBe(false);
    expect(checkAllowed(["cod", "statistics"], "POST").allowed).toBe(false);
  });

  it("refuses the platform routes docs/API.md opens by telling you not to touch", () => {
    // A generic proxy here is an open relay to wp/v2/users with an admin
    // credential attached.
    expect(checkAllowed(["users"], "GET").allowed).toBe(false);
    expect(checkAllowed(["settings"], "PATCH").allowed).toBe(false);
    /*
     * `/customers` used to be in this list and has moved up to its own case now
     * that a screen calls it. What stays refused is the storefront's half of the
     * same subject: `/account/*` is the *shopper's* identity, authenticated by a
     * customer token, and the panel holds a staff credential. A staff credential
     * against `/account` is either a 401 or, worse, the staff member's own
     * account — never the customer whose screen is open.
     *
     * `POST /account/marketing-consent` is the specific one the consent row names
     * in its explanation, and naming a route is not a reason to proxy it.
     */
    expect(checkAllowed(["account"], "GET").allowed).toBe(false);
    expect(checkAllowed(["account", "marketing-consent"], "POST").allowed).toBe(false);
    expect(checkAllowed(["account", "orders"], "GET").allowed).toBe(false);
  });

  it("refuses a permitted path with an unpermitted method", () => {
    const result = checkAllowed(["orders", "3078", "timeline"], "DELETE");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("method");
  });

  it("refuses traversal and injected separators", () => {
    for (const segments of [
      ["orders", ".."],
      ["orders", "../../wp/v2/users"],
      ["orders", ""],
      [],
    ]) {
      expect(checkAllowed(segments, "GET").allowed).toBe(false);
    }
  });

  it("anchors its patterns, so a longer path does not slip through", () => {
    expect(checkAllowed(["orders", "3078", "notes", "secret"], "GET").allowed).toBe(false);
    expect(checkAllowed(["auth", "mexyz"], "GET").allowed).toBe(false);
  });
});

describe("the sealed session", () => {
  it("round-trips a credential", async () => {
    const session = { username: "ac_paneldev", password: "abcd EFGH ijkl", userId: 473 };
    const token = await seal(session);
    expect(await unseal(token)).toEqual(session);
  });

  it("is encrypted, not merely signed — the payload is the credential", async () => {
    const token = await seal({ username: "u", password: "s3cret-value", userId: 1 });
    // A signed-but-readable cookie hands the password to anyone reading a proxy log.
    expect(token).not.toContain("s3cret-value");
    expect(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()).not.toContain(
      "s3cret",
    );
  });

  it("returns null for a tampered or absent token rather than throwing", async () => {
    const token = await seal({ username: "u", password: "p", userId: 1 });
    expect(await unseal(undefined)).toBeNull();
    expect(await unseal("not-a-jwe")).toBeNull();
    expect(await unseal(`${token}tampered`)).toBeNull();
    // Positive control: the untampered token still opens.
    expect(await unseal(token)).not.toBeNull();
  });
});

describe("capability predicates", () => {
  const me = (capabilities: string[]): Identity =>
    ({
      id: 1,
      username: "u",
      display_name: "u",
      email: "e",
      roles: [],
      capabilities,
      auth_method: "application_password",
    }) as Identity;

  it("gates money on both capabilities, not one", () => {
    // Positive control: a Super Admin sees money.
    expect(canSeeMoney(me(["ac_view_analytics", "ac_manage_orders"]))).toBe(true);
    // The compound rule: analytics alone is not enough.
    expect(canSeeMoney(me(["ac_view_analytics"]))).toBe(false);
    expect(canSeeMoney(me(["ac_manage_orders"]))).toBe(false);
  });

  it("gates campaign sending on marketing plus customers", () => {
    expect(canSendCampaigns(me(["ac_manage_marketing", "ac_manage_customers"]))).toBe(true);
    // A Marketing Manager can create (201) and is refused at send (403). Not a bug.
    expect(canSendCampaigns(me(["ac_manage_marketing"]))).toBe(false);
  });

  it("treats no session as no capability", () => {
    expect(canManageOrders(null)).toBe(false);
    expect(canSeeMoney(null)).toBe(false);
  });
});

describe("order domain rules", () => {
  const base = orderSchema.parse({
    id: 1,
    number: "1",
    status: "pending",
    currency: "DZD",
    customer_id: 0,
    customer_note: "",
    payment_method: "cod",
    payment_method_title: "",
    billing: {
      first_name: "",
      last_name: "",
      company: "",
      address_1: "",
      address_2: "",
      city: "",
      state: "",
      postcode: "",
      country: "",
      phone: "",
      email: "",
    },
    shipping: {
      first_name: "",
      last_name: "",
      company: "",
      address_1: "",
      address_2: "",
      city: "",
      state: "",
      postcode: "",
      country: "",
      phone: "",
    },
    line_items: [],
    discount_total: "0.00",
    shipping_total: "0.00",
    total_tax: "0.00",
    subtotal: "0.00",
    total: "0.00",
    is_editable: true,
    needs_payment: false,
    stock_reduced: false,
    date_created: "2026-08-18T00:00:00+00:00",
    date_modified: "2026-08-18T00:00:00+00:00",
    date_paid: null,
    date_completed: null,
  });

  const withBilling = (fields: Partial<Order["billing"]>): Order => ({
    ...base,
    billing: { ...base.billing, ...fields },
  });

  it("builds a name from whichever block has one, with no trailing space", () => {
    // Measured: billing.first_name is filled on 403 of 633 orders and last_name on
    // only 71, so the two do not arrive as a pair.
    expect(customerName(withBilling({ first_name: "Nadia", last_name: "Haddad" }))).toBe(
      "Nadia Haddad",
    );
    expect(customerName(withBilling({ first_name: "Nadia" }))).toBe("Nadia");
    expect(customerName(withBilling({ last_name: "Haddad" }))).toBe("Haddad");
    expect(customerName(base)).toBeNull();
  });

  it("falls back to the other script when a wilaya name is empty", () => {
    /**
     * Measured: 2 of 69 wilayas carry an empty `name_ar` — and they are Algiers
     * (16) and Oran (31), the two highest-traffic ones. Returning `name_ar`
     * unconditionally blanked the place on exactly those orders.
     */
    const wilayas = new Map<string, Wilaya>([
      ["16", { id: 16, code: "16", slug: "algiers", name: "Algiers", name_ar: "", is_active: true } as Wilaya],
      ["19", { id: 19, code: "19", slug: "setif", name: "Sétif", name_ar: "سطيف", is_active: true } as Wilaya],
    ]);
    const inAlgiers = withBilling({ state: "16" });
    const inSetif = withBilling({ state: "19" });
    // Positive control: a complete row uses the locale's own script.
    expect(orderPlace(inSetif, wilayas, "ar")).toBe("سطيف");
    expect(orderPlace(inSetif, wilayas, "fr")).toBe("Sétif");
    // The gap: never an empty string.
    expect(orderPlace(inAlgiers, wilayas, "ar")).toBe("Algiers");
    expect(orderPlace(inAlgiers, wilayas, "fr")).toBe("Algiers");
  });

  it("falls back to the city, then to nothing at all", () => {
    const wilayas = new Map<string, Wilaya>();
    expect(orderPlace(withBilling({ city: "Bir Mourad Raïs" }), wilayas, "fr")).toBe(
      "Bir Mourad Raïs",
    );
    // ~93 % of orders carry no place. A placeholder there is a column of dashes.
    expect(orderPlace(base, wilayas, "fr")).toBeNull();
  });

  it("pads a single-digit wilaya code before lookup", () => {
    const wilayas = new Map<string, Wilaya>([
      ["09", { id: 9, code: "09", slug: "blida", name: "Blida", name_ar: "البليدة", is_active: true } as Wilaya],
    ]);
    expect(orderPlace(withBilling({ state: "9" }), wilayas, "fr")).toBe("Blida");
  });

  it("gives every status a tone", () => {
    // A status with no tone renders an undefined class and loses its only
    // non-textual signal.
    for (const status of [
      "pending",
      "processing",
      "on-hold",
      "completed",
      "cancelled",
      "refunded",
      "failed",
    ] as const) {
      expect(STATUS_TONE[status]).toBeTruthy();
    }
  });
});

describe("the browser's envelope reader", () => {
  /**
   * The sweep's proof.
   *
   * `orders/query.ts` and `products/query.ts` each carried a hand-rolled copy of
   * this reader until the analytics branch, and the differences between the
   * copies were never intentional. Each case below is one of those differences,
   * measured against the live API rather than imagined — so this suite fails if
   * the sweep is ever undone by someone re-inlining a fetch.
   */
  const stub = (
    body: unknown,
    init: { status?: number; text?: string } = {},
  ): typeof globalThis.fetch =>
    (async () =>
      ({
        ok: (init.status ?? 200) < 400,
        status: init.status ?? 200,
        text: async () => init.text ?? JSON.stringify(body),
      }) as Response) as unknown as typeof globalThis.fetch;

  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("prefers the parameter's own sentence over the generic message", async () => {
    /*
     * Measured on `/orders?per_page=500`. The orders fetcher read
     * `error.message` alone, so the screen said "Invalid parameter(s):
     * per_page" — which names the parameter and not the rule. The half that
     * says what to do about it was in `details.params` and was dropped.
     */
    globalThis.fetch = stub(
      {
        success: false,
        error: {
          code: "invalid_request",
          message: "Invalid parameter(s): per_page",
          details: {
            params: { per_page: "per_page must be between 1 (inclusive) and 100 (inclusive)" },
          },
        },
      },
      { status: 400 },
    );

    await expect(acRead("/orders?per_page=500")).rejects.toThrow(
      "per_page must be between 1 (inclusive) and 100 (inclusive)",
    );
  });

  it("never renders an array of parameter names as though it were an explanation", async () => {
    /*
     * `details.params` has **two shapes on this API**. Measured on
     * `/inventory/lookup`: a *missing* required parameter answers
     * `{"params": ["sku"]}`. The products fetcher did `Object.values(params)[0]`,
     * which on an array is its first element — so the screen would have read
     * "sku". It falls through to the API's own message instead.
     */
    globalThis.fetch = stub(
      {
        success: false,
        error: {
          code: "invalid_request",
          message: "Missing parameter(s): sku",
          details: { params: ["sku"] },
        },
      },
      { status: 400 },
    );

    let thrown: unknown;
    try {
      await acRead("/inventory/lookup");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BrowserApiError);
    expect((thrown as BrowserApiError).message).toBe("Missing parameter(s): sku");
    expect((thrown as BrowserApiError).message).not.toBe("sku");
  });

  it("keeps status, code and fields as real properties", async () => {
    // Both hand-rolled copies threw a bare `Error` with `status` and `code` glued
    // on by `Object.assign` — which type-checked, and told a caller nothing.
    globalThis.fetch = stub(
      {
        success: false,
        error: {
          code: "duplicate_sku",
          message: "That SKU is already in use.",
          details: { sku: "AC-BUR-010", fields: { sku: "Already in use." } },
        },
      },
      { status: 409 },
    );

    const thrown = await acRead("/products/1").catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(BrowserApiError);
    const error = thrown as BrowserApiError;
    expect(error.status).toBe(409);
    expect(error.code).toBe("duplicate_sku");
    expect(error.fields).toEqual({ sku: "Already in use." });
    expect(error.details.sku).toBe("AC-BUR-010");
  });

  it("survives an empty body, which both copies threw on", async () => {
    // `response.json()` throws on an empty string, so a 204 — or a 200 with
    // nothing in it — failed inside the parser rather than succeeding.
    globalThis.fetch = stub(null, { status: 204, text: "" });
    await expect(acRead("/whatever")).resolves.toEqual({ data: [], total: 0, meta: {} });
  });

  it("returns meta whole, which is what let the products fetcher stop copying it", async () => {
    /*
     * `total` was the only thing the shared reader exposed, and `/products` needs
     * `meta.facets` as well — so it kept a private copy of the entire envelope
     * reader to get one extra key. The analytics routes need `money_visible` and
     * `generated_at` from the same place.
     */
    globalThis.fetch = stub({
      success: true,
      data: [{ id: 1 }],
      meta: { total: 28, facets: { price: { min: "0", max: "1" } }, money_visible: false },
    });

    const { data, total, meta } = await acRead<{ id: number }[]>("/products");
    expect(data).toHaveLength(1);
    expect(total).toBe(28);
    expect(meta.facets).toEqual({ price: { min: "0", max: "1" } });
    expect(meta.money_visible).toBe(false);
  });

  it("treats a 2xx carrying success:false as a failure", async () => {
    globalThis.fetch = stub({ success: false, error: { code: "nope", message: "Refused." } });
    await expect(acRead("/anything")).rejects.toThrow("Refused.");
  });

  it("does not pretend a non-JSON body is an envelope", async () => {
    globalThis.fetch = stub(null, { status: 502, text: "<html>Bad Gateway</html>" });
    const error = (await acRead("/anything").catch((e: unknown) => e)) as BrowserApiError;
    expect(error).toBeInstanceOf(BrowserApiError);
    expect(error.code).toBe("unparseable_response");
  });
});

describe("the token boundary", () => {
  it("keeps theme-color in step with the token it mirrors", () => {
    /**
     * lib/theme-color.ts is the one file outside tokens.css allowed a colour
     * literal, because Next's metadata API cannot read a custom property. Nothing
     * enforces the pairing, so this asserts it.
     */
    const tokens = readFileSync("styles/tokens.css", "utf8");
    const light = tokens.match(/--color-bg-grouped:\s*(#[0-9a-fA-F]{3,8})/);
    const dark = tokens.match(
      /:root\[data-theme="dark"\][\s\S]*?--color-bg-grouped:\s*(#[0-9a-fA-F]{3,8})/,
    );
    expect(light?.[1]?.toLowerCase()).toBe(THEME_COLOR_LIGHT.toLowerCase());
    expect(dark?.[1]?.toLowerCase()).toBe(THEME_COLOR_DARK.toLowerCase());
  });
});
