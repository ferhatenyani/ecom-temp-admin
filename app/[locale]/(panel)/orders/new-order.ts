import { DEFAULT_COUNTRY } from "@/lib/countries";
import { CREATABLE_STATUSES, type OrderStatus } from "@/lib/order-status";
import type { DeliveryType } from "@/lib/shipment-status";

/**
 * The draft behind `NewOrderDrawer`, and the one function that turns it into a
 * `POST /orders` body.
 *
 * Separated from the component for the reason `export.ts` beside it is: the
 * interesting part of a create form is not the markup, it is which fields go on
 * the wire and in what shape, and that is a pure function of a plain object. It
 * is asserted directly in `tests/new-order.test.ts` rather than through eleven
 * `fireEvent`s per case.
 *
 * ## What was measured, and how — this is not transcription
 *
 * Every claim below about `POST /orders` was **measured in-process via
 * `rest_do_request()`** against the plugin in `ecom-temp`
 * (`wp-content/plugins/algerian-commerce-core/tests/Api/orders.php`), or read
 * from the source cited beside it by `file:symbol`. Read the phrase strictly: it
 * runs routing, the args schema, `OrderInput`, `LineItemInput`, `AddressInput`,
 * the service guards, the repository and WooCommerce, and it does **not** run
 * Application Password authentication or anything between a browser and PHP. It
 * is not "measured against the live API" — creating an order on the live shop is
 * not reversible the way a coupon or a parcel is, and `BLOCKED.md` records the
 * 401 that stops the attempt anyway.
 *
 * ## What the API decides, and this file therefore must not
 *
 * **Money — and this section says the opposite of what it used to.** It read:
 * *"`POST /orders` prices every line from the catalogue and refuses a
 * caller-supplied `price` by name"*, and it was true when it was written. It no
 * longer is. `Orders\LineItemInput` accepts `price` on **both** create and
 * update — `LineItemInput::ALLOWED` names it and `OrderInput::normalize()` is
 * one function shared by `forCreate()` and `forUpdate()` — and the old sentence
 * *"Line prices come from the catalogue and cannot be set."* is gone from the
 * backend. `shipping_amount` arrived with it, accepted on create by the same
 * shared `normalize()` and written by `OrderRepository::create()` through
 * `applyShippingAmount()`.
 *
 * So a line now carries a product, a quantity and — when somebody typed one — a
 * unit price; and the order carries a delivery fee. What did **not** change is
 * the half of the old paragraph that mattered: **this file still computes no
 * money at all.** The form states amounts, `calculate_totals()` sums them
 * (`sum(price × quantity) + shipping_total`, server-side, after the lines and
 * the fee are both written), and the order's total arrives in the 201. That is
 * item 1's sub-task 5, and it survives the field being writable because "what a
 * line costs" and "what the order costs" were never the same question.
 *
 * **A prefilled price is a stated price, and that is a decision rather than a
 * side-effect.** Every line the picker adds is seeded with the catalogue's
 * amount and is therefore recorded as hand-priced — even when the number equals
 * the catalogue's. The backend keeps the two distinguishable on purpose
 * (`OrderPresenter::manualPrice()`: the meta records the *decision*, not the
 * difference) and `OrderService::create()` audits the whole set into
 * `order.created`. `EL/el-admin-app/src/components/orders/CreateOrderModal.jsx`
 * behaves the same way — `unitPrice` is seeded from `selectedBook.price` and
 * sent back whatever happens next — and the reading is right for a back-office
 * order: somebody entering it by phone has seen the number and agreed to it.
 * Clearing the box is how a line is handed back to the catalogue.
 *
 * **No stock guard, because the API has none here.**
 * `OrderService::guardManualPricesWritable()` is wired into `update()` and
 * **not** into `create()` — read from source — and there is nothing for it to
 * guard: no order exists yet, so none is holding stock. The 409 the line editor
 * on the detail warns about and binds has no counterpart on this route, and this
 * form must not invent one.
 *
 * **Stock.** A `pending` order holds none — `stock_reduced: false`, and the
 * ledger stays empty — while a `processing` or `completed` one moves it. That is
 * the API's own rule and the form neither mirrors nor mentions it beyond the
 * status picker, because the status picker is where the choice is made.
 */

/**
 * Every address field the API takes, `email` included — see `payloadAddress`.
 *
 * **A list rather than three hand-kept copies**, which is what this was: the
 * type, the eleven lines of `emptyAddress()` and a `ADDRESS_KEYS` const in
 * `NewOrderDrawer` all enumerated the same fields, and the drawer's copy existed
 * only because this file did not export one. The order edit form is the second
 * caller and would have been the fourth copy. The type and the blank block are
 * both derived from this now, so a field cannot be added to one and forgotten in
 * the others.
 */
export const ADDRESS_KEYS = [
  "first_name",
  "last_name",
  "company",
  "address_1",
  "address_2",
  "city",
  "state",
  "postcode",
  "country",
  "phone",
  "email",
] as const;

export type AddressDraft = Record<(typeof ADDRESS_KEYS)[number], string>;

/**
 * A chosen product, with what the picker knew about it.
 *
 * `name`, `sku` and `cataloguePrice` are carried for the row's own rendering and
 * are **not** sent: the picker is the only thing that knows the name of an id it
 * has just added, and re-resolving one at render would be a request per line.
 * The same argument `RestrictionPicker`'s `onCommit` makes.
 *
 * ## It is `[id]/order-edit.ts`'s `LineDraft` in all but two fields, deliberately
 *
 * The two drafts speak one vocabulary — same field names, same meanings, same
 * `""`-is-not-zero rule on `price` — because an operator moves between the two
 * forms and a reader moves between the two files, and `price` meaning "the
 * catalogue's number" in one and "what somebody typed" in the other is how a
 * bug gets written by someone who read the wrong file first. The two genuine
 * differences are named on the fields below.
 *
 * They are **two declarations rather than one shared type**, and that is a
 * dependency direction rather than an oversight: `order-edit.ts` imports
 * `ADDRESS_KEYS`, `emptyAddress`, `parseQuantity` and `AddressDraft` from *this*
 * file, so this file importing a line type back from it would close a cycle.
 * The shape that would be shared is the edit form's, which carries a
 * `variationId` this form can never set — see below — so hoisting it here would
 * mean exporting a field the create drawer has to remember to leave at zero.
 */
