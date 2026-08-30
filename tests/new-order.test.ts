import { describe, expect, it } from "vitest";
import {
  bindRefusals,
  buildPayload,
  draftProblems,
  emptyAddress,
  emptyDraft,
  isAddressEmpty,
  nextLineKey,
  parseQuantity,
  type DraftLine,
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
 *
 * ## One group of assertions in here was overturned, not extended
 *
 * *"never sends a price, however much the row knows about one"* was called "the
 * single most important assertion in this file" and it is gone. The rule it
 * protected is gone with it: `Orders\LineItemInput::ALLOWED` names `price` and
 * `OrderInput::normalize()` is one function shared by `forCreate()` and
 * `forUpdate()`, so `POST /orders` takes a manual unit price and a
 * `shipping_amount` the way `PATCH /orders/{id}` does. What replaces it is
 * *"sends a price only when somebody typed one"*, which is a narrower and much
 * more easily broken claim — and it is deliberately asserted from both ends,
 * because the old assertion's real job was to stop the row's rendering data from
 * being spread onto the wire, and that failure mode still exists.
 */

const MESSAGES = { noLines: "no lines", quantity: "bad quantity" };

/** One line as the picker leaves it: seeded from the catalogue, editable. */
function lineWith(overrides: Partial<DraftLine> = {}): DraftLine {
  return {
    key: 0,
    productId: 101,
    name: "Théière",
    sku: "AC-THE-001",
    price: "1500.00",
    cataloguePrice: "1500.00",
    quantity: "2",
    ...overrides,
  };
}

function draftWith(overrides: Partial<OrderDraft> = {}): OrderDraft {
  return {
    ...emptyDraft(),
    lines: [lineWith()],
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
     *
     * The line carries a `price` because the picker seeded it from the catalogue
     * and that is a *stated* price — see the prefill assertions below, and
     * `NewOrderDrawer`'s `addLine`, which makes that choice on purpose.
     */
    expect(buildPayload(draftWith())).toEqual({
      line_items: [{ product_id: 101, quantity: 2, price: "1500.00" }],
      status: "pending",
    });
  });

  it("sends a line's rendering data nowhere near the wire", () => {
    /*
     * What survives of the old *"never sends a price"* assertion, which this
     * replaces. That one guarded a rule the API no longer has; the failure mode
     * it was really watching for — the draft line being spread onto the payload,
     * carrying whatever it holds for its own rendering — is still live, and
     * `name`, `sku`, `cataloguePrice` and `key` are all one spread away from it.
     *
     * `key` is the one worth naming twice: it is the panel's own React key,
     * meaningless to the API, and a body carrying it would be refused with
     * "Unknown field." on a line nobody could see anything wrong with.
     */
    const body = buildPayload(draftWith()) as { line_items: Record<string, unknown>[] };
    expect(Object.keys(body.line_items[0]).sort()).toEqual([
      "price",
      "product_id",
      "quantity",
    ]);
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

/**
 * The manual price per line — item 1's sub-task 3, create half.
 *
 * Measured in-process via `rest_do_request()` against the plugin's own suite,
 * and read from `Orders\LineItemInput::one()` where a rule is a rule rather than
 * a case. The old refusal — *"Line prices come from the catalogue and cannot be
 * set."* — is gone from the backend; these are the rules that replaced it.
 */
describe("a line states a price only when somebody typed one", () => {
  /** The line items of a payload, which is the only shape assertions want. */
  const linesOf = (draft: OrderDraft) =>
    buildPayload(draft).line_items as Record<string, unknown>[];

  it("sends the amount that is in the box", () => {
    expect(linesOf(draftWith({ lines: [lineWith({ price: "700" })] }))[0]).toEqual({
      product_id: 101,
      quantity: 2,
      price: "700",
    });
  });

  it("omits the key entirely for an empty box, rather than sending it empty", () => {
    /*
     * `LineItemInput::one()` reads a missing key, `null` and `""` identically —
     * *no manual price, let the catalogue price this line* — so all three are
     * equivalent to the API and none of them is equivalent to a person reading
     * the request. The smallest body that says what the panel means is the one
     * that omits the key. `[id]/order-edit.ts`'s `payloadLines()` omits it on the
     * same argument plus one this route does not have: there the choice is also
     * the difference between a 200 and `guardManualPricesWritable()`'s 409, and
     * `OrderService::create()` never calls that guard.
     */
    expect(linesOf(draftWith({ lines: [lineWith({ price: "" })] }))[0]).toEqual({
      product_id: 101,
      quantity: 2,
    });
    expect(linesOf(draftWith({ lines: [lineWith({ price: "   " })] }))[0]).toEqual({
      product_id: 101,
      quantity: 2,
    });
  });

  it("sends a zero, because a free line is not an absent price", () => {
    /*
     * **The distinction the whole field turns on.** `0` and `"0"` are
     * deliberately absent from `LineItemInput`'s empty list: a free line is a
     * real thing a shop does — a replacement, a promised gift — and it is
     * exactly the case the old refusal was written to prevent. A builder that
     * treated a falsy amount as "no price" would reinstate that rule by
     * accident, and the operator would watch a giveaway come back at full price.
     */
    expect(linesOf(draftWith({ lines: [lineWith({ price: "0" })] }))[0]).toMatchObject({
      price: "0",
    });
  });

  it("trims, because is_numeric() tolerates whitespace and the stored value should not", () => {
    expect(linesOf(draftWith({ lines: [lineWith({ price: " 700 " })] }))[0]).toMatchObject({
      price: "700",
    });
  });

  it("does not normalise the amount, however differently it is written", () => {
    /*
     * `1200.5` is sent as `1200.5`. `LineItemInput::amount()` returns the string
     * the caller typed and is explicit about not normalising it — the class is
     * pure and cannot ask `wc_get_price_decimals()` what the store's precision
     * is, so rounding is WooCommerce's to do when the amount reaches the line.
     * A panel that rounded here would be deciding a precision it cannot read,
     * which is the same arithmetic `lib/format/money.ts` opens by refusing.
     */
    expect(linesOf(draftWith({ lines: [lineWith({ price: "1200.5" })] }))[0]).toMatchObject({
      price: "1200.5",
    });
  });

  it("states a product and a quantity on every line that carries a price", () => {
    /*
     * `LineItemInput::one()` refuses a price on a line that does not also state
     * `product_id` and `quantity` — checked on key presence, so that a stated
     * but invalid quantity is one message rather than two. Both keys are
     * unconditional in `buildPayload`, so the refusal is unreachable from this
     * form; this is what keeps it that way, because the omission rules above are
     * exactly the sort of thing that grows a third case later.
     */
    const lines = linesOf(
      draftWith({
        lines: [
          lineWith({ key: 0, price: "700", quantity: "nope" }),
          lineWith({ key: 1, productId: 102, price: "0" }),
        ],
      }),
    );

    for (const line of lines) {
      expect(line).toHaveProperty("product_id");
      expect(line).toHaveProperty("quantity");
    }
    // And the unparseable quantity is `0`, which the API refuses by name rather
    // than a `1` invented here. `draftProblems` catches it before the request.
    expect(lines[0].quantity).toBe(0);
  });
});

/**
 * The delivery fee — item 1's sub-task 4, create half.
 *
 * `shipping_amount` is accepted on create by the same `OrderInput::normalize()`
 * the PATCH uses and is written by `OrderRepository::create()` through
 * `applyShippingAmount()`, before the single `calculate_totals()`. It is
 * **`shipping_amount` out and `shipping_total` back**: the first is what
 * somebody stated, the second is what the order charges, and `shipping_total` is
 * in `OrderInput::READ_ONLY`.
 */
describe("the delivery fee", () => {
  it("is absent from a blank draft, and from the body it produces", () => {
    /*
     * There is nothing to seed it from: step 2's rate lookup is not built and
     * this drawer has no wilaya or commune to quote against. The seam at the
     * foot of `new-order.ts` says so, and this is the assertion that would fail
     * if somebody invented a default.
     */
    expect(emptyDraft().shippingAmount).toBe("");
    expect(buildPayload(draftWith())).not.toHaveProperty("shipping_amount");
  });

  it("omits an empty box rather than sending it empty", () => {
    /*
     * `OrderInput::normalize()` drops `null` and `""` before the payload is
     * assembled, so an empty box is a key the API discards — asking for nothing
     * in a longer sentence. On a *create* the effect is milder than on the edit
     * form, where an empty box leaves an existing fee where it stands: here
     * there is no fee to leave alone and the order is simply born carrying none.
     */
    expect(buildPayload(draftWith({ shippingAmount: "  " }))).not.toHaveProperty(
      "shipping_amount",
    );
  });

  it("sends what was typed, trimmed, including a stated zero", () => {
    expect(buildPayload(draftWith({ shippingAmount: " 400 " }))).toMatchObject({
      shipping_amount: "400",
    });
    /* `0` is the way to say "no delivery charge" and is a statement rather than
       an absence — a zero shipping line. It reads back as `"0.00"` where an
       empty one reads back `null`, which is the only thing that tells a decision
       from a silence, since both charge nothing. */
    expect(buildPayload(draftWith({ shippingAmount: "0" }))).toMatchObject({
      shipping_amount: "0",
    });
  });
});

/**
 * The line key — the panel's own, and never the API's.
 *
 * It exists because two rows for one product became reachable the moment a price
 * could be typed: four copies at 1 500 and one damaged copy at 700 is a real
 * order, and `NewOrderDrawer`'s `addLine` opens a second row for it rather than
 * merging the press into the discounted one. The React key used to be
 * `line.productId` and would collide on exactly that order.
 */
describe("line keys", () => {
  it("mints the next unused key, derived from the list rather than counted", () => {
    expect(nextLineKey([])).toBe(0);
    expect(nextLineKey([lineWith({ key: 0 }), lineWith({ key: 1 })])).toBe(2);
    // Derived, so a removal cannot make it hand back a key that is still in use.
    expect(nextLineKey([lineWith({ key: 4 })])).toBe(5);
    expect(nextLineKey([lineWith({ key: 7 }), lineWith({ key: 2 })])).toBe(8);
  });

  it("never reaches the wire", () => {
    const body = buildPayload(
      draftWith({ lines: [lineWith({ key: 99 })] }),
    ) as { line_items: Record<string, unknown>[] };
    expect(body.line_items[0]).not.toHaveProperty("key");
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

  it("does not mistake shipping_amount for a shipping address field", () => {
    /*
     * The two names are one character apart and mean nothing like each other:
     * `shipping.city` is half of an address block that is sent twice while the
     * switch is on, and `shipping_amount` is the delivery fee, sent once and
     * never duplicated. The fold is keyed on the `shipping.` prefix — with the
     * dot — so the underscore is what keeps them apart, and a refusal about the
     * fee must never be re-keyed onto a billing control that has nothing to do
     * with it. `line_items.{n}.price` is here for the same reason: a per-line
     * refusal binds to the row that produced it and to nothing else.
     */
    const fields = {
      shipping_amount: "Cannot be negative.",
      "line_items.0.price": "Is implausibly large.",
    };
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
          lineWith({ key: 0, productId: 101, quantity: "2" }),
          lineWith({ key: 1, productId: 102, quantity: "nope" }),
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

  it("adds no rule for the two new money fields, and that is the decision", () => {
    /**
     * **Sub-task 6 asks for `draftProblems()` to be extended for the new fields.
     * It was examined for both and gained nothing**, so this is what "extended"
     * came to: an assertion that it did not grow, and a reason.
     *
     * `LineItemInput::amount()` and `OrderInput::amount()` answer a bad amount
     * with one of three sentences — "Must be an amount.", "Cannot be negative.",
     * "Is implausibly large." — and each names which of three distinct things
     * went wrong. A local rule could only be a fourth, vaguer sentence, or a
     * second copy of those two functions that drifts on the first branch that
     * moves the ceiling. `[id]/order-edit.ts`'s `lineProblems` reached the same
     * conclusion about the same fields.
     *
     * The stock 409 is not pre-empted either, and on this route it cannot be:
     * `OrderService::create()` does not call `guardManualPricesWritable()`, so
     * there is no refusal to warn about before the save. If somebody ever wires
     * that guard into `create()`, this test is where the panel finds out it was
     * ignoring it.
     */
    const problems = draftProblems(
      draftWith({
        lines: [lineWith({ price: "-1" }), lineWith({ key: 1, price: "beaucoup" })],
        shippingAmount: "-40",
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
