/**
 * @vitest-environment node
 *
 * Each of these pins a fact measured against the live API on 2026-08-18. They
 * are regression tests for silent bugs — the kind where nothing throws, nothing
 * fails to typecheck, and the number on screen is simply wrong.
 *
 * The facet tests in particular exist because the first implementation of the
 * merge below rendered `0` beside all six categories in a shop where the API had
 * just reported 15, 3, 3, 3, 2 and 2. It compiled, it typechecked, and only a
 * screenshot showed it.
 */
import { describe, expect, it } from "vitest";
import {
  BY_SLUG,
  BY_TERM_ID,
  categoryVocabulary,
  effectivePrice,
  isDiscounted,
  mergeFacet,
  priceSpan,
  stockQuantity,
  termVocabulary,
  truncation,
} from "@/lib/products";
import { DEFAULT_SORT_KEY, SORTS, sortFromKey, sortKey } from "@/lib/product-status";
import {
  EMPTY_QUERY,
  isFiltered,
  queryFromParams,
  readAttributes,
  toApiParams,
  toUrlParams,
} from "@/app/[locale]/(panel)/products/query";
import { product as productSchema } from "@/lib/api/schemas/product";
import { embeddedImageSrc } from "@/lib/cms";
import type { FacetValue } from "@/lib/api/schemas/product";
import type { Product } from "@/lib/api/schemas/product";

const facetValue = (
  slug: string,
  count: number,
  term_id?: number,
): FacetValue => ({ slug, name: slug, count, ...(term_id ? { term_id } : {}) });

/** Only the fields the helper under test reads; the schema is loose by design. */
const productLike = (fields: Partial<Product>): Product =>
  ({
    price: "",
    regular_price: "",
    sale_price: "",
    on_sale: false,
    manage_stock: false,
    stock_quantity: null,
    ...fields,
  }) as Product;

describe("the facet merge", () => {
  /**
   * The measurement: `pa_matiere` carries six terms and one of them ("Cuir") is
   * on no product, so the facet group reports five values and `total_values: 5`.
   * docs/ADMIN_PANEL.md requires every value to render, zero-count ones included,
   * so a selection never turns its siblings into a dead end — which means the
   * panel has to supply the zero, because the API does not.
   */
  it("renders a value the facet omitted, as a zero", () => {
    const vocabulary = termVocabulary([
      { id: 1, name: "Laine", slug: "laine", description: "", menu_order: 0, count: 3 },
      { id: 2, name: "Cuir", slug: "cuir", description: "", menu_order: 0, count: 0 },
    ]);

    const merged = mergeFacet(vocabulary, [facetValue("laine", 3)], {
      selfNarrowed: false,
      keyOf: BY_SLUG,
    });

    expect(merged).toHaveLength(2);
    expect(merged.find((o) => o.value === "cuir")).toEqual({
      value: "cuir",
      label: "Cuir",
      count: 0,
    });
  });

  /**
   * The bug this parameter exists to prevent, as a test.
   *
   * A facet value carries both `slug` and `term_id`, and the two dimensions want
   * different ones: `?attributes[pa_matiere]=laine` matches slugs while
   * `?category=16` matches ids — `?category=tapis` is a 400 whose message is the
   * pattern `^$|^[0-9]+(,[0-9]+)*$`. Keying categories by slug produced six
   * zeroes and no error.
   */
  it("keys categories by term id, not by slug", () => {
    const vocabulary = categoryVocabulary([
      { id: 16, name: "Tapis et Textiles", slug: "tapis", parent: 0, description: "", count: 3 },
      { id: 18, name: "Épicerie Fine", slug: "epicerie", parent: 0, description: "", count: 3 },
    ]);

    const merged = mergeFacet(
      vocabulary,
      [facetValue("tapis", 3, 16), facetValue("epicerie", 3, 18)],
      { selfNarrowed: false, keyOf: BY_TERM_ID },
    );

    expect(merged.map((o) => o.count)).toEqual([3, 3]);

    // The control: keyed by slug against an id vocabulary, every count is zero
    // and nothing complains. This is the failure mode, pinned.
    const wrong = mergeFacet(
      vocabulary,
      [facetValue("tapis", 3, 16), facetValue("epicerie", 3, 18)],
      { selfNarrowed: false, keyOf: BY_SLUG },
    );
    expect(wrong.map((o) => o.count)).toEqual([0, 0]);
  });

  /**
   * Measured: with `?category=16` the category group collapses to `tapis=3` and
   * `total_values: 1` — it does **not** exclude its own filter, unlike the
   * attribute groups, `stock_status` and `price`, which all do. Rendering the
   * unselected categories as zero would be the dead end the rule forbids, so
   * they fall back to their unfiltered count.
   */
  it("falls back to the unfiltered count for a group the API narrowed by its own filter", () => {
    const vocabulary = categoryVocabulary([
      { id: 16, name: "Tapis", slug: "tapis", parent: 0, description: "", count: 3 },
      { id: 18, name: "Épicerie", slug: "epicerie", parent: 0, description: "", count: 3 },
      { id: 19, name: "Bijoux", slug: "bijoux", parent: 0, description: "", count: 2 },
    ]);

    const merged = mergeFacet(vocabulary, [facetValue("tapis", 3, 16)], {
      selfNarrowed: true,
      keyOf: BY_TERM_ID,
    });

    expect(merged.map((o) => [o.label, o.count])).toEqual([
      ["Tapis", 3],
      ["Épicerie", 3],
      ["Bijoux", 2],
    ]);
  });

  it("reports a zero for an attribute value the facet dropped, because those groups do exclude their own filter", () => {
    const vocabulary = termVocabulary([
      { id: 1, name: "Laine", slug: "laine", description: "", menu_order: 0, count: 3 },
      { id: 2, name: "Argent", slug: "argent", description: "", menu_order: 0, count: 2 },
    ]);

    const merged = mergeFacet(vocabulary, [facetValue("laine", 1)], {
      selfNarrowed: false,
      keyOf: BY_SLUG,
    });

    expect(merged.map((o) => o.count)).toEqual([1, 0]);
  });
});

