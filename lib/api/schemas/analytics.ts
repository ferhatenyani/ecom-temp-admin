import { z } from "zod";
import { codStatistics } from "./payment";

/**
 * The seven analytics reports. `ac_view_analytics`, and money on top of that.
 *
 * **Money is omitted field by field, not nulled and not zeroed.** Measured
 * 2026-08-21 with a caller holding `ac_view_analytics` without
 * `ac_manage_orders`: `/analytics/revenue` is a flat **403**, and on the other
 * six the money keys are simply *absent* — `overview.revenue` (the whole block),
 * `orders.average_order_value` and `orders.currency`, `best_sellers[].revenue`,
 * `by_wilaya[].revenue`, `unattributed.revenue`, `shipping.shipping_revenue` and
 * `shipping.currency`. Nothing marks the hole; the key is gone.
 *
 * So every money field below is `.optional()`, and that is not defensive
 * modelling — a required one turns a Support Agent's dashboard into a
 * `schema_mismatch` at the boundary. The panel reads presence, never a sentinel.
 *
 * The gate is the API's, and the API's alone: `meta.money_visible` reports it and
 * `meta.money_requires` names the capability (`"ac_manage_orders"`, which is not
 * in the specification). `canSeeMoney()` decides what the panel *lays out*; the
 * field's presence decides what it *prints*. The two agree today and the
 * response is the authority when they ever do not.
 */

/**
 * The window every report echoes back.
 *
 * **Render this, never what the date picker holds.** `date_from`/`date_to` sent
 * without `range=custom` are accepted and silently ignored — measured on four
 * spellings including a valid ten-day window, every one answering 200 with the
 * 30-day default. A picker bound to its own state would then show the operator a
 * window the figures beneath it do not describe.
 *
 * `timezone` is `"+00:00"` on this install, which is not `Africa/Algiers`. It is
 * carried through so a range can say which clock drew its boundaries rather than
 * implying the shop's.
 */
export const analyticsRange = z.looseObject({
  preset: z.string(),
  from: z.string(),
  to: z.string(),
  days: z.number(),
  timezone: z.string(),
});
export type AnalyticsRange = z.infer<typeof analyticsRange>;

/**
 * The three lines PLAN §28 asks for that this shop has no honest data for.
 *
 * **It is an object of reasons, not a list of names** — the specification says
 * the second and is wrong. Each key maps to a full English sentence explaining
 * *why*, e.g. *"Gateway fees are not summable across providers…"*. The panel is
 * French and Arabic, so the sentence is rendered from a localised line keyed on
 * the **key**, with the API's own text as the fallback for a key no wording
 * exists for. This is the facet `scope_note` problem in a second place.
 */
export const unavailableReasons = z.record(z.string(), z.string());

/* ------------------------------------------------------------- revenue --- */

/**
 * The money block, which appears twice: on its own route and nested inside
 * `/analytics/overview`.
 *
 * **Two pairs here do not divide, and both are correct.** `orders_placed` 844
 * against `orders_counted` 289, and `net` 719 700 against `collected` 145 150.
 * `RevenueFigure` in `lib/analytics.ts` is what stops either being printed
 * without its scope.
 *
 * `excluded_currencies` was **absent from every response measured**, and the
 * specification points at it to explain the 844 → 289 gap. It does not: the
 * backend emits it only when the window holds an order priced in something other
 * than the shop's currency, and it would explain a different gap entirely — the
 * one between this report's own currency-scoped `orders_placed` and
 * `/analytics/orders`'s `placed`. See `countedReconciliation()` for what actually
 * explains 289.
 */
export const revenueBody = z.looseObject({
  currency: z.string(),
  order_total: z.string(),
  orders_placed: z.number(),
  orders_counted: z.number(),
  gross: z.string(),
  discounts: z.string(),
  shipping_revenue: z.string(),
  tax: z.string(),
  refunds: z.string(),
  net: z.string(),
  collected: z.string(),
  average_order_value: z.string(),
  unavailable: unavailableReasons,
  refund_count: z.number(),
  refunded_orders: z.number(),
  excluded_currencies: z.record(z.string(), z.number()).optional(),
});
export type RevenueBody = z.infer<typeof revenueBody>;

export const revenueReport = revenueBody.extend({ range: analyticsRange });
export type RevenueReport = z.infer<typeof revenueReport>;

/* -------------------------------------------------------------- orders --- */

/**
 * The order activity block, likewise nested inside the overview.
 *
 * `by_status` sums exactly to `placed` — verified, 197+160+1+45+357+83+1 = 844 —
 * which is what makes it able to explain `counted_as_revenue` rather than merely
 * sit beside it.
 */
export const ordersBody = z.looseObject({
  placed: z.number(),
  by_status: z.record(z.string(), z.number()),
  cancelled: z.number(),
  completed: z.number(),
  refunded: z.number(),
  guest_orders: z.number(),
  counted_as_revenue: z.number(),
});

