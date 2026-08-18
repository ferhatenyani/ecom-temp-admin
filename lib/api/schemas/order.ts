import { z } from "zod";
import { orderStatuses } from "@/lib/order-status";

/**
 * Shapes measured against the live API on 2026-08-18, not remembered.
 *
 * `GET /orders` and `GET /orders/{id}` return the **same** object — the detail
 * response carries no extra key. A detail screen's richness therefore comes from
 * the sub-resources below, not from a fatter order, which is why one schema
 * serves both.
 */

/** Money is a decimal string and stays one. Never parsed into a number. */
const decimal = z.string();

/**
 * The vocabulary lives in `lib/order-status.ts`, which imports nothing. Client
 * components need these values and must not pay for Zod to get them — see that
 * file. Re-exported so a server-side caller has one import.
 */
export { orderStatuses, type OrderStatus } from "@/lib/order-status";
export const orderStatus = z.enum(orderStatuses);

/**
 * `email` is present on billing and absent from shipping — measured: filled on
 * 346 of 633 billing blocks and 0 of 633 shipping blocks — so it is optional
 * here rather than modelled as two different address types.
 */
export const address = z.looseObject({
  first_name: z.string(),
  last_name: z.string(),
  company: z.string(),
  address_1: z.string(),
  address_2: z.string(),
  city: z.string(),
  /** The wilaya, as a two-digit code when set at all. Empty on ~92 % of orders. */
  state: z.string(),
  postcode: z.string(),
  country: z.string(),
  phone: z.string(),
  email: z.string().optional(),
});
export type Address = z.infer<typeof address>;

export const lineItem = z.looseObject({
  id: z.number(),
  name: z.string(),
  product_id: z.number(),
  variation_id: z.number(),
  quantity: z.number(),
  sku: z.string(),
  subtotal: decimal,
  total: decimal,
});
export type LineItem = z.infer<typeof lineItem>;

export const order = z.looseObject({
  id: z.number(),
  number: z.string(),
  status: orderStatus,
  currency: z.string(),
  /** 0 means a guest order — measured on 288 of 633. */
  customer_id: z.number(),
  customer_note: z.string(),
  payment_method: z.string(),
  payment_method_title: z.string(),
  billing: address,
  shipping: address,
  /** Empty on 45 of 633 orders, so a detail screen must render that state. */
  line_items: z.array(lineItem),
  discount_total: decimal,
  shipping_total: decimal,
  total_tax: decimal,
  subtotal: decimal,
  total: decimal,
  /** False once stock has moved: the line-item editor is disabled, not absent. */
  is_editable: z.boolean(),
  needs_payment: z.boolean(),
  stock_reduced: z.boolean(),
  date_created: z.string(),
  date_modified: z.string(),
  date_paid: z.string().nullable(),
  date_completed: z.string().nullable(),
});
export type Order = z.infer<typeof order>;

export const orderList = z.array(order);

/**
 * A timeline entry. `actor` is an empty string on system-generated stock events —
 * measured, not assumed — so it is not `nullable` but must be treated as absent
 * when blank.
 *
 * `summary` arrives with HTML entities in it (`99&rarr;98`). It is decoded at
 * render time by `lib/format/html.ts`; React would otherwise print the entity
 * literally.
 */
export const timelineEntry = z.looseObject({
  type: z.string(),
  at: z.string(),
  actor: z.string(),
  summary: z.string(),
  data: z.looseObject({}).nullable().optional(),
});
export type TimelineEntry = z.infer<typeof timelineEntry>;
export const timeline = z.array(timelineEntry);

/**
 * `created_at` is **not** ISO 8601 and carries no offset — measured
 * `"2026-08-18 02:52:22"`, unlike the order's own `date_created`, which is
 * `"2026-08-18T02:52:22+00:00"`. Passing it to `new Date()` parses it as local
 * time and silently shifts it. `lib/format/date.ts` owns that repair.
 */
export const orderNote = z.looseObject({
  id: z.number(),
  content: z.string(),
  customer_note: z.boolean(),
  added_by: z.string(),
  created_at: z.string(),
});
export type OrderNote = z.infer<typeof orderNote>;
export const orderNotes = z.array(orderNote);

/**
 * COD is order metadata and audit events, never a status. `allowed_outcomes` is
 * the API telling us which moves are legal, the same courtesy the 409 body pays.
 */
export const codRecord = z.looseObject({
  enabled: z.boolean(),
  status: z.string(),
  attempts: z.number(),
  confirmed_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  last_attempt_at: z.string().nullable(),
  reason: z.string(),
  allowed_outcomes: z.array(z.string()),
});
export type CodRecord = z.infer<typeof codRecord>;

/** A wilaya, from the public `/locations/wilayas`. Bilingual on every row. */
export const wilaya = z.looseObject({
  id: z.number(),
  code: z.string(),
  slug: z.string(),
  name: z.string(),
  name_ar: z.string(),
  is_active: z.boolean(),
});
export type Wilaya = z.infer<typeof wilaya>;
export const wilayas = z.array(wilaya);

/** `GET /auth/me` — what the panel renders from, never what it trusts for access. */
export const identity = z.looseObject({
  id: z.number(),
  username: z.string(),
  display_name: z.string(),
  email: z.string(),
  roles: z.array(z.string()),
  capabilities: z.array(z.string()),
  auth_method: z.string(),
});
export type Identity = z.infer<typeof identity>;