export type DraftLine = {
  /**
   * Unique within this draft, and minted by `nextLineKey`. **Never an API id** —
   * `POST /orders` has not issued one yet, and `[id]/order-edit.ts`'s `LineDraft`
   * argues at length why one must not be carried afterwards either.
   *
   * It exists because **two rows for one product became reachable** the moment a
   * price could be typed: four copies at 1 500 and one damaged one at 700 is a
   * real order, and `NewOrderDrawer`'s `addLine` now opens a second row for it.
   * The React key was `line.productId` and would collide on exactly that order.
   */
  key: number;
  productId: number;
  name: string;
  sku: string;
  /**
   * The manual unit price **as typed**, or `""` for no override.
   *
   * `""` is not zero and the difference is the field's whole meaning:
   * `LineItemInput::one()` reads `null` and `""` as *no manual price, let the
   * catalogue price this line* and `0` as the real amount zero — a free line,
   * which is a thing a shop does and which the API permits and audits rather
   * than prevents. So clearing this box hands the line back to the catalogue and
   * typing `0` gives it away.
   *
   * **Seeded from the catalogue when the row is added**, which makes every
   * picker-added line a hand-priced one. The file docblock argues that choice
   * rather than letting it be discovered.
   */
  price: string;
  /**
   * What the catalogue was asking when the row was added — or `null` when
   * nothing knows, and then nothing is drawn.
   *
   * `null` is only reachable through the `ac_manage_products` fallback, where a
   * product id is typed and `ProductPicker` hands back `price: ""` because it
   * genuinely knows no price. Every other row on this form came from a search
   * result the panel had just been told the price of, so unlike the edit form —
   * whose lines arrive from an order that publishes the *override* and never the
   * catalogue price — this one is populated for free and stays populated.
   */
  cataloguePrice: string | null;
  /** A string, like every other field in the form layer. Never a `number`. */
  quantity: string;
  /*
   * **No `variationId`, and that is the second difference.** `LineItemInput`
   * takes one and `[id]/order-edit.ts`'s `LineDraft` carries it, because a line
   * that *arrives on an order* may already name a variation. Nothing on this
   * form can produce one: `ProductPicker` offers a simple product's id, and a
   * variable product is refused by the API by name —
   * `OrderRepository::resolveProduct()`, "This is a variable product; name the
   * variation to order." — which is a better sentence than one invented here. A
   * field that could only ever hold `0` is a field that can only rot.
   */
};

/**
 * The next unused key, derived rather than counted.
 *
 * `[id]/order-edit.ts` exports a function of this name with this body, and this
 * is a second copy rather than an import for the reason `DraftLine` above gives:
 * that module imports from this one, so the arrow only points one way, and its
 * version is typed to *its* `LineDraft`. One line of `reduce` duplicated is the
 * cheaper of the two wrongs; a cycle between the create and edit drafts is the
 * expensive one.
 *
 * Derived from the list rather than held in a module-level counter, which would
 * have been shorter and is the wrong shape for a file whose every other export
 * is a pure function of its arguments: two drawers open in two tabs would share
 * it, and a test would have to reset it between cases.
 */
export function nextLineKey(lines: readonly DraftLine[]): number {
  return lines.reduce((max, line) => Math.max(max, line.key), -1) + 1;
}

