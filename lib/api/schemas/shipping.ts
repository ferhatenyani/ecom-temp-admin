import { z } from "zod";

/**
 * Shipping: providers, rules, rates and shipments.
 *
 * Loose objects throughout, as everywhere else here — an added field is not a
 * breaking change; a missing or retyped one is.
 */

/**
 * `GET /shipping/providers`. Measured 2026-08-20: exactly one, `manual` /
 * "In-house delivery", `is_default: true`.
 *
 * **A shipment's `provider` is not constrained to this list.** Shipment 213
 * carries `provider: "acfake"`, a fixture provider the backend's webhook suite
 * registers at runtime, while `/shipping/providers` reports only `manual`. So a
 * provider label is a lookup with a fallback to the raw name, never an index into
 * this array.
 */
export const shippingProvider = z.looseObject({
  name: z.string(),
  label: z.string(),
  is_default: z.boolean(),
});
export type ShippingProvider = z.infer<typeof shippingProvider>;
export const shippingProviders = z.array(shippingProvider);

/**
 * A tariff row — what the shop charges.
 *
 * `specificity` is server-computed and is the whole resolver: measured 3 for a
 * national rule (`wilaya_id: 0, commune_id: 0`), 7 for a wilaya rule and 15 for a
 * commune rule. Higher is narrower and narrower wins. The panel sorts by it and
 * never recomputes it — a client that derived its own ranking would be a second
 * implementation of the rule the whole screen exists to display.
 *
 * `free_over` and `estimated_days` are nullable; `amount` is a decimal string and
 * stays one, because parsing it into a float is how a price a shop typed
 * correctly gets stored 0.000001 away from itself.
 */
export const shippingRule = z.looseObject({
  id: z.number(),
  provider: z.string(),
  wilaya_id: z.number(),
  commune_id: z.number(),
  delivery_type: z.string(),
  amount: z.string(),
  free_over: z.string().nullable(),
  estimated_days: z.number().nullable(),
  is_active: z.boolean(),
  specificity: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ShippingRule = z.infer<typeof shippingRule>;
export const shippingRules = z.array(shippingRule);

/**
 * A resolved quote — what a destination actually costs.
 *
 * `source` is the label the spec asks the screen to keep: `rules` is the shop's
 * own tariff, and a courier's live quote arrives under its own source. Measured
 * with three rules in place: wilaya 16 / commune 484 → `350.00`, wilaya 16 /
 * commune 483 → `500.00`, wilaya 1 / commune 1 → `800.00`. Commune beats wilaya
 * beats national, resolved server-side.
 *
 * **`label` here is a display string — "Delivery" — and is not the credential.**
 * The shipment `label` that Part VI forbids caching lives at `metadata.label` on
 * a *shipment*, is a URL, and never appears on this object. The two fields share
 * a name and nothing else; see `stripLabelUrls` in `lib/shipping.ts`.
 */
export const shippingRate = z.looseObject({
  provider: z.string(),
  service: z.string(),
  label: z.string(),
  amount: z.string(),
  currency: z.string(),
  estimated_days: z.number().nullable(),
  source: z.string(),
  free_shipping: z.boolean(),
});
export type ShippingRate = z.infer<typeof shippingRate>;
export const shippingRates = z.array(shippingRate);

/**
 * A parcel.
 *
 * `GET /shipments/{id}` returns **the same object as the list row** — measured,
 * identical key sets, no extra block — so one schema serves both, unlike a
 * customer.
 *
 * `is_live` is the server's own derived answer to "is the shop still waiting on
 * this", and it is the one field the create button and the cancel button both
 * read. `metadata` is free-form provider detail and is where a courier's label
 * URL would arrive; it is stripped before it reaches a client component.
 *
 * `created_at` ends `+00:00` here while a payment's ends `Z`. Two offset
 * notations in one branch, and `parseApiDate()` is the only thing that may touch
 * either.
 */
export const shipment = z.looseObject({
  id: z.number(),
  order_id: z.number(),
  provider: z.string(),
  provider_shipment_id: z.string(),
  tracking_number: z.string(),
  status: z.string(),
  is_live: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Shipment = z.infer<typeof shipment>;
export const shipments = z.array(shipment);