export const ordersReport = ordersBody.extend({
  range: analyticsRange,
  average_order_value: z.string().optional(),
  currency: z.string().optional(),
});
export type OrdersReport = z.infer<typeof ordersReport>;

/* ----------------------------------------------------------- customers --- */

export const customersBody = z.looseObject({
  customers: z.number(),
  new: z.number(),
  returning: z.number(),
  guest_orders: z.number(),
  rates: z.record(z.string(), z.string()),
});

export const customersReport = customersBody.extend({ range: analyticsRange });
export type CustomersReport = z.infer<typeof customersReport>;

/* ------------------------------------------------------------ products --- */

/**
 * A best seller. `revenue` is money and therefore optional.
 *
 * `name` is the product's own, in whatever language it was entered — this shop
 * mixes French catalogue names with English fixture names — so it renders under
 * `dir="auto"` like every other row of user content.
 */
export const bestSeller = z.looseObject({
  product_id: z.number(),
  name: z.string(),
  units: z.number(),
  orders: z.number(),
  revenue: z.string().optional(),
});
export type BestSeller = z.infer<typeof bestSeller>;

export const productsReport = z.looseObject({
  range: analyticsRange,
  best_sellers: z.array(bestSeller),
  best_sellers_limit: z.number(),
  low_stock: z.looseObject({ products: z.number() }),
});
export type ProductsReport = z.infer<typeof productsReport>;

/* ------------------------------------------------------------ shipping --- */

export const providerStat = z.looseObject({
  provider: z.string(),
  shipments: z.number(),
  delivered: z.number(),
  returned: z.number(),
  cancelled: z.number(),
  failed: z.number(),
  live: z.number(),
  rates: z.record(z.string(), z.string()),
});
export type ProviderStat = z.infer<typeof providerStat>;

/**
 * A wilaya's share.
 *
 * `name` is the English exonym for 16 — *Algiers*, not *Alger* — by design, and
 * README says why: the Latin names follow ISO 3166-2 to match WooCommerce's DZ
 * state list and the slug is derived from them. `name_ar` is complete since
 * `fix/products-support`.
 */
export const wilayaRow = z.looseObject({
  wilaya_id: z.number(),
  code: z.string(),
  name: z.string(),
  name_ar: z.string(),
  orders: z.number(),
  revenue: z.string().optional(),
});
export type WilayaRow = z.infer<typeof wilayaRow>;

/**
 * The orders no wilaya can be attributed to, with the API's own reason.
 *
 * **This is the largest slice in the report and it has no name.** Measured:
 * 249 orders and 652 400 against 844 placed and 719 700 net, so it is bigger
 * than every attributed wilaya put together. A chart that draws it as an unnamed
 * wedge reads as a bug, which is why `reason` travels with it and
 * `wilayaSlices()` returns it as a labelled row rather than a remainder.
 */
export const unattributed = z.looseObject({
  orders: z.number(),
  revenue: z.string().optional(),
  reason: z.string(),
});

export const shippingReport = z.looseObject({
  range: analyticsRange,
  shipments: z.looseObject({
    total: z.number(),
    by_status: z.record(z.string(), z.number()),
    live: z.number(),
  }),
  rates: z.record(z.string(), z.string()),
  providers: z.array(providerStat),
  unavailable: unavailableReasons,
  by_wilaya: z.array(wilayaRow),
  unattributed,
  shipping_revenue: z.string().optional(),
  currency: z.string().optional(),
});
export type ShippingReport = z.infer<typeof shippingReport>;

/* ----------------------------------------------------------------- cod --- */

/**
 * `/analytics/cod` is `/cod/statistics` with a range on it — measured key for
 * key — so it reuses `codStatistics` and `lib/cod.ts`'s helpers rather than
 * restating a shape that already has a tested reader.
 *
 * `.extend()` rather than a spread or an `Omit`: README's Zod lesson is that
 * `Omit` on a `looseObject` erases every known field, because the index
 * signature makes `keyof` swallow the exclusion. Adding a key has no such
 * problem.
 */
export const codReport = codStatistics.extend({ range: analyticsRange });
export type CodReport = z.infer<typeof codReport>;

/* ------------------------------------------------------------ overview --- */

export const overviewReport = z.looseObject({
  range: analyticsRange,
  orders: ordersBody,
  customers: customersBody,
  cod: z.looseObject({
    total_orders: z.number(),
    confirmed_orders: z.number(),
    confirmation_rate: z.string(),
    delivery_rate: z.string(),
  }),
  shipping: z.looseObject({
    shipments: z.number(),
    delivered: z.number(),
    live: z.number(),
    delivery_rate: z.string(),
  }),
  inventory: z.looseObject({ low_stock: z.number() }),
  // Absent in its entirety without `ac_manage_orders`. Not null, not zeroed.
  revenue: revenueBody.optional(),
});
export type OverviewReport = z.infer<typeof overviewReport>;