export type OrderDraft = {
  lines: DraftLine[];
  /** `null` is a guest order, which is what 288 of the shop's 633 orders are. */
  customerId: number | null;
  status: OrderStatus;
  billing: AddressDraft;
  shipping: AddressDraft;
  shippingSameAsBilling: boolean;
  paymentMethod: string;
  paymentMethodTitle: string;
  customerNote: string;
  /**
   * Where the parcel is going, as a **row id in the geography table** — not an
   * address field, and not anything `POST /orders` has ever been sent.
   *
   * ## Why these are on the draft and not in `AddressDraft`
   *
   * `Commerce\AddressInput::FIELDS` is a closed list of ten (`first_name`,
   * `last_name`, `company`, `address_1`, `address_2`, `city`, `state`,
   * `postcode`, `country`, `phone`) plus `email` on billing only, and
   * `AddressInput::parse()` walks `array_diff(array_keys($payload), $allowed)`
   * writing **`'Unknown field.'`** against every key left over — keyed
   * `billing.wilaya_id`, which is a 400 with the field named. Read from source.
   * So a `wilaya_id` inside the address block is not a field the API ignores; it
   * is a refusal, and the whole address goes down with it.
   *
   * `Orders\OrderInput::allowedFields()` was the same story one level up, and
   * **that half is overturned.** This block read *"`payment_method`,
   * `payment_method_title`, `customer_note`, `status`, `customer_id`, `billing`,
   * `shipping`, `line_items`, `shipping_amount`, and an unknown key is `'Unknown
   * field.'` there too. There is no top-level home for a destination on this
   * route either."* There is now: `allowedFields()` names `wilaya_id`,
   * `commune_id` and `delivery_type`, read from source in the backend's
   * `feat/carrier-choice` tree, and `buildPayload` sends all three.
   *
   * The paragraph above it still stands and is a different rule: an **address**
   * still has no `wilaya_id` inside it — `Commerce\AddressInput` refuses an
   * unknown key by name — and the destination is a top-level fact, not an
   * address field. `OrderInput`'s own docblock draws the same line and gives the
   * tell: *`_id` means a row, and a row is what gets routed*; anything without
   * the suffix, inside an address object, is text for a human.
   *
   * ## So what are they for
   *
   * Three things now, and the third is the one this branch added.
   *
   *  1. **The rate lookup** — step 2's sub-task 3, the seam at the foot of this
   *     file. `GET /shipping/rates` takes `wilaya_id` and `commune_id`; it is
   *     the only pair it takes, and an address cannot be substituted for it.
   *  2. **Seeding the address**, once, into fields nobody has typed in — see
   *     `destinationSeed`. It is no longer the *only* trace a destination leaves
   *     on a created order, and it is still worth doing for its own reason: a
   *     wilaya *code* on the address is a real field the shop can report on, and
   *     `lib/api/schemas/order.ts` records that it is empty on ~92 % of orders.
   *  3. **The order body itself** — `wilaya_id` and `commune_id` as integers,
   *     written to order meta by `OrderRepository::applyProps()` and read back
   *     on confirmation by `Shipping\ShipmentSubscriber::destinationOf()`. This
   *     is what makes a back-office order get a parcel at all: without it every
   *     one of them confirms into `order_destination_missing`.
   *
   * ## They are ids, and `state` is a code, and the two are not the same string
   *
   * A wilaya row carries both: `id` is the integer and `code` is that integer
   * zero-padded to two characters. They are one number by construction rather
   * than by coincidence — `Geography\GeoDataset::wilayas()` writes
   * `'id' => $code` and `'code' => str_pad((string) $code, 2, '0', STR_PAD_LEFT)`
   * from the same validated integer, so `Number(w.code) === w.id` holds for every
   * row the importer can produce. Read from source.
   *
   * Nothing here relies on that arithmetic anyway — the picker hands back the
   * whole row and each consumer takes the field it needs — but it is why one
   * control can honestly serve both a geography id and an address code, and it
   * is worth writing down before somebody re-derives it wrongly from `"16"`.
   *
   * Strings, like every other field in the form layer. A commune id is `""`
   * until a wilaya has been chosen and again the moment it changes, because a
   * commune belongs to exactly one wilaya and a stale pair would quote a fee for
   * somewhere else.
   */
  wilayaId: string;
  communeId: string;
  /**
   * Which courier carries the parcel — **the one thing in this block that
   * *does* go on the wire.**
   *
   * `Orders\OrderInput::allowedFields()` names `shipping_provider` as of the
   * carrier branch, so unlike the destination above and the delivery type
   * below, this is a real key on `POST /orders`. Read from source, in the
   * backend's uncommitted `feat/carrier-choice` tree.
   *
   * ## What it is validated against, and what it is not
   *
   * **Registration, never the destination.** `OrderInput::provider()` does
   * shape alone — `strtolower(trim())`, `Must be a string.` for a non-scalar
   * and `Is implausibly long.` over 40 characters — and
   * `OrderService::guardShippingProviderKnown()` does membership against
   * `ProviderRegistry::has()`. Neither asks whether that courier serves the
   * wilaya, and the guard's own docblock says why: *"a back-office order has no
   * cart and no structured destination to quote against"*. The refusal is a
   * 400 keyed `fields.shipping_provider` whose whole message is the legal set —
   * `"Available: manual."` — which is why the capability fallback in
   * `CarrierFields` is a usable control rather than a dead end.
   *
   * There is one exemption and it is not reachable from this form: a PATCH may
   * always restate the courier an order already names, even a de-registered
   * one. A create has no order to restate.
   *
   * ## `""` cannot un-choose a courier, and that is the API's shape not ours
   *
   * `null` and `""` are dropped rather than stored — the same rule
   * `shipping_amount` has, and `OrderInput`'s docblock names the cost out loud:
   * a fee has `0` for "no charge" and a courier has no such third value, so a
   * named courier can be replaced and never cleared. On *this* form that costs
   * nothing, because nothing is named until the drawer opens and seeds the
   * registry's default; `""` here is simply "the operator has not said", and
   * `buildPayload` omits the key exactly as it omits an empty fee.
   *
   * ## Not to be confused with `shipping_source`, which this form never sends
   *
   * The order carries both and they answer different questions.
   * `shipping_source` is `rules | provider | null` and is **read-only** — it
   * records whether the *price* came from the shop's tariff or a courier's own
   * quote. `shipping_provider` records who carries the box.
   * `{"shipping_source": "rules", "shipping_provider": "yalidine"}` is the
   * ordinary reading on an install with no courier credentials, not a
   * contradiction: §14's tariff priced the journey because Yalidine has nothing
   * mapped to quote from, and Yalidine carries it regardless.
   */
  shippingProvider: string;
  /**
   * `home` or `desk`, and it is **two things at once** — which is why it is one
   * control and not two.
   *
   * It is a *quote parameter*: `GET /shipping/rates` declares it with
   * `'default' => Destination::HOME` and `'enum' => Destination::DELIVERY_TYPES`
   * (`Shipping\ShippingController::rateArgs()`), and it changes the answer twice
   * over — `ShippingRule::matches()` tests a rule's own delivery type against
   * it, and a courier prices a doorstep and a desk differently by definition.
   *
   * It is *also* a field on the order now. **This block used to end here with
   * the opposite claim** — *"like the destination and unlike the courier, it
   * never reaches the order body; `allowedFields()` has no `delivery_type` and
   * answers `'Unknown field.'` to one"* — and that is overturned rather than
   * deleted, on `ShipmentSubscriber::destinationOf()`'s stated principle about
   * its own retired text. `allowedFields()` names it,
   * `OrderRepository::applyProps()` writes it to `DELIVERY_TYPE_META`, and
   * `ShipmentSubscriber` reads that key back on confirmation. So the one answer
   * both prices the journey and records it.
   *
   * `POST /orders/{id}/shipments` still asks for it a third time — that route
   * takes its own destination and does not read the order's — and
   * `CreateParcelDrawer` draws this same control against it.
   *
   * Typed rather than a bare string, and off `lib/shipment-status.ts`'s
   * `DELIVERY_TYPES` — one list, already the rule form's and the parcel
   * drawer's, so a third spelling cannot appear here.
   */
  deliveryType: DeliveryType;
  /**
   * The stated delivery fee, as typed. `""` states nothing.
   *
   * **What `""` means here is not what it means on the edit form**, and the two
   * are worth holding apart. There, an empty box leaves an existing shipping
   * line exactly where it is — `OrderInput::normalize()` drops `null` and `""`
   * before the payload is assembled, so a fee the checkout quoted survives a
   * PATCH that says nothing about it. Here there is no existing line to leave
   * alone: the order is being made, and an omitted `shipping_amount` simply
   * means it is created carrying no delivery charge at all
   * (`OrderRepository::applyShippingAmount()` returns early on
   * `!$input->has('shipping_amount')`, so no shipping line is added and
   * `calculate_totals()` derives `shipping_total: "0.00"`).
   *
   * `0` reaches the same total by a different route — `replaceShippingLine()`
   * writes a zero shipping line — and the pair reads back differently:
   * `shipping_amount` is `"0.00"` for the stated zero and `null` for the empty
   * one. Both charge nothing, and only one of them says somebody decided so.
   */
  shippingAmount: string;
};

/**
 * Eleven empty strings, and the country is one of them.
 *
 * **Blank here even though a new order opens on `DZ`.** This function has two
 * callers and only one of them is stating a new fact: `emptyDraft()` below seeds
 * the default on top of it, and `[id]/order-edit.ts`'s `addressDraftOf()` uses
 * it as the floor under a *stored* address, where a default would be the form
 * inventing a country the order never carried. `order-edit.ts` draws exactly
 * that line for `deliveryType` — *"The create draft can honestly open on `home`
 * because it is stating a new fact; this one is reporting an existing one, so an
 * order that says nothing opens on nothing"* — and this is the same rule one
 * field over.
 */
export function emptyAddress(): AddressDraft {
  return Object.fromEntries(ADDRESS_KEYS.map((key) => [key, ""])) as AddressDraft;
}

/**
 * A blank order.
 *
 * `pending` because it is the only creatable status that moves no stock, and
 * therefore the only one that is safe as a default: a form whose default was
 * `processing` would decrement the catalogue for anybody who filled in the lines
 * and pressed save without reading the status picker.
 *
 * ## And both addresses open on Algeria
 *
 * `DEFAULT_COUNTRY`, from `lib/countries.ts`, which is where the argument for
 * the value lives. The argument for it being *here* is `deliveryType: "home"`
 * four fields down, word for word: a form has to draw something, and the honest
 * default is the one that is right for almost every order this shop takes by
 * phone and visible in a picker the moment it is not.
 *
 * Two consequences, both deliberate and both handled below rather than left to
 * be discovered:
 *
 *   `isAddressEmpty`   now disregards the country, or `chooseCustomer` would
 *                      stop copying a customer's address into a block that
 *                      only ever held a default nobody typed.
 *   `payloadAddress`   still omits a block whose only content is that default,
 *                      so a form nobody filled in still sends no `billing` at
 *                      all — which is the rule that function was written for
 *                      and this must not quietly repeal.
 */
