import { describe, expect, it } from "vitest";
import type { Address, LineItem, Order } from "@/lib/api/schemas/order";
import { emptyAddress, type AddressDraft } from "@/app/[locale]/(panel)/orders/new-order";
import {
  MAX_AMOUNT,
  MAX_CUSTOMER_NOTE,
  addressDraftOf,
  buildEditPayload,
  draftOf,
  isEditDirty,
  lineDraftsOf,
  lineProblems,
  linesChanged,
  nextLineKey,
  payloadLines,
  sameAddress,
  type LineDraft,
  type OrderEditDraft,
} from "@/app/[locale]/(panel)/orders/[id]/order-edit";

/**
 * `PATCH /orders/{id}` — the body the order edit drawer sends.
 *
 * The same argument `new-order.test.ts` opens with: the interesting half of a
 * form is which keys reach the wire and in what shape, and that is a pure
 * function of two plain objects. It is asserted here rather than through eleven
 * `fireEvent`s per case.
 *
 * **The stakes are higher on this route than on the create one**, which is why
 * this file exists separately rather than as a section of that one. A create
 * that sends a key too many gets a 400 naming it. An *edit* that sends
 * `line_items` back gets a **409 on every order that has left `pending`** — even
 * when the only field the operator touched was the customer note — so the most
 * important assertions below are about keys that must **not** be there.
 *
 * Every rule asserted here was **measured in-process via `rest_do_request()`**
 * against the plugin in the backend repository
 * (`wp-content/plugins/algerian-commerce-core/tests/Api/orders.php`). Read that
 * phrase strictly: it runs routing, `OrderInput`, `AddressInput`, the service
 * guards, the repository and WooCommerce, and it does not run authentication or
 * anything between a browser and PHP. `BLOCKED.md` says why "measured against
 * the live API" is a phrase no finding on this route may use.
 */

function addressWith(overrides: Partial<Address> = {}): Address {
  return {
    first_name: "Yacine",
    last_name: "Belkacem",
    company: "",
    address_1: "17 rue des Frères Bouadou",
    address_2: "",
    city: "Touggourt",
    state: "",
    postcode: "",
    country: "DZ",
    phone: "0783794307",
    ...overrides,
  };
}

/**
 * One stored line. `price` defaults to `null` — the catalogue priced it — which
 * is what every line on every order this shop has actually looks like.
 */
function lineWith(overrides: Partial<LineItem> = {}): LineItem {
  return {
    id: 91,
    name: "Théière",
    product_id: 101,
    variation_id: 0,
    quantity: 2,
    sku: "AC-THE-001",
    price: null,
    subtotal: "3000.00",
    total: "3000.00",
    ...overrides,
  };
}

/**
 * A stored order, in the fields this form reads. Everything else on the schema
 * is read-only on this route — `OrderInput::READ_ONLY` — and the builder can
 * never reach it, which is half of what the last describe block below asserts.
 */
function orderWith(overrides: Partial<Order> = {}): Order {
  return {
    id: 1023,
    number: "1023",
    status: "completed",
    currency: "DZD",
    customer_id: 0,
    customer_note: "Livrer après 17 h",
    payment_method: "cod",
    payment_method_title: "Paiement à la livraison",
    billing: addressWith({ email: "client@example.test" }),
    shipping: addressWith(),
    line_items: [lineWith()],
    discount_total: "0.00",
    /*
     * `null` beside a `shipping_total` of `400.00`, which is the pair's real
     * shape on every order a checkout placed: the fee came from the tariff and
     * nobody stated one. A fixture where the two agreed would let the form seed
     * from the wrong one and still pass.
     */
    shipping_amount: null,
    shipping_total: "400.00",
    total_tax: "0.00",
    subtotal: "3000.00",
    total: "3400.00",
    is_editable: false,
    needs_payment: false,
    stock_reduced: true,
    date_created: "2026-08-01T09:00:00+00:00",
    date_modified: "2026-08-02T09:00:00+00:00",
    date_paid: "2026-08-01T09:05:00+00:00",
    date_completed: "2026-08-02T09:00:00+00:00",
    ...overrides,
  };
}

