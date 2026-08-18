/**
 * Why stock moved — the whole vocabulary, in one place with no dependencies at
 * all, for the same reason `lib/product-status.ts` has none: the picker, the
 * ledger's filter and the row renderer are all client components that need these
 * *values*, and importing them from a Zod schema would pull Zod's runtime into
 * the route to ship nine strings.
 *
 * **The vocabulary is a union of two endpoints, and neither one is complete.**
 * Measured 2026-08-18 against the live API:
 *
 *   POST /inventory/{id}/adjust  refuses anything outside
 *                                correction, restock, damage, loss,
 *                                customer_return, other       ← 6, the manual set
 *   GET  /inventory/movements/summary  returned keys
 *                                correction, damage, loss, order_reduced,
 *                                order_restored, product_edit, restock ← 7
 *
 * The two sets overlap in four. `order_reduced`, `order_restored` and
 * `product_edit` are written by the plugin and a human may never choose one — the
 * adjust endpoint rejects them with the *same* message as an unknown reason, on
 * purpose, so a caller cannot probe which forgeries exist. And
 * `customer_return` and `other` are choosable but have **zero** movements in this
 * shop today, so the summary omits them entirely.
 *
 * So this is the facet lesson in a new place. A picker built from the summary
 * offers three reasons that answer 400; a legend built from the summary is
 * missing two that a person can create at any moment. Neither response is a
 * vocabulary — one is a set of permissions and the other is a set of counts — and
 * the union of the two is what the screen needs.
 */

/** What a person may send to `POST /inventory/{id}/adjust`. Exactly these six. */
export const MANUAL_REASONS = [
  "correction",
  "restock",
  "damage",
  "loss",
  "customer_return",
  "other",
] as const;
export type ManualReason = (typeof MANUAL_REASONS)[number];

/**
 * Written by the shop, never by a person. `order_reduced` and `order_restored`
 * come from WooCommerce's own stock hooks when an order changes status;
 * `product_edit` covers a quantity changed through the product write endpoints,
 * and exists so the ledger has no gaps it cannot explain.
 */
export const SYSTEM_REASONS = ["order_reduced", "order_restored", "product_edit"] as const;
export type SystemReason = (typeof SYSTEM_REASONS)[number];

/**
 * The union — every reason the ledger can *contain*, which is what a filter and a
 * legend are built from. `GET /inventory/movements?reason=` accepts all nine
 * (verified: `?reason=order_reduced` → 480 rows), because the ledger is read in
 * full even though only six may be written.
 */
export const ALL_REASONS = [...MANUAL_REASONS, ...SYSTEM_REASONS] as const;
export type MovementReason = (typeof ALL_REASONS)[number];

export function isManualReason(reason: string): reason is ManualReason {
  return (MANUAL_REASONS as readonly string[]).includes(reason);
}

export function isKnownReason(reason: string): reason is MovementReason {
  return (ALL_REASONS as readonly string[]).includes(reason);
}

/**
 * Colour is never the only signal — every consumer pairs this with the
 * translated word, and the ledger row carries the signed delta besides.
 *
 * The two order reasons are `neutral` rather than success/danger deliberately:
 * an order reducing stock is the shop working correctly, and 480 of 1154 rows are
 * that. Tinting the commonest row red would mark the ledger's normal state as a
 * problem and leave nothing to notice `damage` by.
 */
export const REASON_TONE: Record<
  MovementReason,
  "neutral" | "info" | "warning" | "success" | "danger"
> = {
  correction: "info",
  restock: "success",
  damage: "danger",
  loss: "danger",
  customer_return: "info",
  other: "neutral",
  order_reduced: "neutral",
  order_restored: "neutral",
  product_edit: "warning",
};

/* ------------------------------------------------------- the adjustment --- */

/**
 * `set`, `increase` and `decrease` are three different mental operations behind
 * one endpoint, and the difference is not convenience.
 *
 * WooCommerce applies increase and decrease as a **relative SQL update**, so two
 * concurrent decrements compose correctly. Two concurrent `set`s are
 * last-writer-wins. A stocktake states an absolute and wants `set`; receiving or
 * writing off goods states a movement and wants the relative form — and using
 * `set` for it silently discards whatever landed in between.
 */
export const ADJUST_MODES = ["set", "increase", "decrease"] as const;
export type AdjustMode = (typeof ADJUST_MODES)[number];

/**
 * What the shelf would read after this adjustment.
 *
 * The panel renders this beside the field so no mode is ever a subtraction the
 * person has to do in their head — the whole reason three modes can share one
 * control. It is a *preview*, not a promise: the API records the before and after
 * WooCommerce actually wrote, because a concurrent adjustment can land in
 * between.
 */
export function projectQuantity(
  mode: AdjustMode,
  quantity: number,
  current: number,
): number {
  switch (mode) {
    case "increase":
      return current + quantity;
    case "decrease":
      return current - quantity;
    default:
      return quantity;
  }
}

/**
 * The rules the API enforces on `quantity`, checked here so the field can say so
 * before a round trip rather than only after one. Measured against the live 400s;
 * the API remains the authority and its message is what lands on the field.
 *
 * Returns a key into `messages.*.adjust.invalid`, or `null` when the value is
 * one the API will accept.
 */
export function quantityProblem(
  mode: AdjustMode,
  raw: string,
): "required" | "whole" | "negative" | "positive" | null {
  const trimmed = raw.trim();
  if (trimmed === "") return "required";
  if (!/^-?\d+$/.test(trimmed)) return "whole";

  const value = Number.parseInt(trimmed, 10);
  if (value < 0) return "negative";
  // A zero-magnitude move is a no-op that would still write a ledger row, so the
  // API refuses it for the two relative modes and allows it for `set` — setting a
  // shelf to zero is a real thing to record.
  if (value === 0 && mode !== "set") return "positive";
  return null;
}