export function emptyDraft(): OrderDraft {
  return {
    lines: [],
    customerId: null,
    status: "pending",
    billing: { ...emptyAddress(), country: DEFAULT_COUNTRY },
    shipping: { ...emptyAddress(), country: DEFAULT_COUNTRY },
    shippingSameAsBilling: true,
    paymentMethod: "",
    paymentMethodTitle: "",
    customerNote: "",
    /*
     * No destination, and nothing to seed one from: a blank draft has no
     * address to resolve. The pickers ask, the same way `CreateParcelDrawer`
     * asks even though the order it is creating a parcel for already carries an
     * address.
     *
     * **This comment ended `…and POST /orders would refuse the pair anyway`,
     * which is no longer true** and is corrected rather than dropped, because
     * the second clause was the reason the first one felt safe. The route takes
     * the pair now; a blank draft still has nothing to put in it, and an
     * unchosen pair still sends no key — `buildPayload` omits rather than
     * sending `0`, which the API refuses.
     */
    wilayaId: "",
    communeId: "",
    /*
     * **Empty here and seeded by the drawer**, which is the one field on this
     * object whose default this module cannot state. The honest default is the
     * registry's own — `providers.find(is_default)`, which is
     * `CreateParcelDrawer`'s expression for the same choice — and the registry
     * arrives from `GET /shipping/providers` at the top of the screen. This
     * module imports nothing and knows no session, so it says `""` and
     * `NewOrderDrawer` fills it when the drawer opens.
     *
     * `""` is therefore reachable in two ways that mean the same thing to the
     * API and different things to a reader: nobody has opened the drawer yet,
     * or the operator explicitly chose "not decided". Both send no key.
     */
    shippingProvider: "",
    /*
     * `home`, because that is the route's own default —
     * `'default' => Destination::HOME` in `rateArgs()` — and because a
     * back-office order taken by phone is a doorstep delivery unless somebody
     * says otherwise. A default of `desk` would quote the cheaper journey to
     * every operator who never looked at the control.
     */
    deliveryType: "home",
    /*
     * Empty, and there is nothing to seed it from at construction. Step 2's
     * rate lookup is what fills it — see `quoteFill` below and the drawer's
     * effect that calls it — and until a destination is chosen the honest
     * default is still the one that states nothing.
     */
    shippingAmount: "",
  };
}

/**
 * Has anybody put anything in this block?
 *
 * ## The country is not counted, and that clause is load-bearing
 *
 * This used to be `Object.values(address).every(…)` over all eleven, which was
 * exactly right while a blank draft's eleven fields were eleven empty strings.
 * `emptyDraft()` now opens both blocks on `DEFAULT_COUNTRY`, so an untouched
 * address is no longer all-empty and the old rule would answer `false` for every
 * form that had just been opened — which would silently retire the *only* thing
 * this function is used for. `chooseCustomer` copies a customer's stored address
 * **only into a block nobody has typed in**, and it would have stopped copying
 * into any of them.
 *
 * So the question this answers is sharpened rather than widened: not *is this
 * block blank* but **has a person put anything here that a record would
 * overwrite** — and a default the form drew on their behalf is not that. A
 * country somebody deliberately changed to `FR` is not that either, strictly,
 * and it is still disregarded; that is the one case this rule gets wrong, it
 * costs a country being replaced by the customer's own, and the alternative —
 * comparing against `DEFAULT_COUNTRY` — would answer differently depending on
 * whether the operator's deliberate choice happened to equal the default, which
 * is worse and much harder to explain.
 *
 * `ADDRESS_KEYS` rather than `Object.values`, so the exclusion is by *name* and
 * a twelfth field added to the list is counted by default.
 */
export function isAddressEmpty(address: AddressDraft): boolean {
  return ADDRESS_KEYS.every((key) => key === "country" || address[key].trim() === "");
}

/**
 * What a chosen destination is allowed to write into an address block.
 *
 * ## The rule is `chooseCustomer`'s, borrowed rather than invented
 *
 * That handler copies a customer's billing block **only into a block nobody has
 * typed in**, on the ground that overwriting a half-filled address is how a
 * person loses the correction they were making. This is the same rule at field
 * granularity: each of the two fields is filled only when it is blank, and
 * neither is ever replaced. A destination changed three times leaves whatever
 * the first choice put there, and anything the operator typed outranks both.
 *
 * ## Why a destination writes into the address at all
 *
 * Because the two controls would otherwise ask the same question twice and
 * agree by luck. The address block already carries a wilaya picker bound to
 * `state`; the destination block carries one bound to a geography id. They are
 * genuinely different values — `AddressInput` does no wilaya validation at all
 * (its own docblock says so: *"No wilaya or commune validation here"*), so
 * `state` is free text the API stores as given, while `wilaya_id` is a row the
 * rate resolver looks up — but they describe one place, and a form that made
 * somebody name it twice would be a form whose two answers can disagree.
 *
 * So the flow is one-directional and only ever additive: **the destination is
 * chosen from a validated list, and the address inherits what that choice
 * knows.** Nothing reads back the other way, so there is no cycle to reason
 * about and no effect synchronising two pieces of state.
 *
 * `city` takes the commune name for the reason the reference shop does the same
 * — `EL/el-user-app/src/pages/CartCheckoutPage.jsx` populates `formData.city`
 * from the commune list of the chosen wilaya, and `el-admin-app`'s
 * `CreateOrderModal.jsx` labels that field *"La commune (ville)"*. In Algeria
 * the commune **is** the city on an address, and WooCommerce has no third field
 * to put it in.
 *
 * The name is passed in already localised rather than resolved here: which of
 * `name` and `name_ar` an address should carry is a rendering decision the
 * drawer makes with the locale in hand, and this module deliberately imports
 * nothing.
 */
export function destinationSeed(
  address: AddressDraft,
  chosen: { wilayaCode?: string; communeName?: string },
): Partial<AddressDraft> {
  const seed: Partial<AddressDraft> = {};

  const code = chosen.wilayaCode?.trim() ?? "";
  if (code !== "" && address.state.trim() === "") seed.state = code;

  const commune = chosen.communeName?.trim() ?? "";
  if (commune !== "" && address.city.trim() === "") seed.city = commune;

  return seed;
}

/**
 * One row of `GET /shipping/rates`, in the four fields the picker reads.
 *
 * Structural rather than `import type { ShippingRate }`, and that is the same
 * decision `DraftLine` makes about `LineDraft`: this module is the pure half of
 * the form and every other export in it is a function of plain objects, so it
 * takes the shape it needs and nothing else. `lib/api/schemas/shipping.ts`'s
 * `shippingRate` is the boundary and is a `looseObject` with five more fields —
 * `service`, `label`, `currency`, `estimated_days`, `free_shipping` — none of
 * which any decision below turns on.
 */
export type QuoteRow = {
  provider: string;
  amount: string;
  /** `home`, `desk`, or `null` for *the adapter did not say*. See below. */
  delivery_type: string | null;
  /** `rules` — the shop's tariff — or `provider`, a courier's own quote. */
  source: string;
};

