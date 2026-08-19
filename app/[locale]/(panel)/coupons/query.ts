import { COUPON_STATUSES, type CouponStatus } from "@/lib/coupon-status";
import type { Coupon } from "@/lib/api/schemas/coupon";

/**
 * The coupon list's URL state.
 *
 * Measured 2026-08-19 against the live router: `search`, `status`, `orderby`,
 * `order` and pagination. `?code=` and `?discount_type=` are **not** parameters —
 * both come back 200 with all six rows, which is this API's standard trap and the
 * reason each one was sent on its own rather than assumed from the documentation.
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

/** `date, id, code, usage`, as the 400 enumerates them. */
export const ORDERBY = ["date", "code", "usage"] as const;
export type OrderBy = (typeof ORDERBY)[number];

const ACCEPTED_ORDERBY = ["date", "id", "code", "usage"] as const;

export const PER_PAGE = 20;

export type CouponsQuery = {
  search: string;
  status: StatusFilter;
  orderby: OrderBy;
  order: "asc" | "desc";
  page: number;
};

export const EMPTY_QUERY: CouponsQuery = {
  search: "",
  status: "",
  orderby: "date",
  order: "desc",
  page: 1,
};

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

export function queryFromParams(params: URLSearchParams): CouponsQuery {
  const status = params.get("status") ?? "";
  const orderby = params.get("orderby") ?? "";

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
  };
}

export function listParams(query: CouponsQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(PER_PAGE),
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
