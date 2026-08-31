import type { Address, LineItem, Order } from "@/lib/api/schemas/order";
import {
  ADDRESS_KEYS,
  emptyAddress,
  parseQuantity,
  type AddressDraft,
} from "../new-order";

/**
 * The draft behind `OrderEditDrawer`, and the one function that turns it into a
 * `PATCH /orders/{id}` body.
 *
 * Separated from the component for `new-order.ts`'s reason: the interesting part
 * of an edit form is not the markup, it is **which keys reach the wire**, and on
 * this route that question has a sharper answer than on the create route. It is
 * a pure function of two plain objects and is asserted directly in
 * `tests/order-edit.test.ts`.
 *
 * ## What was measured, and how — this is not transcription
 *
 * Every claim below was **measured in-process via `rest_do_request()`** against
 * the plugin in `ecom-temp` (`wp-content/plugins/algerian-commerce-core/tests/Api/orders.php`).
 * Read that phrase strictly: it runs routing, the args schema, `OrderInput`,
 * `AddressInput`, the service guards, the repository and WooCommerce, and it
 * does **not** run Application Password authentication or anything between a
 * browser and PHP. It is not "measured against the live API" — no refusal on
 * this route has ever been seen coming back over HTTP, and `BLOCKED.md` says why.
 * The source each rule comes from is cited by `file:symbol` beside it.
 *
 * ## Three findings, and all three shape this file
 *
 * **1. A partial address merges, so the form sends only what changed.**
 * `Orders\OrderRepository::applyProps()` walks `$address->fields` — the keys the
 * *payload stated* — one setter each, so an omitted field is never written.
 * `{"billing": {"first_name": "x"}}` answers 200 with the other ten intact. The
 * form therefore does not have to echo a whole address back to avoid blanking
 * one, and `addressDiff()` below sends the changed keys alone.
 *
 * **2. Clearing is explicit, which is the one place this differs from create.**
 * `Commerce\AddressInput::parse()` maps `null` to `''` and stores an empty
 * string; `OrderInput::normalize()` does the same for the three string fields.
 * So an emptied field is sent **as `""`** rather than omitted — the opposite of
 * `new-order.ts`'s `payloadAddress`, which drops an empty because on a create
 * there is nothing to clear. A builder that reused the create rule here would
 * silently refuse to let anybody delete a phone number.
 *
 * **3. THE BIG ONE — `line_items` reaches the wire only when the lines were
 * actually edited.**
 * `OrderInput`'s own docblock promises a client can "GET an order, change one
 * thing and PATCH the whole object back". **That holds on `pending` and
 * `on-hold` only.** `Orders\OrderService::update()` runs
 * `guardLineItemsWritable()` on `$input->has('line_items')`, and that guard is
 * `WC_Order::is_editable()` — so on `processing`, `completed`, `cancelled`,
 * `refunded` and `failed` an echoed `line_items` is a **409**, *even when the
 * only thing the operator touched was the customer note*. The same is true of
 * `shipping_amount`, which has its own `guardShippingAmountWritable()`.
 *
 * ## How that rule is kept, and how it *used* to be kept
 *
 * Until the line editor existed this file obeyed the rule by having nothing to
 * disobey it with: `OrderEditDraft` carried no lines and no shipping amount, so
 * there was no branch that could get a condition wrong. That was the right shape
 * for a form that could not edit lines, and it is written down here rather than
 * deleted because **the guarantee has changed hands, not disappeared**.
 *
 * The draft now carries both, because the line editor writes through this same
 * route and one route deserves one answer to "which keys reach the wire". What
 * replaces the structural absence is the mechanism every other field on this
 * route already uses: **the body is a diff, and a key that did not change is not
 * in it.** `linesChanged()` compares the draft's lines to the stored ones field
 * by field, in index order — which is the pairing the API itself uses — and an
 * untouched draft answers `false`, so `line_items` is absent from the body of
 * every form that does not draw a lines control. `tests/order-edit.test.ts`
 * asserts that directly, on a `completed` order, for every edit the *other* form
 * can make.
 *
 * That is strictly stronger than the old rule in one way and weaker in one, and
 * both are worth naming. Stronger: the same builder now covers the editor, so
 * there is no second payload function that could learn a different lesson about
 * the 409. Weaker: it is a comparison rather than an absence, so it can be got
 * wrong — which is why the comparison is one function, three lines long, with
 * its own test, rather than a condition inlined at the call site.
 *
 * ## `shipping_amount` is emitted on the same terms and one more
 *
 * An **emptied** field is not an edit. `OrderInput::normalize()` drops `null`
 * and `""` before the payload is assembled, so an empty `shipping_amount` states
 * nothing and the order's shipping line is left exactly where it is; there is no
 * way to un-state a fee, and `0` is how one is cancelled. A builder that sent
 * `""` would produce a body that either does nothing or — sent alone — answers
 * 400 *"No supported fields were provided."* The field's own hint says this on
 * screen, because it is not guessable from the control.
 *
 * ## And what is *still* not here: money
 *
 * No total, no subtotal, no line maths, and the line editor computes none
 * either. `total`, `subtotal`, `shipping_total`, `discount_total` and `total_tax`
 * are all in `OrderInput::READ_ONLY` and are dropped silently rather than
 * refused — `{"total": "1.00"}` alone answers 400 *"No supported fields were
 * provided."* with **no `details.fields`**, because after the read-only keys are
 * stripped the payload is empty. There is no per-field error for a read-only key,
 * ever, so a form that offered one would be binding to a refusal that cannot
 * arrive.
 *
 * What the form states is a *price per unit* and a *delivery fee*; what the
 * order costs is the server's answer to those. The totals stay where they are —
 * rendered by `OrderItems` from the 200 the write produced, after
 * `router.refresh()`.
 */