/**
 * The price one courier will do one journey for, out of everything the rate
 * route said.
 *
 * ## Why the client picks at all, when the panel's rule is that it must not
 *
 * `/shipping/rates` deliberately does not choose. `RateQuote`'s own docblock
 * says so — *"`ShippingService::rates()` does not [need the journey]: a manager
 * comparing 'he collects it' against 'we deliver it' wants all of them"* — and
 * `ShippingService::rates()` accordingly emits **several rows per provider**:
 * the shop's tariff row when a rule matches (`source: "rules"`), plus every row
 * that courier's own `getShippingRates()` returned (`source: "provider"`).
 * `YalidineProvider::getShippingRates()` returns all four of its services
 * regardless of which journey was asked for, by name and on purpose. So the
 * route hands back a menu and expects its caller to read it; picking here is
 * answering the question the route asked, not re-deciding one it settled.
 *
 * The storefront's equivalent is `Shipping\ShopperRates::forProvider()`, and
 * this is **not** a copy of it. That function encodes a checkout *policy* —
 * a free tariff wins outright, then the courier's quote, then the tariff — and
 * a checkout has to charge exactly one number to a shopper who cannot argue.
 * This form has an editable box and an operator on the phone, so the useful
 * answer is the plainer one: **the lowest price this courier will carry it
 * for.** `source` is then shown beside the number rather than deciding it,
 * which is what that field is for — it says who quoted, not which quote wins.
 *
 * ## The `delivery_type` filter, and why `null` passes
 *
 * `RateQuote::coversDeliveryType()` is the rule, reproduced exactly: a row
 * naming a journey covers only that journey, and a row naming none covers
 * whatever was asked. Its docblock argues the second half — `getShippingRates()`
 * is handed a `Destination`, so an adapter that says nothing has answered about
 * the journey it was given, and treating that as a mismatch would drop the
 * quote of every adapter that returns one price. The tariff rows are exactly
 * that case in reverse: `RateResolver::quote()` stamps them with the journey
 * the caller resolved *for*, so they arrive already filtered and pass either
 * way.
 *
 * Ties go to the row that comes first, which is the route's own order —
 * tariff before courier, and the adapter's order within a courier. Nothing
 * downstream can see the difference between two rows at one price except
 * `source`, and preferring the tariff there is the reading that matches what
 * the shop actually charges.
 */
export function quoteFor<Row extends QuoteRow>(
  /* Generic in the row rather than typed to `QuoteRow`, so a caller holding the
     boundary's own `ShippingRate` gets one back with `currency` and `label`
     still on it. The four fields above are what this function *reads*; they are
     not what it is willing to hand back. */
  rows: readonly Row[],
  provider: string,
  deliveryType: string,
): Row | null {
  const name = provider.trim().toLowerCase();
  if (name === "") return null;

  let best: Row | null = null;

  for (const row of rows) {
    if (row.provider.trim().toLowerCase() !== name) continue;
    if (row.delivery_type !== null && row.delivery_type !== deliveryType) continue;

    /* Parsed only to compare, never to store or display: the amount that
       reaches the field is the decimal string the API sent, because
       `lib/format/money.ts` opens by refusing to let a price a shop typed
       correctly be stored a millionth away from itself. */
    if (best === null || Number.parseFloat(row.amount) < Number.parseFloat(best.amount)) {
      best = row;
    }
  }

  return best;
}

/**
 * What the delivery-fee box should hold once a quote arrives — or `null` for
 * *leave it exactly as it is*.
 *
 * ## The rule the seam demanded, at the one granularity that makes it live
 *
 * `chooseCustomer` and `destinationSeed` both say **fill an empty field, never
 * replace a filled one**, and a lookup that obeyed only that would be filled
 * once by the first destination and then be wrong forever after — which is not
 * a *live* shipping cost, it is a single guess. So the rule is sharpened by
 * exactly one clause, and the clause is about provenance rather than emptiness:
 *
 * > a quote may replace an empty box, and it may replace **its own** previous
 * > answer. It may never replace a number a person typed.
 *
 * `previous` is that provenance — the last amount this form wrote into the box,
 * or `null` when it has never written one. If the box still holds it, nobody
 * has touched it since, and the new quote supersedes the old one. If the box
 * holds anything else, somebody typed there and the quote is discarded in
 * silence: it is a suggestion, and a suggestion that argues is a bug.
 *
 * Clearing the box counts as empty and is therefore refillable, which is the
 * right reading — an operator who empties the field is asking for the delivery
 * to be free of charge *or* starting again, and the next destination change
 * answering with a price is the behaviour of every other suggestion on this
 * form. What they must do to keep a hand-typed zero is type `0`, which is a
 * real statement the API stores as a zero shipping line and which this function
 * will never overwrite.
 *
 * Returning `null` rather than the current value is deliberate: the caller sets
 * state, and a caller handed back an identical string would either re-render
 * for nothing or have to compare it itself.
 */
export function quoteFill(
  current: string,
  quoted: string,
  previous: string | null,
): string | null {
  const typed = current.trim();

  if (typed === "") return quoted;
  if (previous !== null && typed === previous) return quoted === typed ? null : quoted;

  return null;
}

/**
 * The quantity, as an integer, or `null` when the text is not one.
 *
 * `null` rather than a clamp or a zero. The field holds raw text on purpose —
 * `Stepper`'s docblock argues it — so "2x" has to stay distinguishable from "2",
 * and a builder that quietly read the leading digit would send an order for a
 * quantity nobody typed.
 */
export function parseQuantity(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  return value > 0 ? value : null;
}

/**
 * Trimmed, and dropped when empty.
 *
 * An address block the operator never touched is omitted from the body
 * altogether rather than sent as eleven empty strings. The two are equivalent to
 * WooCommerce, which stores an unset field as `''` either way — but they are not
 * equivalent to a person reading the request, and a 400 that named
 * `billing.country` on a form where nobody typed an address would be the API
 * answering a question the panel never asked.
 *
 * ## "Never touched" now has to survive a default, and `isAddressEmpty` is how
 *
 * `emptyDraft()` opens both blocks on `DEFAULT_COUNTRY`, so the accumulate-and-
 * check-for-empty that used to be enough would now emit `{"billing":{"country":
 * "DZ"}}` for a form nobody opened the address section of — an order created
 * with an address consisting of a country the operator never stated. That is
 * precisely the "answering a question the panel never asked" the paragraph above
 * refuses, so the emptiness test is delegated to `isAddressEmpty`, which is
 * where the meaning of *untouched* is now defined and argued once.
 *
 * The consequence at the edge is worth naming: an operator who changes the
 * country to `FR`, fills in nothing else and saves sends no address at all. That
 * is a country with nobody and nowhere attached to it, and dropping it loses
 * nothing an order could use — while the reverse, a lone `DZ` on every guest
 * order the shop takes, would put a fact in the database that nobody asserted.
 */