/** The draft the drawer opens with, plus whatever the operator then typed. */
function draftWith(order: Order, overrides: Partial<OrderEditDraft> = {}): OrderEditDraft {
  return { ...draftOf(order), ...overrides };
}

function billingOf(order: Order, overrides: Partial<AddressDraft>): OrderEditDraft {
  return draftWith(order, { billing: { ...draftOf(order).billing, ...overrides } });
}

describe("the body is a diff, and an untouched form sends nothing", () => {
  it("builds an empty body from a draft nobody has edited", () => {
    const order = orderWith();
    expect(buildEditPayload(draftOf(order), order)).toEqual({});
  });

  it("sends one key for one edit, and only that key", () => {
    const order = orderWith();
    expect(buildEditPayload(draftWith(order, { customerNote: "Sonner deux fois" }), order)).toEqual({
      customer_note: "Sonner deux fois",
    });
  });

  it("sends only the changed fields of an address, not the whole block", () => {
    /*
     * The measured merge is what makes this safe: `OrderRepository::applyProps()`
     * walks the keys the *payload stated*, one setter each, so the other ten
     * fields are never written. A builder that echoed the whole block back would
     * be correct on the wire and wrong the moment a field is added to the
     * address type and not to the form.
     */
    const order = orderWith();
    expect(buildEditPayload(billingOf(order, { city: "Alger" }), order)).toEqual({
      billing: { city: "Alger" },
      // Same-as-billing was seeded on, because the two stored blocks agree.
      shipping: { city: "Alger" },
    });
  });

  it("treats a whitespace-only difference as no difference", () => {
    /*
     * `AddressInput::parse()` trims before it stores, so a stored value is
     * already trimmed and a draft differing by a trailing space is not an edit.
     * Sending it would write an audit row for nothing — and, worse, would make
     * `isEditDirty` disagree with the builder if the two asked different
     * questions.
     */
    const order = orderWith();
    expect(buildEditPayload(billingOf(order, { city: "  Touggourt  " }), order)).toEqual({});
    expect(buildEditPayload(draftWith(order, { customerNote: "  Livrer après 17 h " }), order)).toEqual(
      {},
    );
  });
});

