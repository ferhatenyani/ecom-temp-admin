import type { InventoryItem, Movement, MovementSummary } from "@/lib/api/schemas/inventory";
import { isKnownReason } from "@/lib/movement-reason";

/**
 * One route, three views, and the view is in the URL like every other piece of
 * filter state in this panel.
 *
 * **Low stock is the default and the segmented control is how the screen says
 * so.** docs/ADMIN_PANEL.md's line is "built for a phone in a warehouse; the
 * default screen is low stock, not the full list", and a control whose first
 * segment is already selected states that without a second route to get lost in.
 * The full list and the ledger are one tap away and neither is where the screen
 * opens.
 */
export const VIEWS = ["low", "all", "moves"] as const;
export type View = (typeof VIEWS)[number];

export function viewFromParam(value: string | null | undefined): View {
  return (VIEWS as readonly string[]).includes(value ?? "") ? (value as View) : "low";
}

/**
 * 20 for the stock lists, which is the API's own default and the right size for a
 * phone. **`per_page` caps at 100 and 101 is a 400, not a clamp** — measured on
 * `/inventory/movements`, the same behaviour `/orders` and `/products` have.
 */
export const PER_PAGE = 20;

/**
 * The ledger's page size is the same 20, against 1154 rows and 58 pages.
 *
 * docs/ADMIN_PANEL.md warns that an import writes one movement per line and that
 * pagination "has to expect that". It does: nothing here accumulates pages in
 * memory, `?page=999` answers 200 with an empty array rather than an error
 * (measured), and the page control is driven by `meta.total_pages` so it stops
 * where the data does.
 */
export const MOVES_PER_PAGE = 20;

/**
 * What the three views filter by.
 *
 * The stock filters and the ledger filters are separate sets on purpose — they
 * share no parameter and `/inventory` and `/inventory/movements` accept entirely
 * different ones. Keeping them in one object with a `view` discriminator would
 * let a stock filter survive a switch to the ledger and silently do nothing,
 * which is the failure mode this API makes easy: **an unknown query parameter is
 * ignored with a 200**, verified here as everywhere else — `/inventory?nonsense=zzz`
 * returns all 28 rows, identical to no filter at all.
 *
 * A *known* parameter with a bad value is different and does refuse:
 * `?stock_status=zzz` and `?reason=zzz` are both 400. So the panel can send a
 * wrong value and hear about it, and can send a wrong *name* and hear nothing.
 */
export type InventoryQuery = {
  view: View;

  /* --- the stock views ------------------------------------------------- */
  search: string;
  /** `""`, `"instock"`, `"outofstock"`, `"onbackorder"`. Not on the low view. */
  stockStatus: string;
  /** `""` | `"true"` | `"false"` — absent is not `false`, and both filter. */
  manageStock: string;
  page: number;

  /* --- the ledger ------------------------------------------------------ */
  /** One of the nine, or `""`. The union, not the six a person may write. */
  reason: string;
  /** A product id, set by tapping through from an item. */
  productId: string;
  /** `"me"` when the ledger is filtered to the signed-in actor, else `""`. */
  actor: string;
  /** `YYYY-MM-DD`. Anything else is a 400 — the API validates the format. */
  dateFrom: string;
  dateTo: string;
  movesPage: number;
};

export const EMPTY_QUERY: InventoryQuery = {
  view: "low",
  search: "",
  stockStatus: "",
  manageStock: "",
  page: 1,
  reason: "",
  productId: "",
  actor: "",
  dateFrom: "",
  dateTo: "",
  movesPage: 1,
};

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

/** `YYYY-MM-DD` and nothing else — the API answers 400 to any other shape. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function queryFromParams(params: URLSearchParams): InventoryQuery {
  const reason = params.get("reason") ?? "";
  const dateFrom = params.get("date_from") ?? "";
  const dateTo = params.get("date_to") ?? "";

  return {
    view: viewFromParam(params.get("view")),
    search: params.get("search") ?? "",
    stockStatus: params.get("stock_status") ?? "",
    manageStock: params.get("manage_stock") ?? "",
    page: positive(params.get("page")),
    // A hand-edited or stale URL must not be able to provoke a 400 the screen
    // then has to render as an error. An unknown reason is dropped, not sent.
    reason: isKnownReason(reason) ? reason : "",
    productId: /^\d+$/.test(params.get("product_id") ?? "") ? params.get("product_id")! : "",
    actor: params.get("actor") === "me" ? "me" : "",
    dateFrom: ISO_DATE.test(dateFrom) ? dateFrom : "",
    dateTo: ISO_DATE.test(dateTo) ? dateTo : "",
    movesPage: positive(params.get("moves_page")),
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
    per_page: String(PER_PAGE),
    page: String(query.page),
    include_variations: "true",
  });

  if (query.search !== "") params.set("search", query.search);
  if (query.stockStatus !== "") params.set("stock_status", query.stockStatus);
  if (query.manageStock !== "") params.set("manage_stock", query.manageStock);
  return params;
}

/**
 * The low-stock request.
 *
 * `/inventory/low-stock` takes **pagination and `status` only** — verified
 * against the live router, which registers `lowStockArgs()` as exactly that. It
 * has no search, no `stock_status` and no `include_variations`, so the low view
 * renders none of those controls rather than rendering ones that would be
 * silently ignored.
 */
export function lowStockParams(query: InventoryQuery): URLSearchParams {
  return new URLSearchParams({ per_page: String(PER_PAGE), page: String(query.page) });
}

