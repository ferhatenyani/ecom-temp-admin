import { RESTRICTION_FIELDS } from "@/lib/coupon-status";
import type { DiscountType, RestrictionField } from "@/lib/coupon-status";
import type { Coupon, RestrictionRef, Restrictions } from "@/lib/api/schemas/coupon";

/**
 * What a coupon row and the coupon form need to know, in one place.
 *
 * Types only from the schema module, so this stays importable from a client
 * component without dragging Zod along — the arrangement `lib/inventory.ts` and
 * `lib/products.ts` both use.
 */

/* ------------------------------------------------------------ the code --- */

/**
 * The code, as it will actually be stored.
 *
 * WooCommerce lower-cases every code on save, so `BRIEF-TEST-99` comes back
 * `brief-test-99` — and the duplicate check runs against the folded form, which
 * makes `BIENVENUE10` a 409 against the existing `bienvenue10`. Folding as the
 * user types means the field shows what will be stored and the conflict, when it
 * comes, names a code the person recognises.
 *
 * `trim` is here rather than only on submit because a trailing space is invisible
 * and would otherwise be silently removed by the API, moving the caret.
 */
export function normalizeCode(input: string): string {
  return input.trim().toLowerCase();
}

/* --------------------------------------------------------- the discount --- */

/**
 * How to render the amount: as a percentage or as money.
 *
 * **`"0.00"` is a real coupon and must not be treated as an absence.** The
 * `livraison` fixture is `amount: "0.00"` with `free_shipping: true` — a coupon
 * whose discount is genuinely nothing and whose whole effect is the shipping.
 * That is the inverse of the threshold fields on the same object, where zero is
 * stored as null and cannot be read back, so the two cannot share a formatter.
 */
export type Discount =
  | { kind: "percent"; value: string }
  | { kind: "money"; value: string };

export function discount(coupon: Pick<Coupon, "discount_type" | "amount">): Discount {
  return coupon.discount_type === "percent"
    ? { kind: "percent", value: coupon.amount }
    : { kind: "money", value: coupon.amount };
}

/**
 * Whether the coupon's headline effect is the shipping rather than the amount.
 *
 * A row reading "0 DA" beside a coupon called *livraison* is accurate and
 * useless; `free_shipping` is what that coupon does. Only true when the amount is
 * actually zero — a coupon that discounts 2 000 DA *and* ships free is led by the
 * 2 000.
 */
export function isShippingOnly(coupon: Pick<Coupon, "amount" | "free_shipping">): boolean {
  return coupon.free_shipping && Number(coupon.amount) === 0;
}

/* -------------------------------------------------------- the threshold --- */

/**
 * A spend threshold, or the fact that there is none.
 *
 * **`null` is an empty field, never a zero**, and the API guarantees it: an
 * absent minimum is stored and read as null, and a `0` sent on a write is folded
 * to null on the way in. So `"0.00"` can never appear here, and a screen printing
 * `0,00 DA` where there is no minimum would be inventing a restriction.
 *
 * A discriminated union rather than `string | null` so a caller cannot reach the
 * figure without having said which case they are in — the same shape
 * `displayQuantity()` uses for the same reason.
 */
export type Threshold = { set: false } | { set: true; value: string };

export function threshold(value: string | null): Threshold {
  return value === null || value === "" ? { set: false } : { set: true, value };
}

/* ----------------------------------------------------------- the expiry --- */

/**
 * The value an `<input type="date">` may be given.
 *
 * **`date_expires` is asymmetric and this is what breaks a naive form.** It is
 * written as `Y-m-d` and read back as full ISO 8601:
 *
 *   PATCH {"date_expires": "2026-12-31"}  →  "2026-12-31T00:00:00+00:00"
 *
 * A date input bound straight to the response value renders **empty**, because
 * the control accepts `YYYY-MM-DD` and nothing else. The field then looks unset,
 * and the next save posts an empty string — which the API accepts as "clear the
 * expiry". So the round trip silently deletes the date nobody touched.
 *
 * Slicing the day off is safe: WooCommerce expires a coupon at the end of its
 * day, so the time component carries no information. The API accepts the full ISO
 * form back as well (measured), but the input cannot display it, which is the
 * half that matters.
 */