describe("line_items and shipping_amount reach the wire only when they were edited", () => {
  /**
   * **The most important assertions in this file.**
   *
   * `OrderInput`'s docblock promises a client can GET an order, change one thing
   * and PATCH the whole object back. That holds on `pending` and `on-hold` only:
   * `OrderService::update()` runs `guardLineItemsWritable()` on
   * `$input->has('line_items')` and that guard is `WC_Order::is_editable()`, so
   * on `processing`, `completed`, `cancelled`, `refunded` and `failed` an echoed
   * `line_items` is a 409 **even when the only field touched was the note**. The
   * same is true of `shipping_amount` and `guardShippingAmountWritable()`.
   *
   * The fixture is `completed` deliberately, so every body below would be a 409
   * if either key appeared in it.
   */
  it("omits them from every body an edit to the other fields can produce", () => {
    const order = orderWith();

    const bodies = [
      buildEditPayload(draftWith(order, { customerNote: "changed" }), order),
      buildEditPayload(billingOf(order, { phone: "0555000000" }), order),
      buildEditPayload(draftWith(order, { customerId: 42 }), order),
      buildEditPayload(draftWith(order, { paymentMethod: "bacs" }), order),
      buildEditPayload(draftWith(order, { shippingSameAsBilling: false }), order),
    ];

    for (const body of bodies) {
      expect(body).not.toHaveProperty("line_items");
      expect(body).not.toHaveProperty("shipping_amount");
    }
  });

  /**
   * **The draft's whole key set, and the guard it is.**
   *
   * This assertion used to be the *proof* that `line_items` could not be sent:
   * the draft had no lines and no shipping amount in it, so no branch could get
   * a condition wrong. That changed deliberately when the line editor arrived —
   * one route deserves one payload builder, and the editor writes through this
   * one — so the two keys are here now and the guarantee moved to
   * `linesChanged()` and to the emptiness rule on the fee, both asserted
   * directly below.
   *
   * The assertion is kept rather than deleted, and it is still doing the same
   * job: a *third* field added to this draft has to be added here too, which is
   * the moment somebody has to say out loud which key it puts on the wire and
   * when. That is the only reason a key-set test is worth having.
   */
  it("names every field the draft carries, including the two that are gated", () => {
    expect(Object.keys(draftOf(orderWith())).sort()).toEqual([
      "billing",
      "customerId",
      "customerNote",
      "lines",
      "paymentMethod",
      "paymentMethodTitle",
      "shipping",
      "shippingAmount",
      "shippingSameAsBilling",
    ]);
  });

  it("seeds both from the order, so a form that draws neither control sends neither", () => {
    /*
     * This is the mechanism the assertion above used to *be*. `OrderEditDrawer`
     * seeds the whole draft from the order and renders no lines control and no
     * fee field, so its lines and its fee are the stored ones — and a diff of a
     * value against itself is empty however the rest of the form is edited.
     */
    const order = orderWith();
    const draft = draftOf(order);

    expect(linesChanged(draft.lines, order.line_items)).toBe(false);
    expect(draft.shippingAmount).toBe("");
    expect(buildEditPayload(draft, order)).toEqual({});
  });

  it("still omits the fee when the operator empties a stated one", () => {
    /*
     * `OrderInput::normalize()` drops `null` and `""` before the payload is
     * assembled, so an emptied field states nothing and the shipping line is
     * left where it is — there is no way to un-state a fee, and `0` is how one
     * is cancelled. A builder that sent `""` would produce a key the API
     * discards and, sent alone, the 400 "No supported fields were provided." on
     * a form the person had just typed in.
     */
    const order = orderWith({ status: "pending", is_editable: true, shipping_amount: "400.00" });

    expect(buildEditPayload(draftWith(order, { shippingAmount: "" }), order)).toEqual({});
    expect(isEditDirty(draftWith(order, { shippingAmount: "  " }), order)).toBe(false);

    // Zero is a real amount and does reach the wire — it is how a fee is killed.
    expect(buildEditPayload(draftWith(order, { shippingAmount: "0" }), order)).toEqual({
      shipping_amount: "0",
    });
  });

  it("sends the fee when it changes, and reads a quoted one as unstated", () => {
    const order = orderWith({ status: "pending", is_editable: true });

    // `shipping_amount` is null and `shipping_total` is 400.00 — the fee was
    // quoted, not stated — so the field opens empty rather than on the total.
    expect(draftOf(order).shippingAmount).toBe("");

    expect(buildEditPayload(draftWith(order, { shippingAmount: "600" }), order)).toEqual({
      shipping_amount: "600",
    });
  });

  it("never sends status either, however the draft is edited", () => {
    /*
     * Not tidiness. `guardTransition()` runs before every other guard, so a body
     * carrying a refused move *and* a corrected address reports only the move
     * and the address silently does not land. The status is `OrderActions`'
     * control, with its own 409 carrying `allowed` and its own confirm dialog on
     * the two terminal moves.
     */
    const order = orderWith();
    expect(buildEditPayload(draftWith(order, { customerNote: "changed" }), order)).not.toHaveProperty(
      "status",
    );
  });
});

