import type { Facets, Product } from "@/lib/api/schemas/product";
import { DEFAULT_SORT_KEY, sortFromKey } from "@/lib/product-status";

/**
 * Filter state lives in the URL, so a link to a filtered catalogue is shareable,
 * a refresh keeps the filter and the back button works. The query key mirrors it,
 * so the two can never disagree.
 *
 * `per_page` caps at 100 and **over 100 is a 400, not a clamp** — measured,
 * `?per_page=500` answers `400 {"params": {"per_page": "per_page must be between
 * 1 and 100"}}`, the same as `/orders`. 20 is the API's default and the right
 * size for a phone.
 */
export const PER_PAGE = 20;

/**
 * The facet groups worth asking for.
 *
 * Facets are opt-in and cost the API real work, so this is not "everything".
 * `rating` is omitted: measured, it comes back `[]` on every request because no
 * product in this shop has a review, and a filter group that is always empty is a
 * control that cannot be used. `tag` is asked for and rendered only when it has
 * values, for the same reason — every product carries zero tags today, but unlike
 * ratings a tag is one PATCH away.
 */
export const FACETS = "attributes,price,category,tag,stock_status";

/**
 * The filters, as the API names them.
 *
 * Nine of them, plus the search box and the sort. `docs/ADMIN_PANEL.md` says
 * "nine filters plus facets"; measured against the live router, `/products`
 * accepts eleven filtering parameters — `search`, `sku`, `status`, `category`,
 * `tag`, `min_price`, `max_price`, `attributes[…]`, `stock_status`, `on_sale`,
 * `featured` and `rating_min`. The panel carries the nine that can do something
 * in this shop; see the note on `FACETS` for the two that cannot.
 */
export type ProductsQuery = {
  search: string;
  sku: string;
  /** One value, never a list — `?status=draft,publish` is a 400. */
  status: string;
  /** Term **ids**, comma-separated. `?category=tapis` is a 400: the pattern is `^$|^[0-9]+(,[0-9]+)*$`. */
  category: string;
  tag: string;
  minPrice: string;
  maxPrice: string;
  stockStatus: string;
  /** `""` for absent, `"true"` / `"false"` — absent is not `false`, and both filter. */
  onSale: string;
  featured: string;
  /** taxonomy → comma-separated term slugs. Values within one attribute are alternatives. */
  attributes: Record<string, string>;
  sort: string;
  page: number;
};

export const EMPTY_QUERY: ProductsQuery = {
  search: "",
  sku: "",
  status: "",
  category: "",
  tag: "",
  minPrice: "",
  maxPrice: "",
  stockStatus: "",
  onSale: "",
  featured: "",
  attributes: {},
  sort: DEFAULT_SORT_KEY,
  page: 1,
};

/** The `attributes[pa_x]=a,b` params, read out of a URLSearchParams-like source. */
export function readAttributes(entries: Iterable<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    const match = /^attributes\[(.+)\]$/.exec(key);
    if (match && value !== "") out[match[1]] = value;
  }
  return out;
}

export function queryFromParams(params: URLSearchParams): ProductsQuery {
  return {
    search: params.get("search") ?? "",
    sku: params.get("sku") ?? "",
    status: params.get("status") ?? "",
    category: params.get("category") ?? "",
    tag: params.get("tag") ?? "",
    minPrice: params.get("min_price") ?? "",
    maxPrice: params.get("max_price") ?? "",
    stockStatus: params.get("stock_status") ?? "",
    onSale: params.get("on_sale") ?? "",
    featured: params.get("featured") ?? "",
    attributes: readAttributes(params.entries()),
    sort: params.get("sort") ?? DEFAULT_SORT_KEY,
    page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
  };
}

/**
 * The query as the API's own parameters.
 *
 * Empty strings are dropped rather than sent: `?status=` is harmless but
 * `?min_price=` is not obviously so, and an unknown or empty parameter is
 * **ignored with a 200** rather than refused — measured, `?bogus_param=1`
 * returns all 28 rows, identical to no filter at all. So a filter that does
 * nothing looks exactly like a filter that works, and the panel never sends one
 * it does not mean.
 */
export function toApiParams(query: ProductsQuery): URLSearchParams {
  const sort = sortFromKey(query.sort);
  const params = new URLSearchParams({
    per_page: String(PER_PAGE),
    page: String(query.page),
    orderby: sort.orderby,
    order: sort.order,
    facets: FACETS,
  });

  const simple: [string, string][] = [
    ["search", query.search],
    ["sku", query.sku],
    ["status", query.status],
    ["category", query.category],
    ["tag", query.tag],
    ["min_price", query.minPrice],
    ["max_price", query.maxPrice],
    ["stock_status", query.stockStatus],
    ["on_sale", query.onSale],
    ["featured", query.featured],
  ];

  for (const [key, value] of simple) {
    if (value !== "") params.set(key, value);
  }

  for (const [taxonomy, slugs] of Object.entries(query.attributes)) {
    if (slugs !== "") params.set(`attributes[${taxonomy}]`, slugs);
  }

  return params;
}

/** The URL the panel shows, which is the API's parameters minus the ones it always sends. */
export function toUrlParams(query: ProductsQuery): URLSearchParams {
  const params = toApiParams(query);
  for (const key of ["per_page", "facets", "orderby", "order"]) params.delete(key);
  if (query.sort !== DEFAULT_SORT_KEY) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page)); else params.delete("page");
  return params;
}

export function isFiltered(query: ProductsQuery): boolean {
  return (
    query.search !== "" ||
    query.sku !== "" ||
    query.status !== "" ||
    query.category !== "" ||
    query.tag !== "" ||
    query.minPrice !== "" ||
    query.maxPrice !== "" ||
    query.stockStatus !== "" ||
    query.onSale !== "" ||
    query.featured !== "" ||
    Object.values(query.attributes).some((v) => v !== "")
  );
}

/** The query key mirrors the URL, so the two can never disagree. */
export function productsKey(query: ProductsQuery) {
  return ["products", toApiParams(query).toString()] as const;
}

export type ProductsPage = {
  products: Product[];
  total: number;
  facets: Facets | null;
};

/**
 * Reads go through the proxy, which attaches the credential server-side. The
 * browser never sees one.
 *
 * A 400 is surfaced with the API's own parameter message rather than a generic
 * line: the one way to provoke one here is an out-of-range price or a stale
 * saved filter, and `details.params.min_price` says which. Note the envelope
 * key — parameter errors arrive under `params`, and the **attributes filter is
 * the exception**, reporting under `details.fields.attributes` with
 * `details.facetable_attributes` beside it at the `details` level.
 */
export async function fetchProducts(query: ProductsQuery): Promise<ProductsPage> {
  const response = await fetch(`/api/ac/products?${toApiParams(query)}`, {
    headers: { Accept: "application/json" },
  });

  const body = (await response.json()) as {
    success?: boolean;
    data?: unknown;
    meta?: { total?: number; facets?: Facets };
    error?: { code?: string; message?: string; details?: Record<string, unknown> };
  };

  if (!response.ok || body.success === false) {
    const details = body.error?.details ?? {};
    const params = details.params as Record<string, string> | undefined;
    const fields = details.fields as Record<string, string> | undefined;
    const first =
      (params && Object.values(params)[0]) ??
      (fields && Object.values(fields)[0]) ??
      body.error?.message;

    const error = new Error(first ?? `Request failed (${response.status})`);
    Object.assign(error, { status: response.status, code: body.error?.code });
    throw error;
  }

  return {
    products: (body.data ?? []) as Product[],
    total: body.meta?.total ?? 0,
    facets: body.meta?.facets ?? null,
  };
}
