import { CREATABLE_STATUSES, type OrderStatus } from "@/lib/order-status";

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
 */
export function emptyDraft(): OrderDraft {
  return {
    lines: [],
    customerId: null,
    status: "pending",
    billing: emptyAddress(),
    shipping: emptyAddress(),
    shippingSameAsBilling: true,
    paymentMethod: "",
    paymentMethodTitle: "",
    customerNote: "",
    /*
     * Empty, and there is nothing to seed it from — see the seam at the foot of
     * this file. Step 2's rate lookup is what fills it; until then the honest
     * default is the one that states nothing.
     */
    shippingAmount: "",
  };
}

export function isAddressEmpty(address: AddressDraft): boolean {
  return Object.values(address).every((value) => value.trim() === "");
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
 */
function payloadAddress(
  address: AddressDraft,
  { email }: { email: boolean },
): Record<string, string> | null {
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
 * ── The seam step 2 lands in ─────────────────────────────────────────────────
 *
 * Item 1's sub-task 4 asks for the delivery fee to be "prefilled from the rate
 * lookup (item 2 below)". **Step 2 is not built**, and on this form it is
 * missing twice over.
 *
 * There is no rate lookup on this screen to call, and `GET /shipping/rates` —
 * which does exist and is already allowlisted for the shipping rules editor — is
 * not it: it answers a *tariff* question, `wilaya_id` and `commune_id` in and a
 * rate out. And this drawer collects neither. It has a free-text address block
 * whose `state` is a wilaya code at best; the wilaya and commune pickers are
 * step 2's own admin sub-task 2, and turning an address into those two ids is
 * the resolver step 2 is for. So the field is not merely unfilled — nothing on
 * screen yet says *where* the parcel is going.
 *
 * The field is therefore built **editable and overwritable with no prefill**,
 * which is the honest state: `emptyDraft()` seeds it empty and nothing else
 * writes it. An empty box on a new order is not a gap in this form — it is the
 * true answer to "what did anybody state?", and the 201 says what the order
 * ended up charging.
 *
 * **What step 2 has to do here, and nothing else:** once the wilaya and commune
 * pickers exist in this drawer, debounce a rate call on (wilaya, commune,
 * provider, delivery type) and write the answer into `OrderDraft.shippingAmount`.
 * Every other piece is already in place — the control is a real field, the
 * builder already tells a typed amount from an empty one, and a suggestion the
 * operator overwrites is just a value they typed. Two rules come with it, and
 * both are borrowed rather than invented:
 *
 *  - **It must not overwrite an amount somebody has already typed.**
 *    `CustomerPicker`'s rule on this same drawer — a chosen customer's address
 *    is copied only into a block nobody has touched — and `chooseCustomer` is
 *    the working example of it.
 *  - **It must not block the save.** `EL/el-user-app/src/pages/CartCheckoutPage.jsx`
 *    debounces at 600 ms and falls back to a fixed fee when the quote fails;
 *    a back-office order taken by phone must not be unsavable because a courier
 *    API is down.
 *
 * `[id]/order-edit.ts` closes with the same seam for the edit form, and the two
 * differ in exactly one way worth knowing: there, a *stated* fee already exists
 * on some orders and must never be overwritten by a quote, which is why that
 * seam is conditioned on `order.shipping_amount === null`. Here there is no
 * stored value at all, so the only thing to protect is what the operator typed.
 *
 * Nothing above is a rate call, and no docblock in this branch claims one was
 * made. `BLOCKED.md` is where measurements this environment cannot take are
 * recorded; this is not one of those — it is simply a step that has not been
 * written yet.
 */