/**
 * One line as the editor holds it.
 *
 * ## `key` is the panel's, and the API's `id` is deliberately not here
 *
 * A stored line arrives with an `id` and it is the obvious React key. It is also
 * the one field on this object that must never be carried, and the reason is the
 * whole shape of this route: `line_items` is **replace-the-set**.
 * `OrderRepository::replaceLineItems()` removes every line and re-adds the
 * payload's, `resolveLines()` pairs them by **array index**, and
 * `LineItemInput::READ_ONLY` drops `id` on the way in — so the id addresses
 * nothing, and every id on the order changes on every write that names the key,
 * an identical replace included.
 *
 * A draft that carried ids would therefore be carrying a value that is stale the
 * instant it is useful, and the first bug it produces is silent: two lines
 * keyed by ids that churned, React reconciling the wrong row, and a quantity
 * typed into one line appearing in another. So the draft mints its own key —
 * `nextLineKey()` — which is unique inside this form, meaningless outside it,
 * and thrown away at the payload boundary. Two rows for the same product are
 * legal on this API and this is what keeps them distinguishable.
 *
 * ## `name`, `sku` and `cataloguePrice` are carried and not sent
 *
 * `new-order.ts`'s `DraftLine` makes the same argument: the row has to render
 * itself, and re-resolving a product id at render would be a request per line.
 * `cataloguePrice` is the one addition — see `LineDraft.cataloguePrice`.
 */
export type LineDraft = {
  /** Unique within this draft. **Never** the API's line id — see above. */
  key: number;
  productId: number;
  /** `0` is "no variation", which is what the API emits for a simple product. */
  variationId: number;
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
   */
  price: string;
  /**
   * What the catalogue was asking, when the panel happens to know — otherwise
   * `null`, and nothing is drawn.
   *
   * **The order's read shape does not carry it.** `OrderPresenter::lineItems()`
   * emits the *override* and the line's computed totals, and the catalogue price
   * is a fact about the product rather than about the line. The only route that
   * publishes it is `GET /products`, which takes `search`, `status`, `orderby`
   * and `category` and **has no `include`** — read from
   * `Products\ProductController::register()`'s args — so there is no batched
   * lookup by id, and a per-line `GET /products/{id}` is the request-per-row this
   * panel refuses everywhere else.
   *
   * So it is filled from the one source that costs nothing: the product picker
   * inside the editor. Every result the picker renders is a product the panel
   * has just been told the price of, and a line added from it carries that price
   * at the moment it is added. A line the order arrived with stays `null` until
   * a search happens to name its product. `null` renders nothing at all — an
   * invented comparison would be worse than an absent one.
   */
  cataloguePrice: string | null;
  /** A string, like every other field in the form layer. Never a `number`. */
  quantity: string;
};

