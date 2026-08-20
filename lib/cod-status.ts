/**
 * The cash-on-delivery vocabulary, with no dependencies. Same split as
 * `lib/shipment-status.ts`, same reason.
 *
 * **COD is order metadata and audit events, never a status.** A COD outcome does
 * not move the order, and the section that renders these must not offer anything
 * that looks like it does. Verified 2026-08-20: recording `confirmed` on order
 * 3876 left the order at `processing` with `date_modified` untouched.
 */

/** Five states. `pending` is where every COD order starts. */
export const COD_STATUSES = [
  "pending",
  "confirmed",
  "rejected",
  "unreachable",
  "cancelled",
] as const;
export type CodStatus = (typeof COD_STATUSES)[number];

/**
 * The three a confirmation call can conclude with.
 *
 * `pending` is absent because it is a starting point, not an outcome, and
 * `cancelled` is absent because a cancellation happens to the *order* and is
 * carried across by the API rather than recorded as a call. Measured: both are
 * refused with **400 `details.fields.outcome`** — *"Must be one of: confirmed,
 * rejected, unreachable."* — and a missing `outcome` gets a different message
 * again, *"Required. One of: …"*.
 *
 * The panel never renders from this list. `allowed_outcomes` on the record is
 * server-supplied and is what the buttons come from, exactly as the 409's
 * `allowed` list drives an order transition. This exists so a payload can be
 * type-checked before it is sent.
 */
export const COD_OUTCOMES = ["confirmed", "rejected", "unreachable"] as const;
export type CodOutcome = (typeof COD_OUTCOMES)[number];

export function isCodOutcome(value: string): value is CodOutcome {
  return (COD_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Colour is never the only signal; every consumer pairs this with a word.
 *
 * `unreachable` is a warning, not a danger: the call did not connect, which is
 * retried. `rejected` is terminal and is the customer saying no.
 */
export const COD_STATUS_TONE: Record<
  CodStatus,
  "neutral" | "success" | "warning" | "danger"
> = {
  pending: "warning",
  confirmed: "success",
  rejected: "danger",
  unreachable: "warning",
  cancelled: "danger",
};

/**
 * The order statuses that refuse a confirmation attempt outright.
 *
 * **This is the gate `allowed_outcomes` cannot tell you about**, and it is the
 * trap in this section. Measured 2026-08-20: order 3879 carries
 * `allowed_outcomes: []` *and* a cancelled order status, and the 409 blamed the
 * order — `{"order_status":"cancelled"}` — because that check runs first. So a
 * record can report outcomes the order will refuse anyway.
 *
 * Nobody phones a customer to confirm an order that has been cancelled or
 * refunded, which is exactly the two statuses WooCommerce treats as terminal.
 * The panel holds this because the alternative is offering a button whose only
 * possible answer is a 409.
 */
export const COD_CLOSED_ORDER_STATUSES = ["cancelled", "refunded"] as const;

export function orderRefusesCodAttempt(orderStatus: string): boolean {
  return (COD_CLOSED_ORDER_STATUSES as readonly string[]).includes(orderStatus);
}

/**
 * Whether the attempt form should render at all, and why not when it should not.
 *
 * Three gates, in the order the API applies them, so the reason on screen is the
 * reason the server would have given:
 *
 *   1. `enabled` — 409 `{"order_id": …}`, *"Cash on delivery is not enabled…"*
 *   2. the order's own status — 409 `{"order_status": …}`
 *   3. the transition — 409 `{from, to, allowed}`, the only one carrying a list
 *
 * Returned as a discriminated union rather than a boolean because every refusal
 * needs different wording, and a disabled control with no explanation is the
 * thing this panel keeps being told not to ship.
 */
export type CodAttemptGate =
  | { allowed: true; outcomes: readonly string[] }
  | { allowed: false; reason: "disabled" | "order_closed" | "finished" };

export function codAttemptGate(
  record: { enabled: boolean; allowed_outcomes: readonly string[] },
  orderStatus: string,
): CodAttemptGate {
  if (!record.enabled) return { allowed: false, reason: "disabled" };
  if (orderRefusesCodAttempt(orderStatus)) return { allowed: false, reason: "order_closed" };
  if (record.allowed_outcomes.length === 0) return { allowed: false, reason: "finished" };
  return { allowed: true, outcomes: record.allowed_outcomes };
}
