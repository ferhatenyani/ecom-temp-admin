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
  /**
   * **Identifies nothing across a write, and no client may cache one.**
   *
   * `line_items` is replace-the-set: `Orders\OrderRepository::replaceLineItems()`
   * removes every line and re-adds the payload's, and `resolveLines()` pairs the
   * two by **array index**. The id is dropped on the way in by
   * `Orders\LineItemInput::READ_ONLY`, so a body aimed at one line by id does not
   * reach a line at all — it fails on the `product_id` and `quantity` it did not
   * state. Ids churn on every write that names the key, an identical replace
   * included. It is a React key for one render and nothing more.
   */
  id: z.number(),
  name: z.string(),
  product_id: z.number(),
  variation_id: z.number(),
  quantity: z.number(),
  sku: z.string(),
  /**
   * The unit price **a person typed**, or `null` when the catalogue priced it.
   *
   * Not the price the line was charged at, which is what the name suggests and
   * would be the wrong reading: `Orders\OrderPresenter::manualPrice()` reads
   * `OrderRepository::MANUAL_PRICE_META` and emits `null` for a line carrying
   * none, mirroring the write side where `null` and `""` mean *let the catalogue
   * price this* and `0` is the real amount zero. So this field is an **override,
   * present or absent**, and the effective unit price is `total / quantity` —
   * both of which are already here.
   *
   * That mirror is what makes a round trip work: PATCH a fetched order back and
   * a hand-priced line keeps its amount while a catalogue-priced one is re-priced
   * — each because of what it said, not by luck. It is also what makes a round
   * trip **fail** on an order holding stock, where
   * `OrderService::guardManualPricesWritable()` answers 409 to a *stated* price
   * and nothing downstream can tell an echo from a decision.
   *
   * Read from source: `OrderPresenter::lineItems()` and `manualPrice()`.
   */
  price: decimal.nullable(),
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
  /**
   * The delivery fee **this API was told**, or `null` when nobody stated one.
   *
   * The pair to read with it is `shipping_total` directly below, and the rule for
   * telling them apart is the one `Orders\OrderInput`'s docblock gives: **send
   * `shipping_amount`, read `shipping_total`.** This is the settable half —
   * `shipping_total` is in `OrderInput::READ_ONLY` and is derived by
   * `calculate_totals()` from the shipping line — and the two say different
   * things rather than the same thing twice.
   *
   * **`null` here is not "no delivery charge".** An order the checkout placed
   * carries a fee that came from §14's tariff with nobody typing anything, so it
   * reads `shipping_amount: null` beside a `shipping_total` of `600.00`. Any
   * screen that shows one number shows `shipping_total`;
   * `Orders\OrderPresenter::shippingAmount()` says so outright.
   *
   * What this field is for is the **form**: it is what the operator last stated,
   * so the field can open on it and a diff can tell an edit from an echo.
   */
  shipping_amount: decimal.nullable(),
  shipping_total: decimal,
  /**
   * Where the *price* came from — `"rules"`, `"provider"`, or `null`.
   *
   * Read-only: `OrderInput::READ_ONLY` names it, because a caller who could
   * state it could claim a courier had answered when none was asked. Not to be
   * confused with the field directly below it, and the confusion is easy enough
   * that `OrderInput`'s own docblock devotes a section to it: this says **who
   * priced the journey**, the next says **who carries the box**. The pair
   * `{shipping_source: "rules", shipping_provider: "yalidine"}` is the ordinary
   * reading on a shop whose couriers have no destination mapping — §14's tariff
   * priced it and Yalidine still drives it — not a contradiction.
   */
  shipping_source: z.string().nullable(),
  /**
   * The courier, and `null` when nobody has named one.
   *
   * The shipping line's `method_id`, first non-empty one wins
   * (`OrderPresenter::shippingProvider()`). **Not constrained to
   * `/shipping/providers`** and deliberately so — the presenter's docblock says
   * orders outlive the registrations that made them, and an order placed with a
   * courier the shop has since switched off must still say who took the parcel.
   * So this is `providerLabel()`'s input, never an index into the registry.
   *
   * `null` here is what makes `ShipmentSubscriber::confirm()` return early with
   * no parcel *and no recorded failure* — nobody named a courier is a real
   * state, not an error — which is why the parcels card reads this before it
   * explains an absent parcel.
   */
  shipping_provider: z.string().nullable(),
  /**
   * Why the **last** confirmation of this order created no parcel, or `null`.
   *
   * ## It is stored, not caught in flight, and that changes what a screen does
   *
   * `Shipping\ShipmentSubscriber` runs on a WooCommerce status transition —
   * wp-admin, WP-CLI, cron and a payment gateway all fire it as well as
   * `PATCH /orders/{id}` — so most confirmations have no HTTP response to hang
   * a failure on. `ShipmentFailure::toMeta()` writes it to order meta instead
   * and `OrderPresenter::shippingProviderError()` publishes it here. That is
   * why the panel renders this from a `GET` on a screen anybody can open days
   * later, rather than from the mutation that caused it.
   *
   * The reference shop does the opposite and loses by it, which is worth
   * recording because the step text says to copy it: EL hangs a
   * `shippingProviderError` string on the response DTO of the confirming
   * request and its own admin app never reads it —
   * `el-admin-app/src/pages/Orders.jsx::handleUpdateStatus` infers failure from
   * a missing tracking number and shows one fixed sentence, throwing the
   * courier's reason away. Read from source. Ours carries five fields and the
   * screen uses all five.
   *
   * ## Read-only, and every field of it
   *
   * `OrderInput::READ_ONLY` drops the whole key. A caller who could state this
   * could claim a courier had refused an address when no courier was ever
   * asked — so a form must never echo it back expecting it to stick, and none
   * does.
   *
   * ## The shape, and why `at` is the field that needs care
   *
   * `ShipmentFailure::toArray()`: `provider`, `code`, `message`,
   * `provider_message` (`null` when the courier said nothing of its own — the
   * empty string is never used to mean absent), and `at` in ISO-8601.
   *
   * **The value persists until a parcel exists.** `clearFailure()` deletes it
   * only when confirmation finds or creates a live shipment, so an order that
   * failed on Tuesday and has been left alone still reads exactly the same on
   * Friday. Nothing in the value says it is old. That is what `at` is for and
   * why `lib/shipping.ts` renders it as an age rather than as a timestamp
   * alone.
   *
   * `at` is nullable in the shape — `ShipmentFailure::iso()` answers `null` for
   * a stored value it cannot parse, and `fromMeta()` will build a failure out
   * of anything carrying a `code`, because order meta is a public store another
   * plugin can write to. So an undated failure is reachable and is drawn as
   * one.
   */
  shipping_provider_error: z
    .looseObject({
      provider: z.string(),
      code: z.string(),
      message: z.string(),
      provider_message: z.string().nullable(),
      at: z.string().nullable(),
    })
    .nullable(),
  /**
   * Where the order is going, as geography row ids — `null` when it does not
   * say.
   *
   * ## Not the address, and the suffix is the tell
   *
   * `billing.state` and `shipping.city` hold a wilaya and a commune **as free
   * text**, validated for shape and nothing else (`Commerce\AddressInput` says
   * so in terms), and `state` is empty on ~92 % of orders. These two are rows of
   * `ac_geo_wilayas` and `ac_geo_communes`, and they are the only thing a
   * courier can be routed on: `Shipping\Destination`'s docblock records that
   * *"Ouled Fayet" is spelled six ways across three couriers and two languages*
   * and that several communes of one name sit in different wilayas. A
   * destination is asked for; it is never derived from an address.
   *
   * ## Writable, at any status, and that is the retry path
   *
   * `OrderInput::allowedFields()` names all three as of the carrier branch, on
   * both `POST /orders` and `PATCH /orders/{id}`, and
   * `OrderService::guardDestinationResolves()` has **no `is_editable` gate** —
   * its docblock argues that one would freeze the field at the exact moment it
   * starts to matter, because both ways an order earns a
   * `shipping_provider_error` are recorded at `processing`, which is not
   * editable. So "Yalidine refused this commune" is answered by correcting the
   * commune here, on any order, in any status.
   *
   * `null` rather than `0` for an unaddressed order, and that is a round-trip
   * requirement rather than a nicety: `OrderInput` refuses `0` outright — *there
   * is no commune 0* — so a presenter emitting `0` would make every whole-body
   * PATCH of an unaddressed order 400 on two keys the client never touched.
   */
  wilaya_id: z.number().nullable(),
  commune_id: z.number().nullable(),
  /**
   * `home`, `desk`, or `null` when the order does not say.
   *
   * Whitelisted server-side against `Destination::DELIVERY_TYPES`, unlike
   * `shipping_provider` above — the presenter's split is whether the legal set
   * is a fact about the codebase (a constant, so it may be whitelisted) or
   * runtime state (a registry, so it may not).
   *
   * **`null` ships home.** `ShipmentSubscriber::destinationOf()` falls back to
   * `Destination::HOME` for a missing or unrecognised value and is the only
   * place that default lives; `OrderInput` deliberately does not repeat it, so
   * an unstated type reads back `null` and means *nobody said*, not *home was
   * chosen*.
   */
  delivery_type: z.string().nullable(),
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