export type OrderEditDraft = {
  /**
   * `null` is a guest order. The API's guest value is `0` and that is what a
   * guest order reads back as; `null` is the panel's vocabulary for "no
   * customer", shared with the create draft so one picker serves both forms, and
   * it is mapped back at the payload boundary in `buildEditPayload`.
   */
  customerId: number | null;
  billing: AddressDraft;
  shipping: AddressDraft;
  shippingSameAsBilling: boolean;
  paymentMethod: string;
  paymentMethodTitle: string;
  customerNote: string;
  /**
   * The complete intended set of lines, because that is the only kind of set
   * this route accepts. See `linesChanged` for when it reaches the wire.
   */
  lines: LineDraft[];
  /** The stated delivery fee, as typed. `""` states nothing — see the docblock. */
  shippingAmount: string;
  /**
   * Where the order is going, as geography row ids held as strings.
   *
   * ## Why this form has them at all, which was not true a branch ago
   *
   * `OrderInput::allowedFields()` names `wilaya_id`, `commune_id` and
   * `delivery_type` as of the carrier branch, on both verbs, and
   * `OrderService::guardDestinationResolves()` deliberately carries **no
   * `is_editable` gate**. That absence is the whole reason these are here rather
   * than beside the lines in `OrderLinesDrawer`: the guard's own docblock says a
   * gate *"would freeze it at the exact moment it starts to matter"*, because
   * both ways an order earns a `shipping_provider_error` are recorded at
   * `processing`, which is not editable. So the destination belongs to the form
   * whose every field is writable in every status, and that is this one.
   *
   * It is the retry path in `ShipmentSubscriber`'s sense, and it is the reason
   * the parcels card's *"correct the destination"* remedy has somewhere to go.
   *
   * ## Strings, and the pair is cleared together
   *
   * Strings like every other field in the form layer, and `""` is *not stated*.
   * `communeId` is emptied whenever `wilayaId` moves, because a commune belongs
   * to exactly one wilaya and a half-changed pair names a place that does not
   * exist — `DestinationFields` enforces that in its own handler and
   * `new-order.ts` says the same thing about the create draft.
   *
   * ## Emptying does not clear the order's destination, and that is the API
   *
   * `OrderInput::normalize()` drops `null` and `''` for these two before the
   * payload is assembled, exactly as it does for `shipping_amount` and
   * `shipping_provider` — so an emptied picker states nothing and the stored
   * destination stays where it is. There is no way to un-address an order over
   * this route, and `0` is not the escape hatch a zero fee is: `OrderInput`
   * refuses it outright, on the argument that *there is no commune 0* while
   * there very much is a delivery charge of nothing. The form's hint says so,
   * because no picker can imply it.
   */
  wilayaId: string;
  communeId: string;
  /**
   * `home`, `desk`, or `""` when the order does not say — which is a third
   * value and not a synonym for `home`.
   *
   * `OrderInput` refuses to default this and argues why:
   * `ShipmentSubscriber::destinationOf()` already falls back to
   * `Destination::HOME` for a missing value and *"a second default here would
   * give one fact two owners that can drift, and would make a back-office order
   * **claim** a journey nobody chose"*. The create draft can honestly open on
   * `home` because it is stating a new fact; this one is reporting an existing
   * one, so an order that says nothing opens on nothing.
   */
  deliveryType: string;
};

/**
 * The ceiling both amounts share, so a form can say it before the API does.
 *
 * `Orders\LineItemInput::MAX_PRICE` and `Orders\OrderInput::MAX_SHIPPING_AMOUNT`
 * are two separate constants that happen to hold the same number, and they are
 * one here because they are the same rule to the person typing: over this, both
 * answer 400 *"Is implausibly large."* They are declared separately on the
 * backend on purpose — the line price's docblock argues at length that the
 * ceiling is a numeric guard rather than a business rule — so if one ever moves,
 * this constant is where the panel finds out it was wrong.
 */
export const MAX_AMOUNT = 9999999.99;

/** One line as it arrives, into the shape the editor holds. */
function lineDraftOf(item: LineItem, key: number): LineDraft {
  return {
    key,
    productId: item.product_id,
    variationId: item.variation_id,
    name: item.name,
    sku: item.sku,
    // `null` is "the catalogue prices this line" on both sides of the wire, and
    // `""` is how the form says the same thing. See `LineDraft.price`.
    price: item.price ?? "",
    cataloguePrice: null,
    quantity: String(item.quantity),
  };
}

