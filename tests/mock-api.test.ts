/**
 * @vitest-environment node
 *
 * The mock has to be wrong in the same ways the shop is, and right in every
 * other way. This is the half that checks "right".
 *
 * Every assertion below parses a mock response with the panel's **actual** Zod
 * schema through the panel's **actual** `unwrap()`. Not a hand-written copy of
 * the shape: a copy is a second contract that drifts, and a mock validated
 * against a drifted copy is a harness that renders screens from data the real
 * panel would reject at its own boundary. If a schema tightens, this suite goes
 * red before a single screenshot is taken.
 *
 * The node environment is deliberate — `respond()` is pure but the coverage
 * check below reads the schema directory off disk.
 */
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_PATH, respond, type MockResponse } from "@/scripts/mock-api.mjs";
import { unwrap, listMeta } from "@/lib/api/envelope";
import { ApiError } from "@/lib/api/errors";
import type { z } from "zod";

import {
  identity,
  order,
  orderList,
  wilayas,
} from "@/lib/api/schemas/order";
import {
  attributeTerms,
  facets as facetsSchema,
  globalAttributes,
  product,
  productCategories,
  productList,
  productListMeta,
} from "@/lib/api/schemas/product";
import { PRODUCT_STATUSES, STOCK_STATUSES } from "@/lib/product-status";
import { customerDetail, customerList } from "@/lib/api/schemas/customer";
import { inventoryItem, inventoryList } from "@/lib/api/schemas/inventory";
import { coupon, couponDetail, couponList } from "@/lib/api/schemas/coupon";

function get(path: string, query = ""): MockResponse {
  return respond("GET", `${BASE_PATH}${path}`, new URLSearchParams(query));
}

/** The panel's own boundary, applied to the mock's own output. */
function parse<T>(schema: z.ZodType<T>, response: MockResponse) {
  return unwrap(schema, response.body, response.status);
}

/**
 * A list endpoint's `meta` is not optional decoration — pagination is the only
 * thing that tells a screen how many rows exist — so every list is checked for
 * it and not merely for its payload.
 */
function parseList<T>(schema: z.ZodType<T>, response: MockResponse) {
  const { data, meta } = parse(schema, response);
  expect(meta, "a list endpoint must carry meta").not.toBeNull();
  return { data, meta: listMeta.parse(meta) };
}

/**
 * The failure half of the boundary. A 400 that is only checked for its status is
 * a 400 whose body nobody has read, and the body is the whole point on this API:
 * a parameter error names the parameter, and the attributes filter names it
 * somewhere else entirely.
 */
