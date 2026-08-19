import { z } from "zod";
import { DISCOUNT_TYPES, READABLE_COUPON_STATUSES } from "@/lib/coupon-status";

/*
 * The vocabulary lives in `lib/coupon-status.ts`, with no dependencies, and this
 * module imports it — the split `lib/movement-reason.ts` and
 * `lib/product-status.ts` both make. A client component that needs
 * `RESTRICTION_FIELDS` as a *value* must be able to import it without pulling
 * Zod into the browser, and only `import type` is erased. `CouponForm` does
 * exactly that.
 */

/**
 * Shapes measured against the live API on 2026-08-19.
 *
 * A coupon is the third place this panel meets the null-versus-zero distinction,
 * and the first where it runs in **both directions on the same object**:
 *
 *   `amount`     `"0.00"` is a real coupon. The `livraison` fixture is exactly
 *                that — a zero discount with `free_shipping: true` — so a zero
 *                here is a value, not an absence.
 *   thresholds   `null` is the absence and there is no zero. The API stores
 *                `0` as null on the way in, so `"0.00"` can never be read back
 *                from `minimum_amount`.
 *
 * Rendering the two the same way is the inventory lesson arriving for a third
 * time; `lib/coupons.ts` keeps them apart by type.
 */

/**
 * A restriction id resolved to a name — the `restrictions` block, added to the
 * API on this branch.
 *
 * **`missing` is present on every row, not only the broken ones.** An id that
 * resolves to nothing keeps its place in the list with `name: null`, because a
 * client that filtered it out would silently delete the restriction the next time
 * the form saved. A product deleted after the coupon was written leaves a real,
 * stale id; validating writes cannot make reads total.
 */
export const restrictionRef = z.looseObject({
  id: z.number(),
  name: z.string().nullable(),
  missing: z.boolean(),
  /** Products only, and `null` when the product carries no SKU. */
  sku: z.string().nullable().optional(),
  /** Products only. A coupon may legitimately be restricted to a draft. */
  status: z.string().optional(),
  /** Categories only. */
  slug: z.string().optional(),
});
export type RestrictionRef = z.infer<typeof restrictionRef>;

export const restrictions = z.looseObject({
  product_ids: z.array(restrictionRef),
  excluded_product_ids: z.array(restrictionRef),
  product_categories: z.array(restrictionRef),
  excluded_product_categories: z.array(restrictionRef),
});
export type Restrictions = z.infer<typeof restrictions>;

export const coupon = z.looseObject({
  id: z.number(),
  /**
   * Always lower case. The API lower-cases on save — `BRIEF-TEST-99` comes back
   * `brief-test-99` — and the duplicate check runs against the folded form, so
   * `BIENVENUE10` collides with `bienvenue10`. The form folds as the user types
   * so what they see is what will be stored.
   */
  code: z.string(),
  status: z.enum(READABLE_COUPON_STATUSES),
  discount_type: z.enum(DISCOUNT_TYPES),
  /** A decimal string, and `"0.00"` is a real value. Never null. */
  amount: z.string(),
  description: z.string(),
  /**
   * **Asymmetric, and this is what breaks a date input.** It is *written* as
   * `Y-m-d` and *read back* as full ISO — `"2026-12-31T00:00:00+00:00"`. An
   * `<input type="date">` bound straight to the response renders empty, and then
   * clears the field on the next save. `expiryInputValue()` is the only thing
   * that may put this in a control.
   */
  date_expires: z.string().nullable(),
  /** `null` is no threshold. There is no `"0.00"` here — see the file docblock. */
  minimum_amount: z.string().nullable(),
  maximum_amount: z.string().nullable(),
  usage_limit: z.number().nullable(),
  usage_limit_per_user: z.number().nullable(),
  limit_usage_to_x_items: z.number().nullable(),
  /**
   * Read-only, and `0` on all four fixtures. No panel route can move it —
   * redemption happens at `POST /cart/coupons`, on the storefront — so the
   * non-zero rendering has no data in this shop that can reach it.
   *
   * `used_by` is in the API's own read-only list and is emitted by nothing, so
   * *who* redeemed a coupon is not answerable and the screen does not imply it is.
   */
  usage_count: z.number(),
  individual_use: z.boolean(),
  free_shipping: z.boolean(),
  exclude_sale_items: z.boolean(),
  product_ids: z.array(z.number()),
  excluded_product_ids: z.array(z.number()),
  product_categories: z.array(z.number()),
  excluded_product_categories: z.array(z.number()),
  email_restrictions: z.array(z.string()),
  date_created: z.string(),
  date_modified: z.string().nullable(),
});
export type Coupon = z.infer<typeof coupon>;

export const couponList = z.array(coupon);

/**
 * The detail. `restrictions` is emitted by `GET`, `POST` and `PATCH` on a single
 * coupon and **not by the list** — resolving 100 rows would populate a column no
 * list shows — so the two shapes differ by exactly that key, the way a customer's
 * `statistics` does.
 */
export const couponDetail = coupon.extend({ restrictions });
export type CouponDetail = z.infer<typeof couponDetail>;

/**
 * A row in the product picker. Four fields and no fifth.
 *
 * `/coupons/eligible-products` exists because `/products` is `ac_manage_products`
 * and a **Marketing Manager does not hold it** — one of the three roles that can
 * manage coupons, and the one whose job coupons are. It is not the catalogue
 * behind a second capability: there is no price here, no stock, no cost.
 */
export const eligibleProduct = z.looseObject({
  id: z.number(),
  name: z.string(),
  sku: z.string().nullable(),
  status: z.string(),
});
export type EligibleProduct = z.infer<typeof eligibleProduct>;
export const eligibleProductList = z.array(eligibleProduct);

export const eligibleCategory = z.looseObject({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  parent: z.number(),
  count: z.number(),
});
export type EligibleCategory = z.infer<typeof eligibleCategory>;
export const eligibleCategoryList = z.array(eligibleCategory);