describe("the lines, which are replace-the-set and never a patch", () => {
  /** An editable order with two lines, one of them hand-priced. */
  function editable(): Order {
    return orderWith({
      status: "pending",
      is_editable: true,
      stock_reduced: false,
      line_items: [
        lineWith(),
        lineWith({
          id: 92,
          name: "Tapis berbère",
          product_id: 202,
          quantity: 1,
          sku: "AC-TAP-002",
          price: "1200.50",
          subtotal: "1200.50",
          total: "1200.50",
        }),
      ],
    });
  }

  const linesOf = (order: Order, mutate: (lines: LineDraft[]) => LineDraft[]) =>
    draftWith(order, { lines: mutate(lineDraftsOf(order)) });

  it("reads a stored line into the draft, with null as an empty price box", () => {
    const order = editable();
    const [first, second] = lineDraftsOf(order);

    expect(first).toEqual({
      key: 0,
      productId: 101,
      variationId: 0,
      name: "Théière",
      sku: "AC-THE-001",
      // `null` on the wire is "the catalogue prices this line"; `""` is how the
      // form says the same thing. They are the same statement, not a gap.
      price: "",
      cataloguePrice: null,
      quantity: "2",
    });
    expect(second.price).toBe("1200.50");
    // Keyed by position at seed time, and **never** by the API's line id — which
    // identifies nothing and churns on every write that names the key.
    expect(second.key).toBe(1);
    expect(nextLineKey([first, second])).toBe(2);
  });

  it("sends nothing for an untouched set, on an order where sending it would 409", () => {
    const order = editable();
    expect(buildEditPayload(draftOf(order), order)).toEqual({});
  });

  it("sends the complete set for a change to one line", () => {
    /*
     * There is no partial form of this key. `replaceLineItems()` removes every
     * line and re-adds the payload's, so a body naming one line is a body asking
     * for an order with one line on it. A quantity edit therefore carries the
     * other line — and carries its manual price, because a set that omitted it
     * would hand that line back to the catalogue and lose the agreed amount.
     */
    const order = editable();
    const body = buildEditPayload(
      linesOf(order, (lines) => [lines[0], { ...lines[1], quantity: "3" }]),
      order,
    );

    expect(body).toEqual({
      line_items: [
        { product_id: 101, quantity: 2 },
        { product_id: 202, quantity: 3, price: "1200.50" },
      ],
    });
  });

  it("omits price rather than sending it empty, so the line states nothing", () => {
    /*
     * `LineItemInput` reads a missing key, `null` and `""` identically — but
     * `OrderService::guardManualPricesWritable()` refuses lines that *state* a
     * price, and an omitted key states nothing in a way a person reading the
     * payload can see. Clearing the box is how a line goes back to the catalogue.
     */
    const order = editable();
    const body = buildEditPayload(
      linesOf(order, (lines) => [lines[0], { ...lines[1], price: "" }]),
      order,
    ) as { line_items: Record<string, unknown>[] };

    expect(body.line_items[1]).toEqual({ product_id: 202, quantity: 1 });
    // Zero is not empty: a free line is a real thing and the API permits it.
    expect(
      payloadLines([{ ...lineDraftsOf(order)[1], price: "0" }])[0],
    ).toEqual({ product_id: 202, quantity: 1, price: "0" });
  });

  it("carries a variation id when there is one, and omits the zero that means none", () => {
    /*
     * A line on a variable product is priced and stocked from the variation.
     * Dropping the key sends the parent alone, and `resolveProduct()` answers
     * that with "This is a variable product; name the variation to order." — a
     * 400 on a line nobody touched.
     */
    const order = orderWith({
      status: "pending",
      is_editable: true,
      line_items: [lineWith({ variation_id: 5001 })],
    });

    const body = buildEditPayload(
      linesOf(order, (lines) => [{ ...lines[0], quantity: "4" }]),
      order,
    );

    expect(body).toEqual({
      line_items: [{ product_id: 101, quantity: 4, variation_id: 5001 }],
    });
  });

  it("reports adding, removing and reordering as changes", () => {
    const order = editable();
    const seeded = lineDraftsOf(order);

    expect(linesChanged([seeded[0]], order.line_items)).toBe(true);
    expect(linesChanged([...seeded, { ...seeded[0], key: 9 }], order.line_items)).toBe(true);
    /* Index order is the pairing the API itself uses — `resolveLines()` walks
       the payload's list — so two rows swapped really is a different order. */
    expect(linesChanged([seeded[1], seeded[0]], order.line_items)).toBe(true);
  });

  it("does not report a renamed product as an edit somebody made", () => {
    /*
     * `name` and `sku` are the picker's, they are dropped at the payload
     * boundary, and a product renamed in the catalogue since the order was
     * placed must not make the save button light up.
     */
    const order = editable();
    const changed = linesOf(order, (lines) => [
      { ...lines[0], name: "Théière (2026)", sku: "AC-THE-001-B" },
      lines[1],
    ]);

    expect(isEditDirty(changed, order)).toBe(false);
  });

  it("sends a quantity of zero rather than inventing one the person did not type", () => {
    // The API refuses it by name, which is the right outcome for a box holding
    // "2x": `lineProblems` catches it first, and this is the floor under that.
    const order = editable();
    const body = buildEditPayload(
      linesOf(order, (lines) => [{ ...lines[0], quantity: "2x" }, lines[1]]),
      order,
    ) as { line_items: Record<string, unknown>[] };

    expect(body.line_items[0].quantity).toBe(0);
  });

  it("names the two things the form can know before a round trip, and nothing else", () => {
    const message = { noLines: "no lines", quantity: "bad quantity" };
    const order = editable();

    expect(lineProblems([], message)).toEqual({ line_items: "no lines" });
    expect(lineProblems(lineDraftsOf(order), message)).toEqual({});
    expect(
      lineProblems(
        lineDraftsOf(order).map((line, index) =>
          index === 1 ? { ...line, quantity: "0" } : line,
        ),
        message,
      ),
    ).toEqual({ "line_items.1.quantity": "bad quantity" });

    /* A bad *price* is deliberately absent: the API says which of three things
       is wrong ("Must be an amount.", "Cannot be negative.", "Is implausibly
       large.") and a local rule would be a second copy of `LineItemInput`. */
    expect(
      lineProblems(
        lineDraftsOf(order).map((line) => ({ ...line, price: "nope" })),
        message,
      ),
    ).toEqual({});
  });

  it("publishes the ceiling both amounts share, so a form can say it first", () => {
    // `LineItemInput::MAX_PRICE` and `OrderInput::MAX_SHIPPING_AMOUNT` — two
    // constants, one number, one sentence: "Is implausibly large."
    expect(MAX_AMOUNT).toBe(9999999.99);
  });
});

