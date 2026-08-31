/**
 * The product vocabulary, with no dependencies at all — the same reason
 * `lib/order-status.ts` has none.
 *
 * The filter sheet, the facet groups and the form are all client components and
 * need these *values*. Importing them from `lib/api/schemas/product.ts` would
 * pull Zod's runtime into the products route to ship a handful of strings; the
 * orders branch measured that at 63 KB gzipped against a 180 KB budget.
 *
 * The schema imports these; nothing imports the schema to get them.
 */

/**
 * What `?status=` accepts. Measured 2026-08-18: `?status=draft,publish` answers
 * **400** — `status is not one of draft, pending, private, and publish` — so
 * every control built on this is single-select, because the API is.
 */
export const PRODUCT_STATUSES = ["publish", "draft", "pending", "private"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * `trash` is not in the list above and belongs in neither a filter nor the form's
 * status picker — `?status=trash` is a 400. But a trashed product still reads
 * back: `DELETE` answers 200, and a following `GET /products/{id}` answers **200
 * with `status: "trash"`**, not 404. So the schema has to accept it or the panel
 * fails at its own boundary the moment someone trashes a product and the detail
 * screen reloads underneath them.
 */
export const READABLE_STATUSES = [...PRODUCT_STATUSES, "trash"] as const;
export type ReadableStatus = (typeof READABLE_STATUSES)[number];

/**
 * Colour is never the only signal — every consumer pairs this with a translated
 * word. `publish` is deliberately neutral rather than green: in a catalogue of 28
 * products 27 are published, and a column of green badges marks nothing.
 */
export const PRODUCT_STATUS_TONE: Record<
  ReadableStatus,
  "neutral" | "info" | "warning" | "success" | "danger"
> = {
  publish: "neutral",
  draft: "warning",
  pending: "info",
  private: "info",
  trash: "danger",
};

/** `?stock_status=` — a closed enum, and the facet reports all three including zeros. */
export const STOCK_STATUSES = ["instock", "outofstock", "onbackorder"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const STOCK_TONE: Record<StockStatus, "success" | "danger" | "warning"> = {
  instock: "success",
  outofstock: "danger",
  onbackorder: "warning",
};

/** `PATCH`/`POST` accept exactly these two — measured, `grouped` is a 400. */
export const PRODUCT_TYPES = ["simple", "variable"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/**
 * **Whether `POST /products/{id}/duplicate` can honestly copy this product.**
 *
 * The two lists are one list on purpose, and the reason is a defect in the API
 * rather than a preference here.
 *
 * `Products/ProductRepository.php::duplicate()` chooses the copy's class with a
 * single ternary, read from source:
 *
 *     $class = $product->get_type() === 'variable'
 *         ? WC_Product_Variable::class
 *         : WC_Product_Simple::class;
 *
 * — so **`simple` is the fallback for every type that is not `variable`**, not a
 * branch anybody wrote for a third kind. The child loop underneath it is gated on
 * `$child instanceof WC_Product_Variation`, so a product whose children are
 * ordinary products contributes none of them, and the `sync()` at the end runs
 * only when the copy came out `variable`. A product of any other type is therefore
 * copied as *a simple product with the same name, description and price and
 * nothing of what made it that type* — and the 201 says so nowhere: the response
 * is the copy, so `data.type` reads `simple` and looks like an answer rather than
 * a loss.
 *
 * **This function is an allowlist, not a list of the two broken cases**, and that
 * is deliberate. WooCommerce's own `grouped` and `external` are the types this
 * shop would meet first, but the plugin's source names neither anywhere — it
 * names only the two it writes (`Products/ProductInput.php::TYPES`) — so hard-coding
 * a pair of slugs the backend never mentions would be the panel inventing a
 * contract. `product_type` is a WordPress taxonomy and any plugin may register a
 * term in it; the honest question is not *is this one of the two bad ones* but
 * *is this one of the two `duplicate()` was written for*.
 *
 * ## Why the panel refuses rather than the backend
 *
 * The state is unreachable on this shop today — `ProductRepository::paginate()`
 * passes `'type' => ['simple', 'variable']` to `wc_get_products()`, so
 * `GET /products` cannot return one at all, and the create drawer offers exactly
 * `PRODUCT_TYPES` — so a product of a third type can only arrive through wp-admin
 * or another plugin. Refusing here is a guard against that day and costs one
 * boolean; fixing `duplicate()` is a backend change on a path nothing can reach,
 * with a copy semantics for grouped children that nobody has specified.
 */
export function isDuplicable(type: string): boolean {
  return (PRODUCT_TYPES as readonly string[]).includes(type);
}

export const CATALOG_VISIBILITIES = ["visible", "catalog", "search", "hidden"] as const;

/**
 * The sorts that actually sort.
 *
 * `docs/API.md` publishes eight `orderby` values. **Six of them sort, both
 * directions, twelve combinations** — re-measured 2026-08-25 over the full
 * 28-row catalogue, each ordering checked against the order its own field
 * implies rather than against "differs from the default", with the count of
 * distinct values that backs it:
 *
 *     date 16 · id 28 · title 28 · price 21 · sku 28 · popularity 13
 *
 * ## This list said five until 2026-08-25, and the reason is worth keeping
 *
 * The 2026-08-18 measurement it recorded was real: `id`, `price`, `sku`,
 * `popularity` and `rating` did each return byte-identical order to `date`. Then
 * `ProductRepository::orderingClause()` repaired it — and **the record outlived
 * the repair**. `title desc` sat here for two branches described as never
 * measured; it had been working the whole time. A dated measurement is not a
 * permanent fact, and nothing re-took this one because the suite was green:
 * `tests/Api/products.php` asserted `price` and `sku` on a fixture where id,
 * title, sku and price all ascended together, so any of them could stand in for
 * another. That fixture is fixed now and the suite proves all seven separately.
 *
 * ## `menu_order` and `rating` are omitted, and they are not the same case
 *
 * Neither ships, because neither can act on this shop's data: every product
 * carries `menu_order` 0 and `_wc_average_rating` 0, so both sorts return the
 * catalogue untouched and a control offering them would do nothing.
 *
 * They differ underneath, which matters if the data ever changes. The backend
 * suite now proves the **endpoint** sorts by `menu_order` — on a fixture with
 * distinct values, because WooCommerce honours it natively — so that one is a
 * missing-data problem and nothing else. `rating` has no such proof and cannot
 * get one here: `_wc_average_rating` is derived from real reviews, and writing
 * the meta directly would assert a value WooCommerce recomputes.
 */
export const SORTS = [
  { orderby: "date", order: "desc" },
  { orderby: "date", order: "asc" },
  { orderby: "title", order: "asc" },
  { orderby: "title", order: "desc" },
  { orderby: "price", order: "asc" },
  { orderby: "price", order: "desc" },
  { orderby: "sku", order: "asc" },
  { orderby: "sku", order: "desc" },
  { orderby: "id", order: "asc" },
  { orderby: "id", order: "desc" },
  { orderby: "popularity", order: "desc" },
  { orderby: "popularity", order: "asc" },
] as const;

export type Sort = (typeof SORTS)[number];

/** The URL form, so a sort is one search param rather than two that can disagree. */
export function sortKey(sort: Sort): string {
  return `${sort.orderby}-${sort.order}`;
}

export const DEFAULT_SORT_KEY = sortKey(SORTS[0]);

export function sortFromKey(key: string | null | undefined): Sort {
  return SORTS.find((s) => sortKey(s) === key) ?? SORTS[0];
}
