import { describe, expect, it } from "vitest";
import {
  CREATABLE_STATUSES,
  CREATABLE_STOCK_STATUSES,
  CREATABLE_TYPES,
  VARIABLE_OMITS,
  buildPayload,
  draftProblems,
  emptyDraft,
  parseAttachmentId,
  parseStock,
  type ProductDraft,
} from "@/app/[locale]/(panel)/products/new-product";
import {
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  STOCK_STATUSES,
} from "@/lib/product-status";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * Every leaf key under a namespace, as a dotted path.
 *
 * A third copy of `tests/admin-schema.test.ts`'s helper rather than an import
 * from it, on `tests/new-order.test.ts`'s argument: a test file importing
 * another test file's private helper couples two suites that have nothing else
 * to say to each other, and this is four lines.
 */
function flatKeys(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix];

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatKeys(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

/**
 * `POST /products` — the body the product create drawer sends.
 *
 * The interesting half of a create form is which keys reach the wire and in what
 * shape, and that is a pure function of a plain object — so it is asserted here
 * rather than through eleven `fireEvent`s per case. `tests/new-order.test.ts` is
 * the sibling suite and the shape is deliberately its.
 *
 * Every expectation below is one of three things, and the file says which:
 *
 *  - a refusal `Products\ProductInput` makes by name, **read from source** in
 *    `ecom-temp/wp-content/plugins/algerian-commerce-core`;
 *  - a status the plugin's own in-process suite (`tests/Api/products.php`, run
 *    through `rest_do_request()`) asserts;
 *  - a rule this panel decided and would otherwise lose silently.
 *
 * Nothing here was measured over live HTTP. `BLOCKED.md` records the 401.
 *
 * ## The one assertion this suite exists for above all the others
 *
 * **A field the form does not draw must not reach the wire.** The reason this
 * screen went eleven branches unbuilt is that a product carries four editors a
 * create form cannot honestly hold — variations, options, attributes and SEO —
 * and the failure mode of building it anyway is not a crash: it is a body
 * quietly carrying `seo` or `attributes` derived from a draft nobody filled in.
 * `ProductDetail`'s rule, inherited: *a field a form sends but never shows is a
 * field it can silently clobber.* So the key **set** is asserted from both ends
 * on every case.
 */

const MESSAGES = { name: "no name", stock: "bad quantity", image: "bad image" };

function draftWith(overrides: Partial<ProductDraft> = {}): ProductDraft {
  return { ...emptyDraft(), name: "Tapis berbère", ...overrides };
}

describe("the body carries only what the operator set", () => {
  it("sends five keys for a draft holding nothing but a name", () => {
    const payload = buildPayload(draftWith());

    /*
     * `name` because the route requires it; `type`, `status`, `stock_status` and
     * `manage_stock` because each is a control on screen with a default this
     * form chose, and a body that omitted the answer to a question it asked
     * would leave the two able to disagree. Everything else is absent.
     */
    expect(Object.keys(payload).sort()).toEqual([
      "manage_stock",
      "name",
      "status",
      "stock_status",
      "type",
    ]);
    expect(payload).toEqual({
      name: "Tapis berbère",
      type: "simple",
      status: "draft",
      stock_status: "instock",
      manage_stock: false,
    });
  });

  it("never sends a key for one of the four editors it leaves to the detail", () => {
    /*
     * The assertion this suite exists for. A fully filled draft — every control
     * the drawer draws, set — and none of `seo`, `options`, `attributes`,
     * `variations` or `gallery_image_ids` appears, because none of them is on
     * this object at all.
     */
    const payload = buildPayload(
      draftWith({
        sku: "AC-NEW-0001",
        regularPrice: "4500.00",
        salePrice: "3900.00",
        shortDescription: "<p>Court</p>",
        description: "<p>Long</p>",
        categoryIds: [12, 10],
        manageStock: true,
        stockQuantity: "7",
        stockStatus: "onbackorder",
        imageId: "5001",
        status: "publish",
        type: "variable",
      }),
    );

    for (const key of [
      "seo",
      "options",
      "attributes",
      "variations",
      "gallery_image_ids",
      "slug",
      "featured",
      "catalog_visibility",
      "weight",
      "tag_ids",
      "price",
      "on_sale",
      "id",
    ]) {
      expect(key in payload, key).toBe(false);
    }
  });

  it("omits every optional field that is empty rather than sending it blank", () => {
    /* `""` and an absent key are equivalent to `ProductInput` for every field
       here — a price clears on either — and they are not equivalent to a person
       reading the request. */
    const payload = buildPayload(
      draftWith({
        sku: "   ",
        regularPrice: "",
        salePrice: "   ",
        shortDescription: "",
        description: "   ",
        categoryIds: [],
        imageId: "",
      }),
    );

    for (const key of [
      "sku",
      "regular_price",
      "sale_price",
      "short_description",
      "description",
      "category_ids",
      "image_id",
    ]) {
      expect(key in payload, key).toBe(false);
    }
  });

  it("trims what it does send, because the API trims it anyway", () => {
    const payload = buildPayload(
      draftWith({
        name: "  Tapis  ",
        sku: "  AC-NEW-0001  ",
        regularPrice: " 4500.00 ",
        description: "  <p>Long</p>  ",
      }),
    );

    expect(payload.name).toBe("Tapis");
    expect(payload.sku).toBe("AC-NEW-0001");
    expect(payload.regular_price).toBe("4500.00");
    expect(payload.description).toBe("<p>Long</p>");
  });

  it("keeps money a decimal string, never a number", () => {
    /* `ProductInput` runs `is_numeric()` and stores `(string) $value`, and the
       harness refuses a JSON number by name — *"Must be a number."* for `1200`
       exactly as for `"abc"`. `lib/format/money.ts` opens by refusing to let a
       price a shop typed correctly be stored a millionth away from itself. */
    const payload = buildPayload(
      draftWith({ regularPrice: "4500.00", salePrice: "3900.50" }),
    );

    expect(payload.regular_price).toBe("4500.00");
    expect(payload.sale_price).toBe("3900.50");
    expect(typeof payload.regular_price).toBe("string");
    expect(typeof payload.sale_price).toBe("string");
  });

  it("sends category ids sorted, as the API stores them", () => {
    const payload = buildPayload(draftWith({ categoryIds: [14, 10, 12] }));
    expect(payload.category_ids).toEqual([10, 12, 14]);
  });
});

/**
 * `type` decides two of the thirteen keys, and this is the half of it that is
 * asymmetric. `VARIABLE_OMITS` in `new-product.ts` carries the argument: a
 * variable product's parent holds `regular_price: ""` — measured on every
 * variable row in the catalogue — and `ProductInput` will nonetheless accept and
 * store a price, because it has no branch on `type` at all. So a form that sent
 * one would store a number no screen in the shop ever reads back.
 */
describe("what the form does about type", () => {
  it("omits both prices on a variable product, whatever is in the boxes", () => {
    const draft = draftWith({
      type: "variable",
      regularPrice: "4500.00",
      salePrice: "3900.00",
    });
    const payload = buildPayload(draft);

    for (const key of VARIABLE_OMITS) expect(key in payload, key).toBe(false);
    expect(payload.type).toBe("variable");

    // …and the identical draft as a simple product sends both, which is what
    // makes this a decision about `type` rather than about the boxes.
    const simple = buildPayload({ ...draft, type: "simple" });
    expect(simple.regular_price).toBe("4500.00");
    expect(simple.sale_price).toBe("3900.00");
  });

  it("keeps the whole stock block on both types, because stock is not asymmetric", () => {
    /*
     * The half a form would get wrong by guessing from the word "variable". Both
     * variable products in the measured catalogue carry an ordinary
     * `manage_stock` / `stock_quantity` pair, so parent-level stock is a real
     * setting on one and taking it away would remove something the API keeps.
     */
    const payload = buildPayload(
      draftWith({ type: "variable", manageStock: true, stockQuantity: "7" }),
    );

    expect(payload.manage_stock).toBe(true);
    expect(payload.stock_quantity).toBe(7);
    expect(payload.stock_status).toBe("instock");
  });

  it("offers exactly the two types the API takes", () => {
    expect(CREATABLE_TYPES).toEqual(PRODUCT_TYPES);
    expect([...CREATABLE_TYPES]).toEqual(["simple", "variable"]);
  });
});

/**
 * Three states, and only two of them put a number on the wire. The distinction
 * is the catalogue's own invariant — 8 of 28 rows manage no stock and carry
 * `stock_quantity: null` — and it is a `200` either way, which is why getting it
 * wrong is invisible.
 */
describe("stock, and the two different ways of holding none", () => {
  it("drops the quantity entirely when the shelf is not counted", () => {
    /* Measured: the API answers 200 with the field ignored, which looks exactly
       like a save that worked. `ProductDetail` deletes the key for the same
       reason rather than sending it and trusting the answer. */
    const payload = buildPayload(draftWith({ manageStock: false, stockQuantity: "12" }));
    expect("stock_quantity" in payload).toBe(false);
  });

  it("sends null for a counted shelf whose count nobody has typed", () => {
    /* `ProductInput` preserves an explicit `null`. *Nothing is being counted*
       and *the count is zero* are different facts about a shelf. */
    const payload = buildPayload(draftWith({ manageStock: true, stockQuantity: "" }));
    expect(payload.stock_quantity).toBeNull();
    expect("stock_quantity" in payload).toBe(true);
  });

  it("sends a real zero as a real zero", () => {
    const payload = buildPayload(draftWith({ manageStock: true, stockQuantity: "0" }));
    expect(payload.stock_quantity).toBe(0);
  });

  it("sends no key at all for text that is not a whole number", () => {
    /*
     * The floor under `draftProblems`, and it must not invent a `0`.
     * `Number("2x")` is `NaN` and `JSON.stringify(NaN)` is `null` — which the
     * API reads as *clear the count* — so a builder that trusted `Number()`
     * would send a value nobody typed and get a 200 back.
     */
    for (const text of ["2x", "-1", "7.9", "twelve"]) {
      const payload = buildPayload(draftWith({ manageStock: true, stockQuantity: text }));
      expect("stock_quantity" in payload, text).toBe(false);
    }

    /* Whitespace is the *empty* case and not this one — a box holding two
       spaces is a box somebody has not typed a number into — so it sends `null`
       like any other empty box rather than dropping the key. */
    expect(
      buildPayload(draftWith({ manageStock: true, stockQuantity: "   " })).stock_quantity,
    ).toBeNull();
  });

  it("offers exactly the three stock statuses the API takes", () => {
    expect(CREATABLE_STOCK_STATUSES).toEqual(STOCK_STATUSES);
  });
});

describe("the featured image, which is one field and two ways of filling it", () => {
  it("sends the id the picker chose", () => {
    expect(buildPayload(draftWith({ imageId: "5001" })).image_id).toBe(5001);
  });

  it("sends the id somebody typed into the capability fallback", () => {
    /* One field, one rule: the picker writes `String(item.id)` into the same
       place the fallback's text field binds to, so there is one code path. */
    expect(buildPayload(draftWith({ imageId: " 5001 " })).image_id).toBe(5001);
  });

  it("sends no key for none, for zero, or for text that is not an id", () => {
    /* `0`, `null` and `""` are one value to the API — *clear the featured image*
       — and there is nothing on a product being created to clear. */
    for (const text of ["", "0", "abc", "-3", "5.5"]) {
      expect("image_id" in buildPayload(draftWith({ imageId: text })), text).toBe(false);
    }
  });

  it("never sends a gallery, which is the edit form's field", () => {
    expect("gallery_image_ids" in buildPayload(draftWith({ imageId: "5001" }))).toBe(false);
  });
});

describe("a quantity and an attachment id are text until proved to be numbers", () => {
  it("reads a whole number of zero or more, and nothing else", () => {
    expect(parseStock("0")).toBe(0);
    expect(parseStock("7")).toBe(7);
    expect(parseStock(" 12 ")).toBe(12);

    /* Stricter than the API in the one direction that cannot refuse anything it
       accepts: `is_numeric` then `(int)` would read `7.9` as `7`, and somebody
       who typed `7.9` into a stock box did not mean 7. */
    expect(parseStock("7.9")).toBeNull();
    expect(parseStock("-1")).toBeNull();
    expect(parseStock("2x")).toBeNull();
    expect(parseStock("")).toBeNull();
  });

  it("reads a positive attachment id, and calls zero none", () => {
    expect(parseAttachmentId("5001")).toBe(5001);
    expect(parseAttachmentId(" 5001 ")).toBe(5001);
    expect(parseAttachmentId("0")).toBeNull();
    expect(parseAttachmentId("")).toBeNull();
    expect(parseAttachmentId("abc")).toBeNull();
  });
});

/**
 * The client-side rules, and how few of them there are.
 *
 * The test each one had to pass to exist: **would leaving it out cost a round
 * trip to learn something the form already knows for certain, or let a value
 * nobody typed reach the wire?** `orders/new-order.ts` set that bar and this
 * file keeps it — which is why there is no `sale_price <= regular_price` rule
 * here even though the API does keep one.
 */
describe("the client-side rules, and how few of them there are", () => {
  it("says nothing about a draft that only needs a name", () => {
    expect(draftProblems(draftWith(), MESSAGES)).toEqual({});
  });

  it("refuses a blank name, which is the one field the route requires", () => {
    expect(draftProblems(draftWith({ name: "" }), MESSAGES)).toEqual({
      name: MESSAGES.name,
    });
    expect(draftProblems(draftWith({ name: "   " }), MESSAGES)).toEqual({
      name: MESSAGES.name,
    });
  });

  it("refuses a quantity that is not a whole number, and only while counting", () => {
    expect(
      draftProblems(draftWith({ manageStock: true, stockQuantity: "2x" }), MESSAGES),
    ).toEqual({ stock_quantity: MESSAGES.stock });

    // An empty box is a real value — it sends `null` — so it is not a problem.
    expect(
      draftProblems(draftWith({ manageStock: true, stockQuantity: "" }), MESSAGES),
    ).toEqual({});

    // And an uncounted shelf drops the key, so its contents cannot be wrong.
    expect(
      draftProblems(draftWith({ manageStock: false, stockQuantity: "2x" }), MESSAGES),
    ).toEqual({});
  });

  it("refuses an attachment id that is not a number", () => {
    expect(draftProblems(draftWith({ imageId: "abc" }), MESSAGES)).toEqual({
      image_id: MESSAGES.image,
    });
    // `0` is a number and is dropped by the builder, not by a rule.
    expect(draftProblems(draftWith({ imageId: "0" }), MESSAGES)).toEqual({});
    expect(draftProblems(draftWith({ imageId: "" }), MESSAGES)).toEqual({});
  });

  it("keys its problems the way the API keys its own refusals", () => {
    /* So a 400 naming `stock_quantity` and a local rule naming the same field
       merge into one map and one `ErrorSummary` with no translation step. */
    const problems = draftProblems(
      draftWith({
        name: "",
        manageStock: true,
        stockQuantity: "2x",
        imageId: "abc",
      }),
      MESSAGES,
    );
    expect(Object.keys(problems).sort()).toEqual(["image_id", "name", "stock_quantity"]);
  });

  it("pre-empts nothing the API says better", () => {
    /*
     * Four refusals the API makes and this file deliberately does not:
     *
     *   an inverted price pair   "Cannot be higher than the regular price."
     *                            (`ProductInput::validateSalePrice()`, when both
     *                            are stated — which on this form they are)
     *   a taken SKU              409, and there are two of them
     *   a bad attachment id      "{id} is not an image attachment."
     *   an unknown enum          "Must be one of: simple, variable."
     *
     * Each names the problem better than a local copy could, and each copy could
     * only ever be a second authority that drifts.
     */
    const problems = draftProblems(
      draftWith({
        regularPrice: "1000",
        salePrice: "1500",
        sku: "AC-CAT-0101",
        imageId: "999999",
      }),
      MESSAGES,
    );
    expect(problems).toEqual({});
  });
});

describe("a blank draft, and the two defaults that are decisions", () => {
  it("starts as an uncounted, in-stock, simple draft", () => {
    expect(emptyDraft()).toEqual({
      name: "",
      type: "simple",
      status: "draft",
      sku: "",
      regularPrice: "",
      salePrice: "",
      shortDescription: "",
      description: "",
      categoryIds: [],
      manageStock: false,
      stockQuantity: "",
      stockStatus: "instock",
      imageId: "",
    });
  });

  it("does not publish by default, which is the point of the default", () => {
    /*
     * `NewOrderDrawer` defaults to `pending` because it is the only creatable
     * status that moves no stock; this is that argument one collection over. A
     * product created `publish` is in the shop the instant the button is
     * pressed, with whatever had been typed by then and usually with no image.
     */
    expect(emptyDraft().status).toBe("draft");
    expect(buildPayload(draftWith()).status).toBe("draft");
  });

  it("offers all four writable statuses and never the trash", () => {
    /* `trash` is readable and not writable — a product is trashed by `DELETE`
       and `?status=trash` is a 400 — so it is in `READABLE_STATUSES` and not
       here. One list, re-exported rather than copied. */
    expect(CREATABLE_STATUSES).toEqual(PRODUCT_STATUSES);
    expect([...CREATABLE_STATUSES]).not.toContain("trash");
  });
});

describe("both locales resolve every key the create drawer uses", () => {
  it("keeps products.create in exact sync between fr and ar", () => {
    const a = flatKeys(fr.products.create).sort();
    const b = flatKeys(ar.products.create).sort();

    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(15);
    // No leaf may be empty: `next-intl` renders the key path as visible text for
    // a missing message, in the locale fewer of the people writing this can read.
    for (const messages of [fr.products.create, ar.products.create]) {
      for (const value of flatKeys(messages).map((key) =>
        key.split(".").reduce<unknown>((node, part) => (node as never)[part], messages),
      )) {
        expect(typeof value).toBe("string");
        expect(value).not.toBe("");
      }
    }
  });

  it("carries the drawer's own strings, and the placeholder in the toast", () => {
    for (const messages of [fr, ar]) {
      const create = messages.products.create;

      for (const key of ["action", "title", "description", "submit", "failed"] as const) {
        expect(create[key], key).toBeTruthy();
      }

      /* `{{name}}` parses as a literal brace plus a placeholder plus a literal
         brace, and `next-intl` throws `INVALID_MESSAGE` and renders the key path
         as visible text. Presence is not validity. */
      expect(create.created).toContain("{name}");
      expect(create.created).not.toContain("{{");

      // The three local rules, the three steps and the fallback's sentence — the
      // last is the one a Manager reads instead of a media picker.
      for (const key of ["name", "stock", "image"] as const) {
        expect(create.problem[key], key).toBeTruthy();
      }
      for (const key of [
        "none",
        "attached",
        "choose",
        "change",
        "remove",
        "back",
        "backToPicker",
        "manualId",
        "manualIdWhy",
      ] as const) {
        expect(create.image[key], key).toBeTruthy();
      }
    }
  });

  it("reuses the detail's field labels rather than translating them twice", () => {
    /* The drawer reads its twelve field labels from `products.detail`, which is
       why they are not under `products.create` — two translations of one word
       drift, and a form and a detail disagreeing about what "Prix habituel"
       is called is the kind of thing nobody notices for a year. */
    for (const messages of [fr, ar]) {
      const detail: Record<string, unknown> = messages.products.detail;
      for (const key of [
        "name",
        "sku",
        "skuHint",
        "skuTaken",
        "type",
        "status",
        "regularPrice",
        "salePrice",
        "shortDescription",
        "description",
        "categories",
        "noCategories",
        "manageStock",
        "manageStockHint",
        "stockQuantity",
        "stockStatus",
        "image",
        "identity",
        "pricing",
        "inventory",
        "descriptions",
        "htmlNote",
      ]) {
        expect(detail[key], key).toBeTruthy();
      }
    }
  });
});
