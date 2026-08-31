import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_ORDER_BY,
  MAX_SLUG_BYTES,
  TERMS_PER_PAGE,
  attributeCreateBody,
  attributeUpdateBody,
  blankRequired,
  detachCount,
  draftFromAttribute,
  draftFromTerm,
  normaliseSlug,
  slugBytes,
  slugTooLong,
  splitFieldErrors,
  termCreateBody,
  termUpdateBody,
  willDetach,
} from "@/app/[locale]/(panel)/attributes/attribute-write";
import type { AttributeTerm, GlobalAttributeDetail } from "@/lib/api/schemas/product";
import { NAV } from "@/components/ui/nav-tree";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * Every leaf key under a namespace, as a dotted path.
 *
 * A fourth copy of `tests/admin-schema.test.ts`'s helper rather than an import,
 * on `tests/new-order.test.ts`'s argument: a test file importing another test
 * file's private helper couples two suites that have nothing else to say to each
 * other, and this is four lines.
 */
function flatKeys(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix];

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatKeys(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

const attribute = (over: Partial<GlobalAttributeDetail> = {}): GlobalAttributeDetail => ({
  id: 1,
  name: "Matière",
  slug: "matiere",
  taxonomy: "pa_matiere",
  type: "select",
  order_by: "menu_order",
  has_archives: false,
  term_count: 6,
  product_count: 7,
  ...over,
});

const term = (over: Partial<AttributeTerm> = {}): AttributeTerm => ({
  id: 1000,
  name: "Laine",
  slug: "laine",
  description: "",
  menu_order: 0,
  count: 2,
  ...over,
});

/**
 * The bodies the attributes screen sends, and what it refuses to send.
 *
 * Every claim asserted here about the API is one of two things and the case says
 * which: **read from source** in `ecom-temp/wp-content/plugins/algerian-commerce-core`,
 * cited by `file:symbol`, or **measured in process through `rest_do_request()`**
 * on 2026-08-30 — the plugin's own suite `tests/Api/attributes.php` (59 passed,
 * 0 failed) or a probe against the same install. Nothing was measured over live
 * HTTP; `BLOCKED.md` records the 401.
 */
describe("the attribute write bodies", () => {
  it("sends name alone when no slug was typed, so the API derives it", () => {
    // An absent `slug` is the derivation; an **empty** one is a 400 —
    // `GlobalAttributeInput::common()`, *"Must be a non-empty string, or omitted
    // to derive it from the name."* So the key has to disappear, not blank out.
    expect(attributeCreateBody({ name: "  Couleur  ", slug: "  " })).toEqual({ name: "Couleur" });
    expect(attributeCreateBody({ name: "Couleur", slug: "coul" })).toEqual({
      name: "Couleur",
      slug: "coul",
    });
  });

  /**
   * **`type` is never sent, and that is a measurement rather than an omission.**
   *
   * `AttributeService::guardType()` checks `wc_get_attribute_types()`, a
   * filtered PHP list a plugin can extend; no route publishes it, and the only
   * way a client learns it is by provoking a 400 and reading
   * `details.available_types`. On this shop that list is `["select"]` — one
   * value — so a control would be a choice of one, and a hard-coded several
   * would be a vocabulary the panel cannot check.
   *
   * `order_by` and `has_archives` are absent for the create form's own rule: a
   * field the form does not draw must not reach the wire. Both are on the detail
   * form, where there is room to say what they do.
   */
  it("never sends type, order_by or has_archives on a create", () => {
    const body = attributeCreateBody({ name: "Couleur", slug: "couleur" });
    expect(Object.keys(body).sort()).toEqual(["name", "slug"]);
  });

  /**
   * The `pa_` prefix is **stripped rather than refused**, matching
   * `GlobalAttributeInput`: the API publishes `taxonomy: "pa_matiere"` next to
   * `slug: "matiere"` on every row, so a person copying the wrong one of the two
   * out of the list above is the ordinary mistake, not an abuse.
   */
  it("strips a pa_ prefix from a typed slug rather than refusing it", () => {
    expect(normaliseSlug("pa_matiere")).toBe("matiere");
    expect(normaliseSlug("  PA_Matiere  ")).toBe("matiere");
    // Only leading, and only once: `pa_pa_x` is a slug somebody meant.
    expect(normaliseSlug("x_pa_y")).toBe("x_pa_y");
    expect(normaliseSlug("pa_pa_x")).toBe("pa_x");
  });

  /**
   * ── The byte budget, which is a rule about Arabic ────────────────────────
   *
   * `GlobalAttributeInput::MAX_SLUG_BYTES` is 29 because WordPress caps a
   * taxonomy name at 32 and `pa_` takes three, and `strlen()` counts **bytes**.
   * A Latin letter costs one and an Arabic letter two, so the cap bites at 29
   * French characters and at 14 Arabic ones — which is why this is checked in
   * the panel at all rather than left to the server.
   *
   * The boundary is measured: a 29-byte slug is 201 and a 30-byte slug is 400.
   */
  it("measures the slug budget in bytes, not characters", () => {
    expect(MAX_SLUG_BYTES).toBe(29);
    expect(slugBytes("matiere")).toBe(7);
    // Five characters, ten bytes. `.length` would have said five.
    expect(slugBytes("الطول")).toBe(10);
    expect("الطول".length).toBe(5);

    expect(slugTooLong("a".repeat(29))).toBe(false);
    expect(slugTooLong("a".repeat(30))).toBe(true);
    // Fifteen Arabic characters is thirty bytes — over, where fifteen Latin ones
    // are nowhere near it.
    expect(slugTooLong("ا".repeat(15))).toBe(true);
    expect(slugTooLong("a".repeat(15))).toBe(false);
  });

  /**
   * **`null` when nothing changed, and it is the whole reason this is a
   * function.**
   *
   * `AttributeService::update()` throws `invalidRequest('No supported fields
   * were provided.')` on an empty input, and measured that 400 carries **no
   * `details` key at all** — so a screen reading `details.fields` gets
   * `undefined` and renders an error with nothing in it. The answer is not to
   * handle the refusal but to make the request unsendable: `null` turns the save
   * control off, with a reason (§3.3).
   */
  it("answers null when an edit changed nothing", () => {
    const row = attribute();
    expect(attributeUpdateBody(row, draftFromAttribute(row))).toBeNull();

    // Whitespace is not a change, because the API trims before it compares.
    expect(attributeUpdateBody(row, { ...draftFromAttribute(row), name: "  Matière  " })).toBeNull();

    // And an emptied slug box is not a change either: it means "leave it", not
    // "derive a new one", which on an existing attribute would be a rename.
    expect(attributeUpdateBody(row, { ...draftFromAttribute(row), slug: "" })).toBeNull();
  });

  it("sends only the keys that moved", () => {
    const row = attribute();
    const base = draftFromAttribute(row);

    expect(attributeUpdateBody(row, { ...base, name: "Matériau" })).toEqual({ name: "Matériau" });
    expect(attributeUpdateBody(row, { ...base, slug: "pa_matiere-2" })).toEqual({
      slug: "matiere-2",
    });
    expect(attributeUpdateBody(row, { ...base, has_archives: true })).toEqual({
      has_archives: true,
    });
    expect(attributeUpdateBody(row, { ...base, order_by: "name" })).toEqual({ order_by: "name" });

    // Two at once is one request, because the API takes a partial body and a
    // second PATCH would be a second `wc_update_attribute()` — which migrates
    // every product's meta.
    expect(attributeUpdateBody(row, { ...base, name: "X", order_by: "id" })).toEqual({
      name: "X",
      order_by: "id",
    });
  });

  /**
   * `GlobalAttributeInput::ORDER_BY`, *"WooCommerce's own list, hard-coded
   * inside `wc_create_attribute()`"* — and measured, the refusal for anything
   * else is `Must be one of: menu_order, name, name_num, id.`
   *
   * Copied from the plugin's constant rather than from WooCommerce so the panel
   * refuses exactly what the API refuses; asserted here so a re-ordering or a
   * fifth value cannot arrive silently.
   */
  it("offers exactly the four order_by values the API takes", () => {
    expect([...ATTRIBUTE_ORDER_BY]).toEqual(["menu_order", "name", "name_num", "id"]);
  });

  /**
   * A stored `order_by` outside the four is possible — nothing stops a plugin
   * writing the column — so it is checked rather than cast, and falls back to
   * `AttributeService::create()`'s own default. A cast would put a value in the
   * select that the select cannot show and that the API would then refuse.
   */
  it("falls back to menu_order for a stored value outside the vocabulary", () => {
    expect(draftFromAttribute(attribute({ order_by: "sideways" })).order_by).toBe("menu_order");
    expect(draftFromAttribute(attribute({ order_by: "name_num" })).order_by).toBe("name_num");
  });
});

describe("the term write bodies", () => {
  it("sends name alone when no slug was typed", () => {
    expect(termCreateBody({ name: "  Rouge  ", slug: "" })).toEqual({ name: "Rouge" });
    expect(termCreateBody({ name: "Rouge", slug: "rouge-vif" })).toEqual({
      name: "Rouge",
      slug: "rouge-vif",
    });
  });

  /**
   * `menu_order` is writable and the rows carry it, and it is **not sent**:
   * nothing on this screen reorders terms, and the attribute's own `order_by`
   * decides the storefront's order. A key the form does not draw must not reach
   * the wire — the rule `ProductDetail`'s draft docblock spends a paragraph on.
   */
  it("never sends menu_order, which no control on this screen sets", () => {
    expect(Object.keys(termCreateBody({ name: "Rouge", slug: "r" }))).not.toContain("menu_order");
    expect(
      Object.keys(termUpdateBody(term(), { name: "Rouge", slug: "laine", description: "" }) ?? {}),
    ).not.toContain("menu_order");
  });

  it("answers null when a term edit changed nothing", () => {
    const row = term({ description: "Chaude" });
    expect(termUpdateBody(row, draftFromTerm(row))).toBeNull();
  });

  /**
   * **Clearing a description is a real edit.** `AttributeTermInput` accepts
   * `null` and an empty string and stores `''` for both, so a person who deletes
   * the text meant it — unlike an emptied `name` or `slug`, each of which is a
   * certain 400 (*"Must be a non-empty string."*).
   *
   * This case found the defect it now guards: `name: ""` was reaching the body,
   * because an empty string genuinely differs from the stored name. The API
   * would have refused it every time, so the panel was spending a request to be
   * told something it already knew — and the fix is two-sided, because omitting
   * the key alone would turn "I cleared the name" into a save that quietly did
   * nothing. See `blankRequired()`.
   */
  it("sends an emptied description and never an emptied name or slug", () => {
    const row = term({ description: "Chaude" });
    expect(termUpdateBody(row, { name: row.name, slug: row.slug, description: "" })).toEqual({
      description: "",
    });
    expect(termUpdateBody(row, { name: "", slug: "", description: "Chaude" })).toBeNull();
    // …and the same on the attribute grain, which had the identical defect.
    const row2 = attribute();
    expect(attributeUpdateBody(row2, { ...draftFromAttribute(row2), name: "   " })).toBeNull();
  });

  /**
   * The control's half of the same rule. `attributeUpdateBody()` answering
   * `null` stops the request; this stops the button, so the two together mean a
   * cleared required box can neither be sent nor look saved (§3.3).
   */
  it("reports a cleared required box so the control can say why", () => {
    expect(blankRequired("")).toBe(true);
    expect(blankRequired("   ")).toBe(true);
    expect(blankRequired(" Laine ")).toBe(false);
  });
});

/**
 * ── The refusal keys, which are the reason the screens have a banner ─────────
 */
describe("splitting a refusal into what a control can wear", () => {
  /**
   * **This test used to assert the opposite and the change is the point.**
   * `AttributeRepository::fromWpError()` filed every non-conflict `WP_Error`
   * under `details.fields.attribute` — a key no control has — so WooCommerce's
   * own slug refusals rendered nowhere, and this suite asserted that the split
   * rescued them into the banner. The fix round's item 8 fixed it at the source:
   * the code now names the field, so those two sentences arrive under `slug` or
   * `name` and belong under a box.
   *
   * Which of the two is decided by the payload rather than by the refusal.
   * `wc_create_attribute()` derives the slug from the *name* when none is
   * stated, then refuses what it derived — so the person who left the slug box
   * empty is pointed at the label that produced it. Measured through
   * `rest_do_request()` after the change (`tests/Api/attributes.php`, **64
   * passed, 0 failed**):
   *
   *     {"name": "Type"}                 → fields.name
   *     {"name": "Type", "slug": "type"} → fields.slug
   */
  it("binds WooCommerce's own slug refusals, which now name a real control", () => {
    const stated = splitFieldErrors(
      { slug: 'Slug "type" is not allowed because it is a reserved term. Change it, please.' },
      ["name", "slug"],
    );
    expect(stated.bound.slug).toContain("reserved term");
    expect(stated.loose).toEqual([]);

    const derived = splitFieldErrors(
      { name: 'Slug "longueurlongueur…" is too long. Please use a shorter slug.' },
      ["name", "slug"],
    );
    expect(derived.bound.name).toContain("too long");
    expect(derived.loose).toEqual([]);
  });

  /**
   * And the reason the split is kept rather than deleted with the defect that
   * motivated it: `ProductAttributes.tsx` binds `["attributes"]` against
   * `AttributeInput::listFromPayload()`, which reports **per entry** — so its
   * keys can never match and `loose` is structurally load-bearing there. That
   * screen was never affected by `fromWpError()` at all.
   */
  it("still rescues a per-entry key that no bare control name can match", () => {
    const { bound, loose } = splitFieldErrors(
      { "attributes[0].options": "At least one option is required." },
      ["attributes"],
    );
    expect(bound).toEqual({});
    expect(loose[0]).toContain("At least one option");
  });

  it("binds a plain field refusal to its control and reports both at once", () => {
    // **A 400 lists every bad field at once** — the reason `BrowserApiError`
    // keeps `fields` intact rather than flattening to one string.
    const { bound, loose } = splitFieldErrors(
      { name: "Must be a non-empty string.", slug: "Must be at most 29 bytes…" },
      ["name", "slug"],
    );
    expect(bound.name).toBe("Must be a non-empty string.");
    expect(bound.slug).toBe("Must be at most 29 bytes…");
    expect(loose).toEqual([]);
  });

  /**
   * The named refusals the panel never provokes — `terms`, `attribute_id`,
   * `attribute_name`, `parent`, `products` — are in the same position as
   * `attribute`: no control has that name, so the message goes on screen rather
   * than being dropped. Seeing one means either this screen has a bug or the API
   * changed, and both are worth a person noticing.
   */
  it("puts a refusal for a key the form never sends on screen rather than dropping it", () => {
    const { bound, loose } = splitFieldErrors(
      { parent: "An attribute taxonomy is flat. …" },
      ["name", "slug", "description"],
    );
    expect(bound).toEqual({});
    expect(loose[0]).toContain("flat");
  });

  /**
   * A **409 has no `fields` at all** — a conflict carries the offending value at
   * the top of `details` (`details.slug`, or `details.term_id` for a duplicate
   * term name) and never under `fields`, which is this API's 400 validation
   * channel. So `null` has to be a shape this function accepts rather than one
   * the caller guards against; it is what lets one `onError` cover a bound 400,
   * a loose 400 and a conflict.
   */
  it("accepts a failure with no fields, which is what a 409 is", () => {
    expect(splitFieldErrors(null, ["name"])).toEqual({ bound: {}, loose: [] });
  });
});

/**
 * ── The delete guards ───────────────────────────────────────────────────────
 */
describe("reading a delete refusal", () => {
  /**
   * Both guards put the count under `details.products` and the two grains carry
   * different companions — measured verbatim:
   *
   *   attribute  {products: 1, product_ids: [7565], taxonomy: "pa_acprobesize"}
   *   term       {products: 1, term_id: 729}
   *
   * `product_ids` is capped at five by `AttributeService::SAMPLE` while
   * `products` is the full count, so the two disagree on a widely-used attribute
   * and reading `product_ids.length` as the number would under-report what a
   * force-delete is about to detach.
   */
  it("reads the count from details.products on both grains", () => {
    expect(detachCount({ products: 7, product_ids: [1, 2, 3, 4, 5], taxonomy: "pa_x" })).toBe(7);
    expect(detachCount({ products: 1, term_id: 729 })).toBe(1);
  });

  it("answers null for a refusal that is not a usage conflict", () => {
    // A duplicate-slug 409 has no details at all, and a validation 400's details
    // are `fields`. Neither is a detach count, and returning 0 for them would
    // make the screen say "nothing will be detached" about a failure that never
    // reached the guard.
    expect(detachCount({})).toBeNull();
    expect(detachCount({ fields: { name: "Required." } })).toBeNull();
    expect(detachCount({ products: "7" })).toBeNull();
  });

  /**
   * The panel holds both numbers before it asks — `product_count` from the
   * single read, `count` on every term row — so the consequence goes in the
   * **first** dialog rather than being discovered from a 409 and asked twice.
   * `CategoriesScreen` has to ask twice because its list cannot be sure of the
   * count; this screen can.
   */
  it("decides from the count the screen already holds", () => {
    expect(willDetach(0)).toBe(false);
    expect(willDetach(1)).toBe(true);
  });
});

describe("the terms request", () => {
  /**
   * `AttributeController::termIndexArgs()` calls
   * `paginationArgs(Response::MAX_PER_PAGE)`, so `per_page` **defaults to 100**
   * on this route where every other collection defaults to 20 — and 100 is also
   * the maximum, measured: `per_page=200` is a 400 saying *"per_page must be
   * between 1 (inclusive) and 100 (inclusive)"*.
   *
   * Sent explicitly rather than left to the default, because the default is a
   * fact about the route a reader of the call site cannot see.
   */
  it("asks for the whole vocabulary, at the route's own ceiling", () => {
    expect(TERMS_PER_PAGE).toBe(100);
  });
});

/**
 * ── Where the screen lives ──────────────────────────────────────────────────
 */
describe("the navigation entry", () => {
  const entry = NAV.flatMap((group) => group.items).find((item) => item.key === "attributes");

  /**
   * **`ac_manage_products`, the same capability as `products` beside it**, read
   * from `AttributeController::registerRoutes()`: one
   * `Permissions::callback(Capabilities::MANAGE_PRODUCTS)` carries all four
   * routes, and `AttributeService` asserts it again inside every method.
   *
   * Asserted rather than assumed because this file's own docblock records two
   * live defects of exactly this kind — `dashboard` with no capability and
   * `transfer` with the wrong one — each of which rendered a nav row whose only
   * possible outcome was the forbidden screen.
   */
  it("is gated on the capability its routes actually require", () => {
    expect(entry).toBeDefined();
    expect(entry?.capability).toBe("ac_manage_products");
    expect(entry?.href).toBe("/attributes");
  });

  /**
   * It sits in `catalog`, with products and inventory, and **not** under
   * `/products/…`: `isActive()` prefix-matches, so an href of
   * `/products/attributes` would light the Products row at the same time as this
   * one and the sidebar would claim the reader was in two places.
   */
  it("sits in the catalogue group and cannot light another row", () => {
    const catalog = NAV.find((group) => group.key === "catalog");
    expect(catalog?.items.map((item) => item.key)).toContain("attributes");
    expect(entry?.href.startsWith("/products")).toBe(false);
  });

  /**
   * `landingPath()` walks `NAV` in order and answers the first destination the
   * reader may open, so an entry inserted before `products` would change where
   * a Product Manager lands after signing in. It is inserted after.
   */
  it("does not become anyone's landing page", () => {
    const catalog = NAV.find((group) => group.key === "catalog");
    const items = catalog?.items.map((item) => item.key) ?? [];
    expect(items.indexOf("attributes")).toBeGreaterThan(items.indexOf("products"));
  });
});

/**
 * The two locales, on the namespaces these screens read.
 *
 * ADMIN_PANEL.md's rule is that French and Arabic stay exactly in sync, and a
 * missing Arabic key does not fail a render — `next-intl` falls back to printing
 * the key path, which is a visible defect only in the locale fewer of the people
 * writing this can read.
 */
describe("both locales resolve every key the attributes screens use", () => {
  const namespaces = ["attributes", "nav"] as const;

  it("is at exact key parity", () => {
    for (const namespace of namespaces) {
      const a = flatKeys((fr as Record<string, unknown>)[namespace]).sort();
      const b = flatKeys((ar as Record<string, unknown>)[namespace]).sort();
      expect(a, namespace).toEqual(b);
    }
  });

  it("names the nav entry in both", () => {
    expect(fr.nav.attributes).toBeTruthy();
    expect(ar.nav.attributes).toBeTruthy();
    expect(fr.nav.attributes).not.toBe(ar.nav.attributes);
  });

  /**
   * The four `order_by` values are rendered through `t("orderByOption.{value}")`,
   * so a missing one prints the key path inside a select — a control showing
   * `attributes.orderByOption.name_num` as an option.
   */
  it("labels every order_by value in both", () => {
    for (const messages of [fr, ar]) {
      const options = (messages as unknown as {
        attributes: { orderByOption: Record<string, string> };
      }).attributes.orderByOption;

      for (const value of ATTRIBUTE_ORDER_BY) {
        expect(options[value], value).toBeTruthy();
      }
      // And nothing else: a fifth label would be a value the API refuses.
      expect(Object.keys(options).sort()).toEqual([...ATTRIBUTE_ORDER_BY].sort());
    }
  });

  /**
   * The counted sentences, checked for the placeholder they are built on.
   * `{{count}}` parses as a literal brace plus a placeholder plus a literal
   * brace and `next-intl` throws `INVALID_MESSAGE`, rendering the key path as
   * visible text — presence is not validity.
   */
  it("carries a usable placeholder in every counted sentence", () => {
    for (const messages of [fr, ar]) {
      const block = (messages as unknown as { attributes: Record<string, string> }).attributes;

      for (const key of [
        "termUsedBy",
        "deleteDetach",
        "termDeleteDetach",
        "deletedDetached",
        "termDeletedDetached",
      ] as const) {
        expect(block[key], key).toContain("{count");
        expect(block[key], key).not.toContain("{{");
      }

      expect(block.usage).toContain("{terms");
      expect(block.usage).toContain("{products");
      expect(block.termsTruncated).toContain("{shown");
      expect(block.termsTruncated).toContain("{total");
      expect(block.count).toContain("{total");
    }
  });

  /**
   * **The sentences a person reads before an irreversible act**, present in both
   * and non-empty. Each of these is the panel telling the truth about something
   * the API does silently: a delete detaches products and breaks variations with
   * no error, and a slug change strands every bookmark and saved filter.
   */
  it("carries the whole warning vocabulary in both", () => {
    for (const messages of [fr, ar]) {
      const block = (messages as unknown as { attributes: Record<string, string> }).attributes;

      for (const key of [
        "slugWarning",
        "slugChanged",
        "termSlugChanged",
        "deleteTitle",
        "deleteBody",
        "deleteConfirmLabel",
        "termDeleteTitle",
        "termDeleteBody",
        "slugTooLong",
        "termSlugHint",
        "typeHint",
        "listNote",
        "saveBlocked",
      ] as const) {
        expect(block[key], key).toBeTruthy();
      }
    }
  });
});