describe("clearing a field is explicit, which is where this differs from create", () => {
  it("sends an emptied address field as an empty string rather than omitting it", () => {
    /*
     * The opposite of `new-order.ts`'s `payloadAddress`, which drops an empty
     * because on a create there is nothing to clear. `AddressInput::parse()`
     * maps `null` and `""` to an empty string and stores it, so `""` is how a
     * PATCH deletes a value — and a builder that reused the create rule here
     * would silently refuse to let anybody delete a phone number.
     */
    const order = orderWith();
    expect(buildEditPayload(billingOf(order, { phone: "" }), order)).toEqual({
      billing: { phone: "" },
      shipping: { phone: "" },
    });
  });

  it("sends an emptied note and an emptied payment method the same way", () => {
    const order = orderWith();
    expect(
      buildEditPayload(draftWith(order, { customerNote: "", paymentMethod: "" }), order),
    ).toEqual({ customer_note: "", payment_method: "" });
  });
});

describe("the email a shipping address does not have", () => {
  it("never sends shipping.email, even while same-as-billing is on", () => {
    /*
     * `AddressInput::BILLING_ONLY` is `['email']` and the refusal is by name —
     * "Only a billing address carries an email." Same-as-billing copies the
     * whole billing block, so the key is dropped at the payload boundary rather
     * than hidden in the form; the create builder drops it in exactly the same
     * place for exactly the same measurement.
     */
    const order = orderWith();
    const body = buildEditPayload(billingOf(order, { email: "autre@example.test" }), order) as {
      billing: Record<string, string>;
      shipping?: Record<string, string>;
    };

    expect(body.billing).toEqual({ email: "autre@example.test" });
    // The e-mail was the only edit, so the shipping block has nothing to say.
    expect(body).not.toHaveProperty("shipping");
  });

  it("does not report two identical addresses as different because of it", () => {
    // `sameAddress` excludes `email` — a stored billing e-mail with no shipping
    // counterpart would otherwise seed the switch off on every order that has one.
    const order = orderWith();
    expect(sameAddress(order.billing, order.shipping)).toBe(true);
    expect(draftOf(order).shippingSameAsBilling).toBe(true);
  });
});