/** The order's lines, keyed by position at seed time. */
export function lineDraftsOf(order: Order): LineDraft[] {
  return order.line_items.map(lineDraftOf);
}

/**
 * The next unused key, derived rather than counted.
 *
 * A module-level counter would have been shorter and is the wrong shape for a
 * file whose every other export is a pure function of its arguments: two drawers
 * open in two tabs would share it, and a test would have to reset it between
 * cases. Derived from the list, it is deterministic and local — and it cannot
 * collide, because the only keys that exist are the ones in the list.
 */
export function nextLineKey(lines: LineDraft[]): number {
  return lines.reduce((max, line) => Math.max(max, line.key), -1) + 1;
}

/** One stored address as the draft holds it. Absent keys read as empty. */
export function addressDraftOf(address: Address): AddressDraft {
  const draft = emptyAddress();
  for (const key of ADDRESS_KEYS) {
    const value = address[key];
    if (typeof value === "string") draft[key] = value;
  }
  return draft;
}

/**
 * Do the two stored blocks say the same thing?
 *
 * `email` is excluded because a shipping address has none — WooCommerce has
 * `set_billing_email()` and no counterpart, and `AddressInput::BILLING_ONLY`
 * follows it — so comparing it would report every order with a billing e-mail as
 * having two different addresses.
 */
export function sameAddress(billing: Address, shipping: Address): boolean {
  return ADDRESS_KEYS.every(
    (key) => key === "email" || (billing[key] ?? "") === (shipping[key] ?? ""),
  );
}

/**
 * The order as the form opens on it.
 *
 * **"Same as billing" is seeded from the data rather than defaulted**, which is
 * the difference between a create form and an edit form: a new order has no
 * addresses and the switch is a convenience, while an existing order already
 * has two and the switch has to *report* whether they agree before it can offer
 * to keep them agreeing. Seeding it on would silently promise to overwrite a
 * shipping address that deliberately differs — which is most of the orders where
 * anybody fills the second block in at all.
 */
export function draftOf(order: Order): OrderEditDraft {
  return {
    customerId: order.customer_id === 0 ? null : order.customer_id,
    billing: addressDraftOf(order.billing),
    shipping: addressDraftOf(order.shipping),
    shippingSameAsBilling: sameAddress(order.billing, order.shipping),
    paymentMethod: order.payment_method,
    paymentMethodTitle: order.payment_method_title,
    customerNote: order.customer_note,
    lines: lineDraftsOf(order),
    /*
     * `null` is the API saying *nobody stated a fee* — the checkout quoted it
     * from §14's tariff, or there is none — and `""` is how this form says the
     * same thing back. It is deliberately **not** seeded from `shipping_total`,
     * which is the derived number and would turn every quoted fee into a stated
     * one on the first save. `OrderPresenter::shippingAmount()` argues the pair
     * at length; the short version is *send `shipping_amount`, read
     * `shipping_total`*.
     */
    shippingAmount: order.shipping_amount ?? "",
    /*
     * `null` on all three is *the order does not say*, and it is the honest
     * seed for a screen that reports rather than proposes.
     * `OrderPresenter::destinationId()` emits `null` rather than `0` precisely
     * so a client can round-trip an unaddressed order without 400ing on two
     * keys it never touched, and an empty picker on such an order is showing
     * the truth — its own docblock says so.
     *
     * Seeding the wilaya from `billing.state` was considered and is wrong. That
     * field is free text a shopper typed, `AddressInput` validates its shape
     * and nothing more, and it is empty on ~92 % of orders — so it would fill
     * the picker with a guess on one order in twelve and leave the rest blank,
     * and the one in twelve would be a *routing* decision derived from an
     * address. `Shipping\Destination`'s docblock refuses that derivation by
     * name and `DestinationFields` restates it: a destination is asked for, it
     * is never inferred from an address.
     */
    wilayaId: order.wilaya_id === null ? "" : String(order.wilaya_id),
    communeId: order.commune_id === null ? "" : String(order.commune_id),
    deliveryType: order.delivery_type ?? "",
  };
}

/**
 * The changed fields of one address block, or `null` when none changed.
 *
 * Trimmed on both sides of the comparison, because the API trims what it stores
 * — `AddressInput::parse()` calls `trim()` before the length check — so a stored
 * value is already trimmed and a draft that differs only by a trailing space is
 * not a change. Sending it would write an audit row for nothing.
 *
 * An emptied field is sent as `""`. See the file docblock: that is how clearing
 * is expressed, and it is the whole reason this cannot reuse `payloadAddress`.
 */