describe("truncation", () => {
  /**
   * Measured with a throwaway 60-term attribute: the group came back with 50
   * values, `total_values: 60` and `truncated: true`. "50 sur 60" is the line;
   * a bounded list that does not say so reads as complete.
   */
  it("reports what was shown against what exists, once truncated", () => {
    expect(
      truncation({
        values: Array.from({ length: 50 }, (_, i) => facetValue(`cap-${i}`, 1)),
        total_values: 60,
        truncated: true,
      }),
    ).toEqual({ shown: 50, total: 60 });
  });

  it("says nothing when the group is complete", () => {
    expect(
      truncation({ values: [facetValue("laine", 3)], total_values: 1, truncated: false }),
    ).toBeNull();
    expect(truncation(undefined)).toBeNull();
  });
});

describe("price", () => {
  /**
   * Measured on AC-SEO-NOPRICE: a published product with `price: ""` and
   * `regular_price: ""`. WooCommerce's lookup table stores its `min_price` as
   * `0.0000`, which is why the price facet's floor is `0.00` — but a product
   * with no price is not a free product, and the row must not say it is.
   */
  it("distinguishes no price from a price of zero", () => {
    expect(effectivePrice(productLike({ price: "", regular_price: "" }))).toBeNull();
    expect(effectivePrice(productLike({ price: "0", regular_price: "0" }))).toBe("0");
  });

  /**
   * A variable product's own `regular_price` is `""` while `price` carries the
   * resolved figure — measured on both variable products in the catalogue.
   */
  it("reads the API's resolved price on a variable product", () => {
    expect(effectivePrice(productLike({ price: "12500", regular_price: "" }))).toBe("12500");
  });

  it("only strikes through a regular price when there is a sale price to compare it with", () => {
    expect(
      isDiscounted(productLike({ on_sale: true, sale_price: "190", regular_price: "200" })),
    ).toBe(true);
    // `on_sale` is true on a variable product whose *variation* is discounted,
    // and its own sale_price is empty. Striking through nothing renders a stray
    // line over the only price on the row.
    expect(
      isDiscounted(productLike({ on_sale: true, sale_price: "", regular_price: "" })),
    ).toBe(false);
  });

  it("gives a span only when the variations actually disagree", () => {
    expect(priceSpan(["17500", "17500", "18500"])).toEqual({ min: "17500", max: "18500" });
    expect(priceSpan(["17500", "17500"])).toBeNull();
    expect(priceSpan(["17500"])).toBeNull();
    // An empty price is not a zero, and must not drag the floor to it.
    expect(priceSpan(["", "12500", "16900"])).toEqual({ min: "12500", max: "16900" });
  });
});

describe("stock", () => {
  /**
   * 8 of 28 products do not manage stock, and `stock_quantity` is null on every
   * one of them. Measured too: `stock_quantity` is silently **dropped** by a
   * PATCH when `manage_stock` is false — a 200 with the field ignored.
   */
  it("has no quantity when the product does not manage stock", () => {
    expect(stockQuantity(productLike({ manage_stock: false, stock_quantity: 7 }))).toBeNull();
    expect(stockQuantity(productLike({ manage_stock: true, stock_quantity: 7 }))).toBe(7);
    expect(stockQuantity(productLike({ manage_stock: true, stock_quantity: 0 }))).toBe(0);
  });
});

