import { acRead } from "@/lib/api/browser";
import type { Facets, Product } from "@/lib/api/schemas/product";
import { DEFAULT_SORT_KEY, sortFromKey } from "@/lib/product-status";

/**
 * Filter state lives in the URL, so a link to a filtered catalogue is shareable,
 * a refresh keeps the filter and the back button works. The query key mirrors it,
 * so the two can never disagree.
 *
 * **Page and per-page do not.** They live in component state, which is a change
 * from this screen's first version and is deliberate consistency rather than a
 * preference: the orders list — the reference implementation for the redesign —
 * holds both in `useState`, and a run that migrates twenty screens cannot afford
 * two paging models. The argument for page-in-URL is real (a shareable link to
 * page 4), and if it wins later it should win everywhere in one change rather
 * than screen by screen. `TableFooter` is the one control involved, so that
 * change is small; a panel where half the lists put the page in the URL is not.
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
  /**
   * No control on the screen writes this, and it is still read, still sent and
   * still removable as a chip.
   *
   * `search` already matches SKUs — measured, `?search=AC-TAP` narrows the list
   * the same way `?sku=AC-TAP` does — so a second box beside the first would be
   * two controls for one job, and the one a person reaches for first would be
   * whichever was closer. But the parameter costs nothing to keep working, a
   * saved link may carry it, and `e2e/products.spec.ts` navigates by it to
   * resolve a detail URL without hard-coding an id that the backend's own suite
   * recreates on every run.
   */
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
  /** `"{orderby}-{order}"`, and only ever one of the five in `SORTS`. */
  sort: string;
  /** Component state, not the URL. See the module docblock. */
  page: number;
  /** Chosen in the table footer. Capped at 100. */
  perPage: number;
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
  perPage: PER_PAGE,
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
    /* Not read from the URL. A `?page=` on an incoming link is ignored rather
       than honoured, because honouring it here and never writing it back would
       be a parameter that works once and then silently stops. */
    page: 1,
    perPage: PER_PAGE,
  };
}

/**
 * The query as the API's own parameters.
 *
 * Empty strings are dropped rather than sent — and on this collection that is
 * load-bearing rather than tidiness. **`?status=` is a 400 here** (corrected
 * 2026-08-25; this said "harmless"), as are `?orderby=` and `?order=`: the empty
 * string is not a member of any of those enums and is refused with the same
 * sentence a nonsense value gets. `/coupons` differs — there `?status=` really
 * does read as absence — so the two collections do not share one rule.
 *
 * `?min_price=` is not obviously so, and an unknown or empty parameter is
 * **ignored with a 200** rather than refused — measured, `?bogus_param=1`
 * returns all 28 rows, identical to no filter at all. So a filter that does
 * nothing looks exactly like a filter that works, and the panel never sends one
 * it does not mean.
 *
 * `orderby`/`order` go through `sortFromKey`, which is the guard that keeps this
 * to the five measured combinations: an unknown or never-measured key — `title
 * desc`, notably — falls back to the default rather than being relayed.
 */
export function toApiParams(query: ProductsQuery): URLSearchParams {
  const sort = sortFromKey(query.sort);
  const params = new URLSearchParams({
    per_page: String(query.perPage),
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

/** The URL the panel shows: the API's parameters minus the ones it always sends. */
export function toUrlParams(query: ProductsQuery): URLSearchParams {
  const params = toApiParams(query);
  for (const key of ["per_page", "page", "facets", "orderby", "order"]) params.delete(key);
  if (query.sort !== DEFAULT_SORT_KEY) params.set("sort", query.sort);
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

/**
 * How many filters the drawer is holding.
 *
 * Counted per **value**, not per dimension, so the button agrees with the chip
 * row underneath it: two categories is two. Status and search are excluded
 * because they have their own controls in the toolbar — a badge counting a filter
 * the person can already see is a number that never goes to zero.
 */
export function drawerFilterCount(query: ProductsQuery): number {
  const values = (list: string) => list.split(",").filter(Boolean).length;
  return (
    values(query.category) +
    values(query.tag) +
    (query.stockStatus !== "" ? 1 : 0) +
    (query.minPrice !== "" || query.maxPrice !== "" ? 1 : 0) +
    (query.onSale !== "" ? 1 : 0) +
    (query.featured !== "" ? 1 : 0) +
    Object.values(query.attributes).reduce((sum, slugs) => sum + values(slugs), 0)
  );
}

/** The query key mirrors the request, so the two can never disagree. */
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
 *
 * `acRead` rather than a hand-rolled reader. This module's own copy read
 * `details.params` in its object shape only, and **`details.params` has two
 * shapes on this API** — for a missing required parameter it is an array of
 * names, measured on `/inventory/lookup` as `{"params": ["sku"]}`. `Object.values`
 * of an array returns its elements, so that path would have rendered the bare
 * word `sku` as though it were an explanation. `firstMessage()` in
 * `lib/api/browser.ts` falls through to the generic message instead, and carries
 * the measurement.
 *
 * Facets come off `meta`, which is why the shared reader now returns it whole:
 * needing one key more than `total` is exactly what kept this fetcher carrying a
 * private copy of the entire envelope reader for three branches.
 */
export async function fetchProducts(query: ProductsQuery): Promise<ProductsPage> {
  const { data, total, meta } = await acRead<Product[]>(`/products?${toApiParams(query)}`);

  return {
    products: data,
    total,
    // Facets are opt-in and a response can legitimately carry none.
    facets: (meta.facets as Facets | undefined) ?? null,
  };
}