export function expiryInputValue(dateExpires: string | null): string {
  if (dateExpires === null || dateExpires === "") return "";
  const day = dateExpires.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

/**
 * Whether a coupon's expiry has passed.
 *
 * The API accepts a past date without complaint — measured, `2020-01-01` is a 200
 * — so an expired coupon is an ordinary state the list will contain, not an
 * impossible one. It reads as `publish` and would otherwise look live.
 *
 * Compared as calendar days in UTC, matching how WooCommerce stores the field:
 * the value is midnight UTC and the coupon is valid *through* that day, so a
 * coupon expiring today has not expired.
 */
export function isExpired(dateExpires: string | null, now: Date): boolean {
  if (dateExpires === null || dateExpires === "") return false;

  const day = dateExpires.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;

  const today = now.toISOString().slice(0, 10);
  return day < today;
}

/* ------------------------------------------------------------ the usage --- */

/**
 * How much of a coupon's usage allowance is gone.
 *
 * `usage_count` is 0 on every coupon in this shop and no panel route can move it
 * — redemption is `POST /cart/coupons`, on the storefront — so the "nearly used
 * up" rendering has no data here that can reach it. It is still built, because a
 * real shop's coupons are the opposite, and it is guarded rather than assumed.
 *
 * `used_by` is emitted by nothing, so *who* redeemed a coupon is unanswerable and
 * the screen never implies otherwise.
 */
export type Usage =
  | { limited: false; count: number }
  | { limited: true; count: number; limit: number; exhausted: boolean };

export function usage(coupon: Pick<Coupon, "usage_count" | "usage_limit">): Usage {
  if (coupon.usage_limit === null) return { limited: false, count: coupon.usage_count };

  return {
    limited: true,
    count: coupon.usage_count,
    limit: coupon.usage_limit,
    exhausted: coupon.usage_count >= coupon.usage_limit,
  };
}

/* ----------------------------------------------------- the restrictions --- */

/**
 * Which restriction fields carry anything, so the form and the row can say
 * "restricted" without four empty sections.
 */
export function restrictionCount(coupon: Pick<Coupon, RestrictionField>): number {
  return (
    coupon.product_ids.length +
    coupon.excluded_product_ids.length +
    coupon.product_categories.length +
    coupon.excluded_product_categories.length
  );
}

/**
 * The stale ids across every restriction field.
 *
 * A product deleted after the coupon was written leaves an id that resolves to
 * nothing, and the API reports it as `{id, name: null, missing: true}` rather
 * than dropping it — because a client that dropped it would delete the
 * restriction the next time the form saved.
 *
 * The form surfaces these as a warning rather than silently keeping them: a
 * coupon restricted to a product that no longer exists applies to nothing, and
 * that is indistinguishable, from every other angle, from a coupon that works.
 */
export function missingRefs(restrictions: Restrictions): RestrictionRef[] {
  // Iterated through `RESTRICTION_FIELDS` rather than `Object.values`: the schema
  // is a `looseObject`, so its index signature is `unknown` and `Object.values`
  // would hand back `unknown[]`. Naming the four fields keeps the type and means
  // a fifth restriction field cannot be silently picked up untyped.
  return RESTRICTION_FIELDS.flatMap((field) => restrictions[field]).filter(
    (ref) => ref.missing,
  );
}

/**
 * A restriction's label, or the honest absence of one.
 *
 * Never falls back to the bare id as a *name* — an id printed where a name goes
 * reads as a product called 8842. The caller renders the missing case as its own
 * thing, with the id as evidence rather than as a label. The same rule
 * `movementActor()` follows for an actor it cannot name.
 */
export function refLabel(ref: RestrictionRef): { named: true; text: string } | { named: false } {
  return ref.missing || ref.name === null || ref.name === ""
    ? { named: false }
    : { named: true, text: ref.name };
}

/**
 * Which discount types the per-product restrictions actually bite on.
 *
 * `fixed_product` discounts each matching line; `percent` and `fixed_cart` apply
 * to the cart and use the product list only as a *condition*. The distinction is
 * WooCommerce's and the form states it rather than leaving a shop to discover
 * that "500 DA off these two products" took 500 DA off the whole basket.
 */
export function discountsPerProduct(type: DiscountType): boolean {
  return type === "fixed_product";
}