function payloadAddress(
  address: AddressDraft,
  { email }: { email: boolean },
): Record<string, string> | null {
  if (isAddressEmpty(address)) return null;

  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(address)) {
    /*
     * **`email` is refused on a shipping address by name** — "Only a billing
     * address carries an email." WooCommerce has `set_billing_email()` and no
     * shipping equivalent, so this is the API being precise rather than strict,
     * and the panel must not send the key at all. It is dropped here rather than
     * hidden in the form, because "same as billing" copies the whole block and
     * would otherwise carry the billing email across into a 400.
     */
    if (key === "email" && !email) continue;
    const trimmed = value.trim();
    if (trimmed !== "") out[key] = trimmed;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The body of `POST /orders`.
 *
 * Only what the operator actually set. Every optional key is omitted when it is
 * empty rather than sent blank — see `payloadAddress` — and `line_items` is the
 * one key that is always present, because an order with none is the API's first
 * refusal and the drawer's save button is disabled until there is one.
 *
 * **`customer_id` is omitted for a guest, not sent as `0`.** The API documents
 * `0` as the guest value and would accept it, and the two are indistinguishable
 * on the far side; the omission is the honest one because "guest" here is the
 * absence of a customer rather than a customer numbered zero.
 *
 * ## The two money keys, and why each is omitted rather than sent empty
 *
 * **`price` on a line.** `LineItemInput::one()` reads a missing key, `null` and
 * `""` identically — *no manual price, the catalogue prices this line* — so the
 * three are equivalent to the API and are **not** equivalent to a person reading
 * the request. The smaller body is the readable one, and it is the one that
 * matches what the panel means. `[id]/order-edit.ts`'s `payloadLines()` omits it
 * on the same argument plus one this route does not have: there,
 * `guardManualPricesWritable()` tests which lines *state* a price, so the choice
 * is also the difference between a 200 and a 409. Here nothing guards it —
 * `OrderService::create()` never calls that guard — so this omission buys
 * readability alone, and it is written down that way rather than borrowing an
 * argument that does not apply.
 *
 * A price may only ride on a line that also states `product_id` and `quantity`
 * (`LineItemInput::one()`, checked on key presence). Both are unconditional here,
 * so that refusal is unreachable from this form — which is why nothing below
 * guards against it and why `draftProblems` does not pre-empt it either.
 *
 * **`shipping_amount`.** Same shape, different reason. `OrderInput::normalize()`
 * drops `null` and `""` before the payload is assembled, so an empty box is a
 * key the API would discard; sending it would be asking for nothing in a longer
 * sentence. `0` is a real statement — a zero shipping line — and reaches the
 * wire like any other amount.
 *
 * **Neither is validated here.** "Must be an amount.", "Cannot be negative." and
 * "Is implausibly large." are the API's three sentences and they say which of
 * three things is wrong; a local rule would be a second copy of
 * `LineItemInput::amount()` that drifts. `draftProblems` says the same thing at
 * more length.
 */
export function buildPayload(draft: OrderDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    line_items: draft.lines.map((line) => {
      const item: Record<string, unknown> = {
        product_id: line.productId,
        quantity: parseQuantity(line.quantity) ?? 0,
      };

      /* A quantity that is not a whole number sends `0`, which the API refuses
         by name (`line_items.{n}.quantity`). `draftProblems` catches it first so
         the round trip is not spent learning something the form already knew;
         the `?? 0` above is the floor under that, and it must not invent a `1`. */
      const price = line.price.trim();
      if (price !== "") item.price = price;

      return item;
    }),
    status: draft.status,
  };

  if (draft.customerId !== null) payload.customer_id = draft.customerId;

  const billing = payloadAddress(draft.billing, { email: true });
  if (billing) payload.billing = billing;

  const shipping = payloadAddress(
    draft.shippingSameAsBilling ? draft.billing : draft.shipping,
    { email: false },
  );
  if (shipping) payload.shipping = shipping;

  const method = draft.paymentMethod.trim();
  if (method !== "") payload.payment_method = method;

  const title = draft.paymentMethodTitle.trim();
  if (title !== "") payload.payment_method_title = title;

  const note = draft.customerNote.trim();
  if (note !== "") payload.customer_note = note;

  const shippingAmount = draft.shippingAmount.trim();
  if (shippingAmount !== "") payload.shipping_amount = shippingAmount;

  /*
   * The courier.
   *
   * Omitted when empty, on `shipping_amount`'s reasoning one block up:
   * `OrderInput::normalize()` drops `null` and `""` before the payload is
   * assembled, so an unnamed courier is a key the API would discard. Not
   * lower-cased or trimmed beyond this — `OrderInput::provider()` does
   * `strtolower(trim())` itself, deliberately matching `ProviderRegistry::has()`
   * character for character, and a second normalisation here would be a second
   * authority that can only ever drift from it.
   */
  const provider = draft.shippingProvider.trim();
  if (provider !== "") payload.shipping_provider = provider;

  /*
   * ── the destination, which this block used to say could not be sent ──────
   *
   * **The old text was true when it was written and is now overturned.** It
   * read: *"`wilayaId`, `communeId` and `deliveryType` are all on the draft and
   * none is in `allowedFields()`"*, and `buildPayload` sent none of the three.
   * `OrderInput::allowedFields()` now names all three on both verbs,
   * `OrderRepository::applyProps()` writes them to the same three meta keys the
   * checkout writes, and `OrderService::guardDestinationResolves()` refuses a
   * commune that does not belong to the wilaya beside it. Read from source in
   * the backend's `feat/carrier-choice` tree; `ShipmentSubscriber::destinationOf()`
   * quotes its own retired paragraph the same way, and for the same reason —
   * *"a reader who remembers it deserves to know it was overturned on purpose"*.
   *
   * **And it is not optional.** Without these keys a back-office order confirms
   * with `order_destination_missing` and never creates a parcel — every time, by
   * construction, because `destinationOf()` reads ids from meta and refuses to
   * guess them out of a free-text address. That is precisely the manual step
   * this whole item exists to remove, so a create drawer that collected a
   * destination and then dropped it would have shipped the item's own failure
   * mode as a feature.
   *
   * ## Both or neither, and the draft already guarantees it
   *
   * A `wilaya_id` with no `commune_id` is refused — *"Required when the order
   * names a wilaya."* — and the reverse is refused with the mirror sentence.
   * Nothing here has to enforce that: `DestinationFields` clears `communeId`
   * whenever `wilayaId` moves and neither can be set without the other being
   * offered, so a half pair is a form mid-edit and this condition simply waits
   * for it. `draftProblems` does not pre-empt the refusal either, for the reason
   * it gives about every other API rule.
   *
   * ## Integers, and an omitted key rather than a zero
   *
   * `OrderInput::destinationId()` is `is_numeric()` then a whole-number test
   * then `< 1`, so `"16"` would in fact be accepted — but the presenter emits
   * integers and a body that round-trips should send back what it read.
   * `Number()` is exact on these: they are row ids the picker put into the
   * option `value` itself.
   *
   * `0` is **refused** rather than dropped, which is where these part company
   * with the fee above — `LineItemInput`'s split, restated by `OrderInput`: a
   * charge has a meaningful zero and an id does not, *there is no commune 0*.
   * So an unchosen picker omits its key and never sends `0`; `Number("")` is
   * `0` and would have been exactly that mistake.
   */
  const wilayaId = Number(draft.wilayaId);
  const communeId = Number(draft.communeId);

  if (
    draft.wilayaId !== "" &&
    draft.communeId !== "" &&
    Number.isInteger(wilayaId) &&
    Number.isInteger(communeId)
  ) {
    payload.wilaya_id = wilayaId;
    payload.commune_id = communeId;
  }

  /*
   * The journey, independently of the pair — which is the API's own shape:
   * `guardDestinationResolves()` returns early unless one of the two *ids* is
   * stated, and says why, *"it is a journey rather than a place, it needs no
   * pair and no lookup"*. So an order that states only a desk collection has
   * said something harmless and true about an address it may not have yet.
   *
   * Optional, and omitting it ships home — `destinationOf()` falls back to
   * `Destination::HOME` and is the only place that default lives. The draft
   * defaults to `home` because a form has to draw something, so this key is
   * normally present; the guard on `""` is for a draft built by hand.
   */
  const deliveryType = draft.deliveryType.trim();
  if (deliveryType !== "") payload.delivery_type = deliveryType;

  return payload;
}