describe("same-as-billing, seeded from the data rather than defaulted", () => {
  it("opens off when the two stored blocks genuinely differ", () => {
    /*
     * The difference between a create form and an edit form. Seeding it on would
     * silently promise to overwrite a shipping address that deliberately
     * differs — which is most of the orders where anybody fills the second block
     * in at all.
     */
    const order = orderWith({ shipping: addressWith({ city: "Oran" }) });
    expect(draftOf(order).shippingSameAsBilling).toBe(false);
    expect(buildEditPayload(draftOf(order), order)).toEqual({});
  });

  it("turning it on over two differing blocks is itself an edit", () => {
    const order = orderWith({ shipping: addressWith({ city: "Oran" }) });
    // The shipping block is diffed against what is stored under `shipping`, not
    // against `billing` — so switching it on states the fields that disagree.
    expect(buildEditPayload(draftWith(order, { shippingSameAsBilling: true }), order)).toEqual({
      shipping: { city: "Touggourt" },
    });
  });

  it("edits the shipping block on its own while the switch is off", () => {
    const order = orderWith({ shipping: addressWith({ city: "Oran" }) });
    const draft = draftOf(order);
    expect(
      buildEditPayload({ ...draft, shipping: { ...draft.shipping, city: "Annaba" } }, order),
    ).toEqual({ shipping: { city: "Annaba" } });
  });
});

describe("the customer, and the zero that is not a null", () => {
  it("maps the panel's null back to the API's guest value at the boundary", () => {
    const order = orderWith({ customer_id: 20 });
    expect(draftOf(order).customerId).toBe(20);
    expect(buildEditPayload(draftWith(order, { customerId: null }), order)).toEqual({
      customer_id: 0,
    });
  });

  it("reads a guest order back as null and sends nothing for it", () => {
    const order = orderWith({ customer_id: 0 });
    expect(draftOf(order).customerId).toBeNull();
    expect(buildEditPayload(draftOf(order), order)).toEqual({});
  });

  it("attaches an order to a customer", () => {
    const order = orderWith({ customer_id: 0 });
    expect(buildEditPayload(draftWith(order, { customerId: 21 }), order)).toEqual({
      customer_id: 21,
    });
  });
});

describe("the two payment fields are independent", () => {
  it("sends the method alone", () => {
    const order = orderWith();
    expect(buildEditPayload(draftWith(order, { paymentMethod: "bacs" }), order)).toEqual({
      payment_method: "bacs",
    });
  });

  it("sends the title alone", () => {
    /*
     * Measured: neither field requires the other. The one coupling is on the
     * API's side and only in one direction — clearing the method clears the
     * title with it unless the same body states a title, which is
     * `WC_Order::set_payment_method()`'s own behaviour.
     */
    const order = orderWith();
    expect(buildEditPayload(draftWith(order, { paymentMethodTitle: "Virement" }), order)).toEqual({
      payment_method_title: "Virement",
    });
  });
});

describe("isEditDirty is the builder's own answer, not a second rule", () => {
  it("agrees with the builder on the whitespace case that would otherwise disagree", () => {
    /*
     * A dirtiness rule that compared the draft to a re-derived `draftOf(order)`
     * would call a trailing space dirty and then send nothing: the save button
     * would enable, the body would be `{}`, and the API would answer 400 "No
     * supported fields were provided." for a form the person had just edited.
     */
    const order = orderWith();
    const untouched = draftOf(order);
    const whitespace = billingOf(order, { city: "  Touggourt  " });

    expect(isEditDirty(untouched, order)).toBe(false);
    expect(isEditDirty(whitespace, order)).toBe(false);
    expect(isEditDirty(draftWith(order, { customerNote: "changed" }), order)).toBe(true);
  });
});

describe("reading an order into a draft", () => {
  it("fills every address key, treating an absent one as empty", () => {
    // The schema is a `looseObject` and `email` is optional, so a shipping block
    // arrives without it. The draft is a full eleven either way, because a
    // controlled input cannot be handed `undefined`.
    expect(addressDraftOf({ first_name: "Yacine" } as Address)).toEqual({
      ...emptyAddress(),
      first_name: "Yacine",
    });
  });

  it("publishes the API's own note cap so the form can count against it", () => {
    // `OrderInput::MAX_NOTE`. The counter counts the *trimmed* length, because
    // `normalize()` trims before it measures.
    expect(MAX_CUSTOMER_NOTE).toBe(5000);
  });
});