function apiError(response: MockResponse): ApiError {
  try {
    parse(productList, response);
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  return expect.unreachable("the response did not throw");
}

describe("the envelope", () => {
  it("answers an unmocked path with a well-formed rest_no_route error", () => {
    const response = get("/analytics/overview");
    expect(response.status).toBe(404);

    // Loudly, and through the same code path a real 404 would take. A mock that
    // answered `{data: []}` here would let a screen calling an endpoint nobody
    // wrote render a convincing empty table.
    expect(() => parse(orderList, response)).toThrowError(ApiError);
    try {
      parse(orderList, response);
      expect.unreachable("the error envelope must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("rest_no_route");
      expect((error as ApiError).status).toBe(404);
    }
  });

  it("refuses a verb it has no handler for, rather than falling through", () => {
    expect(respond("POST", `${BASE_PATH}/orders`).status).toBe(404);
  });

  it("refuses a path outside the base", () => {
    expect(respond("GET", "/wp-json/wp/v2/users").status).toBe(404);
  });
});

describe("GET /auth/me", () => {
  it("parses as the identity the panel renders from", () => {
    const { data } = parse(identity, get("/auth/me"));
    expect(data.capabilities).toContain("ac_manage_orders");
    // A detail response carries no `meta`; only lists do.
    expect(parse(identity, get("/auth/me")).meta).toBeNull();
  });
});

describe("GET /locations/wilayas", () => {
  it("parses, and is bilingual on all 58 rows", () => {
    const { data } = parseList(wilayas, get("/locations/wilayas"));
    expect(data).toHaveLength(58);
    expect(data.every((row) => row.name !== "" && row.name_ar !== "")).toBe(true);
  });
});

describe("GET /orders", () => {
  it("parses the list and its pagination", () => {
    const { data, meta } = parseList(orderList, get("/orders", "per_page=20&page=1"));
    expect(data).toHaveLength(20);
    expect(meta.total).toBe(633);
    expect(meta.total_pages).toBe(32);
  });

  it("parses every one of the 633 rows, not only the first page", () => {
    // A fixture set is only as validated as its worst row, and the edge cases
    // here — no line items, a guest, an empty wilaya — are spread across pages.
    const rows = Array.from({ length: 7 }, (_, page) =>
      parseList(orderList, get("/orders", `per_page=100&page=${page + 1}`)).data,
    ).flat();
    expect(rows).toHaveLength(633);
    expect(rows.filter((row) => row.line_items.length === 0)).toHaveLength(45);
    expect(rows.filter((row) => row.customer_id === 0)).toHaveLength(288);
    expect(rows.filter((row) => row.billing.state === "")).toHaveLength(582);
  });

  it("parses a detail with the same schema the list uses", () => {
    const { data, meta } = parse(order, get("/orders/1000"));
    expect(data.id).toBe(1000);
    expect(meta).toBeNull();
  });

  it("404s an id that does not exist", () => {
    expect(get("/orders/999999").status).toBe(404);
  });
});

describe("GET /products", () => {
  it("parses the list, including the rows that carry an absence", () => {
    const { data, meta } = parseList(productList, get("/products", "per_page=100"));
    // 28 measured rows, 11 seeded ones, and the trashed one is in neither the
    // listing nor this count.
    expect(meta.total).toBe(38);
    expect(data.filter((row) => row.stock_quantity === null)).toHaveLength(8);
    expect(data.some((row) => row.status === "publish" && row.price === "")).toBe(true);
    expect(data.some((row) => row.status === "draft" && row.slug === "")).toBe(true);
    expect(
      data.some(
        (row) =>
          row.type === "variable" && row.variations.length > 0 && row.regular_price === "",
      ),
    ).toBe(true);
    // The 60-character SKU has to stay on page one or the harness's 340px
    // overflow assertion is watching a table that no longer contains the string
    // that breaks it.
    const firstPage = parseList(productList, get("/products", "per_page=20")).data;
    expect(firstPage.some((row) => row.sku.length > 50)).toBe(true);
  });

  it("parses a detail", () => {
    expect(parse(product, get("/products/101")).data.id).toBe(101);
  });

  /**
   * A trashed product is readable and unlistable, and both halves matter: the
   * schema accepts `trash` only because `GET /products/{id}` answers 200 with it
   * after a delete, and `?status=trash` is a 400 so there is no listing that can
   * reach it.
   */
  it("keeps a trashed product out of the listing and readable by id", () => {
    const trashed = parse(product, get("/products/211")).data;
    expect(trashed.status).toBe("trash");

    const listed = parseList(productList, get("/products", "per_page=100")).data;
    expect(listed.some((row) => row.id === 211)).toBe(false);
    expect(get("/products", "status=trash").status).toBe(400);
  });
});

describe("the catalogue vocabularies", () => {
  it("serves /product-categories flat, with a tree and a usage count", () => {
    const { data, meta } = parseList(
      productCategories,
      get("/product-categories", "per_page=100"),
    );
    expect(meta.total).toBe(data.length);
    // Flat with `parent`, not nested — the tree is the caller's to build.
    expect(data.some((row) => row.parent !== 0)).toBe(true);
    expect(data.every((row) => data.some((p) => p.id === row.parent) || row.parent === 0))
      .toBe(true);
    expect(data.some((row) => row.count > 0)).toBe(true);
  });

  /**
   * `slug` and `taxonomy` are different strings and confusing them is the
   * mistake this endpoint exists to prevent: the slug addresses the attribute,
   * the taxonomy is what `?attributes[…]` matches and what keys a facet group.
   */
  it("serves /attributes with slug and taxonomy as different things", () => {
    const { data } = parseList(globalAttributes, get("/attributes"));
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((row) => row.taxonomy !== row.slug)).toBe(true);
    expect(data.every((row) => row.taxonomy === `pa_${row.slug}`)).toBe(true);
  });

  it("serves /attributes unpaginated, the way /locations/wilayas is", () => {
    const all = parseList(globalAttributes, get("/attributes")).data;
    // No `per_page`, and still every row: a default of 10 would silently drop a
    // shop's later attributes and every facet group keyed on them with it.
    expect(parseList(globalAttributes, get("/attributes", "per_page=1")).data)
      .toHaveLength(all.length);
  });

  /**
   * **The reason this route is read at all.** A facet group omits its zero-count
   * values, so a term no product carries exists nowhere else — and without it
   * the filter sheet can only ever offer the values that already match.
   */
  it("serves /attributes/{id}/terms, including a term with count 0", () => {
    const { data, meta } = parseList(attributeTerms, get("/attributes/1/terms", "per_page=100"));
    expect(meta.total).toBe(data.length);
    expect(data).toHaveLength(6);
    expect(data.filter((term) => term.count === 0)).toHaveLength(1);
  });

  it("404s a sub-resource nobody wrote, at every collection", () => {
    expect(get("/attributes/9/terms").status).toBe(404);
    expect(get("/attributes/1/nonsense").status).toBe(404);
    // The depth guard is per collection, not a blanket `> 3`: a third segment on
    // a collection with no sub-resource must not be answered by the row.
    expect(get("/orders/1000/notes").status).toBe(404);
    expect(get("/products/101/variations").status).toBe(404);
    expect(get("/inventory/low-stock/anything").status).toBe(404);
  });
});

/** `meta.facets`, through the real `facets` schema and the real `productListMeta`. */
function productsMeta(query: string) {
  const { meta } = parse(productList, get("/products", `per_page=100&${query}`));
  return productListMeta.parse(meta);
}

const ALL_FACETS = "facets=attributes,price,category,tag,stock_status";

function productFacets(query: string) {
  const meta = productsMeta(`${ALL_FACETS}&${query}`);
  expect(meta.facets, "?facets= must produce meta.facets").toBeDefined();
  return facetsSchema.parse(meta.facets);
}

const attributeGroup = (query: string, taxonomy: string) => {
  const group = productFacets(query).attributes?.groups.find((g) => g.taxonomy === taxonomy);
  expect(group, `no facet group for ${taxonomy}`).toBeDefined();
  return group!;
};

describe("meta.facets", () => {
  it("is opt-in, and only the groups that were asked for arrive", () => {
    expect(productsMeta("").facets).toBeUndefined();

    const one = productsMeta("facets=price").facets;
    expect(one).toBeDefined();
    expect(facetsSchema.parse(one).price).toBeDefined();
    expect(facetsSchema.parse(one).category).toBeUndefined();
    expect(facetsSchema.parse(one).attributes).toBeUndefined();
  });

  it("carries the scope and the sentence the panel renders", () => {
    const facets = productFacets("");
    expect(facets.scope).toBe("publish");
    expect(facets.scope_note.length).toBeGreaterThan(0);
  });

  /** Three shapes in one object, and a single "facet group" type is wrong twice. */
  it("is three different shapes, not one", () => {
    const facets = productFacets("");
    // `price` is a band.
    expect(facets.price).toMatchObject({ currency: "DZD" });
    // A published product with no price at all stores zero, so the floor is 0.
    expect(facets.price?.min).toBe("0.00");
    // `stock_status` is a bare array, and the one group the API enumerates
    // completely — a closed enum, so the zero is reported rather than omitted.
    expect(Array.isArray(facets.stock_status)).toBe(true);
    expect(facets.stock_status?.map((v) => v.value)).toEqual([...STOCK_STATUSES]);
    expect(facets.stock_status?.some((v) => v.count === 0)).toBe(true);
    // `category` is a group.
    expect(facets.category?.values.length).toBeGreaterThan(0);
    expect(typeof facets.category?.truncated).toBe("boolean");
  });

  it("omits a zero-count value, and total_values counts what is left", () => {
    const vocabulary = parseList(attributeTerms, get("/attributes/1/terms", "per_page=100")).data;
    const group = attributeGroup("", "pa_matiere");

    const uncounted = vocabulary.find((term) => term.count === 0);
    expect(uncounted, "the vocabulary must hold a term no product carries").toBeDefined();

    // The group dropped it entirely — it is not present with a count of zero.
    expect(group.values.some((v) => v.slug === uncounted!.slug)).toBe(false);
    expect(group.values.every((v) => v.count > 0)).toBe(true);
    // And `total_values` is the number of non-zero values, not the vocabulary.
    expect(vocabulary).toHaveLength(6);
    expect(group.total_values).toBe(5);
  });

  it("caps a group at 50 and says so", () => {
    const vocabulary = parseList(attributeTerms, get("/attributes/2/terms", "per_page=100")).data;
    const group = attributeGroup("", "pa_couleur");

    expect(vocabulary).toHaveLength(60);
    expect(group.values).toHaveLength(50);
    // The real number, so "50 sur 60" can be rendered rather than a list that
    // reads as complete.
    expect(group.total_values).toBe(60);
    expect(group.truncated).toBe(true);
  });

  /**
   * **The inconsistency lib/products.ts exists to repair.** Reproduce the API's
   * behaviour, not the repair: `category` narrows itself and the others do not.
   */
  it("does not exclude the category filter from the category group", () => {
    const unfiltered = productFacets("").category!;
    const narrowed = productFacets("category=12").category!;

    expect(unfiltered.values.length).toBeGreaterThan(1);
    expect(narrowed.values).toHaveLength(1);
    expect(narrowed.total_values).toBe(1);
    expect(narrowed.values[0].term_id).toBe(12);
  });

  it("does exclude an attribute group's own filter, and price's and stock's", () => {
    const unfiltered = attributeGroup("", "pa_matiere");
    const filtered = attributeGroup("attributes[pa_matiere]=laine", "pa_matiere");
    // Its own filter would have left one value. It reports all five.
    expect(filtered.values.map((v) => v.slug)).toEqual(unfiltered.values.map((v) => v.slug));

    // While a *different* group narrows under it, which is what makes the line
    // above a measurement rather than a group that ignores filtering entirely.
    expect(attributeGroup("attributes[pa_matiere]=laine", "pa_couleur").total_values)
      .toBeLessThan(attributeGroup("", "pa_couleur").total_values);

    expect(productFacets("min_price=5000").price).toEqual(productFacets("").price);
    expect(productFacets("stock_status=outofstock").stock_status)
      .toEqual(productFacets("").stock_status);
  });

  it("counts published rows only, whatever the list is showing", () => {
    const listed = parseList(productList, get("/products", "per_page=100")).data;
    const published = listed.filter((row) => row.status === "publish").length;
    const counted = productFacets("").stock_status!.reduce((sum, v) => sum + v.count, 0);

    expect(listed.length).toBeGreaterThan(published);
    expect(counted).toBe(published);
  });
});

describe("the /products filters", () => {
  const total = (query: string) =>
    parseList(productList, get("/products", `per_page=100&${query}`)).meta.total;
  const rows = (query: string) =>
    parseList(productList, get("/products", `per_page=100&${query}`)).data;

  it("takes one status, from the product set and not the order set", () => {
    for (const status of PRODUCT_STATUSES) {
      const filtered = rows(`status=${status}`);
      expect(filtered.length, `no rows for status=${status}`).toBeGreaterThan(0);
      expect(filtered.every((row) => row.status === status)).toBe(true);
    }
    // A comma list is a 400 — the measurement every single-select control here
    // is built on — and so is an order status, which this route never accepted.
    expect(get("/products", "status=draft,publish").status).toBe(400);
    expect(get("/products", "status=refunded").status).toBe(400);
    expect(apiError(get("/products", "status=draft,publish")).details).toMatchObject({
      params: { status: expect.stringContaining("draft") },
    });
  });

  it("takes term ids for category, and refuses a slug", () => {
    expect(total("category=12")).toBeGreaterThan(0);
    expect(total("category=12,15")).toBeGreaterThan(total("category=12"));

    // Well-formed and matching nothing is a 200 with zero rows.
    expect(total("category=99999")).toBe(0);

    // Not well-formed is a 400, and the message is the pattern.
    const error = apiError(get("/products", "category=tapis"));
    expect(error.status).toBe(400);
    expect(error.details).toMatchObject({
      params: { category: expect.stringContaining("^$|^[0-9]+(,[0-9]+)*$") },
    });
    expect(get("/products", "tag=nouveaute").status).toBe(400);
  });

  it("filters by tag, sku and stock status", () => {
    const tagged = rows("tag=401");
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.every((row) => row.tag_ids.includes(401))).toBe(true);

    expect(rows("sku=AC-CAT-0206").every((row) => row.sku.includes("AC-CAT-0206"))).toBe(true);

    const out = rows("stock_status=outofstock");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((row) => row.stock_status === "outofstock")).toBe(true);
    // A closed enum, so a value outside it is a 400 rather than zero rows.
    expect(get("/products", "stock_status=bogus").status).toBe(400);
  });

  it("filters by price, and a bad price is a capturable 400", () => {
    const dear = rows("min_price=10000");
    expect(dear.length).toBeGreaterThan(0);
    expect(dear.every((row) => Number(row.price || "0") >= 10000)).toBe(true);
    expect(total("max_price=1000")).toBeLessThan(total(""));

    // The one error state a filter sheet can actually provoke, so the screen has
    // something to render: `details.params.min_price`, not a generic message.
    const error = apiError(get("/products", "min_price=abc"));
    expect(error.status).toBe(400);
    expect(error.code).toBe("rest_invalid_param");
    expect(error.details).toMatchObject({ params: { min_price: expect.any(String) } });
  });

  /** `""` is absent and `"false"` is a filter. They are not the same request. */
  it("keeps an absent on_sale apart from on_sale=false", () => {
    expect(total("on_sale=true")).toBeGreaterThan(0);
    expect(total("on_sale=false")).toBeGreaterThan(0);
    expect(total("on_sale=true") + total("on_sale=false")).toBe(total(""));
    expect(total("on_sale=false")).not.toBe(total(""));
    expect(total("on_sale=")).toBe(total(""));

    expect(total("featured=true")).toBeGreaterThan(0);
    expect(total("featured=false")).not.toBe(total(""));
    expect(get("/products", "featured=maybe").status).toBe(400);
  });

  it("matches attribute term slugs, and alternatives inside one attribute", () => {
    const laine = rows("attributes[pa_matiere]=laine");
    expect(laine.length).toBeGreaterThan(0);
    // Slugs, not ids, and on a *global* attribute `name` is the taxonomy.
    expect(
      laine.every((row) =>
        row.attributes.some((a) => a.name === "pa_matiere" && a.options.includes("laine")),
      ),
    ).toBe(true);

    // OR within one attribute…
    expect(rows("attributes[pa_matiere]=laine,coton").length).toBe(
      laine.length + rows("attributes[pa_matiere]=coton").length,
    );
    // …and AND across two.
    expect(
      rows("attributes[pa_matiere]=coton&attributes[pa_couleur]=blanc").length,
    ).toBeLessThan(rows("attributes[pa_matiere]=coton").length);

    // A term nobody carries is zero rows, not an error.
    expect(total("attributes[pa_matiere]=cuir")).toBe(0);
  });

  /**
   * The attributes filter reports its errors somewhere else than every other
   * parameter, and a reader that only knows `details.params` renders a generic
   * message and throws the useful half away.
   */
  it("reports a bad attribute under details.fields, never under details.params", () => {
    const error = apiError(get("/products", "attributes[pa_nope]=x"));
    expect(error.status).toBe(400);
    expect(error.details.params).toBeUndefined();
    expect(error.fields?.attributes).toEqual(expect.any(String));
    expect(error.details.facetable_attributes).toEqual(
      expect.arrayContaining(["pa_matiere", "pa_couleur"]),
    );
  });
});