/**
 * The API's refusals, re-keyed onto the controls that actually produced them.
 *
 * ## The defect this exists for, found by driving the drawer
 *
 * "Same as billing" sends the billing block twice, so **one bad value comes back
 * as two refusals**. Typing `Algeria` into the single country field on screen
 * produced, verbatim:
 *
 *     2 champs empêchent l’enregistrement.
 *       Must be a two-letter ISO country code, such as DZ.   ← links to the field
 *       Must be a two-letter ISO country code, such as DZ.   ← links nowhere
 *
 * Both halves are wrong for the reader. The count says two fields when they
 * typed in one; the second line is an orphan — §3.4 renders a failure with no
 * control on screen as plain text, correctly, because the shipping block is
 * hidden while the switch is on — and an unattributable duplicate of a message
 * that *is* attributed reads as a second, mysterious problem.
 *
 * So while the switch is on, a `shipping.*` refusal is folded onto its billing
 * twin: same field, same control, one line. A refusal that has no billing twin
 * still survives on its own key rather than being dropped — the panel must never
 * swallow something the API objected to.
 *
 * With the switch **off** nothing is remapped: the two blocks are then genuinely
 * two sets of controls, and `shipping.city` means the shipping city.
 */
export function bindRefusals(
  fields: Record<string, string>,
  shippingSameAsBilling: boolean,
): Record<string, string> {
  if (!shippingSameAsBilling) return fields;

  const bound: Record<string, string> = {};

  for (const [key, message] of Object.entries(fields)) {
    if (!key.startsWith("shipping.")) {
      bound[key] = message;
      continue;
    }

    const twin = key.replace(/^shipping\./, "billing.");
    /* The billing message wins where both exist — it is the one whose control
       the person can see, and the two are the same sentence anyway. */
    if (!(twin in bound) && !(twin in fields)) bound[twin] = message;
  }

  return bound;
}

/**
 * The client-side rules, as field keys the drawer binds exactly as it binds a
 * 400's.
 *
 * Deliberately thin. The API validates every one of these and says something
 * better than this file could — "Must be a two-letter ISO country code, such as
 * DZ" is a sentence the panel exists to surface, not to pre-empt. What is here
 * is only what would otherwise cost a round trip to learn something the form
 * already knows for certain: there are no lines, or a quantity is not a number.
 *
 * Keyed the way the API keys its own failures (`line_items.0.quantity`), so the
 * two merge into one map and one `ErrorSummary` without a translation step.
 *
 * ## The two new fields, and why neither added a rule here
 *
 * Item 1's sub-task 6 asks for this function to be extended for the manual price
 * and the delivery fee. **It was examined for both and gained nothing**, which
 * is a decision rather than an omission and is therefore recorded rather than
 * left to look like one.
 *
 * `LineItemInput::amount()` and `OrderInput::amount()` refuse a bad amount with
 * one of three sentences — *"Must be an amount."*, *"Cannot be negative."*,
 * *"Is implausibly large."* — and each names which of three distinct things went
 * wrong. A local rule could only be a fourth, vaguer sentence, or a second copy
 * of those two functions that drifts on the first branch that moves the ceiling.
 * `[id]/order-edit.ts`'s `lineProblems` reached the same conclusion for the same
 * fields and says so; the two forms agreeing about this is worth more than
 * either of them pre-empting a round trip.
 *
 * The stock 409 is not here either, and on this route it *cannot* be:
 * `OrderService::create()` does not call `guardManualPricesWritable()`, so
 * there is no refusal to warn about before a save. The line editor on the detail
 * warns about it because `update()` does.
 *
 * What survives is the original pair — no lines, and a quantity that is not a
 * whole number — because those are the only two things this form knows for
 * certain that would otherwise cost a round trip.
 */
export function draftProblems(
  draft: OrderDraft,
  message: { noLines: string; quantity: string },
): Record<string, string> {
  const problems: Record<string, string> = {};

  if (draft.lines.length === 0) problems.line_items = message.noLines;

  draft.lines.forEach((line, index) => {
    if (parseQuantity(line.quantity) === null) {
      problems[`line_items.${index}.quantity`] = message.quantity;
    }
  });

  return problems;
}

/** The status picker's options, in the API's own order. */
export const CREATABLE = CREATABLE_STATUSES;


