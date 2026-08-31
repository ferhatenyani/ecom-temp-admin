import { describe, expect, it } from "vitest";
import {
  COMBINATION_CAP,
  attach,
  attachedFrom,
  attributesBody,
  axesOf,
  combinationKey,
  combinationsOf,
  detach,
  isGlobal,
  isParentRefusal,
  localSkuClashes,
  mappingLosses,
  planGeneration,
  rowDirty,
  variationCreateBody,
  variationDraftFrom,
  variationKey,
  variationUpdateBody,
  withOption,
  withRole,
  withVisible,
  type Attached,
  type VariationDraft,
} from "@/app/[locale]/(panel)/products/[id]/variable-product";
import type { Product, Variation } from "@/lib/api/schemas/product";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * Every leaf key under a namespace, as a dotted path.
 *
 * A fifth copy of `tests/admin-schema.test.ts`'s helper rather than an import, on
 * the argument `tests/new-order.test.ts` and `tests/attributes.test.ts` both
 * make: a test file importing another test file's private helper couples two
 * suites that have nothing else to say to each other, and this is four lines.
 */
function flatKeys(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix];

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatKeys(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

/* ------------------------------------------------------------- fixtures --- */

const attributeRow = (over: Partial<Attached> = {}): Attached => ({
  id: 1,
  name: "pa_couleur",
  options: ["rouge", "bleu"],
  visible: true,
  variation: true,
  position: 0,
  ...over,
});

/**
 * The shape that matters: a **global** variation axis, a **global** spec, and a
 * **local** attribute with no control on screen.
 *
 * The local one is the fixture the whole completeness invariant turns on. The two
 * variable products in this shop carry `id: 0` attributes ("Taille", "Finition"),
 * and an editor that only knew about global ones would have deleted them on its
 * first save — silently, with a 200.
 */
const PARENT_ATTRIBUTES: Attached[] = [
  attributeRow(),
  attributeRow({
    id: 2,
    name: "pa_matiere",
    options: ["laine", "coton"],
    variation: false,
    position: 1,
  }),
  attributeRow({
    id: 0,
    name: "Finition",
    options: ["Mate", "Brillante"],
    variation: false,
    position: 2,
  }),
];

const product = (over: Partial<Product> = {}): Product =>
  ({
    id: 104,
    name: "Tapis berbère",
    type: "variable",
    attributes: PARENT_ATTRIBUTES,
    variations: [9001],
  }) as unknown as Product;

const variation = (over: Partial<Variation> = {}): Variation =>
  ({
    id: 9001,
    parent_id: 104,
    sku: "",
    status: "publish",
    description: "",
    price: "1000",
    regular_price: "1000",
    sale_price: "",
    on_sale: false,
    manage_stock: true,
    stock_quantity: 4,
    stock_status: "instock",
    weight: "",
    attributes: { pa_couleur: "rouge" },
    image_id: 0,
    image: null,
    date_created: "",
    date_modified: "",
    ...over,
  }) as unknown as Variation;

/* ═══════════════════════════════════════════════════ the completeness rule ═══ */

/**
 * **The deferral, asserted rather than argued.**
 *
 * `ProductDetail` refused to edit `attributes` for two branches because
 * `ProductRepository::update()` calls `set_attributes()` — a whole-list replace —
 * so a *partial* list deletes what it omits and
 * `VariationService::variationAttributes()` then makes every existing variation's
 * combination illegal. The reversal rests entirely on the claim that this module
 * cannot produce a partial list.
 *
 * That claim is only worth anything if it is checked against every operation the
 * editor offers, including the ones that have no control for the row they must
 * preserve. So each case below runs an edit and asserts the **key set of the body
 * equals the key set of the product**, plus or minus exactly what was asked for.
 */
describe("the attribute list is always sent whole", () => {
  const keysOf = (body: { attributes: Attached[] } | null) =>
    (body?.attributes ?? []).map(variationKey).sort();

  const parentKeys = PARENT_ATTRIBUTES.map(variationKey).sort();

  it("carries every attribute when only one option is touched", () => {
    const draft = withOption(PARENT_ATTRIBUTES, "pa_couleur", "vert", true, [
      "rouge",
      "bleu",
      "vert",
    ]);
    const body = attributesBody(PARENT_ATTRIBUTES, draft);

    expect(keysOf(body)).toEqual(parentKeys);
    expect(body?.attributes).toHaveLength(3);
  });

  it("carries the local attribute the screen draws no term control for", () => {
    const draft = withRole(PARENT_ATTRIBUTES, "pa_couleur", false);
    const body = attributesBody(PARENT_ATTRIBUTES, draft);

    const local = body?.attributes.find((row) => !isGlobal(row));
    expect(local).toBeDefined();
    // Byte-identical to what was read: options, visibility, position and all.
    expect(local).toEqual(PARENT_ATTRIBUTES[2]);
  });

  it("removes exactly one key when one attribute is detached, and no other", () => {
    const draft = detach(PARENT_ATTRIBUTES, "pa_matiere");
    expect(keysOf(attributesBody(PARENT_ATTRIBUTES, draft))).toEqual(
      parentKeys.filter((key) => key !== "pa_matiere"),
    );
  });

  it("adds exactly one key when one attribute is attached", () => {
    const draft = attach(PARENT_ATTRIBUTES, { id: 7, taxonomy: "pa_taille" });
    expect(keysOf(attributesBody(PARENT_ATTRIBUTES, draft))).toEqual(
      [...parentKeys, "pa_taille"].sort(),
    );
  });

  /**
   * `null` when nothing changed, which is the third place in this panel that
   * answers it and the same 400: `ProductService::update()` throws
   * `invalidRequest('No supported fields were provided.')` on an empty patch, and
   * that 400 carries no `details` — so a save button that fired on an untouched
   * card would produce an error bound to no control and visible nowhere.
   */
  it("answers null for an untouched card", () => {
    expect(attributesBody(PARENT_ATTRIBUTES, attachedFrom(product()))).toBeNull();
  });

  /**
   * Toggling a term off and back on must return the card to clean. Without the
   * vocabulary ordering in `withOption()` the options would come back in a
   * different order, the card would read dirty forever, and the next save would
   * rewrite the whole attribute list for nothing — which is precisely the write
   * this module exists to make rare.
   */
  it("is idempotent under a toggle, so an undone edit reports clean", () => {
    const order = ["rouge", "bleu", "vert"];
    const off = withOption(PARENT_ATTRIBUTES, "pa_couleur", "rouge", false, order);
    const back = withOption(off, "pa_couleur", "rouge", true, order);

    expect(attributesBody(PARENT_ATTRIBUTES, back)).toBeNull();
  });

  /** A value the vocabulary no longer lists still has to survive a save. */
  it("keeps an option the vocabulary does not know about", () => {
    const carried = [attributeRow({ options: ["rouge", "retire-du-vocabulaire"] })];
    const draft = withOption(carried, "pa_couleur", "bleu", true, ["rouge", "bleu"]);

    expect(draft[0].options).toContain("retire-du-vocabulaire");
    expect(draft[0].options).toContain("bleu");
  });

  it("preserves stored positions rather than renumbering by index", () => {
    // Sparse positions are the API's and are not this screen's business. A
    // renumber would make an untouched card dirty and reorder the storefront.
    const sparse = [attributeRow({ position: 0 }), attributeRow({ id: 2, name: "pa_matiere", position: 9 })];
    const body = attributesBody(sparse, withVisible(sparse, "pa_matiere", false));

    expect(body?.attributes.map((row) => row.position)).toEqual([0, 9]);
  });

  /** `AttributeInput`'s own defaults, copied so the panel stores what the API assumes. */
  it("attaches a new attribute as a visible spec at the next free position", () => {
    const [added] = attach(PARENT_ATTRIBUTES, { id: 7, taxonomy: "pa_taille" }).slice(-1);

    expect(added).toEqual({
      id: 7,
      // The **taxonomy**, not the slug: a variation joins on `get_name()`.
      name: "pa_taille",
      options: [],
      visible: true,
      variation: false,
      position: 3,
    });
  });
});

/* ══════════════════════════════════════════════════════ the mapping guard ═══ */

/**
 * The three destructive edits, each counted before it fires.
 *
 * They all end the same way — a variation whose combination the parent no longer
 * offers — but they are three different acts and the confirmation names which.
 */
describe("mappingLosses names every variation an edit would orphan", () => {
  const variations = [variation(), variation({ id: 9002, attributes: { pa_couleur: "bleu" } })];

  it("reports a detached variation axis", () => {
    const losses = mappingLosses(PARENT_ATTRIBUTES, detach(PARENT_ATTRIBUTES, "pa_couleur"), variations);

    expect(losses).toEqual([
      { key: "pa_couleur", reason: "detached", variations: [9001, 9002], options: [] },
    ]);
  });

  it("reports an axis demoted back to a spec", () => {
    const losses = mappingLosses(
      PARENT_ATTRIBUTES,
      withRole(PARENT_ATTRIBUTES, "pa_couleur", false),
      variations,
    );

    expect(losses[0].reason).toBe("no-longer-variation");
    expect(losses[0].variations).toEqual([9001, 9002]);
  });

  it("reports only the rows using an option that was un-ticked", () => {
    const narrowed = withOption(PARENT_ATTRIBUTES, "pa_couleur", "bleu", false, ["rouge", "bleu"]);
    const losses = mappingLosses(PARENT_ATTRIBUTES, narrowed, variations);

    expect(losses).toEqual([
      { key: "pa_couleur", reason: "option-removed", variations: [9002], options: ["bleu"] },
    ]);
  });

  /** Un-ticking a term nothing carries is free, and warning about it would train the warning away. */
  it("says nothing when the removed option is unused", () => {
    const unused = [attributeRow({ options: ["rouge", "bleu", "vert"] })];
    const narrowed = withOption(unused, "pa_couleur", "vert", false, ["rouge", "bleu", "vert"]);

    expect(mappingLosses(unused, narrowed, variations)).toEqual([]);
  });

  /** A spec has no variations by definition — no key a variation carries can be one. */
  it("says nothing about detaching a spec", () => {
    expect(mappingLosses(PARENT_ATTRIBUTES, detach(PARENT_ATTRIBUTES, "pa_matiere"), variations)).toEqual([]);
  });

  /**
   * WooCommerce's *any*. `guardAttributes()` skips an empty value explicitly, so
   * a wildcard row depends on no particular option and cannot be orphaned by one
   * being removed — and it must not be counted as a carrier when the axis goes
   * either.
   */
  it("does not count a row whose value is any", () => {
    const wildcard = [variation({ attributes: { pa_couleur: "" } })];
    expect(mappingLosses(PARENT_ATTRIBUTES, detach(PARENT_ATTRIBUTES, "pa_couleur"), wildcard)).toEqual([]);
  });

  it("says nothing when the product has no variations at all", () => {
    expect(mappingLosses(PARENT_ATTRIBUTES, detach(PARENT_ATTRIBUTES, "pa_couleur"), [])).toEqual([]);
  });

  /** Promoting a spec has nothing to lose yet — the check is against `current`. */
  it("says nothing about an attribute being promoted in the same save", () => {
    expect(
      mappingLosses(PARENT_ATTRIBUTES, withRole(PARENT_ATTRIBUTES, "pa_matiere", true), variations),
    ).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════ generate combinations ═══ */

describe("the combination grid", () => {
  /**
   * `VariationRepository::normalizeCombination()` runs `ksort()`, and the API
   * compares two combinations with `===` on PHP arrays, which is order-sensitive.
   * A panel that compared unsorted would report every existing row as missing and
   * offer to generate a duplicate of the whole table.
   */
  it("keys a combination independently of insertion order and case", () => {
    expect(combinationKey({ pa_couleur: "Rouge", pa_taille: "M" })).toBe(
      combinationKey({ pa_taille: "m", pa_couleur: "rouge" }),
    );
    // …and `attribute_` is stripped, which is the other half of the normaliser.
    expect(combinationKey({ attribute_pa_couleur: "rouge" })).toBe(
      combinationKey({ pa_couleur: "rouge" }),
    );
  });

  it("drops an axis with no terms chosen rather than zeroing the grid", () => {
    const axes = axesOf([attributeRow(), attributeRow({ id: 3, name: "pa_taille", options: [] })]);
    expect(axes.map((axis) => axis.key)).toEqual(["pa_couleur"]);
    expect(combinationsOf(axes)).toHaveLength(2);
  });

  it("takes only the attributes marked as variants", () => {
    expect(axesOf(PARENT_ATTRIBUTES).map((axis) => axis.key)).toEqual(["pa_couleur"]);
  });

  it("counts the whole grid and only the missing cells", () => {
    const twoAxes = [
      attributeRow({ options: ["rouge", "bleu"] }),
      attributeRow({ id: 3, name: "pa_taille", options: ["s", "m", "l"], variation: true, position: 1 }),
    ];
    const held = [variation({ attributes: { pa_couleur: "rouge", pa_taille: "s" } })];
    const plan = planGeneration(twoAxes, held);

    expect(plan.total).toBe(6);
    expect(plan.missing).toHaveLength(5);
    expect(plan.missing.map(combinationKey)).not.toContain(
      combinationKey({ pa_couleur: "rouge", pa_taille: "s" }),
    );
    expect(plan.refusal).toBeNull();
  });

  /**
   * A wildcard row covers **no** cell: `guardDuplicateCombination()` compares the
   * whole normalised map, so `{couleur: ""}` and `{couleur: "rouge"}` are
   * different combinations and generating the second beside the first is
   * accepted. Counted and reported rather than silently ignored, because the
   * result is two rows a shopper could match at once and no error anywhere.
   */
  it("counts a wildcard row as covering nothing, and says how many there are", () => {
    const plan = planGeneration([attributeRow()], [variation({ attributes: { pa_couleur: "" } })]);

    expect(plan.wildcards).toBe(1);
    expect(plan.missing).toHaveLength(2);
  });

  it("refuses with a reason rather than an empty plan", () => {
    expect(planGeneration(PARENT_ATTRIBUTES.slice(1), []).refusal).toBe("no-axes");
    expect(
      planGeneration([attributeRow({ options: ["rouge"] })], [variation()]).refusal,
    ).toBe("nothing-missing");
  });

  /**
   * **The cap.** There is no ceiling anywhere in the API — `VariationController`
   * registers no count guard, `VariationService::create()` enforces only a
   * duplicate combination and a duplicate SKU, and the list read is unpaginated —
   * so the panel is the only thing between a shopkeeper and `OptionSet`'s 7,776.
   * 50 is `OptionSet::MAX_CHOICES`, borrowed rather than invented.
   */
  it("caps a single press at OptionSet's own choice limit", () => {
    expect(COMBINATION_CAP).toBe(50);

    const wide = [
      attributeRow({ options: Array.from({ length: 51 }, (_, i) => `c${i}`) }),
    ];
    const plan = planGeneration(wide, []);

    expect(plan.total).toBe(51);
    expect(plan.missing).toHaveLength(51);
    expect(plan.refusal).toBe("over-cap");
  });

  /** Exactly at the cap is allowed: the refusal is `> CAP`, not `>=`. */
  it("allows a run of exactly the cap", () => {
    const atCap = [
      attributeRow({ options: Array.from({ length: COMBINATION_CAP }, (_, i) => `c${i}`) }),
    ];
    expect(planGeneration(atCap, []).refusal).toBeNull();
  });

  /**
   * The cap is on **what one press creates**, not on how many variations a
   * product may have: a product with sixty rows and three gaps fills the three.
   * The cost being guarded is sixty sequential writes from one click.
   */
  it("does not refuse a small run on a product that already has many rows", () => {
    const axis = [attributeRow({ options: ["rouge", "bleu", "vert"] })];
    const held = [
      variation({ id: 1, attributes: { pa_couleur: "rouge" } }),
      variation({ id: 2, attributes: { pa_couleur: "bleu" } }),
    ];
    const plan = planGeneration(axis, held);

    expect(plan.missing).toHaveLength(1);
    expect(plan.refusal).toBeNull();
  });

  /**
   * `attributes` and nothing else. A generated row arrives with no price, no SKU
   * and no stock, which is the honest state — a price the panel invented is a
   * price somebody ships at — and a made-up SKU would 409 the moment it collided.
   */
  it("creates a row with the combination alone", () => {
    expect(variationCreateBody({ pa_couleur: "rouge" })).toEqual({
      attributes: { pa_couleur: "rouge" },
    });
  });

  /**
   * **The abandon rule.** The two parent-level 409s refuse every combination —
   * *"Only variable products have variations"* carries `details.type` and *"The
   * parent product has no attributes marked for variations"* carries no details
   * at all — while the two row-level ones name what they collided with. Firing
   * the remaining forty-nine on a parent-level refusal is forty-nine identical
   * failures behind a progress bar.
   */
  it("tells a parent-level refusal from a row-level one", () => {
    expect(isParentRefusal(409, {})).toBe(true);
    expect(isParentRefusal(409, { type: "simple" })).toBe(true);
    expect(isParentRefusal(409, { variation_id: 9001 })).toBe(false);
    expect(isParentRefusal(409, { sku: "AC-1" })).toBe(false);
    // A 400 is always about the one body that was sent.
    expect(isParentRefusal(400, {})).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════ one table row ═══ */

const draftOf = (over: Partial<VariationDraft> = {}): VariationDraft => ({
  ...variationDraftFrom(variation()),
  ...over,
});

describe("a variation row is the unit of dirt and of saving", () => {
  it("is clean against the row the API returned", () => {
    const row = variation();
    expect(variationUpdateBody(row, variationDraftFrom(row))).toBeNull();
    expect(rowDirty(row, variationDraftFrom(row))).toBe(false);
  });

  it("sends only what changed", () => {
    expect(variationUpdateBody(variation(), draftOf({ regular_price: "1200" }))).toEqual({
      regular_price: "1200",
    });
  });

  /**
   * A price rides **as typed** and never through `Number()`. `VariationInput`
   * runs `is_numeric()` and refuses what fails it with a sentence naming the
   * value; a cast would turn `"12a"` into `NaN`, which `JSON.stringify` writes as
   * `null`, and `null` on a price field is the API's *clear it*.
   */
  it("keeps a typo reachable rather than casting it into a clear", () => {
    expect(variationUpdateBody(variation(), draftOf({ regular_price: "12a" }))).toEqual({
      regular_price: "12a",
    });
  });

  /**
   * `stock_quantity` rides with `manage_stock` or not at all. The two are one
   * fact about a shelf: `VariationRepository::apply()` calls the setter
   * unconditionally, so a count sent for a row that manages no stock is a number
   * nothing reads and a save that looked like it worked.
   */
  it("drops the quantity when the row manages no stock", () => {
    const body = variationUpdateBody(
      variation(),
      draftOf({ manage_stock: false, stock_quantity: "12" }),
    );
    expect(body).toEqual({ manage_stock: false });
  });

  /** An empty box is `null` — nothing being counted, which is not a count of zero. */
  it("sends null for an emptied quantity and 0 for a counted zero", () => {
    expect(variationUpdateBody(variation(), draftOf({ stock_quantity: "" }))).toEqual({
      stock_quantity: null,
    });
    expect(variationUpdateBody(variation(), draftOf({ stock_quantity: "0" }))).toEqual({
      stock_quantity: 0,
    });
  });

  it("reads a null quantity back as an empty box, not as zero", () => {
    const unmanaged = variation({ manage_stock: false, stock_quantity: null });
    expect(variationDraftFrom(unmanaged).stock_quantity).toBe("");
  });

  /** The row's identity is never rewritten in place: no `attributes` key. */
  it("never sends the combination", () => {
    const body = variationUpdateBody(variation(), draftOf({ sku: "AC-1", status: "private" }));
    expect(Object.keys(body ?? {}).sort()).toEqual(["sku", "status"]);
  });
});

/**
 * The one refusal the table makes on its own, and deliberately the only one.
 *
 * Two rows of the same table typing the same SKU is knowable without asking and
 * is a certain 409 — `guardSku()` → `skuExists()` → `wc_get_product_id_by_sku()`,
 * whose index covers variations as well as products. Catching it here marks
 * **both** rows, which the 409 cannot: the API names the SKU and the row it
 * refused, and has no idea the clash is with an unsaved sibling three lines up.
 */
describe("localSkuClashes", () => {
  const map = (entries: [number, string][]) =>
    new Map(entries.map(([id, sku]) => [id, draftOf({ sku })]));

  it("marks both rows of a clash", () => {
    expect(localSkuClashes(map([[1, "AC-1"], [2, "AC-1"], [3, "AC-2"]]))).toEqual(
      new Set([1, 2]),
    );
  });

  /** MySQL's default collation is case-insensitive, and so is the trim. */
  it("compares trimmed and case-insensitively", () => {
    expect(localSkuClashes(map([[1, "ac-1"], [2, " AC-1 "]]))).toEqual(new Set([1, 2]));
  });

  /**
   * `guardSku()` returns early for `''`, and a variation inheriting its parent's
   * SKU is the ordinary state of the first row of every variable product in this
   * shop — so an empty SKU never collides.
   */
  it("never marks an empty SKU", () => {
    expect(localSkuClashes(map([[1, ""], [2, ""], [3, "   "]]))).toEqual(new Set());
  });
});

/* ══════════════════════════════════════════════════════════════ the copies ═══ */

/**
 * The two locales, on the namespaces these screens read.
 *
 * ADMIN_PANEL.md's rule is that French and Arabic stay exactly in sync, and a
 * missing Arabic key does not fail a render — `next-intl` falls back to printing
 * the key path, which is a visible defect only in the locale fewer of the people
 * writing this can read.
 */
describe("both locales resolve every key the variable-product screens use", () => {
  const namespaces = ["products"] as const;

  it("is at exact key parity", () => {
    for (const namespace of namespaces) {
      const a = flatKeys((fr as Record<string, unknown>)[namespace]).sort();
      const b = flatKeys((ar as Record<string, unknown>)[namespace]).sort();
      expect(a, namespace).toEqual(b);
    }
  });

  /**
   * The three loss reasons are rendered through `t("loss.{reason}")`, so a
   * missing one prints the key path inside a destructive confirmation — the one
   * dialog on this branch whose whole job is to be read.
   */
  it("names every mapping-loss reason in both", () => {
    for (const messages of [fr, ar]) {
      const loss = (messages as unknown as {
        products: { variants: { loss: Record<string, string> } };
      }).products.variants.loss;

      expect(Object.keys(loss).sort()).toEqual([
        "detached",
        "no-longer-variation",
        "option-removed",
      ]);
    }
  });

  /**
   * The counted sentences, checked for the placeholder they are built on.
   * `{{count}}` parses as a literal brace plus a placeholder plus a literal brace
   * and `next-intl` throws `INVALID_MESSAGE`, rendering the key path as visible
   * text — presence is not validity.
   */
  it("carries a usable placeholder in every counted sentence", () => {
    const counted: [string, string][] = [
      ["variants.generate", "count"],
      ["variants.outcome", "created"],
      ["variants.wildcards", "count"],
      ["variants.grid", "total"],
      ["duplicate.done", "count"],
    ];

    for (const messages of [fr, ar]) {
      const block = (messages as Record<string, unknown>).products as Record<string, unknown>;

      for (const [path, placeholder] of counted) {
        const [group, key] = path.split(".");
        const sentence = (block[group] as Record<string, string>)[key];

        expect(sentence, path).toBeTruthy();
        expect(sentence, path).toContain(`{${placeholder},`);
        expect(sentence, path).not.toContain(`{{${placeholder}`);
      }
    }
  });

  /**
   * **The word "variation" must not appear in the role control**, which is the
   * whole of the spec-versus-variant decision: WooCommerce's flag is called
   * `variation` and putting that on screen is a sentence about the software.
   * The two options name their outcomes instead.
   */
  it("never labels the role control with the API's own flag name", () => {
    for (const messages of [fr, ar]) {
      const variants = (messages as unknown as {
        products: { variants: Record<string, string> };
      }).products.variants;

      for (const key of ["roleSpec", "roleVariant", "roleSpecWhy", "roleVariantWhy"]) {
        expect(variants[key].toLowerCase(), key).not.toContain("variation:");
      }
      // And each option says what it *does*, so neither is a bare noun.
      expect(variants.roleSpecWhy.length).toBeGreaterThan(20);
      expect(variants.roleVariantWhy.length).toBeGreaterThan(20);
    }
  });
});
