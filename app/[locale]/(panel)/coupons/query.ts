import { COUPON_STATUSES, type CouponStatus } from "@/lib/coupon-status";
import type { Coupon } from "@/lib/api/schemas/coupon";

/**
 * The coupon list's URL state.
 *
 * Measured 2026-08-19 against the live router: `search`, `status`, `orderby`,
 * `order` and pagination. `?code=` and `?discount_type=` are **not** parameters —
 * both come back 200 with all six rows, which is this API's standard trap and the
 * reason each one was sent on its own rather than assumed from the documentation.
 *
 * **`?search=` matches the code and nothing else**, and the screen says so rather
 * than implying otherwise. `?search=fidélité` — a word that appears only in a
 * description — returns 0 rows while `?search=bienvenue` returns 1. The customers
 * list is why this is stated at all: a search box that claimed two fields the API
 * had never been seen to match shipped for three branches there and made an
 * entire empty state unreachable. So the field is labelled "rechercher un code",
 * and `empty.noResults` repeats the limit — because the person who needs that
 * sentence is the one already looking at no results.
 */

/**
 * `?status=` takes `publish` or `draft`, and **the default is neither**.
 *
 * Sending no status returns publish *and* draft together — measured: the list is
 * 6 rows with one of them drafted, and `?status=publish` returned the same 6
 * before that coupon was drafted. So "all" is the absence of the parameter, not a
 * value, and the segmented control's first segment sends nothing.
 *
 * `?status=trash` is a 400. A trashed coupon is readable by id and invisible to
 * the list, which is why `READABLE_COUPON_STATUSES` is wider than this.
 */
export const STATUS_FILTERS = ["", ...COUPON_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * `date, id, code, usage`, as the 400 enumerates them — and **nothing on this
 * screen sorts.**
 *
 * `orderby` is accepted, validated and then ignored: all four values return an
 * identical id sequence, measured against the mock in `tests/mock-api.test.ts`,
 * which reproduces the live router's behaviour on purpose so a sort cannot be
 * "verified" here and shipped broken. This is Orders' and Customers' position
 * rather than Products', which ships sortable headers off five re-measured
 * combinations. So no column carries a `sortKey`, the list passes no
 * `onSortChange`, and no header announces `aria-sort`.
 *
 * The guard below stays regardless, and it is the only reason this list is kept:
 * a hand-edited or stale URL must not be able to provoke a 400 the screen then
 * has to render as an error.
 */
const ACCEPTED_ORDERBY = ["date", "id", "code", "usage"] as const;
export type OrderBy = (typeof ACCEPTED_ORDERBY)[number];

/**
 * Page size, and the three the footer offers.
 *
 * **Page and per-page live in the URL here, as they do on customers** — the
 * arrangement `TableFooter` is written against, so the control can be used as-is
 * rather than wrapped. The reason is the same one: this list has two filters, so
 * the URL is short enough that the reading position is worth carrying in it. The
 * products list holds both in component state because its nine filter dimensions
 * make the shareable URL the *filter* rather than the position.
 *
 * All three values are ≤ 100, which is not decoration: **`per_page=101` is a
 * measured 400, not a clamp**, on this collection and on both picker routes. A
 * stale `?per_page=37` falls back rather than travelling, because the control
 * could not represent it afterwards.
 */
export const PER_PAGE_OPTIONS = [20, 50, 100] as const;
export const PER_PAGE = 20;

export type CouponsQuery = {
  search: string;
  status: StatusFilter;
  orderby: OrderBy;
  order: "asc" | "desc";
  page: number;
  perPage: number;
};

export const EMPTY_QUERY: CouponsQuery = {
  search: "",
  status: "",
  orderby: "date",
  order: "desc",
  page: 1,
  perPage: PER_PAGE,
};

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

export function queryFromParams(params: URLSearchParams): CouponsQuery {
  const status = params.get("status") ?? "";
  const orderby = params.get("orderby") ?? "";
  const perPage = Number.parseInt(params.get("per_page") ?? "", 10);

  return {
    search: params.get("search") ?? "",
    /*
     * A hand-edited or stale URL must not be able to provoke a 400 the screen
     * then renders as an error. `?status=trash` is exactly that URL — a plausible
     * guess, and a 400 — so anything outside the two falls back to no filter.
     */
    status: (COUPON_STATUSES as readonly string[]).includes(status)
      ? (status as CouponStatus)
      : "",
    orderby: (ACCEPTED_ORDERBY as readonly string[]).includes(orderby)
      ? (orderby as OrderBy)
      : "date",
    order: params.get("order") === "asc" ? "asc" : "desc",
    page: positive(params.get("page")),
    /* Falls back rather than travelling: the footer's select could not represent
       a `?per_page=37`, and a control that cannot show the state it is in is a
       control that lies about it. */
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage) ? perPage : PER_PAGE,
  };
}

export function listParams(query: CouponsQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(query.perPage),
    page: String(query.page),
    orderby: query.orderby,
    order: query.order,
  });

  if (query.search !== "") params.set("search", query.search);
  // Deliberately omitted when empty: absent means publish *and* draft, and
  // `?status=` with an empty value is a legal request that means the same thing
  // but leaves a meaningless parameter in every URL.
  if (query.status !== "") params.set("status", query.status);
  return params;
}

/** The URL the panel shows: only what differs from the defaults. */
export function toUrlParams(query: CouponsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search !== "") params.set("search", query.search);
  if (query.status !== "") params.set("status", query.status);
  if (query.orderby !== EMPTY_QUERY.orderby) params.set("orderby", query.orderby);
  if (query.order !== EMPTY_QUERY.order) params.set("order", query.order);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.perPage !== EMPTY_QUERY.perPage) params.set("per_page", String(query.perPage));
  return params;
}

export function isFiltered(query: CouponsQuery): boolean {
  return query.search !== "" || query.status !== "";
}

/* --------------------------------------------------------- the pickers --- */

/**
 * The picker's page size.
 *
 * 50 rather than 20: a picker is scanned, not paged through, and this shop's
 * whole catalogue is 28 products. `per_page` caps at 100 and **101 is a 400, not
 * a clamp**, the same as everywhere else on this API.
 */
export const PICKER_PER_PAGE = 50;

export function pickerParams(search: string, page: number): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(PICKER_PER_PAGE),
    page: String(page),
  });

  if (search !== "") params.set("search", search);
  return params;
}

/* ------------------------------------------------------------- fetching --- */

export type CouponsPage = { coupons: Coupon[]; total: number };

/** The query key mirrors the request, so the two can never disagree. */
export function couponsKey(query: CouponsQuery) {
  return ["coupons", listParams(query).toString()] as const;
}

export function pickerKey(kind: "products" | "categories", search: string, page: number) {
  return ["coupons", "picker", kind, pickerParams(search, page).toString()] as const;
}