describe("GET /customers", () => {
  /**
   * The one collection where the list row and the detail are different objects.
   * lib/api/schemas/customer.ts is explicit that they differ by exactly
   * `statistics`, and a mock that put it on both would let a component reach for
   * it on a list row and find it — right up until production.
   */
  it("omits statistics from the list and carries it on the detail", () => {
    const { data } = parseList(customerList, get("/customers", "per_page=100"));
    expect(data).toHaveLength(16);
    expect(data.some((row) => "statistics" in row)).toBe(false);

    const detail = parse(customerDetail, get("/customers/20")).data;
    expect(detail.statistics.total_orders).toBeGreaterThan(0);
  });

  it("parses all 16 details, including the 11 who have never ordered", () => {
    const details = Array.from({ length: 16 }, (_, i) =>
      parse(customerDetail, get(`/customers/${20 + i}`)).data,
    );
    const never = details.filter(
      (row) => row.statistics.first_order === null && row.statistics.last_order === null,
    );
    expect(never).toHaveLength(11);
    expect(details.filter((row) => row.first_name === "" && row.last_name === "")).toHaveLength(12);
  });
});

describe("GET /inventory", () => {
  it("parses every row, and null is not zero on eight of them", () => {
    // The 38 listed products plus the 5 variations. A trashed product is in no
    // stockroom and is in neither this list nor /products.
    const { data, meta } = parseList(inventoryList, get("/inventory", "per_page=100"));
    expect(meta.total).toBe(43);
    expect(data.filter((row) => row.parent_id !== 0)).toHaveLength(5);
    expect(data.filter((row) => row.stock_quantity === null)).toHaveLength(8);
    // Per product, not global — so there is no shop-wide threshold to display.
    expect(data.filter((row) => row.low_stock_amount === 5)).toHaveLength(1);
  });

  it("parses a detail", () => {
    expect(parse(inventoryItem, get("/inventory/101")).data.id).toBe(101);
  });

  /**
   * The inventory screen calls this from the client on every render and the
   * harness brief's endpoint list does not mention it — the capture run is what
   * found that. It returns the same item as the other three inventory routes.
   */
  it("serves /inventory/low-stock with the same row shape", () => {
    const { data, meta } = parseList(inventoryList, get("/inventory/low-stock", "per_page=100"));
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((row) => row.low_stock)).toBe(true);
    expect(meta.total).toBe(data.length);
    // And its sibling stays a 404: nothing reaches /lookup on load, so nothing
    // may verify a scanner flow against a fixture that does not exist.
    expect(get("/inventory/lookup", "sku=AC-CAT-0101").status).toBe(404);
  });
});

