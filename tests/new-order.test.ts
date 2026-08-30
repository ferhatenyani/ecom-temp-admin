import { describe, expect, it } from "vitest";
import {
  bindRefusals,
  buildPayload,
  draftProblems,
  emptyAddress,
  emptyDraft,
  isAddressEmpty,
  parseQuantity,
  type OrderDraft,
} from "@/app/[locale]/(panel)/orders/new-order";
import { CREATABLE_STATUSES, orderStatuses } from "@/lib/order-status";

/**
 * `POST /orders` — the body the back-office order-entry drawer sends.
 *
 * The interesting half of a create form is which keys reach the wire and in what
 * shape, and that is a pure function of a plain object — so it is asserted here
 * rather than through eleven `fireEvent`s per case. Every expectation below is a
 * refusal the backend's own suite (`tests/Api/orders.php`) makes by name, or a
 * rule this panel decided and would otherwise lose silently.
 */

const MESSAGES = { noLines: "no lines", quantity: "bad quantity" };

function draftWith(overrides: Partial<OrderDraft> = {}): OrderDraft {
  return {
    ...emptyDraft(),
    lines: [{ productId: 101, name: "Théière", sku: "AC-THE-001", price: "1500.00", quantity: "2" }],
    ...overrides,
  };
}

describe("the body carries only what the operator set", () => {
  it("sends the lines and the status, and nothing else, on a blank form", () => {
    /*
     * The whole point of the omissions. A create that shipped eleven empty
     * billing strings, an empty payment method and a `customer_id: 0` would be
     * asking the API to validate fields nobody filled in — and `billing.country`
     * is exactly the one that answers back.
     */
    expect(buildPayload(draftWith())).toEqual({
      line_items: [{ product_id: 101, quantity: 2 }],
      status: "pending",
    });
  });

  it("never sends a price, however much the row knows about one", () => {
    /*
     * The single most important assertion in this file. `POST /orders` prices
     * every line from the catalogue and refuses a caller-supplied price **by
     * name** — `details.fields["line_items.0.price"]` — and the draft line
     * carries a price for its own rendering, one field away from being spread
     * onto the wire.
     */
    const body = buildPayload(draftWith()) as { line_items: Record<string, unknown>[] };
    expect(Object.keys(body.line_items[0]).sort()).toEqual(["product_id", "quantity"]);
  });

  it("omits customer_id for a guest and sends it for a customer", () => {
    expect(buildPayload(draftWith({ customerId: null }))).not.toHaveProperty("customer_id");
    expect(buildPayload(draftWith({ customerId: 42 }))).toMatchObject({ customer_id: 42 });
  });

  it("keeps a customer numbered zero distinguishable from a guest", () => {
    // `0` *is* the API's guest value, so a form that chose it explicitly still
    // says so. The distinction only exists because `customerId` is nullable.
    expect(buildPayload(draftWith({ customerId: 0 }))).toMatchObject({ customer_id: 0 });
  });

  it("trims, and drops a field that was only whitespace", () => {
    const body = buildPayload(
      draftWith({
        paymentMethod: "  cod  ",
        paymentMethodTitle: "   ",
        customerNote: "  Sonner deux fois  ",
      }),
    );

    expect(body).toMatchObject({ payment_method: "cod", customer_note: "Sonner deux fois" });
    expect(body).not.toHaveProperty("payment_method_title");
  });
});

describe("the two address blocks", () => {
  const billing = {
    ...emptyAddress(),
    first_name: "Amina",
    address_1: "12 Rue Didouche Mourad",
    city: "Alger",
    state: "16",
    country: "dz",
    phone: "0550123456",
    email: "amina@example.test",
  };

  it("omits a block nobody touched", () => {
    const body = buildPayload(draftWith());
    expect(body).not.toHaveProperty("billing");
    expect(body).not.toHaveProperty("shipping");
  });

  it("sends only the filled fields of a block somebody did", () => {
    const body = buildPayload(draftWith({ billing, shippingSameAsBilling: false }));

    expect(body.billing).toEqual({
      first_name: "Amina",
      address_1: "12 Rue Didouche Mourad",
      city: "Alger",
      state: "16",
      country: "dz",
      phone: "0550123456",
      email: "amina@example.test",
    });
    // Not upper-cased here: the API does that and refuses a country *name* with
    // a sentence naming DZ. Normalising locally would hide which of the two
    // mistakes somebody made.
    expect((body.billing as Record<string, string>).country).toBe("dz");
  });

  it("copies billing into shipping and drops the email on the way", () => {
    /**
     * **The refusal this exists to prevent.** A shipping address carries no
     * e-mail — WooCommerce has `set_billing_email()` and no counterpart — and
     * the API refuses the key by name rather than ignoring it: "Only a billing
     * address carries an email." A "same as billing" switch that copied the
     * block wholesale would turn a convenience into a 400 on every order that
     * used it.
     */
    const body = buildPayload(draftWith({ billing, shippingSameAsBilling: true }));

    expect(body.shipping).not.toHaveProperty("email");
    expect(body.billing).toHaveProperty("email", "amina@example.test");
    expect(body.shipping).toMatchObject({ city: "Alger", state: "16" });
  });

  it("sends a separate shipping block when the switch is off", () => {
    const shipping = { ...emptyAddress(), city: "Oran", state: "31" };
    const body = buildPayload(draftWith({ billing, shipping, shippingSameAsBilling: false }));

    expect(body.shipping).toEqual({ city: "Oran", state: "31" });
  });

  it("knows an untouched block from a filled one", () => {
    expect(isAddressEmpty(emptyAddress())).toBe(true);
    expect(isAddressEmpty({ ...emptyAddress(), city: "   " })).toBe(true);
    expect(isAddressEmpty({ ...emptyAddress(), city: "Alger" })).toBe(false);
  });
});

