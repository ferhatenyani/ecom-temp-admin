import type { Address, Order } from "@/lib/api/schemas/order";
import { ADDRESS_KEYS, emptyAddress, type AddressDraft } from "../new-order";

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
 * **3. THE BIG ONE — `line_items` must not be in the body at all.**
 * `OrderInput`'s own docblock promises a client can "GET an order, change one
 * thing and PATCH the whole object back". **That holds on `pending` and
 * `on-hold` only.** `Orders\OrderService::update()` runs
 * `guardLineItemsWritable()` on `$input->has('line_items')`, and that guard is
 * `WC_Order::is_editable()` — so on `processing`, `completed`, `cancelled`,
 * `refunded` and `failed` an echoed `line_items` is a **409**, *even when the
 * only thing the operator touched was the customer note*. The same is now true
 * of `shipping_amount`, which has its own `guardShippingAmountWritable()`.
 *
 * The instruction that follows is "omit the key" rather than "omit it when it
 * has not changed", and this file obeys it **structurally rather than by
 * checking**: `OrderEditDraft` has no lines and no shipping amount in it, so
 * there is no branch that could get the condition wrong and no future edit to
 * this function that could reintroduce the key by accident. The line-item
 * editor is a separate control with a separate write, because the two halves
 * have separate gates — lines are frozen on most orders and these fields never
 * are, and one form with a permanently disabled half is worse than two forms.
 *
 * ## And what is *not* here: money
 *
 * No total, no subtotal, no line maths. `total`, `subtotal`, `shipping_total`,
 * `discount_total` and `total_tax` are all in `OrderInput::READ_ONLY` and are
 * dropped silently rather than refused — `{"total": "1.00"}` alone answers 400
 * *"No supported fields were provided."* with **no `details.fields`**, because
 * after the read-only keys are stripped the payload is empty. There is no
 * per-field error for a read-only key, ever, so a form that offered one would be
 * binding to a refusal that cannot arrive. The order's totals stay where they
 * are: rendered by `OrderItems` from the server's own answer.
 */

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
};

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