function addressDiff(
  draft: AddressDraft,
  stored: Address,
  { email }: { email: boolean },
): Record<string, string> | null {
  const out: Record<string, string> = {};

  for (const key of ADDRESS_KEYS) {
    /*
     * **`email` is refused on a shipping address by name** — "Only a billing
     * address carries an email." It is dropped here rather than hidden in the
     * form, because "same as billing" copies the whole block and would otherwise
     * carry the billing e-mail across into a 400. The create builder drops it in
     * exactly the same place and for exactly the same measurement.
     */
    if (key === "email" && !email) continue;

    const next = draft[key].trim();
    const before = (stored[key] ?? "").trim();
    if (next !== before) out[key] = next;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Did the operator actually edit the lines?
 *
 * **This is the condition the whole route turns on.** A body that names
 * `line_items` is a 409 on every order that has left `pending`, and on an
 * `on-hold` order holding stock it is a 409 again if any line states a price. So
 * the key must be absent unless the person meant to rewrite the set — and
 * "meant to" has to be decided from the draft, because the wire carries no way
 * to say *these are the same lines I already had*.
 *
 * Compared **in index order, field by field**, because index order is the
 * pairing the API itself uses: `OrderRepository::resolveLines()` walks the
 * payload's list and `replaceLineItems()` re-adds it in that order. Reordering
 * two lines is therefore a real change and is reported as one, which is correct
 * — the stored order really would come back with the rows the other way round.
 *
 * The four fields are the four the payload can carry. `name` and `sku` are not
 * among them: they are the picker's, they are dropped on the way out, and a
 * product renamed in the catalogue since the order was placed must not read as
 * an edit somebody made.
 *
 * `price` is compared against `""` for a stored `null`, which is the same
 * mapping `lineDraftOf()` applies — *no override* on both sides. A stored
 * `"1200.50"` re-typed as `1200.5` **does** compare as changed, and that is
 * honest rather than a defect: the API stores the string it is given and
 * `OrderPresenter` publishes it through `wc_format_decimal()`, so the two are
 * the same amount written two ways and the person really did retype the box.
 * The alternative — parsing both sides to floats — would put the panel in the
 * business of deciding when two prices are the same number, which is exactly
 * the arithmetic `lib/format/money.ts` refuses to do.
 */
export function linesChanged(lines: LineDraft[], stored: LineItem[]): boolean {
  if (lines.length !== stored.length) return true;

  return lines.some((line, index) => {
    const was = stored[index];
    return (
      line.productId !== was.product_id ||
      line.variationId !== was.variation_id ||
      line.quantity.trim() !== String(was.quantity) ||
      line.price.trim() !== (was.price ?? "")
    );
  });
}

/**
 * The lines as `line_items` takes them — the complete set, every time.
 *
 * There is no partial form of this key. `replaceLineItems()` removes every
 * existing line and re-adds the payload's, so a body naming one line is a body
 * asking for an order with one line on it. That is why `linesChanged()` above
 * gates the key rather than filtering it: either the whole set goes, or nothing
 * does.
 *
 * **`price` is omitted rather than sent empty when there is no override**, and
 * the two are not quite equivalent even though `LineItemInput` reads them the
 * same way. Omitting means the line does not *state* a price, which is the exact
 * test `OrderService::guardManualPricesWritable()` applies — so on an order
 * holding stock, a set in which nobody typed an amount goes through, while the
 * same set with `price: ""` on every line would also go through but for a reason
 * nobody reading the payload could see. The smaller body is the readable one.
 *
 * **`variation_id` is carried whenever it is not zero, and that is not
 * optional.** A line on a variable product is priced and stocked from the
 * variation; dropping the key would send the parent id alone, and
 * `OrderRepository::resolveProduct()` answers that with a 400 —
 * *"This is a variable product; name the variation to order."* — on a line
 * nobody touched. Zero is omitted because zero is the absence.
 *
 * A quantity that is not a whole number sends `0`, which the API refuses by name
 * (`line_items.{n}.quantity`). `lineProblems()` below catches it first so the
 * round trip is not spent learning something the form already knew; this is the
 * floor under that, and it must not silently invent a `1`.
 */
export function payloadLines(lines: LineDraft[]): Record<string, unknown>[] {
  return lines.map((line) => {
    const item: Record<string, unknown> = {
      product_id: line.productId,
      quantity: parseQuantity(line.quantity) ?? 0,
    };

    if (line.variationId !== 0) item.variation_id = line.variationId;

    const price = line.price.trim();
    if (price !== "") item.price = price;

    return item;
  });
}

/**
 * The body of `PATCH /orders/{id}` — only the fields that actually changed.
 *
 * A diff rather than a snapshot, for two reasons that both come from the
 * measurements above. The partial merge makes it *safe*: an omitted field is
 * never written, so sending three keys says nothing about the other twenty. And
 * the whole-body 409 makes it **necessary**: the natural implementation of an
 * edit form — send everything the form holds — is the one that puts `line_items`
 * on the wire and 409s on every order that has left `pending`.
 *
 * `status` is never here either, and that is not an omission. The status is
 * `OrderActions`' control in the page header: a move has its own transition
 * table, its own 409 carrying `allowed`, and a `ConfirmDialog` on the two
 * terminal ones. Folding it into a save would put an irreversible act behind a
 * button labelled "save", and `OrderService::update()` runs `guardTransition()`
 * before every other guard — so a body carrying both a refused move and a good
 * address reports only the move, and the address edit would silently not happen.
 *
 * An empty object is a real and expected answer: it means nothing changed, and
 * the caller must not send it — `OrderService::update()` answers a payload with
 * no supported fields with a **400** *"No supported fields were provided."*
 * carrying no `details` at all. `isEditDirty` below is the same question, asked
 * once, so the save button and the request cannot disagree about it.
 */
export function buildEditPayload(
  draft: OrderEditDraft,
  order: Order,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  const customerId = draft.customerId ?? 0;
  if (customerId !== order.customer_id) payload.customer_id = customerId;

  const billing = addressDiff(draft.billing, order.billing, { email: true });
  if (billing) payload.billing = billing;

  /* While the switch is on the billing draft *is* the shipping address, so the
     shipping block is diffed against what is stored under `shipping` — not
     against `billing`. Turning the switch on over two blocks that already differ
     is therefore itself an edit, which is what the operator asked for. */
  const shipping = addressDiff(
    draft.shippingSameAsBilling ? draft.billing : draft.shipping,
    order.shipping,
    { email: false },
  );
  if (shipping) payload.shipping = shipping;

  /*
   * `payment_method` and `payment_method_title` are **independent** — measured,
   * neither requires the other — so they are diffed separately rather than sent
   * as a pair. The one coupling is on the API's side and only in one direction:
   * clearing the method clears the title with it unless the same body states a
   * title, which is `WC_Order::set_payment_method()`'s own behaviour and not
   * something a client can or should compensate for.
   */
  const method = draft.paymentMethod.trim();
  if (method !== order.payment_method.trim()) payload.payment_method = method;

  const title = draft.paymentMethodTitle.trim();
  if (title !== order.payment_method_title.trim()) {
    payload.payment_method_title = title;
  }

  const note = draft.customerNote.trim();
  if (note !== order.customer_note.trim()) payload.customer_note = note;

  /*
   * The two `is_editable`-gated keys, and the reason they are last is only
   * readability — the API validates the whole body at once. What matters is the
   * condition, not the position: `linesChanged()` is false for a draft seeded
   * from this order and not edited, so `OrderEditDrawer` — which seeds both and
   * draws neither — cannot produce either key however its own fields are
   * changed. That is asserted directly rather than assumed.
   */
  if (linesChanged(draft.lines, order.line_items)) {
    payload.line_items = payloadLines(draft.lines);
  }

  /*
   * An empty box is not an edit, and this is the one field where that needs
   * saying twice.
   *
   * `OrderInput::normalize()` drops `null` and `""` before the payload is
   * assembled — measured in-process, and read from source at `OrderInput.php`'s
   * `array_key_exists('shipping_amount', …) && !in_array(…, [null, ''], true)`.
   * So an emptied field states nothing, the order's shipping line is left
   * exactly where it is, and there is no way to *un*-state a fee: `0` cancels
   * one, and empty means "this request has no opinion". Sending `""` would
   * produce a key the API discards, and sent alone it would produce the 400
   * *"No supported fields were provided."* on a form the person had just typed
   * in. The field's hint says so on screen, because no control can imply it.
   */
  const shippingAmount = draft.shippingAmount.trim();
  if (shippingAmount !== "" && shippingAmount !== (order.shipping_amount ?? "")) {
    payload.shipping_amount = shippingAmount;
  }

  /*
   * ── the destination, and it travels as a pair or not at all ─────────────
   *
   * **Both ids or neither.** The API would in fact accept one:
   * `guardDestinationResolves()` reads the order's stored half for whichever
   * key the payload did not state, and then resolves the pair. That is a
   * courtesy to a client sending a partial body and it is a bad shape for a
   * form to rely on — the operator who moved the wilaya and has not yet chosen
   * a commune would send `wilaya_id` alone, the guard would pair it with the
   * *old* commune, and the refusal that comes back is *"That commune belongs to
   * a different wilaya"* about a commune no longer on screen. So the pair is
   * sent whole and the form does not send a half.
   *
   * That is also free rather than enforced: the pickers clear `communeId`
   * whenever `wilayaId` moves, so a half pair is never a *changed* pair — it is
   * a pair mid-edit, and `whole` below is what keeps it off the wire until the
   * operator finishes.
   *
   * **Ints, not the strings the form holds.** `OrderInput::destinationId()`
   * runs `is_numeric()` before the cast and would accept `"16"` — it is
   * `!is_numeric($value) || (float)$value !== floor((float)$value) || (int)$value < 1`
   * and nothing more — but the presenter emits integers and a body that
   * round-trips should send back what it read. `Number()` on a picker value is
   * exact here: these are row ids the form put in the option `value` itself.
   *
   * **Emptied is not cleared.** `null` and `''` are dropped by `normalize()`
   * before the payload is assembled, so clearing the pickers and saving would
   * send two keys the API discards. The condition therefore tests `whole`
   * rather than `changed` alone — an operator who empties the pair changes the
   * draft and sends nothing, which is exactly what the API would have done with
   * it, and the field's hint says so on screen.
   */
  const wilayaId = Number(draft.wilayaId);
  const communeId = Number(draft.communeId);
  const whole =
    draft.wilayaId !== "" &&
    draft.communeId !== "" &&
    Number.isInteger(wilayaId) &&
    Number.isInteger(communeId);

  if (whole && (wilayaId !== order.wilaya_id || communeId !== order.commune_id)) {
    payload.wilaya_id = wilayaId;
    payload.commune_id = communeId;
  }

  /*
   * The journey is independent of the pair, and the API agrees:
   * `guardDestinationResolves()` returns early unless one of the two *ids* is
   * stated, and its comment says why — `delivery_type` *"is a journey rather
   * than a place, it needs no pair and no lookup"*, so an order that states
   * only a desk collection has said something harmless and true about an
   * address it may not have yet. It is therefore diffed on its own.
   *
   * `""` is dropped for the ids' reason, and it is the value an order that has
   * never said reads back as — so opening this drawer on such an order and
   * saving something else sends no `delivery_type`, which is right: the order
   * still has no opinion and `destinationOf()` still ships it home.
   */
  const deliveryType = draft.deliveryType.trim();
  if (deliveryType !== "" && deliveryType !== (order.delivery_type ?? "")) {
    payload.delivery_type = deliveryType;
  }

  return payload;
}

/**
 * Is there anything to save?
 *
 * The same question `buildEditPayload` answers, asked through it rather than
 * beside it. A second dirtiness rule — comparing the draft to a re-derived
 * `draftOf(order)`, which is what most forms in this panel do — would disagree
 * with the builder on exactly the cases that matter: a field that differs only
 * by whitespace reads as dirty and sends nothing, so the save button would
 * enable, the request would carry an empty body, and the API would answer 400
 * *"No supported fields were provided."* for a form the person had just edited.
 */
export function isEditDirty(draft: OrderEditDraft, order: Order): boolean {
  return Object.keys(buildEditPayload(draft, order)).length > 0;
}

/** The API's 5 000-character cap on `customer_note`, so the form can show it. */
export const MAX_CUSTOMER_NOTE = 5000;

/**
 * The line editor's client-side rules, keyed the way the API keys its own.
 *
 * `new-order.ts`'s `draftProblems` in the same shape and deliberately just as
 * thin, for the same reason: the API validates every one of these and says
 * something better than this file could. *"Must be an amount."*, *"Cannot be
 * negative."* and *"Is implausibly large."* are sentences the panel exists to
 * surface, not to pre-empt — and a price rule written here would be a second
 * copy of `LineItemInput::amount()` that drifts.
 *
 * What is here is only what would otherwise spend a round trip learning
 * something the form already knows for certain: there are no lines, or a
 * quantity is not a whole number. Both are refusals the API does make —
 * `line_items` and `line_items.{n}.quantity` — so the keys are the API's and the
 * two merge into one map and one `ErrorSummary` with no translation step.
 *
 * **A stated price on a stock-holding order is not here either**, though the
 * panel can see it coming: `stock_reduced` is on the read shape and
 * `guardManualPricesWritable()` is a pure function of it and of which lines state
 * a price. It is left to the API on purpose. The guard is a **409 carrying
 * `lines`**, not a validation error, and the distinction is the API's own — no
 * amount the operator could retype would be accepted, so a per-field message
 * saying *that value is wrong* would be a lie about what happened. The editor
 * warns before the save and binds the refusal after it; neither is a `problems`
 * entry.
 */
export function lineProblems(
  lines: LineDraft[],
  message: { noLines: string; quantity: string },
): Record<string, string> {
  const problems: Record<string, string> = {};

  if (lines.length === 0) problems.line_items = message.noLines;

  lines.forEach((line, index) => {
    if (parseQuantity(line.quantity) === null) {
      problems[`line_items.${index}.quantity`] = message.quantity;
    }
  });

  return problems;
}

/**
 * ── The seam step 2 lands in ─────────────────────────────────────────────────
 *
 * Item 1's sub-task 4 asks for the shipping cost to be "prefilled from the rate
 * lookup (item 2 below)". **Step 2 is not built.** There is no rate lookup on
 * this screen to call, and `GET /shipping/rates` — which does exist and is
 * already allowlisted for the shipping rules editor — is not it: it answers a
 * *tariff* question, `wilaya_id` and `commune_id` in and a rate out, and an order
 * carries a wilaya code on its address at best (empty on ~92 % of them, measured)
 * and never a commune id. Turning an address into those two ids is the resolver
 * step 2 is for.
 *
 * ### Half of that paragraph has since been overturned, and it is quoted rather
 * ### than rewritten so a reader who remembers it knows why
 *
 * **"an order … never [carries] a commune id" is no longer true.** The carrier
 * branch made `wilaya_id`, `commune_id` and `delivery_type` writable on both
 * `POST /orders` and `PATCH /orders/{id}` and readable on the order, and this
 * form now edits all three — `OrderEditDraft` above, and `buildEditPayload`'s
 * destination block. So the "resolver" this paragraph was waiting for turned out
 * to be unnecessary for the *ids*: they are stated, not derived, which is the
 * outcome `Shipping\Destination`'s docblock always argued for.
 *
 * **What is still open is exactly the rate lookup**, and the paragraph is right
 * about it. Nothing on this screen calls `GET /shipping/rates`, and the pieces
 * below are still the whole of what a later branch has to add. The reasoning the
 * old text gave is the reasoning that paid off, which is why it is kept.
 *
 * So the field is built **editable and overwritable with no prefill**, which is
 * the honest state: `draftOf()` seeds it from `order.shipping_amount`, which is
 * what somebody previously stated, and from nothing else. An empty field on an
 * order the checkout quoted is not a gap in this form — it is the true answer to
 * "what did anybody state?", and `shipping_total` on the detail beside it says
 * what the order is actually charging.
 *
 * **What step 2 has to do here, and nothing else:** put a suggested amount into
 * `OrderEditDraft.shippingAmount` when the editor opens on an order whose
 * shipping line nobody has stated — that is, when `order.shipping_amount` is
 * `null`. Every other piece is already in place: the control is a real field,
 * the diff already tells a typed amount from an untouched one, and a suggestion
 * that the operator overwrites is just an edit. It must **not** overwrite a
 * stated fee, for `CustomerPicker`'s reason on the create drawer — a value a
 * person chose is not a blank to be filled — and it must not turn a quoted fee
 * into a stated one by seeding from `shipping_total`, which is the mistake
 * `draftOf()`'s comment names.
 *
 * Nothing above is a rate call, and no docblock in this branch claims one was
 * made. `BLOCKED.md` is where measurements this environment cannot take are
 * recorded; this is not one of those — it is simply a step that has not been
 * written yet.
 */