describe("one bad value produces one refusal, not two", () => {
  const COUNTRY = "Must be a two-letter ISO country code, such as DZ.";

  it("folds a shipping refusal onto the billing control that caused it", () => {
    /**
     * Found by driving the drawer, and it rendered as:
     *
     *     2 champs empêchent l’enregistrement.
     *       Must be a two-letter ISO country code, such as DZ.   ← linked
     *       Must be a two-letter ISO country code, such as DZ.   ← orphan
     *
     * for a single country field. "Same as billing" sends the block twice, so
     * the API — correctly — refuses it twice.
     */
    expect(
      bindRefusals({ "billing.country": COUNTRY, "shipping.country": COUNTRY }, true),
    ).toEqual({ "billing.country": COUNTRY });
  });

  it("keeps a shipping refusal that has no billing twin, rather than swallowing it", () => {
    // The panel must never drop something the API objected to. Without a twin
    // there is nothing to fold onto, so it moves to the visible control instead.
    expect(bindRefusals({ "shipping.city": "Too long." }, true)).toEqual({
      "billing.city": "Too long.",
    });
  });

  it("leaves everything that is not an address alone", () => {
    const fields = { line_items: "no lines", status: "bad", "billing.email": "nope" };
    expect(bindRefusals(fields, true)).toEqual(fields);
  });

  it("remaps nothing when the two blocks are genuinely two blocks", () => {
    const fields = { "billing.country": COUNTRY, "shipping.country": COUNTRY };
    expect(bindRefusals(fields, false)).toEqual(fields);
  });
});

describe("quantity is text until it is proved to be a number", () => {
  it("takes a positive whole number and nothing else", () => {
    expect(parseQuantity("3")).toBe(3);
    expect(parseQuantity(" 3 ")).toBe(3);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(parseQuantity("1.5")).toBeNull();
  });

  it("refuses a value a lenient parser would have accepted", () => {
    /*
     * `Number.parseInt("2x")` is 2, and a builder that used it would send an
     * order for a quantity nobody typed. The field holds raw text on purpose —
     * `Stepper`'s docblock argues it — so the strictness has to live here.
     */
    expect(Number.parseInt("2x", 10)).toBe(2);
    expect(parseQuantity("2x")).toBeNull();
  });
});

describe("the client-side rules, and how few of them there are", () => {
  it("refuses an order with no lines", () => {
    expect(draftProblems(emptyDraft(), MESSAGES)).toEqual({ line_items: "no lines" });
  });

  it("keys a bad quantity the way the API keys it, so one map binds both", () => {
    const problems = draftProblems(
      draftWith({
        lines: [
          { productId: 101, name: "A", sku: "", price: "", quantity: "2" },
          { productId: 102, name: "B", sku: "", price: "", quantity: "nope" },
        ],
      }),
      MESSAGES,
    );

    expect(problems).toEqual({ "line_items.1.quantity": "bad quantity" });
  });

  it("leaves every field the API validates alone", () => {
    /**
     * The negative control, and the more important half of the two.
     *
     * A country name, a malformed e-mail and an unknown product id are all
     * refusals the API makes with a better sentence than this panel could write
     * — "Must be a two-letter ISO country code, such as DZ" is the message the
     * whole error-binding path exists to *surface*, not to pre-empt. A form that
     * grew a local copy of each would drift from the API on the first branch
     * that changed one, and would still have to handle the 400.
     */
    const problems = draftProblems(
      draftWith({
        billing: { ...emptyAddress(), country: "Algeria", email: "nope" },
      }),
      MESSAGES,
    );

    expect(problems).toEqual({});
  });
});

describe("the statuses an order may begin in", () => {
  it("offers five of the seven", () => {
    expect([...CREATABLE_STATUSES]).toEqual([
      "pending",
      "processing",
      "on-hold",
      "completed",
      "failed",
    ]);
  });

  it("leaves out exactly the two terminal ones, and no others", () => {
    /*
     * Written as a set difference rather than as a second literal list, so that
     * a status added to the vocabulary shows up here as a failure rather than
     * being silently absent from the picker.
     */
    const missing = orderStatuses.filter(
      (status) => !(CREATABLE_STATUSES as readonly string[]).includes(status),
    );
    expect(missing).toEqual(["cancelled", "refunded"]);
  });

  it("defaults to the one creatable status that moves no stock", () => {
    /*
     * Not a cosmetic default. `processing` and `completed` decrement the
     * catalogue on create, so a form that defaulted to either would move stock
     * for anybody who filled in the lines and pressed save without reading the
     * status picker.
     */
    expect(emptyDraft().status).toBe("pending");
    expect(buildPayload(draftWith())).toMatchObject({ status: "pending" });
  });
});
