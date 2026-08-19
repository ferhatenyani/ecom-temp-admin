/**
 * The coupon vocabulary, with no dependencies.
 *
 * The same split `lib/movement-reason.ts` and `lib/product-status.ts` make, and
 * for the same measured reason: **Zod costs 60 KB gzipped in the browser.** The
 * schema module imports these constants; a client component imports them too, and
 * imports only *types* from the schema. If the vocabulary lived in the schema
 * file, importing `RESTRICTION_FIELDS` as a value from a row component would pull
 * Zod into the bundle — a value import is not erased the way `import type` is.
 *
 * Nothing here talks to the API. Everything here is a list the API told us about.
 */

/** WooCommerce's own three. There is no fourth, and no `maximum_discount`. */
export const DISCOUNT_TYPES = ["percent", "fixed_cart", "fixed_product"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/**
 * What `?status=` accepts, and what the form may set. Two values.
 *
 * The 400 for anything else reads `status is not one of , publish, and draft` —
 * with an empty string as the first named option, because the "no filter"
 * sentinel is in the enum the router validates against. Worth knowing before
 * showing that message to a person: it offers an option that is not a status.
 */
export const COUPON_STATUSES = ["publish", "draft"] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

/**
 * What can be **read** is wider than what can be filtered — exactly as
 * `READABLE_STATUSES` is for products, and measured the same way.
 * `DELETE /coupons/{id}` answers 200, the coupon drops out of the list (5 → 4),
 * and a following `GET` answers **200 with `status: "trash"`** rather than 404;
 * only `?force=true` produces the 404. Meanwhile `?status=trash` as a *filter* is
 * a 400. A schema without `trash` would fail at its own boundary the moment
 * someone trashes a coupon and the detail screen reloads underneath them.
 */
export const READABLE_COUPON_STATUSES = [...COUPON_STATUSES, "trash"] as const;
export type ReadableCouponStatus = (typeof READABLE_COUPON_STATUSES)[number];

/**
 * Colour is never the only signal; every consumer pairs this with a word.
 *
 * `publish` is neutral rather than green: every coupon in this shop is published,
 * and a column of green badges marks nothing. Same reasoning as
 * `PRODUCT_STATUS_TONE`.
 */
export const COUPON_STATUS_TONE: Record<
  ReadableCouponStatus,
  "neutral" | "warning" | "danger"
> = {
  publish: "neutral",
  draft: "warning",
  trash: "danger",
};

/** The four restriction fields, named once so nothing iterates a literal twice. */
export const RESTRICTION_FIELDS = [
  "product_ids",
  "excluded_product_ids",
  "product_categories",
  "excluded_product_categories",
] as const;
export type RestrictionField = (typeof RESTRICTION_FIELDS)[number];

/**
 * Which of the four name products and which name categories — as a lookup rather
 * than two lists, because every caller wants the answer for one field and not the
 * membership of a set. Two lists meant one of them was never read.
 */
export const RESTRICTION_KIND: Record<RestrictionField, "products" | "categories"> = {
  product_ids: "products",
  excluded_product_ids: "products",
  product_categories: "categories",
  excluded_product_categories: "categories",
};

/** Which of the four exclude rather than include — the pair rendered as a warning tone. */
export function isExclusion(field: RestrictionField): boolean {
  return field === "excluded_product_ids" || field === "excluded_product_categories";
}
