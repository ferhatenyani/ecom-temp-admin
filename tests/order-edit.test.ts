import { describe, expect, it } from "vitest";
import type { Address, Order } from "@/lib/api/schemas/order";
import { emptyAddress, type AddressDraft } from "@/app/[locale]/(panel)/orders/new-order";
import {
  MAX_CUSTOMER_NOTE,
  addressDraftOf,
  buildEditPayload,
  draftOf,
  isEditDirty,
  sameAddress,
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
    line_items: [
      {
        id: 91,
        name: "Théière",
        product_id: 101,
        variation_id: 0,
        quantity: 2,
        sku: "AC-THE-001",
        subtotal: "3000.00",
        total: "3000.00",
      },
    ],
    discount_total: "0.00",
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

describe("line_items and shipping_amount can never reach the wire", () => {
  /**
   * **The most important assertions in this file.**
   *
   * `OrderInput`'s docblock promises a client can GET an order, change one thing
   * and PATCH the whole object back. That holds on `pending` and `on-hold` only:
   * `OrderService::update()` runs `guardLineItemsWritable()` on
   * `$input->has('line_items')` and that guard is `WC_Order::is_editable()`, so
   * on `processing`, `completed`, `cancelled`, `refunded` and `failed` an echoed
   * `line_items` is a 409 **even when the only field touched was the note**. The
   * same is now true of `shipping_amount` and `guardShippingAmountWritable()`.
   */
  it("omits them from every body this builder can produce", () => {
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

  it("has no draft field that could express either one", () => {
    /*
     * The omission is structural rather than conditional — there is no branch
     * that could get a condition wrong — and this is the assertion that says so:
     * the draft's whole key set, so adding `lines` to it fails here rather than
     * in production on a completed order.
     */
    expect(Object.keys(draftOf(orderWith())).sort()).toEqual([
      "billing",
      "customerId",
      "customerNote",
      "paymentMethod",
      "paymentMethodTitle",
      "shipping",
      "shippingSameAsBilling",
    ]);
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
