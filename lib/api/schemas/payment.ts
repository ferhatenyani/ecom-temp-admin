import { z } from "zod";

/**
 * Payments. `ac_manage_payments` — Super Admin only, and after the two-tier
 * collapse that is one of the panel's two tiers rather than one role in six.
 */

/**
 * `GET /payments/methods`. Measured 2026-08-20: `chargily` (default) and `cod`.
 *
 * Same rule as a shipping provider — a payment's `provider` is a lookup against
 * this with a fallback to the raw name, never an index into it.
 */
export const paymentMethod = z.looseObject({
  name: z.string(),
  label: z.string(),
  is_default: z.boolean(),
});
export type PaymentMethod = z.infer<typeof paymentMethod>;
export const paymentMethods = z.array(paymentMethod);

/**
 * A transaction.
 *
 * `GET /payments/{id}` returns the same object as the list row — measured — so
 * one schema serves both.
 *
 * **A payment carries its own `currency`**, like an order and unlike a product,
 * and is formatted with it rather than with `SHOP_CURRENCY`. An install carrying
 * pre-`DZD` orders has transactions in another currency and rendering them all as
 * dinars would be silently wrong arithmetic on a screen about money.
 *
 * `created_at` ends `Z` here while a shipment's ends `+00:00`.
 */
export const payment = z.looseObject({
  id: z.number(),
  order_id: z.number(),
  provider: z.string(),
  provider_transaction_id: z.string(),
  reference: z.string(),
  amount: z.string(),
  currency: z.string(),
  status: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Payment = z.infer<typeof payment>;
export const payments = z.array(payment);

/**
 * What `POST /payments/{id}/verify` answers, which is **not** a payment.
 *
 * Measured on payment 37 (a `cod` transaction, `pending`): a two-part object
 * carrying the provider's own answer beside the stored record.
 *
 * ```
 * {"report":      {"status":"pending","provider_status":"awaiting_delivery",
 *                  "amount":"","currency":"","metadata":{…}},
 *  "transaction": {…the full payment…}}
 * ```
 *
 * **`report.amount` and `report.currency` came back as empty strings**, so the
 * report is not safe to format as money. `transaction` is the authority for every
 * figure on screen; `report` is what the provider said, and its value is
 * `provider_status` — the courier's or gateway's own spelling, which is the thing
 * a mis-mapping shows up in.
 *
 * Verify is a POST rather than a GET on purpose: it asks the gateway a question
 * over the network and writes down the answer, which may settle an order and
 * reduce stock. A GET that changes things is one browser prefetch away from doing
 * it by accident.
 */
export const verifyReport = z.looseObject({
  status: z.string(),
  provider_status: z.string(),
  amount: z.string(),
  currency: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const verifyResult = z.looseObject({
  report: verifyReport,
  transaction: payment,
});
export type VerifyResult = z.infer<typeof verifyResult>;

/**
 * `GET /cod/statistics`. `ac_view_analytics`, which both tiers hold.
 *
 * **Two different "confirmed" counts live in one payload, and they answer
 * different questions.** Measured 2026-08-20: `by_status.confirmed` is 74 while
 * `confirmed_orders` is 111. `by_status` sums exactly to `total_orders` (527) and
 * is the *current* state; `confirmed_orders` is what `rates.confirmation` divides
 * by 527 to get `0.2106`, so it counts orders that were **ever** confirmed.
 *
 * Both are right. Put them near each other unlabelled and a reader concludes one
 * is broken — which is the customers-statistics lesson arriving intact, so
 * `codFigures()` makes the scope non-optional the way `StatFigure` does.
 */
export const codStatistics = z.looseObject({
  total_orders: z.number(),
  by_status: z.record(z.string(), z.number()),
  confirmed_orders: z.number(),
  delivered_orders: z.number(),
  returned_orders: z.number(),
  rates: z.record(z.string(), z.string()),
});
export type CodStatistics = z.infer<typeof codStatistics>;
