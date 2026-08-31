import { describe, expect, it } from "vitest";
import type { Address, LineItem, Order } from "@/lib/api/schemas/order";
import { emptyAddress, type AddressDraft } from "@/app/[locale]/(panel)/orders/new-order";
import {
  MAX_AMOUNT,
  MAX_CUSTOMER_NOTE,
  addPickedLine,
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
    /* The carrier branch's read shape. `rules` beside `manual` is the ordinary
       reading on a shop with no courier credentials — §14's tariff priced the
       journey and the shop carries it itself — and never a contradiction. */
    shipping_source: "rules",
    shipping_provider: "manual",
    /* No failure. The one case where there *is* one is a `ParcelFailure`
       question rather than a payload one, and `lib/shipping.ts` owns it. */
    shipping_provider_error: null,
    /*
     * **Addressed**, and the fixture has to be: an order that carries no
     * destination cannot demonstrate the rule that matters here — that a form
     * seeded from an addressed order sends nothing until somebody moves a
     * picker. `null` on all three is the *other* interesting fixture and is
     * built per-case below.
     */
    wilaya_id: 16,
    commune_id: 484,
    delivery_type: "home",
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
      /* The destination joined on the carrier branch, and it is the case this
         assertion was kept for: three keys added, and each one had to say out
         loud when it reaches the wire. `wilayaId`/`communeId` go as a whole
         changed pair and never half; `deliveryType` goes on its own, because
         `guardDestinationResolves()` does not run for it. */
      "communeId",
      "customerId",
      "customerNote",
      "deliveryType",
      "lines",
      "paymentMethod",
      "paymentMethodTitle",
      "shipping",
      "shippingAmount",
      "shippingSameAsBilling",
      "wilayaId",
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

/**
 * The destination — the retry path, and the reason this drawer got a new
 * section rather than the line editor getting one.
 *
 * `OrderInput::allowedFields()` names `wilaya_id`, `commune_id` and
 * `delivery_type` on both verbs as of the carrier branch, and
 * `OrderService::guardDestinationResolves()` carries **no `is_editable` gate**.
 * That absence is load-bearing and its docblock says so: *"a gate here would
 * make the retry unreachable … Both ways an order earns a
 * `shipping_provider_error` — the missing destination and the commune a courier
 * refused — are recorded at `processing`, which is not editable."* So the
 * destination belongs to the form whose every field is writable in every status,
 * which is this one; every case below is on a `completed` order for that reason.
 *
 * Read from source in `ecom-temp`'s `feat/carrier-choice` tree. Nothing here was
 * measured over HTTP and nothing claims to have been.
 */
describe("the destination, which is writable at every status on purpose", () => {
  it("seeds from the order, and sends nothing until somebody moves a picker", () => {
    const order = orderWith();
    const draft = draftOf(order);

    expect(draft.wilayaId).toBe("16");
    expect(draft.communeId).toBe("484");
    expect(draft.deliveryType).toBe("home");
    expect(buildEditPayload(draft, order)).toEqual({});
  });

  /**
   * `null` is *the order does not say*, and it opens as an empty picker rather
   * than as a guess.
   *
   * Seeding the wilaya from `billing.state` was considered and refused:
   * that field is free text, `AddressInput` validates its shape and nothing
   * more, and it is empty on ~92 % of orders — so it would fill the control on
   * one order in twelve with a *routing* decision derived from an address, which
   * `Shipping\Destination`'s docblock refuses by name.
   */
  it("opens empty on an order nobody has addressed, address or no address", () => {
    const draft = draftOf(
      orderWith({
        wilaya_id: null,
        commune_id: null,
        delivery_type: null,
        billing: addressWith({ state: "16", city: "Alger" }),
      }),
    );

    expect(draft.wilayaId).toBe("");
    expect(draft.communeId).toBe("");
    expect(draft.deliveryType).toBe("");
  });

  it("sends both ids as integers when either one moves", () => {
    const order = orderWith();

    /* The commune alone changed, and the wilaya travels with it. The API would
       take the commune on its own — the guard reads the order's stored half —
       but a form must not rely on that: an operator mid-edit would send a lone
       `wilaya_id`, the guard would pair it with the *old* commune, and the
       refusal names a commune no longer on screen. */
    expect(buildEditPayload(draftWith(order, { communeId: "483" }), order)).toEqual({
      wilaya_id: 16,
      commune_id: 483,
    });

    expect(
      buildEditPayload(draftWith(order, { wilayaId: "31", communeId: "900" }), order),
    ).toEqual({ wilaya_id: 31, commune_id: 900 });
  });

  /**
   * Emptying the pickers states nothing, exactly as emptying the fee does.
   *
   * `OrderInput::normalize()` drops `null` and `''` for these two before the
   * payload is assembled, so a body carrying them would be discarded — and sent
   * alone it would be the 400 *"No supported fields were provided."* on a form
   * the person had just edited. **There is no way to un-address an order over
   * this route**, and `0` is not the escape hatch a zero fee is: `OrderInput`
   * refuses it outright, *there is no commune 0*.
   */
  it("cannot clear a destination, and never sends a zero trying", () => {
    const order = orderWith();

    for (const half of [
      { wilayaId: "", communeId: "" },
      { wilayaId: "16", communeId: "" },
      { wilayaId: "", communeId: "484" },
    ]) {
      const payload = buildEditPayload(draftWith(order, half), order);
      expect(payload, JSON.stringify(half)).not.toHaveProperty("wilaya_id");
      expect(payload, JSON.stringify(half)).not.toHaveProperty("commune_id");
    }
  });

  /**
   * The journey is diffed on its own, because the API treats it on its own:
   * `guardDestinationResolves()` returns early unless one of the two *ids* is
   * stated, saying that `delivery_type` *"is a journey rather than a place, it
   * needs no pair and no lookup"*.
   */
  it("sends the journey without the pair, and the pair without the journey", () => {
    const order = orderWith();

    expect(buildEditPayload(draftWith(order, { deliveryType: "desk" }), order)).toEqual({
      delivery_type: "desk",
    });

    expect(buildEditPayload(draftWith(order, { communeId: "483" }), order)).not.toHaveProperty(
      "delivery_type",
    );
  });

  it("says nothing about the journey when the order never did", () => {
    /* An order with no stated type opens on `""` and stays silent, which is
       right: it still has no opinion and `ShipmentSubscriber::destinationOf()`
       still ships it home. `OrderInput` deliberately does not default this —
       *"a second default here would give one fact two owners that can drift"*. */
    const order = orderWith({ delivery_type: null });
    const draft = draftOf(order);

    expect(draft.deliveryType).toBe("");
    expect(buildEditPayload(draft, order)).toEqual({});
    expect(isEditDirty(draft, order)).toBe(false);
  });

  /**
   * And none of it is gated on `is_editable`, which is the whole point.
   *
   * A `completed` order holding stock is the state every case above runs in —
   * `orderWith()`'s default — so this asserts the negative directly: the two
   * keys the route *does* gate stay out of the body while the destination goes
   * in. If a future edit ever put the destination behind the lines' gate, this
   * is what fails.
   */
  it("reaches the wire from a completed order while the gated keys do not", () => {
    const order = orderWith({ status: "completed", is_editable: false, stock_reduced: true });
    const payload = buildEditPayload(draftWith(order, { communeId: "483" }), order);

    expect(payload).toEqual({ wilaya_id: 16, commune_id: 483 });
    expect(payload).not.toHaveProperty("line_items");
    expect(payload).not.toHaveProperty("shipping_amount");
  });
});

/**
 * `addPickedLine` — the merge rule, as pure list arithmetic.
 *
 * ## Asserted here rather than driven through the picker, deliberately
 *
 * The defect this fixes was invisible to every test the panel had, and the
 * reason is worth writing down: it lived inside a `setDraft` callback in a
 * component, so the only way to reach it was to render `OrderLinesDrawer`,
 * stub `/products`, type into a search box and press a result twice. Nothing was
 * going to do that, so the rule shipped with a condition that could not fire and
 * a docblock explaining why it was correct. Moving it to a function of a list
 * and a product is what makes the first case below a two-line assertion.
 *
 * ## The rule, in one sentence
 *
 * A row absorbs the press when **it is already charging, per unit, what the new
 * row would charge** — which is `price.trim() === seed` for a stated price and
 * `price.trim() === ""` for a row the catalogue prices, because the seed is what
 * the catalogue asks and the picker has just been told it.
 *
 * The seed is `PickedProduct.price`, and it is `""` only on the
 * no-`ac_manage_products` fallback where the picker genuinely knows no price.
 */
describe("adding a product to the set", () => {
  const picked = { id: 101, name: "Théière", sku: "AC-THE-001", price: "1500.00" };

  /** One line as the picker leaves it: seeded from the catalogue, editable. */
  function draftLine(overrides: Partial<LineDraft> = {}): LineDraft {
    return {
      key: 0,
      productId: 101,
      variationId: 0,
      name: "Théière",
      sku: "AC-THE-001",
      price: "1500.00",
      cataloguePrice: "1500.00",
      quantity: "1",
      ...overrides,
    };
  }

  it("raises the quantity of a row the picker itself seeded — the defect", () => {
    /*
     * **The regression this whole change exists for.** The old rule was
     * `productId === id && price.trim() === ""`, and a picker-added row's price
     * is never `""` — `addPickedLine` seeds it from the catalogue in the same
     * breath. So pressing add twice on a product the order did not already carry
     * opened two rows, and the second press plainly meant quantity 2.
     */
    const once = addPickedLine([], picked);
    expect(once).toHaveLength(1);
    expect(once[0]).toMatchObject({ productId: 101, price: "1500.00", quantity: "1" });

    const twice = addPickedLine(once, picked);
    expect(twice).toHaveLength(1);
    expect(twice[0].quantity).toBe("2");

    expect(addPickedLine(twice, picked)[0].quantity).toBe("3");
  });

  it("still absorbs into a row the order arrived with, which is the old rule", () => {
    /*
     * `lineDraftOf` maps a stored `price: null` to `""` — *the catalogue prices
     * this line* — and the old condition was written for exactly this row. It
     * keeps working, as the arm of the new rule where a row's price is the
     * catalogue's and the seed is what the catalogue asks: the same number said
     * two ways, so the press is charged the same either way.
     */
    const stored = lineDraftsOf(orderWith({ line_items: [lineWith({ price: null })] }));
    expect(stored[0].price).toBe("");

    const after = addPickedLine(stored, picked);
    expect(after).toHaveLength(1);
    expect(after[0].quantity).toBe("3");
    /* And it stays catalogue-priced. Merging must not quietly convert a line the
       catalogue prices into a hand-priced one — that is a different agreement,
       and `guardManualPricesWritable()` refuses a *stated* price on an order
       holding stock, so it would also turn a 200 into a 409. */
    expect(after[0].price).toBe("");
  });

  it("opens a new row rather than discounting the extra unit", () => {
    /*
     * The case the old docblock was written to protect, and it is protected
     * unchanged. Four copies at 1 500 and one damaged one at 700 is a real
     * order; a press seeded at 1 500 must not raise the 700 row, or the shop
     * gives the extra unit away at somebody else's discount.
     */
    const discounted = [draftLine({ price: "700", cataloguePrice: "1500.00", quantity: "1" })];
    const after = addPickedLine(discounted, picked);

    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ price: "700", quantity: "1" });
    expect(after[1]).toMatchObject({ price: "1500.00", quantity: "1" });
  });

  it("takes the first row that agrees, and leaves the others alone", () => {
    /* Positional, like everything else on this route — `resolveLines()` pairs by
       array index and the API keys its refusals the same way. Two rows charging
       the seed would both be correct targets; the first is the one to explain. */
    const lines = [
      draftLine({ key: 0, price: "700" }),
      draftLine({ key: 1, price: "1500.00" }),
      draftLine({ key: 2, price: "1500.00" }),
    ];
    const after = addPickedLine(lines, picked);

    expect(after).toHaveLength(3);
    expect(after.map((line) => line.quantity)).toEqual(["1", "2", "1"]);
  });

  it("never merges across products", () => {
    const other = [draftLine({ productId: 55, name: "Verre", sku: "AC-VER-001" })];
    expect(addPickedLine(other, picked)).toHaveLength(2);
  });

  it("merges an unpriced press into an unpriced row, on the fallback path", () => {
    /*
     * Without `ac_manage_products` the picker hands back `price: ""` because it
     * genuinely knows no price, and a row seeded from it is `""` too. `"" === ""`
     * merges, which is what this path did before and must keep doing — seeding
     * `0` instead would put a free line in front of somebody who thought they
     * were adding a product.
     */
    const blind = { ...picked, price: "" };
    const once = addPickedLine([], blind);

    expect(once[0]).toMatchObject({ price: "", cataloguePrice: null, quantity: "1" });
    expect(addPickedLine(once, blind)[0].quantity).toBe("2");
  });

  it("does not merge a blind press into a row somebody priced", () => {
    /* The mirror of the case above, and the one that would give money away if
       `""` were treated as a wildcard rather than as "the catalogue's price". A
       picker that knows no price cannot claim a row at 700 charges the same. */
    const priced = [draftLine({ price: "700" })];
    expect(addPickedLine(priced, { ...picked, price: "" })).toHaveLength(2);
  });

  it("mints a key that collides with nothing already in the set", () => {
    /* Line ids churn on every write that names `line_items`, so the draft mints
       its own — `LineDraft.key` argues it. A duplicate would have React
       reconciling the wrong row, and a quantity typed into one line appearing in
       another. */
    const lines = [draftLine({ key: 0, productId: 55 }), draftLine({ key: 7, productId: 56 })];
    expect(addPickedLine(lines, picked)[2].key).toBe(8);
  });

  it("leaves the set it was handed untouched", () => {
    /* It is called from inside a `setDraft` updater, so a mutation here would be
       a state mutation — and under StrictMode's double invocation it would apply
       twice. Both arms return a new array. */
    const before = [draftLine({ price: "1500.00", quantity: "1" })];
    const snapshot = structuredClone(before);

    addPickedLine(before, picked);
    addPickedLine(before, { ...picked, id: 55 });

    expect(before).toEqual(snapshot);
  });

  it("repairs a quantity the box is holding as raw text, and never swallows the press", () => {
    /*
     * The quantity field holds raw text on purpose — `Stepper`'s docblock argues
     * it — so a row can be sitting on `2x` or on `` when somebody presses add.
     * Carried over from the rule this replaces, unchanged and now pinned,
     * because it is easy to "tidy" into something worse:
     *
     *   `2x`  →  `3`.  `Number.parseInt` reads the leading digit. That is
     *                  exactly what `parseQuantity` refuses to do, and the
     *                  refusal is right *there* and wrong here: that function
     *                  builds a payload, where a quantity nobody typed would be
     *                  ordered silently, and this writes a number into a box the
     *                  operator is looking at. Whatever it puts there is visible
     *                  and correctable before anything is sent.
     *   `x`   →  `1`.  Nothing to read, so the press means one of these.
     *
     * Either way the row leaves in a state `lineProblems` accepts, which is the
     * point: pressing add should not be able to leave the form unsubmittable.
     */
    expect(addPickedLine([draftLine({ quantity: "2x" })], picked)[0].quantity).toBe("3");
    expect(addPickedLine([draftLine({ quantity: "x" })], picked)[0].quantity).toBe("1");
    expect(addPickedLine([draftLine({ quantity: "" })], picked)[0].quantity).toBe("1");
  });
});