/**
 * The ledger request.
 *
 * `actor=me` becomes `?actor_id={my id}` — the id comes from `/auth/me`, which
 * every role can read, and is the one identity filter the panel can honestly
 * offer. See `movementActor()` for why it is a filter and not a column.
 */
export function movementParams(query: InventoryQuery, meId: number | null): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(MOVES_PER_PAGE),
    page: String(query.movesPage),
  });

  if (query.reason !== "") params.set("reason", query.reason);
  if (query.productId !== "") params.set("product_id", query.productId);
  if (query.dateFrom !== "") params.set("date_from", query.dateFrom);
  if (query.dateTo !== "") params.set("date_to", query.dateTo);
  if (query.actor === "me" && meId !== null) params.set("actor_id", String(meId));
  return params;
}

/** The summary takes the ledger's filters minus its pagination. */
export function summaryParams(query: InventoryQuery, meId: number | null): URLSearchParams {
  const params = movementParams(query, meId);
  params.delete("per_page");
  params.delete("page");
  return params;
}

/** The URL the panel shows: only what differs from the defaults. */
export function toUrlParams(query: InventoryQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.view !== "low") params.set("view", query.view);

  if (query.view === "moves") {
    if (query.reason !== "") params.set("reason", query.reason);
    if (query.productId !== "") params.set("product_id", query.productId);
    if (query.actor !== "") params.set("actor", query.actor);
    if (query.dateFrom !== "") params.set("date_from", query.dateFrom);
    if (query.dateTo !== "") params.set("date_to", query.dateTo);
    if (query.movesPage > 1) params.set("moves_page", String(query.movesPage));
    return params;
  }

  if (query.view === "all") {
    if (query.search !== "") params.set("search", query.search);
    if (query.stockStatus !== "") params.set("stock_status", query.stockStatus);
    if (query.manageStock !== "") params.set("manage_stock", query.manageStock);
  }
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

/** Whether the *current view* is narrowed, which is what the empty state asks. */
export function isFiltered(query: InventoryQuery): boolean {
  if (query.view === "moves") {
    return (
      query.reason !== "" ||
      query.productId !== "" ||
      query.actor !== "" ||
      query.dateFrom !== "" ||
      query.dateTo !== ""
    );
  }
  if (query.view === "low") return false;
  return query.search !== "" || query.stockStatus !== "" || query.manageStock !== "";
}

/* ------------------------------------------------------------- fetching --- */

export type StockPage = { items: InventoryItem[]; total: number };
export type MovementsPage = { movements: Movement[]; total: number };

/** The query key mirrors the request, so the two can never disagree. */
export function stockKey(query: InventoryQuery) {
  return query.view === "low"
    ? (["inventory", "low", lowStockParams(query).toString()] as const)
    : (["inventory", "all", stockParams(query).toString()] as const);
}

export function movementsKey(query: InventoryQuery, meId: number | null) {
  return ["inventory", "moves", movementParams(query, meId).toString()] as const;
}

export function summaryKey(query: InventoryQuery, meId: number | null) {
  return ["inventory", "summary", summaryParams(query, meId).toString()] as const;
}

/**
 * Reads go through the proxy, which attaches the credential server-side. The
 * browser never holds one.
 *
 * The API's own parameter message is surfaced rather than a generic line, and it
 * arrives under `details.params` — **which has two shapes on this API**. For a
 * bad value it is an object of messages (`{"per_page": "per_page must be between
 * 1 and 100"}`); for a missing required parameter it is an *array* of names
 * (`{"params": ["sku"]}`, measured on `/inventory/lookup` with no `sku`). Both
 * are handled, because a panel that renders `[object Object]` at a person in a
 * stockroom has told them nothing.
 */
async function read<T>(path: string): Promise<{ data: T; total: number }> {
  const response = await fetch(`/api/ac${path}`, { headers: { Accept: "application/json" } });
  const body = (await response.json()) as {
    success?: boolean;
    data?: unknown;
    meta?: { total?: number };
    error?: { code?: string; message?: string; details?: Record<string, unknown> };
  };

  if (!response.ok || body.success === false) {
    const details = body.error?.details ?? {};
    const params = details.params;
    const fields = details.fields as Record<string, string> | undefined;

    const fromParams = Array.isArray(params)
      ? undefined // a list of missing names, not a message — the generic line is better
      : params && typeof params === "object"
        ? Object.values(params as Record<string, string>)[0]
        : undefined;

    const first = fromParams ?? (fields && Object.values(fields)[0]) ?? body.error?.message;
    const error = new Error(first ?? `Request failed (${response.status})`);
    Object.assign(error, { status: response.status, code: body.error?.code });
    throw error;
  }

  return { data: (body.data ?? []) as T, total: body.meta?.total ?? 0 };
}

export async function fetchStock(query: InventoryQuery): Promise<StockPage> {
  const path =
    query.view === "low"
      ? `/inventory/low-stock?${lowStockParams(query)}`
      : `/inventory?${stockParams(query)}`;
  const { data, total } = await read<InventoryItem[]>(path);
  return { items: data, total };
}

export async function fetchMovements(
  query: InventoryQuery,
  meId: number | null,
): Promise<MovementsPage> {
  const { data, total } = await read<Movement[]>(
    `/inventory/movements?${movementParams(query, meId)}`,
  );
  return { movements: data, total };
}

export async function fetchSummary(
  query: InventoryQuery,
  meId: number | null,
): Promise<MovementSummary> {
  const { data } = await read<MovementSummary>(
    `/inventory/movements/summary?${summaryParams(query, meId)}`,
  );
  return data;
}
