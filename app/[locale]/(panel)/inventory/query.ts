import type { InventoryItem } from "@/lib/api/schemas/inventory";
import { acRead } from "@/lib/api/browser";

/**
 * The stock list's own query, and **only** the stock list's.
 *
 * The ledger used to live here behind a `view: "moves"` discriminator, and it
 * moved out with the route — `inventory/movements/query.ts` is its half now. The
 * old file's own docblock said why the two parameter sets had to stay separate:
 * they share no parameter, `/inventory` and `/inventory/movements` accept
 * entirely different ones, and **an unknown query parameter is ignored with a
 * 200** on this API (`/inventory?nonsense=zzz` returns all 28 rows, identical to
 * no filter at all). Keeping both in one object made it possible for a stock
 * filter to survive a switch to the ledger and silently do nothing. Two routes
 * make that unrepresentable rather than merely discouraged.
 *
 * A *known* parameter with a bad value does refuse: `?stock_status=zzz` is a 400.
 * So the panel can send a wrong value and hear about it, and can send a wrong
 * *name* and hear nothing.
 */

/**
 * Two views, one endpoint each.
 *
 * `all` is `/inventory` and takes the whole filter set. `low` is
 * `/inventory/low-stock` and takes **pagination only** — verified against the
 * live router, which registers `lowStockArgs()` as exactly that. That is why the
 * low tab renders neither the search field nor the filter button rather than
 * disabling them: not rendering a control that cannot act is the rule the nav
 * already follows for capabilities, and here it is load-bearing, because a
 * parameter this endpoint does not know answers 200 with the full report.
 *
 * The order is the tab order — All first, the way the orders and products strips
 * read. The *default* is `low`, which is a different question and is
 * `DEFAULT_VIEW` below.
 */
export const VIEWS = ["all", "low"] as const;
export type View = (typeof VIEWS)[number];

/**
 * docs/ADMIN_PANEL.md: "built for a phone in a warehouse; the default screen is
 * low stock, not the full list." The tab strip states that by opening with its
 * second tab active, which is unusual and is the point — arriving at `/inventory`
 * is arriving at a report, and the strip says which one.
 */
export const DEFAULT_VIEW: View = "low";

export function viewFromParam(value: string | null | undefined): View {
  return (VIEWS as readonly string[]).includes(value ?? "") ? (value as View) : DEFAULT_VIEW;
}

/**
 * 20, the API's own default, and `TableFooter` offers 50 and 100 beside it.
 * **`per_page` caps at 100 and 101 is a 400, not a clamp** — measured on
 * `/inventory/movements`, the same behaviour `/orders` and `/products` have.
 */
export const PER_PAGE = 20;

const PER_PAGE_CHOICES = [20, 50, 100];

export type InventoryQuery = {
  view: View;
  search: string;
  /** `""`, `"instock"`, `"outofstock"`, `"onbackorder"`. Not on the low view. */
  stockStatus: string;
  /** `""` | `"true"` | `"false"` — absent is not `false`, and both filter. */
  manageStock: string;
  page: number;
  perPage: number;
};

export const EMPTY_QUERY: InventoryQuery = {
  view: DEFAULT_VIEW,
  search: "",
  stockStatus: "",
  manageStock: "",
  page: 1,
  perPage: PER_PAGE,
};

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

export function queryFromParams(params: URLSearchParams): InventoryQuery {
  const perPage = Number.parseInt(params.get("per_page") ?? "", 10);

  return {
    view: viewFromParam(params.get("view")),
    search: params.get("search") ?? "",
    stockStatus: params.get("stock_status") ?? "",
    manageStock: params.get("manage_stock") ?? "",
    page: positive(params.get("page")),
    /* Clamped to what the footer offers rather than passed through: 101 is a 400
       on this API and a hand-edited URL must not be able to provoke one that the
       screen then has to render as an error. */
    perPage: PER_PAGE_CHOICES.includes(perPage) ? perPage : PER_PAGE,
  };
}

