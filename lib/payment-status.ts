/**
 * The payment vocabulary, with no dependencies. Same split as
 * `lib/shipment-status.ts`, same reason.
 */

/**
 * Six statuses. Measured 2026-08-20 — `?status=zzz` on `/payments` answers 400
 * naming all six.
 *
 * Every one of the 37 payments in this shop is `pending`, so `?status=paid`
 * returns zero rows. That is the positive control this list needs: the filter is
 * real (`?status=zzz` refuses, `?bogus=x` is ignored with a 200 and the full
 * count), the shop simply has nothing settled yet.
 */
export const PAYMENT_STATUSES = [
  "pending",
  "paid",
  "failed",
  "expired",
  "cancelled",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * **`paid` is not terminal, and that is the one real difference from a shipment.**
 *
 * A delivered parcel is the end of the story; money that has arrived can still go
 * back. `refunded` is the only state reachable from `paid`, which is what stops a
 * replayed or out-of-order webhook walking a settled order back to pending and
 * re-opening a checkout that already succeeded.
 *
 * The panel cannot exercise any of this. **There is no PATCH on a payment** — the
 * only writes are `POST /orders/{id}/payments` (start a checkout) and
 * `POST /payments/{id}/verify` (ask the provider) — so the rule is enforced
 * inside verification and never surfaces as a 409 the panel could render. Kept
 * here because a status badge still has to know that `paid` is not an ending.
 */
export const TERMINAL_PAYMENT_STATUSES = [
  "failed",
  "expired",
  "cancelled",
  "refunded",
] as const;

export function isSettledPayment(status: string): boolean {
  return status === "paid";
}

/**
 * Colour is never the only signal; every consumer pairs this with a word.
 *
 * `refunded` is a warning rather than a danger: money going back is an ordinary
 * outcome the shop chose, unlike a payment that failed or expired on its own.
 */
export const PAYMENT_STATUS_TONE: Record<
  PaymentStatus,
  "neutral" | "success" | "warning" | "danger"
> = {
  pending: "neutral",
  paid: "success",
  failed: "danger",
  expired: "danger",
  cancelled: "danger",
  refunded: "warning",
};
