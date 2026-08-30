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
 * ## What the API decides, and this file therefore must not
 *
 * **Money.** `POST /orders` prices every line from the catalogue and refuses a
 * caller-supplied `price` by name — measured, `line_items.0.price` comes back in
 * a 400's `details.fields`. So a line carries a product and a quantity and
 * nothing else, and the drawer shows the catalogue's unit price as a *fact about
 * the product* while computing no total at all. The order's total arrives in the
 * 201.
 *
 * **Stock.** A `pending` order holds none — `stock_reduced: false`, and the
 * ledger stays empty — while a `processing` or `completed` one moves it. That is
 * the API's own rule and the form neither mirrors nor mentions it beyond the
 * status picker, because the status picker is where the choice is made.
 */

/** Every address field the API takes, `email` included — see `payloadAddress`. */
export type AddressDraft = {
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  phone: string;
  email: string;
};

/**
 * A chosen product, with what the picker knew about it.
 *
 * `name`, `sku` and `price` are carried for the row's own rendering and are
 * **not** sent: the picker is the only thing that knows the name of an id it has
 * just added, and re-resolving one at render would be a request per line. The
 * same argument `RestrictionPicker`'s `onCommit` makes.
 */
export type DraftLine = {
  productId: number;
  name: string;
  sku: string;
  price: string;
  /** A string, like every other field in the form layer. Never a `number`. */
  quantity: string;
};

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
};

export function emptyAddress(): AddressDraft {
  return {
    first_name: "",
    last_name: "",
    company: "",
    address_1: "",
    address_2: "",
    city: "",
    state: "",
    postcode: "",
    country: "",
    phone: "",
    email: "",
  };
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
 */
export function buildPayload(draft: OrderDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    line_items: draft.lines.map((line) => ({
      product_id: line.productId,
      quantity: parseQuantity(line.quantity) ?? 0,
    })),
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
