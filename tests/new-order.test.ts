import { describe, expect, it } from "vitest";
import {
  bindRefusals,
  buildPayload,
  destinationSeed,
  draftProblems,
  emptyAddress,
  emptyDraft,
  isAddressEmpty,
  nextLineKey,
  parseQuantity,
  quoteFill,
  quoteFor,
  type DraftLine,
  type OrderDraft,
  type QuoteRow,
} from "@/app/[locale]/(panel)/orders/new-order";
import { CREATABLE_STATUSES, orderStatuses } from "@/lib/order-status";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * Every leaf key under a namespace, as a dotted path.
 *
 * A second copy of `tests/admin-schema.test.ts`'s helper rather than an import
 * from it: a test file importing another test file's private helper couples two
 * suites that have nothing else to say to each other, and this is four lines.
 */
function flatKeys(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix];

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatKeys(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

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
     *
     * **`delivery_type` is here and no other delivery key is**, which is the one
     * asymmetry a reader trips over. `emptyDraft()` opens the journey on `home`
     * — `rateArgs()`'s own `'default' => Destination::HOME` — so it is a value
     * the form is stating from the first frame, and `allowedFields()` names it.
     * The destination pair opens empty, and an empty picker sends nothing rather
     * than `0`, because `OrderInput::destinationId()` refuses `0` outright while
     * `null` and `''` are dropped. So a blank form says *home delivery, place
     * not yet decided*, which is exactly what it is.
     */
    expect(buildPayload(draftWith())).toEqual({
      line_items: [{ product_id: 101, quantity: 2, price: "1500.00" }],
      status: "pending",
      delivery_type: "home",
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
     * There is still nothing to seed it from. The drawer has a wilaya and a
     * commune now — step 2's admin sub-task 2 — but the rate lookup that turns
     * them into an amount is sub-task 3 and is not built, and neither are the
     * carrier and delivery-type halves of the four-part key it debounces on.
     * The seam at the foot of `new-order.ts` says so, and this is the assertion
     * that would fail if somebody invented a default.
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
 * The destination — step 2's admin sub-task 2, and the keys sub-task 3 put on
 * the wire.
 *
 * ## This block used to assert the opposite, and that is the point of it
 *
 * It was headed *"the destination, which is never part of the order body"* and
 * asserted that `wilaya_id`, `commune_id` and `delivery_type` could not reach
 * `POST /orders`, on the ground that `OrderInput::allowedFields()` named none of
 * them. That was true and the backend then closed it: `allowedFields()` names
 * all three, on both verbs, `OrderRepository::applyProps()` writes them to the
 * same three meta keys the checkout writes, and
 * `OrderService::guardDestinationResolves()` refuses a commune that does not
 * belong to the wilaya beside it. Read from source in `ecom-temp`'s
 * `feat/carrier-choice` tree.
 *
 * **Why it had to change rather than being left as a tidy invariant.** An order
 * created with no destination confirms straight into `order_destination_missing`
 * — `ShipmentSubscriber::destinationOf()` reads ids from meta and refuses to
 * guess them out of a free-text address — so it never gets a parcel and somebody
 * has to make one by hand. That is precisely the manual step this item exists to
 * remove, and a create drawer that collected a destination and dropped it would
 * have shipped the failure as a feature.
 *
 * ## What did *not* change, and is still asserted below
 *
 * `Commerce\AddressInput::FIELDS` is the ten address fields plus `email` on
 * billing, and `parse()` writes `'Unknown field.'` against every key
 * `array_diff` leaves over — keyed `billing.wilaya_id`. The destination is a
 * **top-level** fact, never an address field, and the last case here is what
 * keeps it that way.
 */
describe("the destination, which reaches the order body as a pair", () => {
  it("is empty on a blank draft", () => {
    expect(emptyDraft().wilayaId).toBe("");
    expect(emptyDraft().communeId).toBe("");
  });

  it("sends both ids as integers when the pair is whole", () => {
    const payload = buildPayload(
      draftWith({ wilayaId: "16", communeId: "484", deliveryType: "desk" }),
    );

    /* Numbers, not the strings the form holds. `OrderInput::destinationId()`
       runs `is_numeric()` before the cast and would take `"16"`, but the
       presenter emits integers and a body that round-trips sends back what it
       read. */
    expect(payload.wilaya_id).toBe(16);
    expect(payload.commune_id).toBe(484);
    expect(payload.delivery_type).toBe("desk");
    expect(Object.keys(payload).sort()).toEqual([
      "commune_id",
      "delivery_type",
      "line_items",
      "status",
      "wilaya_id",
    ]);
  });

  it("sends neither id while the pair is half chosen, and never a zero", () => {
    /*
     * **Both or neither.** A lone `wilaya_id` is
     * `guardDestinationResolves()`'s *"Required when the order names a
     * commune."* and the reverse is the mirror sentence, so a half pair is a
     * round trip spent learning what the form already knows.
     *
     * The zero is the sharper half: `Number("")` is `0`, and `0` is **refused**
     * rather than dropped — `OrderInput` splits it from `shipping_amount` on the
     * argument that a charge has a meaningful zero and an id has none, *there is
     * no commune 0*. So the guard tests the string being empty and not the
     * number being falsy.
     */
    for (const half of [
      { wilayaId: "16", communeId: "" },
      { wilayaId: "", communeId: "484" },
      { wilayaId: "", communeId: "" },
    ]) {
      const payload = buildPayload(draftWith(half));
      expect(payload, JSON.stringify(half)).not.toHaveProperty("wilaya_id");
      expect(payload, JSON.stringify(half)).not.toHaveProperty("commune_id");
    }
  });

  it("never sends the draft's own camel-cased names", () => {
    /* The failure mode this file's docblock names: the draft spread onto the
       body, carrying whatever it holds for its own bookkeeping. Every one of
       these is `'Unknown field.'` and takes the whole request with it. */
    const payload = buildPayload(draftWith({ wilayaId: "16", communeId: "484" }));
    expect(payload).not.toHaveProperty("wilayaId");
    expect(payload).not.toHaveProperty("communeId");
    expect(payload).not.toHaveProperty("deliveryType");
    expect(payload).not.toHaveProperty("shippingProvider");
  });

  it("omits the journey when the draft states none", () => {
    /* Reachable only from a draft built by hand — `emptyDraft()` opens on
       `home` — and asserted because the API's rule is the interesting one:
       `delivery_type` is dropped when empty like every other optional key, and
       an order that never states one still ships home, because
       `destinationOf()` falls back to `Destination::HOME` and is the only place
       that default lives. */
    const payload = buildPayload(
      draftWith({ deliveryType: "" as OrderDraft["deliveryType"] }),
    );
    expect(payload).not.toHaveProperty("delivery_type");
  });

  it("does not put an id inside an address block when one is sent", () => {
    const payload = buildPayload(
      draftWith({
        wilayaId: "16",
        communeId: "484",
        billing: { ...emptyAddress(), city: "Alger", state: "16" },
      }),
    );

    expect(payload.billing).toEqual({ city: "Alger", state: "16" });
  });
});

/**
 * `shipping_provider` — the courier step 2's carrier picker puts on the wire.
 *
 * **This docblock said it was "the one key" and named the destination as the
 * three that never travel.** `allowedFields()` names all four now, so the
 * delivery section states who carries the box *and* where it is going, which is
 * the pair the confirmation hook needs before it can create anything.
 * `shipping_provider` sits deliberately beside `shipping_amount` in that list
 * because the two are facts about one shipping line; the destination sits at the
 * end because it is one statement in three keys.
 *
 * **Nothing here normalises the name**, and that is asserted rather than left to
 * be noticed. `OrderInput::provider()` does `strtolower(trim())` itself,
 * matching `ProviderRegistry::has()` character for character so the string that
 * is stored is the string the registry answers to. A second normalisation in
 * the panel could only ever drift from it — and would hide from a reader that
 * the API does it.
 */
describe("the courier, which is the one thing in this block that does travel", () => {
  it("is empty on a blank draft, because the registry's default is the drawer's to seed", () => {
    expect(emptyDraft().shippingProvider).toBe("");
    /* `home`, which is `rateArgs()`'s own `'default' => Destination::HOME`. */
    expect(emptyDraft().deliveryType).toBe("home");
  });

  it("sends the courier when one is named", () => {
    const payload = buildPayload(draftWith({ shippingProvider: "yalidine" }));
    expect(payload.shipping_provider).toBe("yalidine");
  });

  it("omits the key entirely when nobody named one", () => {
    /* `null` and `""` are dropped by `OrderInput::normalize()` before the
       payload is assembled, so sending one would be asking for nothing in a
       longer sentence — `shipping_amount`'s rule, and the API's own. */
    for (const stated of ["", "   "]) {
      const payload = buildPayload(draftWith({ shippingProvider: stated }));
      expect(payload, stated).not.toHaveProperty("shipping_provider");
    }
  });

  it("never sends shipping_source, which is read-only and a different question", () => {
    /* `shipping_source` is `rules | provider | null` and says where the *price*
       came from; `shipping_provider` says who carries the box.
       `OrderInput::READ_ONLY` names the first, and a caller who could state it
       could claim a courier had answered when none was asked. */
    const payload = buildPayload(
      draftWith({ shippingProvider: "zrexpress", shippingAmount: "450.00" }),
    );
    expect(payload).not.toHaveProperty("shipping_source");
    expect(Object.keys(payload).sort()).toEqual([
      /* The draft's `home` default, which every payload from a real drawer
         carries — see the blank-form case at the top of this file. */
      "delivery_type",
      "line_items",
      "shipping_amount",
      "shipping_provider",
      "status",
    ]);
  });

  it("does not depend on a fee, because the API does not either", () => {
    /* `OrderRepository::applyShippingLine()` branches: a payload naming only a
       courier takes `assignShippingProvider()`, which creates a shipping line
       when the order has none. So "Yalidine is collecting it and I have not
       been told the price" is a real order. */
    const payload = buildPayload(draftWith({ shippingProvider: "yalidine" }));
    expect(payload.shipping_provider).toBe("yalidine");
    expect(payload).not.toHaveProperty("shipping_amount");
  });
});

/**
 * `quoteFor` — which of the rate route's rows prices this courier's journey.
 *
 * The route answers a **menu**: `ShippingService::rates()` emits the shop's
 * tariff row *and* every row the courier's own `getShippingRates()` returned,
 * per registered courier, and `YalidineProvider` returns all four of its
 * services whatever journey was asked for. Reading `data[0]` is only safe on a
 * shop with one provider and no courier credentials — which is this one, and is
 * why this function could not be discovered by driving the panel here.
 */
describe("picking one courier's price out of the menu", () => {
  const row = (over: Partial<QuoteRow> = {}): QuoteRow => ({
    provider: "yalidine",
    amount: "700.00",
    delivery_type: "home",
    source: "provider",
    ...over,
  });

  it("takes the cheapest row that covers the journey", () => {
    const rows = [
      row({ amount: "700.00" }),
      row({ amount: "560.00" }),
      row({ amount: "480.00", delivery_type: "desk" }),
    ];
    expect(quoteFor(rows, "yalidine", "home")?.amount).toBe("560.00");
    expect(quoteFor(rows, "yalidine", "desk")?.amount).toBe("480.00");
  });

  it("treats a row that names no journey as covering the one asked for", () => {
    /* `RateQuote::coversDeliveryType()`: null passes, because
       `getShippingRates()` is handed a `Destination` and an adapter that says
       nothing has answered about the journey it was given. Dropping those would
       discard the quote of every adapter that returns one price. */
    const rows = [row({ delivery_type: null, amount: "610.00" })];
    expect(quoteFor(rows, "yalidine", "home")?.amount).toBe("610.00");
    expect(quoteFor(rows, "yalidine", "desk")?.amount).toBe("610.00");
  });

  it("never reads another courier's row", () => {
    const rows = [row({ provider: "zrexpress", amount: "300.00" }), row({ amount: "900.00" })];
    expect(quoteFor(rows, "yalidine", "home")?.amount).toBe("900.00");
    expect(quoteFor(rows, "manual", "home")).toBeNull();
  });

  it("answers null for no courier and for a destination nothing priced", () => {
    /* Both are real states the picker draws rather than defensive branches: the
       empty option is a value on this form, and `manual` has no rate API at all
       — `ManualProvider::getShippingRates()` is `return [];`. */
    expect(quoteFor([row()], "", "home")).toBeNull();
    expect(quoteFor([], "yalidine", "home")).toBeNull();
  });

  it("matches the name the way the registry does, and hands back the whole row", () => {
    /* `ProviderRegistry::has()` looks up `strtolower(trim($name))`. */
    expect(quoteFor([row()], "  Yalidine ", "home")?.source).toBe("provider");
    /* The tariff and the courier are both real answers and `source` says which,
       rather than deciding which — the shop is charging the customer and the
       courier is charging the shop. */
    const both = [row({ amount: "500.00", source: "rules" }), row({ amount: "700.00" })];
    expect(quoteFor(both, "yalidine", "home")?.source).toBe("rules");
  });
});

/**
 * `quoteFill` — the rule that makes the delivery fee *live* without ever taking
 * it away from the person filling the form.
 *
 * `chooseCustomer` and `destinationSeed` both say "fill an empty field, never
 * replace a filled one", and a lookup obeying only that would be filled once by
 * the first destination and wrong ever after. So the rule gains one clause about
 * provenance: a quote may replace its **own** previous answer.
 */
describe("what a quote is allowed to write into the delivery fee", () => {
  it("fills an empty box", () => {
    expect(quoteFill("", "450.00", null)).toBe("450.00");
    expect(quoteFill("   ", "450.00", null)).toBe("450.00");
  });

  it("replaces its own previous suggestion, which is what makes the cost live", () => {
    expect(quoteFill("450.00", "800.00", "450.00")).toBe("800.00");
  });

  it("never replaces a number somebody typed", () => {
    expect(quoteFill("300.00", "450.00", null)).toBeNull();
    /* Still refused after the form has suggested something: the box no longer
       holds the suggestion, so somebody has been in it. */
    expect(quoteFill("300.00", "800.00", "450.00")).toBeNull();
  });

  it("keeps a typed zero, which is a real statement and not an empty box", () => {
    /* `0` writes a zero shipping line and reads back `"0.00"`; an empty box adds
       no line at all and reads back `null`. Both charge nothing and only one of
       them says somebody decided so. */
    expect(quoteFill("0", "450.00", null)).toBeNull();
  });

  it("says nothing to do when the answer has not changed", () => {
    /* `null` is *leave it alone*, and returning the identical string instead
       would re-render for nothing — and would make the drawer's effect fail to
       settle on its second pass. */
    expect(quoteFill("450.00", "450.00", "450.00")).toBeNull();
  });
});

/**
 * `destinationSeed` — the only trace a destination leaves on a created order.
 *
 * The rule is `chooseCustomer`'s, at field granularity: **fill an empty field,
 * never replace a filled one.** A person entering an order by phone may have
 * typed the commune themselves before reaching the picker, and losing that is
 * the defect the customer picker already refuses to cause.
 */
describe("what a chosen destination writes into an address", () => {
  it("fills an empty wilaya code and an empty city", () => {
    expect(
      destinationSeed(emptyAddress(), {
        wilayaCode: "16",
        communeName: "Alger Centre",
      }),
    ).toEqual({ state: "16", city: "Alger Centre" });
  });

  it("never overwrites what somebody typed", () => {
    const typed = { ...emptyAddress(), state: "31", city: "Oran" };

    expect(
      destinationSeed(typed, { wilayaCode: "16", communeName: "Alger Centre" }),
    ).toEqual({});
  });

  it("fills each field on its own, so a half-typed address gains the other half", () => {
    /* The likeliest real case: the operator typed the town off a phone call and
       never touched the wilaya code, which is a field nobody types by hand. */
    expect(
      destinationSeed(
        { ...emptyAddress(), city: "Bab Ezzouar" },
        { wilayaCode: "16", communeName: "Alger Est" },
      ),
    ).toEqual({ state: "16" });
  });

  it("writes nothing for a destination that was cleared", () => {
    /* Choosing the empty option hands back `null` rows, and a cleared
       destination must not blank an address the operator has already got. */
    expect(destinationSeed(emptyAddress(), {})).toEqual({});
    expect(
      destinationSeed(emptyAddress(), { wilayaCode: "  ", communeName: "" }),
    ).toEqual({});
  });

  it("treats whitespace as empty on the address side too", () => {
    expect(
      destinationSeed({ ...emptyAddress(), state: "  " }, { wilayaCode: "16" }),
    ).toEqual({ state: "16" });
  });
});

/**
 * The two locales, on the namespaces this drawer reads.
 *
 * ADMIN_PANEL.md's rule is that French and Arabic stay exactly in sync, and a
 * missing Arabic key does not fail a render — `next-intl` falls back to printing
 * the key path, which is a visible defect only in the locale that fewer of the
 * people writing this can read. The destination's strings live in two
 * namespaces, `shipping` for the controls and `orders` for the drawer's own
 * copy, because they belong to neither form in particular.
 */
describe("both locales resolve every key the create drawer uses", () => {
  const namespaces = ["orders", "shipping"] as const;

  it("is at exact key parity", () => {
    for (const namespace of namespaces) {
      const a = flatKeys((fr as Record<string, unknown>)[namespace]).sort();
      const b = flatKeys((ar as Record<string, unknown>)[namespace]).sort();
      expect(a, namespace).toEqual(b);
      expect(a.length, namespace).toBeGreaterThan(20);
    }
  });

  it("carries the destination's own strings in both", () => {
    for (const messages of [fr, ar]) {
      const shipping: Record<string, unknown> = messages.shipping;
      for (const key of [
        "pickWilaya",
        "pickCommune",
        "pickCommuneFirst",
        "communesLoading",
        "noCommunes",
        "notChosen",
      ]) {
        expect(shipping[key], key).toBeTruthy();
      }

      const create = messages.orders.create.shipping;
      expect(create.destinationWhy).toBeTruthy();
      /* `{{name}}` parses as a literal brace plus a placeholder plus a literal
         brace, and `next-intl` throws `INVALID_MESSAGE` and renders the key path
         as visible text. Presence is not validity. */
      expect(create.wilayaMismatch).toContain("{name}");
      expect(create.wilayaMismatch).not.toContain("{{");

      /* The carrier block's own strings — step 2's sub-tasks 1 and 3. Its four
         drawn states each have a sentence, and a missing Arabic one renders the
         key path in the locale fewer of the people writing this can read. */
      for (const key of [
        "carrier",
        "carrierNone",
        "carrierNoPrice",
        "carrierNoAccess",
        "deliveryTypeHint",
        "quotePrompt",
        "quoting",
        "quotedAmount",
      ] as const) {
        expect(create[key], key).toBeTruthy();
      }

      /* The three that interpolate, checked for the placeholder rather than for
         presence — `{{source}}` is a render-time throw, not a missing word. */
      expect(create.quoted).toContain("{source}");
      expect(create.quoted).not.toContain("{{");
      expect(create.quoteNone).toContain("{name}");
      expect(create.quoteNone).not.toContain("{{");
      expect(create.quoteFailed).toContain("{message}");
      expect(create.quoteFailed).not.toContain("{{");

      /* The two the carrier block borrows rather than declares: the journey's
         labels are the rule form's and the parcel drawer's, and the quote's
         attribution is the rules resolver's. One vocabulary for one field. */
      const borrowed: Record<string, unknown> = messages.shipping;
      for (const key of ["deliveryTypeLabel", "sourceRules", "sourceProvider"]) {
        expect(borrowed[key], key).toBeTruthy();
      }
      for (const type of ["home", "desk"] as const) {
        expect(messages.deliveryType[type], type).toBeTruthy();
      }
    }
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

  /*
   * ── the Algeria default, and the two rules it had to not break ─────────────
   *
   * `emptyDraft()` opens both blocks on `DZ` so the country picker is answered
   * before anybody reaches it. That is a fact the *form* states, and these three
   * are the assertions that keep it from becoming a fact the *order* states.
   */
  it("opens both blocks on Algeria, and `emptyAddress()` on nothing", () => {
    const draft = emptyDraft();
    expect(draft.billing.country).toBe("DZ");
    expect(draft.shipping.country).toBe("DZ");

    /* The floor under a *stored* address is still blank, because
       `[id]/order-edit.ts` seeds from it and an order that never carried a
       country must keep saying so. */
    expect(emptyAddress().country).toBe("");
  });

  it("does not put that default on the wire on its own", () => {
    /*
     * The regression this guards. Accumulate-and-check-for-empty would now emit
     * `{"billing":{"country":"DZ"}}` for a form whose address section nobody
     * opened — an order created carrying a country nobody stated. `buildPayload`
     * defers to `isAddressEmpty`, so the default rides along only when there is
     * an address for it to belong to.
     */
    const body = buildPayload(draftWith());
    expect(body).not.toHaveProperty("billing");

    const filled = buildPayload(
      draftWith({ billing: { ...emptyDraft().billing, city: "Alger" } }),
    );
    expect(filled.billing).toEqual({ city: "Alger", country: "DZ" });
  });

  it("still lets a customer's address land in a block holding only the default", () => {
    /*
     * `chooseCustomer` copies a customer's stored address only into a block
     * nobody has typed in, and the old all-eleven rule would have answered
     * `false` for every freshly opened drawer — retiring the copy silently. The
     * country is disregarded; anything else is not.
     */
    expect(isAddressEmpty(emptyDraft().billing)).toBe(true);
    expect(isAddressEmpty({ ...emptyDraft().billing, country: "FR" })).toBe(true);
    expect(isAddressEmpty({ ...emptyDraft().billing, city: "Alger" })).toBe(false);
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
