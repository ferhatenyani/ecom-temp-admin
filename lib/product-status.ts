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

export const CATALOG_VISIBILITIES = ["visible", "catalog", "search", "hidden"] as const;

/**
 * The sorts that actually sort.
 *
 * `docs/API.md` publishes eight `orderby` values. Measured 2026-08-18 against the
 * live router by comparing each one's full 28-row id sequence against
 * `orderby=date`, **five of them returned byte-identical order to `date`** in
 * both directions: `id`, `price`, `sku`, `popularity` and `rating` were accepted
 * with a 200 and silently did not sort.
 *
 * That was repaired in the backend (`ProductRepository::orderingClause()`, which
 * joins `wc_product_meta_lookup` through `posts_clauses`), and the panel offers
 * the four a person actually reaches for. `popularity` and `rating` are omitted
 * because this shop has no ratings and `total_sales` is 0–2 across the whole
 * catalogue: a sort whose keys are all equal is a control that does nothing, and
 * that is the defect this list exists to avoid repeating.
 */
export const SORTS = [
  { orderby: "date", order: "desc" },
  { orderby: "date", order: "asc" },
  { orderby: "title", order: "asc" },
  { orderby: "price", order: "asc" },
  { orderby: "price", order: "desc" },
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