describe("GET /coupons", () => {
  it("parses the list, and keeps zero and null apart", () => {
    const { data, meta } = parseList(couponList, get("/coupons", "per_page=100"));
    expect(meta.total).toBe(4);
    // `"0.00"` is a real coupon; a threshold of zero is stored as null and can
    // never read back as `"0.00"`. Both directions on one object.
    expect(data.some((row) => row.amount === "0.00" && row.free_shipping)).toBe(true);
    expect(
      data.every(
        (row) => row.minimum_amount !== "0.00" && row.maximum_amount !== "0.00",
      ),
    ).toBe(true);
  });

  it("carries restrictions on the detail and not on the list", () => {
    const { data } = parseList(couponList, get("/coupons", "per_page=100"));
    expect(data.some((row) => "restrictions" in row)).toBe(false);

    const detail = parse(couponDetail, get("/coupons/302")).data;
    expect(detail.restrictions.product_ids[0].missing).toBe(false);
    // The list schema still parses a detail body — loose objects — which is why
    // the absence above is asserted rather than inferred from a parse failure.
    expect(parse(coupon, get("/coupons/302")).data.code).toBe("livraison");
  });
});

describe("query parameters", () => {
  it("rejects a comma-separated status with a 400", () => {
    const response = get("/orders", "status=processing,pending");
    expect(response.status).toBe(400);
    try {
      parse(orderList, response);
      expect.unreachable("a 400 must throw");
    } catch (error) {
      expect((error as ApiError).code).toBe("rest_invalid_param");
      expect((error as ApiError).status).toBe(400);
    }
  });

  it("filters by a single status", () => {
    const { data, meta } = parseList(orderList, get("/orders", "status=failed&per_page=100"));
    expect(meta.total).toBe(1);
    expect(data[0].status).toBe("failed");
  });

  it("searches case-insensitively over the obvious fields", () => {
    expect(parseList(productList, get("/products", "search=MIEL")).meta.total).toBe(
      parseList(productList, get("/products", "search=miel")).meta.total,
    );
    expect(parseList(customerList, get("/customers", "search=client20")).meta.total).toBe(1);
    expect(parseList(orderList, get("/orders", "search=benali&per_page=100")).meta.total)
      .toBeGreaterThan(0);
  });

  /**
   * **The load-bearing one.** `/orders` accepts `orderby` and silently ignores
   * it, and the mock must reproduce that or an agent will verify a sort control
   * against the harness and ship one that does nothing in production.
   */
  it("accepts orderby on /orders and ignores it", () => {
    const ids = (query: string) =>
      parseList(orderList, get("/orders", query)).data.map((row) => row.id);

    expect(ids("per_page=100&orderby=date&order=asc")).toEqual(
      ids("per_page=100&orderby=date&order=desc"),
    );
    expect(ids("per_page=100&orderby=title&order=asc")).toEqual(ids("per_page=100"));
    // And a value nobody has heard of is a 200, not a 400.
    expect(get("/orders", "orderby=nonsense").status).toBe(200);
  });

  /**
   * **The narrow exception, and both halves of it.** `/products` sorts, for
   * exactly the five combinations `SORTS` in lib/product-status.ts records as
   * re-measured after the backend repair — and for nothing else. `title desc`
   * is the case that matters: nobody measured it, so it is accepted with a 200
   * and comes back unsorted, and an agent who builds that control watches it do
   * nothing here rather than in production.
   *
   * Compared as id sequences, the way the live router was measured.
   */
  it("sorts /products by exactly the five measured combinations", () => {
    const ids = (query: string) =>
      parseList(productList, get("/products", `per_page=100&${query}`)).data.map((r) => r.id);
    const names = (query: string) =>
      parseList(productList, get("/products", `per_page=100&${query}`)).data.map((r) => r.name);
    const prices = (query: string) =>
      parseList(productList, get("/products", `per_page=100&${query}`)).data.map((r) =>
        Number(r.price || "0"),
      );
    /** Accent-folded, because a collation that depends on the runtime's ICU
        build is a sort that differs between machines. */
    const fold = (value: string) =>
      value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    const unsorted = ids("");

    // date desc is the default order, and date asc is its reverse.
    expect(ids("orderby=date&order=desc")).toEqual(unsorted);
    expect(ids("orderby=date&order=asc")).toEqual([...unsorted].reverse());

    // title asc is alphabetical, and is not the default order.
    const alphabetical = names("orderby=title&order=asc");
    expect(alphabetical.map(fold)).toEqual([...alphabetical.map(fold)].sort());
    expect(ids("orderby=title&order=asc")).not.toEqual(unsorted);

    // price sorts in both directions.
    const ascending = prices("orderby=price&order=asc");
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
    const descending = prices("orderby=price&order=desc");
    expect(descending).toEqual([...descending].sort((a, b) => b - a));
    expect(ids("orderby=price&order=asc")).not.toEqual(unsorted);

    // And everything else is a 200 that did not sort — `title desc` included,
    // which is the whole point of the list being five and not six.
    expect(ids("orderby=title&order=desc")).toEqual(unsorted);
    expect(ids("orderby=title&order=desc")).not.toEqual(
      [...ids("orderby=title&order=asc")].reverse(),
    );
    expect(ids("orderby=sku&order=asc")).toEqual(unsorted);
    expect(ids("orderby=popularity&order=desc")).toEqual(unsorted);
    expect(ids("orderby=nonsense&order=asc")).toEqual(unsorted);
    expect(get("/products", "orderby=nonsense").status).toBe(200);
  });

  it("refuses a per_page over 100 rather than clamping it", () => {
    expect(get("/orders", "per_page=500").status).toBe(400);
  });
});