describe("the query model", () => {
  it("round-trips every filter through the URL", () => {
    const url = new URLSearchParams(
      "search=tapis&sku=AC-TAP&status=draft&category=16,18&tag=5" +
        "&min_price=100&max_price=900&stock_status=instock&on_sale=true&featured=true" +
        "&attributes[pa_matiere]=laine,argent&attributes[pa_couleur]=rouge&sort=price-asc&page=3",
    );
    const query = queryFromParams(url);

    expect(query.search).toBe("tapis");
    expect(query.category).toBe("16,18");
    expect(query.attributes).toEqual({
      pa_matiere: "laine,argent",
      pa_couleur: "rouge",
    });
    /*
     * The page is **not** read from the URL, and a `?page=3` on an incoming link
     * is deliberately ignored. It lives in component state now, matching the
     * orders list — see the docblock in query.ts for why the redesign moved it
     * and what it would take to move it back everywhere at once.
     *
     * Asserted rather than deleted, because "the page is not in the URL" is the
     * fact the round-trip below depends on: a `page` that parsed in and never
     * wrote back out would fail it.
     */
    expect(query.page).toBe(1);
    expect(toUrlParams(query).has("page")).toBe(false);

    // Back out again, unchanged.
    expect(queryFromParams(toUrlParams(query))).toEqual(query);
  });

  it("sends the API's own parameter names, and nothing it did not mean", () => {
    const params = toApiParams({ ...EMPTY_QUERY, status: "draft", minPrice: "100" });

    expect(params.get("status")).toBe("draft");
    expect(params.get("min_price")).toBe("100");
    // An empty filter is not sent. An unknown or empty parameter is ignored with
    // a 200 rather than refused — measured, `?bogus_param=1` returns all 28 rows
    // — so a filter that does nothing looks exactly like one that works.
    expect(params.has("max_price")).toBe(false);
    expect(params.has("search")).toBe(false);
    // `per_page` is always sent and always within range: over 100 is a 400, not
    // a clamp.
    expect(Number(params.get("per_page"))).toBeLessThanOrEqual(100);
    expect(params.get("facets")).toContain("attributes");
  });

  it("writes attributes in the bracketed form the API matches", () => {
    const params = toApiParams({
      ...EMPTY_QUERY,
      attributes: { pa_matiere: "laine", pa_couleur: "" },
    });
    expect(params.get("attributes[pa_matiere]")).toBe("laine");
    // An emptied group is dropped rather than sent blank.
    expect(params.has("attributes[pa_couleur]")).toBe(false);
  });

  it("reads bracketed attribute parameters and ignores everything else", () => {
    expect(
      readAttributes([
        ["attributes[pa_matiere]", "laine"],
        ["attributes[pa_couleur]", ""],
        ["status", "draft"],
        ["attributes", "broken"],
      ]),
    ).toEqual({ pa_matiere: "laine" });
  });

  it("knows when anything is filtered, including one attribute", () => {
    expect(isFiltered(EMPTY_QUERY)).toBe(false);
    // Sort and page are not filters: paging to page 2 must not offer to "clear
    // the filter", because there is none.
    expect(isFiltered({ ...EMPTY_QUERY, page: 4, sort: "price-asc" })).toBe(false);
    expect(isFiltered({ ...EMPTY_QUERY, attributes: { pa_matiere: "laine" } })).toBe(true);
    expect(isFiltered({ ...EMPTY_QUERY, onSale: "true" })).toBe(true);
  });
});

describe("sorting", () => {
  /**
   * The panel offers only the sorts that sort — **six values, both directions**,
   * re-measured 2026-08-25 over the full catalogue and asserted in the backend's
   * own suite against a fixture whose orders are mutually distinct.
   *
   * This test asserted three values until that date, on a real 2026-08-18
   * measurement that the backend repair outgrew. That is the failure worth
   * pinning here: a dated measurement is not a permanent fact, and this suite
   * stayed green through two branches of it.
   *
   * `menu_order` and `rating` stay out, and they are not the same case. Every
   * product carries 0 for both, so neither control could act — but the backend
   * suite proves the *endpoint* sorts by `menu_order`, while `rating` has no such
   * proof and can get none here, `_wc_average_rating` being derived from reviews
   * this shop has none of.
   */
  it("offers no sort the API cannot honour", () => {
    const offered = new Set<string>(SORTS.map((s) => s.orderby));
    expect(offered).toEqual(new Set(["date", "title", "price", "sku", "id", "popularity"]));
    expect(offered.has("menu_order")).toBe(false);
    expect(offered.has("rating")).toBe(false);
    // Every offered value carries both directions: a one-directional sort
    // control is half a control, and `title` shipped as exactly that until the
    // re-measurement — recorded as "descending was never measured" when it
    // had been working the whole time.
    for (const orderby of offered) {
      expect(SORTS.filter((s) => s.orderby === orderby)).toHaveLength(2);
    }
  });

  it("falls back to the default for an unknown sort key", () => {
    expect(sortKey(sortFromKey("price-asc"))).toBe("price-asc");
    // `popularity` sorts and is deliberately reachable only by URL — it orders by
    // `total_sales`, which the API emits on no response, so there is no column to
    // hang a header on. Honoured rather than rewritten, the way `customers`
    // treats the two `orderby` values it accepts and does not offer.
    expect(sortKey(sortFromKey("popularity-desc"))).toBe("popularity-desc");
    // A stale bookmark naming a sort that does not exist must render the list,
    // not an error.
    expect(sortKey(sortFromKey("rating-desc"))).toBe(DEFAULT_SORT_KEY);
    expect(sortKey(sortFromKey("nonsense"))).toBe(DEFAULT_SORT_KEY);
    expect(sortKey(sortFromKey(null))).toBe(DEFAULT_SORT_KEY);
  });
});