/**
 * The stock list request.
 *
 * **`include_variations=true`, and this is the branch's largest correction to the
 * spec's shorthand.** `GET /inventory` defaults it to `false`, which is why the
 * full list is 28 rows while `?include_variations=true` is 33 — and why the
 * default list does not contain "Burnous en laine - L", a row `/inventory/low-stock`
 * puts on the first screen. Measured: the low-stock report always includes
 * variations, the list does not, and with the default the two disagree about
 * which rows exist. A stock screen that omits the rows actually holding the stock
 * is not a stock screen, so the panel asks for them.
 */
export function stockParams(query: InventoryQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(query.perPage),
    page: String(query.page),
    include_variations: "true",
  });

  if (query.search !== "") params.set("search", query.search);
  if (query.stockStatus !== "") params.set("stock_status", query.stockStatus);
  if (query.manageStock !== "") params.set("manage_stock", query.manageStock);
  return params;
}

/**
 * The low-stock request. Pagination and nothing else — see `VIEWS`.
 */
export function lowStockParams(query: InventoryQuery): URLSearchParams {
  return new URLSearchParams({
    per_page: String(query.perPage),
    page: String(query.page),
  });
}

/** The URL the panel shows: only what differs from the defaults. */
export function toUrlParams(query: InventoryQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.view !== DEFAULT_VIEW) params.set("view", query.view);

  if (query.view === "all") {
    if (query.search !== "") params.set("search", query.search);
    if (query.stockStatus !== "") params.set("stock_status", query.stockStatus);
    if (query.manageStock !== "") params.set("manage_stock", query.manageStock);
  }
  if (query.page > 1) params.set("page", String(query.page));
  if (query.perPage !== PER_PAGE) params.set("per_page", String(query.perPage));
  return params;
}

/**
 * Whether the *current view* is narrowed, which is what the empty state asks.
 *
 * `low` is unconditionally false, and that is correct rather than an oversight:
 * the report takes no filters, so there is nothing an empty low-stock screen
 * could offer to clear. What it used to leave unanswered is the *other* way a
 * list can be empty with rows behind it — a page past the last one — and that is
 * `isOverPaged()` below rather than a lie told here.
 */
export function isFiltered(query: InventoryQuery): boolean {
  if (query.view === "low") return false;
  return query.search !== "" || query.stockStatus !== "" || query.manageStock !== "";
}

/**
 * An empty page that is not an empty result.
 *
 * `?page=3` of a two-page report answers 200 with an empty array — measured, the
 * same behaviour `/inventory/movements` has — so the list renders its empty state
 * with a page control that is not on screen, because the footer lives inside the
 * table that was not drawn. On the `all` view "clear the filters" was at least a
 * way out; on `low` `isFiltered()` is false by construction and the browser's
 * back button was the only escape from a screen the panel itself had navigated
 * to. So the empty state offers the first page whenever the reader is past it,
 * on both views, and that answer does not depend on there being a filter.
 */
export function isOverPaged(query: InventoryQuery): boolean {
  return query.page > 1;
}

/* ------------------------------------------------------------- fetching --- */

export type StockPage = { items: InventoryItem[]; total: number };

/** The query key mirrors the request, so the two can never disagree. */
export function stockKey(query: InventoryQuery) {
  return query.view === "low"
    ? (["inventory", "low", lowStockParams(query).toString()] as const)
    : (["inventory", "all", stockParams(query).toString()] as const);
}

/**
 * Reads go through the proxy, which attaches the credential server-side; the
 * browser never holds one. `acRead` is the shared reader — this module used to
 * carry its own copy, and `lib/api/browser.ts` records what that cost: the copy
 * that handles `details.params` arriving as an *array* was not always the copy
 * whose screen someone tested, and `/inventory/lookup` is the one endpoint
 * measured to send that shape.
 */
export async function fetchStock(query: InventoryQuery): Promise<StockPage> {
  const path =
    query.view === "low"
      ? `/inventory/low-stock?${lowStockParams(query)}`
      : `/inventory?${stockParams(query)}`;
  const { data, total } = await acRead<InventoryItem[]>(path);
  return { items: data, total };
}
