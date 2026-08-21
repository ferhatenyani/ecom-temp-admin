import { z } from "zod";
import { orderStatuses } from "@/lib/order-status";

/**
 * Shapes measured against the live API on 2026-08-19, not remembered.
 *
 * **This is the first collection where the list row and the detail are not the
 * same object.** Orders, products and inventory all return one shape from both
 * routes, and every branch so far has noted "one schema serves both". Here the
 * key sets differ by exactly one: `GET /customers/{id}` carries `statistics` and
 * `GET /customers` omits it. Verified by comparing key sets across all 16 rows,
 * and by comparing every shared value on customer 24 — they are identical, so the
 * detail really is the row plus a report rather than a richer object.
 *
 * So there are two types, and the list one is not merely the detail with a field
 * made optional: a component handed a list row must not be able to reach for
 * `statistics` and find `undefined` at runtime.
 */

/** An address, in exactly the form `PATCH` accepts back. */
export const address = z.looseObject({
  first_name: z.string(),
  last_name: z.string(),
  company: z.string(),
  address_1: z.string(),
  address_2: z.string(),
  city: z.string(),
  state: z.string(),
  postcode: z.string(),
  country: z.string(),
  phone: z.string(),
  /** Billing only. Shipping carries no email — WooCommerce stores none. */
  email: z.string().optional(),
});
export type Address = z.infer<typeof address>;

/**
 * The consent record — one flag and two fields that explain it.
 *
 * `marketing_consent_at` and `marketing_consent_source` were added to the API on
 * this branch, because a bare boolean cannot distinguish *declined* from *never
 * asked* and the panel was being asked to render a row explaining which. Both are
 * `null` together on a customer who has never decided, which is 15 of the 16 here.
 *
 * The date carries a UTC offset. The meta behind it does not — it is stored as a
 * naive `Y-m-d H:i:s` — and the offset is added at the API boundary precisely
 * because `notes[].created_at` and `movements[].created_at` do not, and
 * `new Date()` shifts those silently.
 */
export const CONSENT_SOURCES = ["registration", "account", "unsubscribe_link"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/**
 * **A string, not an enum, and that is a correction rather than a loosening.**
 *
 * This was `z.enum([...])` and it blanked the entire customer screen. `Consent`
 * on the backend writes `marketing_consent_source` from a caller-supplied string
 * with **no validation of any kind** — `Consent::set($id, true, $source)` stores
 * whatever it is handed — so the three values above are a convention, not a
 * contract. The campaigns seed passed `"seed"`, entirely reasonably, and
 * `GET /customers/{id}` then failed to parse: `acFetch` parses on the server, so
 * the whole detail rendered as *"This page couldn't load"* over one label on one
 * row.
 *
 * That is the `unknownSectionTypes()` rule, which this panel already applies to
 * the homepage's section types and to a notification's channel: **a vocabulary
 * copied from the other side of the wire must degrade, not blank the page.** A
 * source the panel has no label for renders as itself — see `consentRecord()`.
 */
const consentSource = z.string();

/**
 * A customer row.
 *
 * `role` is on every one of the 16 and is `"customer"` on every one of them: the
 * repository filters on it, so a staff account cannot appear here and
 * `GET /customers/1` — the administrator — is a 404 rather than a leak. It is
 * read anyway, because a schema that drops the field could not notice if that
 * ever stopped being true.
 */
export const customer = z.looseObject({
  id: z.number(),
  username: z.string(),
  email: z.string(),
  /**
   * **Empty on 12 of the 16.** A customer record in this shop routinely has no
   * name at all, so nothing may render `first_name` as though it were the row's
   * identity. `customerName()` decides what a row is called.
   */
  first_name: z.string(),
  last_name: z.string(),
  role: z.string(),
  is_paying_customer: z.boolean(),
  marketing_consent: z.boolean(),
  marketing_consent_at: z.string().nullable(),
  marketing_consent_source: consentSource.nullable(),
  billing: address,
  shipping: address,
  date_created: z.string(),
  /** `null` on a customer nobody has edited since it was created. */
  date_modified: z.string().nullable(),
});
export type Customer = z.infer<typeof customer>;

export const customerList = z.array(customer);

/**
 * One order, as the statistics block summarises it. Not an `Order` — this is four
 * fields, and reaching for the rest would be a request the panel has not made.
 */
const statisticsOrder = z.looseObject({
  id: z.number(),
  date: z.string(),
  status: z.string(),
  total: z.string(),
});
export type StatisticsOrder = z.infer<typeof statisticsOrder>;

/**
 * The statistics report.
 *
 * **Two of these numbers do not divide into each other, and the panel must not
 * let a reader think they do.** On customer 24: `total_orders: 5`,
 * `completed_orders: 2`, `total_revenue: "2100.00"`, `average_order_value:
 * "1050.00"`.
 *
 * 2100 ÷ 5 is 420, and that is the arithmetic a person does when the two figures
 * sit side by side. The API's own arithmetic is 2100 ÷ 2 — revenue is the sum of
 * the *completed* orders (1500 + 600, verified against this customer's order
 * list) and the average is over the same two. Every figure is internally
 * consistent; only the labels can make that visible, so `lib/customers.ts` gives
 * each one a scope and the screen never prints a bare "average".
 *
 * `by_status` sums to `total_orders` exactly — 0+1+0+2+1+1+0 = 5 — so it is the
 * honest breakdown of the count, and it is the block that explains why revenue
 * counts fewer orders than the customer placed.
 */
export const customerStatistics = z.looseObject({
  total_orders: z.number(),
  completed_orders: z.number(),
  cancelled_orders: z.number(),
  returned_orders: z.number(),
  total_revenue: z.string(),
  average_order_value: z.string(),
  /** Both `null` on a customer who has never ordered — 11 of the 16. */
  first_order: statisticsOrder.nullable(),
  last_order: statisticsOrder.nullable(),
  by_status: z.record(z.enum(orderStatuses), z.number()),
});
export type CustomerStatistics = z.infer<typeof customerStatistics>;

/** The detail: the row, plus the report the list omits. */
export const customerDetail = customer.extend({ statistics: customerStatistics });
export type CustomerDetail = z.infer<typeof customerDetail>;