/**
 * **The embedded image, which was declared wrong for the whole run and could
 * not fire until this branch.**
 *
 * `lib/api/schemas/product.ts` required `url` on `image` and on every entry of
 * `gallery`. `ProductPresenter::image()` answers `{id, src, thumbnail, alt}` —
 * read from source — and emits no `url` at all. Not one of the 28 seeded
 * products carries an `image_id`, so the shape was reachable only through a
 * write and nothing in the panel could perform that write: the moment the edit
 * form grew `image_id` and `gallery_image_ids`, the answer to the very first
 * save would have thrown at the boundary and taken the screen with it.
 *
 * The fix is `lib/api/schemas/cms.ts`'s, one collection over, for the identical
 * slip against `MediaPresenter::image()` — `id` required, every carrier of the
 * picture optional, and `embeddedImageSrc` deciding which key wins so no screen
 * has to know there are two.
 */
describe("the embedded product image", () => {
  const withImage = (image: unknown, gallery: unknown[] = []) => ({
    ...productLike({}),
    id: 1,
    name: "n",
    slug: "n",
    type: "simple",
    status: "publish" as const,
    featured: false,
    catalog_visibility: "visible",
    sku: "",
    description: "",
    short_description: "",
    stock_status: "instock",
    weight: "",
    category_ids: [],
    tag_ids: [],
    attributes: [],
    variations: [],
    image_id: 5001,
    gallery_image_ids: [5002],
    image,
    gallery,
    permalink: "",
    seo: {
      title: "",
      description: "",
      canonical: "",
      robots: { index: true, follow: true, directive: "index, follow" },
      overrides: [],
    },
    date_created: "2026-01-01T00:00:00+00:00",
    date_modified: "2026-01-01T00:00:00+00:00",
  });

  /** What the router really sends. This used to be a parse failure. */
  const presenterShape = {
    id: 5001,
    src: "https://shop.test/wp-content/uploads/2026/08/real.jpg",
    thumbnail: "https://shop.test/wp-content/uploads/2026/08/real-300x200.jpg",
    alt: "Gros plan",
  };

  it("parses the shape ProductPresenter::image() actually sends", () => {
    const parsed = productSchema.parse(withImage(presenterShape, [presenterShape]));
    expect(parsed.image?.id).toBe(5001);
    expect(embeddedImageSrc(parsed.image)).toBe(presenterShape.src);
    expect(parsed.gallery).toHaveLength(1);
  });

  /** And the harness's, which sends `url` where the presenter sends `src`. */
  it("parses the harness's shape too, and one rule picks the key", () => {
    const harnessShape = { id: 5001, url: presenterShape.src, alt: "", width: 30, height: 20 };
    const parsed = productSchema.parse(withImage(harnessShape));
    expect(embeddedImageSrc(parsed.image)).toBe(presenterShape.src);

    // The presenter's key wins when both arrive, because it is the router
    // rather than a fixture — `lib/cms.ts` carries that decision.
    expect(embeddedImageSrc({ src: "a", url: "b" })).toBe("a");
    // And nothing to render is `null` rather than an empty string, so a caller
    // draws the placeholder instead of a broken image.
    expect(embeddedImageSrc({ id: 5001 } as { src?: string })).toBeNull();
    expect(embeddedImageSrc(null)).toBeNull();
  });

  /**
   * **`gallery` can be shorter than `gallery_image_ids`**, which is the
   * presenter's own `array_filter` over `image()` — an id whose attachment is
   * gone stays writable and drops out of the enriched list. So the two must be
   * matched by id and never zipped by index, which is what `ProductMedia` does.
   */
  it("allows a gallery shorter than the id list it enriches", () => {
    const parsed = productSchema.parse({
      ...withImage(null, []),
      gallery_image_ids: [5002, 5003],
      gallery: [],
    });
    expect(parsed.gallery_image_ids).toHaveLength(2);
    expect(parsed.gallery).toHaveLength(0);
  });
});