/**
 * The mock grows one collection per redesign branch, and the promise this suite
 * makes — every schema the mock serves is validated against it — only stays true
 * if a new schema file cannot arrive unnoticed. So the directory is enumerated
 * and each module is either exercised above or listed here with a reason.
 *
 * Adding an endpoint to the mock means moving its module out of UNCOVERED and
 * writing the parse. Adding a schema file means one line here, deliberately.
 */
const COVERED = ["order", "product", "customer", "inventory", "coupon"];

const UNCOVERED: Record<string, string> = {
  analytics: "the dashboard's report endpoints are not mocked yet",
  audit: "/audit is not mocked yet",
  campaign: "/campaigns is not mocked yet",
  cms: "/cms/* is not mocked yet",
  media: "/media is not mocked yet",
  notification: "/notifications is not mocked yet",
  payment: "/payments is not mocked yet",
  settings: "/settings is not mocked yet",
  shipping: "/shipping/* and /shipments are not mocked yet",
  staff: "/users and /roles are not mocked yet",
  transfer: "the import/export endpoints are not mocked yet",
};

describe("schema coverage", () => {
  it("accounts for every module in lib/api/schemas", () => {
    const modules = readdirSync(resolve(import.meta.dirname, "../lib/api/schemas"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => file.replace(/\.ts$/, ""))
      .sort();

    const unaccounted = modules.filter(
      (name) => !COVERED.includes(name) && !(name in UNCOVERED),
    );
    expect(
      unaccounted,
      "a new schema module must be exercised by this suite or listed in UNCOVERED with a reason",
    ).toEqual([]);

    // And the reverse: a listed reason for a module that no longer exists is a
    // stale exemption, which is how an UNCOVERED list quietly stops meaning
    // anything.
    const stale = [...COVERED, ...Object.keys(UNCOVERED)].filter(
      (name) => !modules.includes(name),
    );
    expect(stale, "UNCOVERED names a module that no longer exists").toEqual([]);
  });
});
