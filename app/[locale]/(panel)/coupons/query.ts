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
 * `date, id, code, usage`, as the 400 enumerates them — and **all four sort, in
 * both directions.**
 *
 * Re-measured 2026-08-25 against the live router, one value at a time and
 * against a positive control:
 *
 *   id     no `order` → 30, 29, 28, 27;   `asc` → 27, 28, 29, 30
 *   code   `asc` → bienvenue10, livraison, ramadan2000, tapis15 — alphabetical
 *   usage  `desc` → 99, 50, 5, 1;  `asc` → 1, 5, 50, 99 — **numeric**, not lexical
 *   date   the default ordering, and the one value that can prove nothing
 *
 * Anything else is a 400, `order=sideways` is a 400, `?orderby=` is the absence
 * of the parameter rather than a fifth value, and `order` defaults to `desc`.
 *
 * ## Why this file used to say nothing sorts — the part worth writing down
 *
 * It recorded `orderby` as "accepted, validated and then ignored", and the
 * control behind that was taken on `date`. `date` is this collection's *default*
 * ordering, so `date asc` and `date desc` are both compared against the sequence
 * they already produce. Worse: the shop's four coupons share a single
 * `post_date`, so every comparison ties and both directions fall back to
 * primary-key order — answering the unparameterised listing byte for byte. A
 * working sort and a dead one are indistinguishable through that value.
 *
 * **A control taken on a collection's default ordering is not a control**, and
 * the absence of a positive control is not evidence of absence. The same shape
 * recurs wherever a collection's default `orderby` is also one of its offered
 * values, which is most of them — so measure a *non-default* value, against rows
 * whose order under it is known to differ.
 *
 * ## What ships, and what deliberately does not
 *
 * `code`, `usage` and `id` carry a `sortKey` in `columns.tsx`, the list passes
 * `onSortChange`, and those three headers announce `aria-sort`. No column
 * declares `sortDirections`: all eight combinations were measured, unlike
 * products' `title`, where only ascending ever was.
 *
 * **`date` gets no header control**, and not for want of evidence. It is
 * `date_created`; the only date on this list is `expires` (`date_expires`),
 * which is a different field and one the API cannot sort by. Adding a "created"
 * column purely to hang a sort on would be chrome. So `date` stays the resting
 * order with no control, which is honest — and `DataTable`'s
 * `none → asc → desc → none` cycle returns to it by dropping `orderby` from the
 * URL on the third click.
 *
 * The guard below stays regardless of any of that: a hand-edited or stale URL
 * must not be able to provoke a 400 the screen then has to render as an error.
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

/**
 * The one guard, used by both directions of travel.
 *
 * A hand-edited or stale URL must not be able to provoke a 400 the screen then
 * has to render as an error, and a header cycle handing back a key must not be
 * able to either — `SortState.key` is a plain `string`, so the column's `sortKey`
 * and this enum are only related by construction until something checks. Both
 * paths fall back to the default rather than travelling.
 */
export function orderbyFromKey(key: string | null): OrderBy {
  return (ACCEPTED_ORDERBY as readonly string[]).includes(key ?? "")
    ? (key as OrderBy)
    : EMPTY_QUERY.orderby;
}

export function queryFromParams(params: URLSearchParams): CouponsQuery {
  const status = params.get("status") ?? "";
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
    /* `?orderby=zzz` is a 400 the same way `?status=trash` is, so it falls back
       too. `?orderby=date` is honoured rather than rewritten even though no
       header can produce it: it is a legal request that happens to name the
       resting order, and `toUrlParams` drops it again on the next commit. */
    orderby: orderbyFromKey(params.get("orderby")),
    /* `order` is only ever read alongside `orderby`, and the API's own default
       is `desc` — measured: `orderby=id` with no `order` answers 30, 29, 28, 27. */
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
