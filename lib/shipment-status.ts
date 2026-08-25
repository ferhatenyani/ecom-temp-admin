/**
 * The shipment vocabulary, with no dependencies.
 *
 * The same split `lib/coupon-status.ts` and `lib/movement-reason.ts` make, for
 * the same measured reason: **Zod costs 60 KB gzipped in the browser.** A client
 * component importing a value from a schema module drags Zod in with it, because
 * a value import is not erased the way `import type` is.
 *
 * Nothing here talks to the API. Everything here is something the API told us.
 */

/**
 * Ten statuses, in the order a parcel passes through them.
 *
 * Re-measured 2026-08-25 — `?status=zzz` on `/shipments` answers 400 naming all
 * ten, and `PATCH /shipments/{id}` refuses an eleventh with the same list.
 *
 * **This file used to say the API lists them alphabetically. It does not**, and
 * the two refusals are the evidence:
 *
 * > `"status is not one of pending, created, picked_up, in_transit,
 * > out_for_delivery, delivered, returning, returned, cancelled, and failed."`
 *
 * > `"Must be one of: pending, created, picked_up, in_transit,
 * > out_for_delivery, delivered, returning, returned, cancelled, failed."`
 *
 * Both are the **physical** order — the order below, the order a parcel passes
 * through them in. Alphabetical would open `cancelled, created, delivered`. The
 * two sentences differ in punctuation and in nothing else, which is the
 * query-parameter enum family against the body-field one. Neither is a ranking:
 * only `TERMINAL_SHIPMENT_STATUSES` divides this list into anything.
 *
 * **This is the shop's vocabulary, not a courier's.** Yalidine and ZR Express each
 * name their states differently and each adapter maps onto these, keeping the
 * provider's own spelling in `metadata.provider_status` — which is why a shipment
 * from the `acfake` provider carries `provider_status: "RAW_DELIVERED"` beside a
 * `status` of `delivered`.
 */
export const SHIPMENT_STATUSES = [
  "pending",
  "created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "returning",
  "returned",
  "cancelled",
  "failed",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/**
 * Finished, one way or another — and the only thing that decides what a shipment
 * still permits.
 *
 * Measured: a live shipment moves to **any** status, including backwards
 * (`in_transit` → `pending` answered 200). A terminal one moves nowhere:
 * `delivered` → `in_transit` is a 409. So there is no transition matrix to carry,
 * only this set — which is deliberate on the API's side, because a courier
 * reports what it reports, sometimes late and sometimes out of order, and
 * refusing a status to defend a diagram would put the shop's record at odds with
 * the physical world.
 *
 * `is_live` on the payload is the server's own answer to the same question and is
 * what the panel actually reads. This list exists for the cases where there is no
 * payload to ask — a status picker deciding what to offer.
 */
export const TERMINAL_SHIPMENT_STATUSES = [
  "delivered",
  "returned",
  "cancelled",
  "failed",
] as const;

export function isTerminalShipmentStatus(status: string): boolean {
  return (TERMINAL_SHIPMENT_STATUSES as readonly string[]).includes(status);
}

/**
 * Colour is never the only signal; every consumer pairs this with a word.
 *
 * `delivered` is the only success. `returning` is a warning rather than a danger
 * because the parcel is still moving and the shop is still waiting — it is the
 * state §56 added precisely so that *on its way back* could be told from *back in
 * my hands*, which is the difference between waiting and re-listing the stock.
 */
export const SHIPMENT_STATUS_TONE: Record<
  ShipmentStatus,
  "neutral" | "success" | "warning" | "danger"
> = {
  pending: "neutral",
  created: "neutral",
  picked_up: "neutral",
  in_transit: "neutral",
  out_for_delivery: "warning",
  delivered: "success",
  returning: "warning",
  returned: "danger",
  cancelled: "danger",
  failed: "danger",
};

/**
 * Where a parcel can go from here, for a status picker.
 *
 * Every live status can reach every *other* status — measured, including
 * backwards — so this is the full list minus the current one. A terminal status
 * reaches nothing, and the button is absent rather than disabled, because the
 * 409 it would produce carries no `allowed` list to render.
 *
 * **That is the difference from an order transition**, and it is the one place
 * this branch cannot follow the panel's usual rule. An order's 409 carries
 * `allowed: [...]` and the panel renders it; a shipment's 409 carries
 * `{from, to, is_live}` and no list at all. So the shipment picker is the panel's
 * only client-side transition rule, and it is a one-liner rather than a table
 * precisely because the server's rule is a one-liner too.
 */
export function nextShipmentStatuses(current: string, isLive: boolean): ShipmentStatus[] {
  if (!isLive) return [];
  return SHIPMENT_STATUSES.filter((status) => status !== current);
}

/** The two delivery types a rule and a shipment both carry. */
export const DELIVERY_TYPES = ["home", "desk"] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];