/**
 * ── The seam, closed ─────────────────────────────────────────────────────────
 *
 * This block has said twice now that step 2 was missing from this form. It is
 * not any more, and what follows is the record of what was decided rather than
 * a list of what is left — because for the first time there is nothing left in
 * *this* file's half of it.
 *
 * ## The route, and the argument for it
 *
 * **`GET /shipping/rates`, not `GET /checkout/shipping-rates`**, and the two
 * were genuinely both candidates. Read from source, in the backend's
 * uncommitted `feat/carrier-choice` tree:
 *
 *   /shipping/rates            `Shipping\ShippingController::rateArgs()` takes
 *                              exactly `wilaya_id`, `commune_id`, `provider`,
 *                              `delivery_type` and `subtotal`. Four of those
 *                              five are this form's four debounce keys, by
 *                              name. `ac_manage_shipping`.
 *
 *   /checkout/shipping-rates   `Cart\CheckoutController::destinationArgs()`
 *                              plus `cart_token`, and `CheckoutService::
 *                              shippingRates()` reads the **subtotal off the
 *                              cart**, never off the request. Public —
 *                              `permission_callback` is `__return_true`.
 *
 * The storefront route is the tempting one precisely because it needs no
 * capability, and that is the trap: it prices *a cart*. A back-office order is
 * not a cart and has no token, and the panel does not have a cart route on its
 * allowlist to make one with. A form that opened a shopper's cart session in
 * order to learn a delivery fee would be inventing a shopper.
 *
 * The storefront route also answers a different question by design. It returns
 * **one row per courier** — `ShopperRates::forProvider()` has already picked —
 * while `/shipping/rates` returns every row and lets its caller choose, which
 * is what the picker needs in order to say what each courier charges. See
 * `quoteFor` above, which is that choice.
 *
 * So `/shipping/rates`, which was **already on the allowlist** before this
 * branch, put there with the shipping rules editor's own resolver. Nothing was
 * widened; `/checkout/*` remains absent and `tests/boundary.test.ts` now says so
 * by name.
 *
 * ## The capability gap, which is real in kind and empty in practice
 *
 * `Shipping\ShippingController::registerRoutes()` builds **one** guard —
 * `Permissions::callback(Capabilities::MANAGE_SHIPPING)` — and hangs every
 * route on it, `/shipping/providers` and `/shipping/rates` included;
 * `ShippingService::rates()` asserts the same capability again inside. This
 * drawer's own route is `ac_manage_orders`. Two different capabilities, and the
 * panel has three screens that already degrade across exactly this kind of gap.
 *
 * **No role reaches the gap today.** `Permissions\Capabilities::roles()` gives
 * `ac_manage_shipping` to all four roles that hold `ac_manage_orders` — Super
 * Admin, Admin, Manager and Order Manager — read from source. It is therefore
 * `canPickCustomers`'s kind of fallback rather than `canPickProducts`'s: a
 * guard rather than a live path. It is still built, because capabilities are
 * resolved per *user* from `/auth/me` and not per role, and because it costs a
 * text field: `OrderService::guardShippingProviderKnown()` refuses an unknown
 * courier with `fields.shipping_provider` whose entire message is the legal set
 * (`"Available: manual."`), so an operator who cannot read the picker's source
 * can type a name and be told what the names are. `CarrierFields` carries it.
 *
 * ## Coverage — "only the couriers that serve the destination"
 *
 * The step asks the picker to offer only those, citing
 * `EL/el-user-app/src/constants/orderEnums.js`'s `getAvailableProviders()`.
 * That function turns out to be a **hard-coded list of four wilayas ZR Express
 * does not serve**, compared by a normalised name — not an API answer at all.
 * This API has no coverage route either: `ProviderRegistry::describe()` emits
 * `{name, label, is_default}` and nothing about places, and
 * `ShippingProviderInterface` declares no `serves()`. The backend's own answer,
 * stated in `Cart\CheckoutService`, is that **a courier serves a destination if
 * and only if it produced a row**.
 *
 * Filtering the picker on that would be wrong here, and the reason is the whole
 * of `BLOCKED.md` item 2. `ManualProvider::getShippingRates()` returns `[]` by
 * design and `manual` is the only registered provider on this install, so a
 * destination with no tariff rule would empty the picker — and an unsynced
 * Yalidine returns `[]` for *every* destination, which is the state this shop
 * is in and will stay in until somebody runs `sync-destinations`. Hiding a
 * courier the operator knows is collecting the parcel, because the shop has not
 * finished configuring it, is the panel refusing something the API accepts.
 *
 * And the API does accept it: `guardShippingProviderKnown()` validates against
 * *registration*, never the destination, and says why — a back-office order has
 * no cart to quote against. So the picker offers every registered courier and
 * **labels each with what it quoted**, or with the fact that it quoted nothing.
 * The operator sees exactly what the step wanted them to see, and nothing is
 * taken away from them. `CarrierFields` draws it.
 *
 * ## The three rules, all kept
 *
 *  - **It does not overwrite what the operator typed.** `quoteFill` above, and
 *    it is `chooseCustomer`'s rule with one clause added so that a *live* cost
 *    can move: a quote replaces an empty box or its own previous answer, and
 *    nothing else.
 *  - **It does not block the save.** The lookup is a `useQuery` beside the
 *    mutation, never in front of it; nothing about its state reaches the submit
 *    button's `disabled`, which is still `lines.length === 0` and nothing more.
 *    A save fired mid-lookup sends what is in the box, and the answer that
 *    arrives afterwards is discarded by the drawer's own guard rather than
 *    written into a form that is already on the wire.
 *  - **A destination is only as good as the pair it names.** Unchanged, and now
 *    load-bearing: `communeId` is cleared whenever `wilayaId` moves, and
 *    `/shipping/rates` declares both `required` with `minimum: 1`, so the query
 *    is simply disabled until the pair is whole. Nothing is ever sent half.
 *
 * ## What is part of the order body, and this paragraph used to say the opposite
 *
 * It read: *"What still is not part of the order body: the destination and the
 * delivery type. `allowedFields()` has no key for `wilaya_id`, `commune_id` or
 * `delivery_type` and answers `'Unknown field.'` to each, so `buildPayload`
 * sends none of the three."* **Overturned, deliberately, and quoted rather than
 * deleted** — the same way `ShipmentSubscriber::destinationOf()` quotes its own
 * retired paragraph, and for the reason it gives: a reader who remembers the old
 * rule deserves to know it was reversed on purpose rather than forgotten.
 *
 * `allowedFields()` now names all three, on `POST /orders` and
 * `PATCH /orders/{id}` alike, because `normalize()` is one function shared by
 * `forCreate()` and `forUpdate()`. `buildPayload` sends the pair when it is
 * whole and the journey when it is stated, so a fully filled draft now produces
 * `["line_items","status","shipping_provider","wilaya_id","commune_id",
 * "delivery_type"]` and `tests/new-order.test.ts` asserts that set.
 *
 * **The reason it had to change is the item's own point.** An order created
 * without a destination confirms straight into `order_destination_missing` —
 * `ShipmentSubscriber::destinationOf()` reads ids from meta and refuses to guess
 * them out of an address — so no parcel is ever created for it and an operator
 * has to make one by hand. That is the manual step this item exists to remove.
 *
 * `POST /orders/{id}/shipments` still asks for all three again, because — as
 * `CreateParcelDrawer` measured — that route does not read a destination off the
 * order, and it is now the fallback rather than the normal path. That is the
 * same fact `[id]/order-edit.ts`'s seam records, and the *rate lookup* half of
 * that seam is still open: the edit form has a stored fee to protect, which is
 * why its version is conditioned on `order.shipping_amount === null` and why it
 * is a different sub-task on a different screen.
 *
 * Nothing in this branch was measured over live HTTP; `BLOCKED.md` records the
 * 401 that stops it. Every claim above is read from source in `ecom-temp` and
 * says so by `file:symbol`, and the multi-courier shape the picker is built for
 * exists only in `scripts/mock-api.mjs`, which says the same thing about itself.
 */
