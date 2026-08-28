/**
 * The segment list's URL state: a sort and a reading position, and nothing else.
 *
 * ## Sorting ships on `name`, and on `name` alone
 *
 * Measured 2026-08-28 against the live router, over the shop's four segments:
 *
 *   bare (the resting order)        [46, 44, 43, 45]   `name asc` is the default
 *   orderby=name&order=desc         [45, 43, 44, 46]   the exact reverse
 *   orderby=id&order=asc            [43, 44, 45, 46]
 *   orderby=id&order=desc           [46, 45, 44, 43]   **differs from name desc**
 *   orderby=created_at asc AND desc [43, 44, 45, 46]   identical in both
 *   orderby=updated_at asc AND desc [43, 44, 45, 46]   identical in both
 *   ?orderby=zzz                    400
 *
 * The standing rule wants a positive control that is not the collection's resting
 * order, and this collection makes that awkward in a way worth writing down:
 * `name asc` **is** the default, so it proves nothing on its own, and the two
 * stamp fields prove nothing either — all four segments were seeded in one pass
 * and share a single `created_at` and a single `updated_at`, so both directions
 * tie on every row and fall back to primary-key order. That is the coupons `date`
 * trap made permanent, and it is a property of the shop rather than of the
 * parameter.
 *
 * So the control is two-part and both halves are needed. **`name desc` reverses
 * the default exactly**, which a parameter that were merely accepted-and-ignored
 * could not do. And **`id desc` differs from `name desc`**, which proves
 * `orderby` *discriminates between fields* rather than the router having one
 * hard-coded reversal. Neither alone would be enough.
 *
 * **`created_at` and `updated_at` therefore ship no control**, and the reason is
 * not that they are broken: they are accepted, validated and honoured, and they
 * simply cannot be shown to do anything on this fixture. The remedy is a fixture
 * with distinct stamps, not a control; until then, offering a sort whose two
 * directions render identically would be a control that appears to do nothing.
 * **`id` earns no column either** — four segments named by a person, and a column
 * of primary keys is nothing anybody would scan.
 *
 * ## The resting order sends no `orderby` at all
 *
 * `name asc` is the default, so asking for it explicitly is a parameter that
 * changes nothing in every URL for ever. The header's third click drops it and
 * returns to rest, which is `DataTable`'s own cycle — so in practice the one
 * sortable header toggles between the resting ascending order and its reverse,
 * which is exactly the shape of a collection with one axis.
 *
 * ## No search, and the parameter is not merely unmeasured
 *
 * `?search=Alger` answers **all four rows**, not the one whose name starts with
 * it. The route declares no such argument at all, so the value reaches nothing —
 * this is the "accepted and ignored" case rather than the "nobody has asked" one,
 * and a search box would be a control that silently does nothing.
 */

/** The four values the 400 enumerates, in the order it prints them. */
const ACCEPTED_ORDERBY = ["name", "created_at", "updated_at", "id"] as const;
export type OrderBy = (typeof ACCEPTED_ORDERBY)[number];

export const PER_PAGE_OPTIONS = [20, 50, 100] as const;
export const PER_PAGE = 20;

export type SegmentsQuery = {
  orderby: OrderBy;
  order: "asc" | "desc";
  page: number;
  perPage: number;
};

export const EMPTY_QUERY: SegmentsQuery = {
  orderby: "name",
  order: "asc",
  page: 1,
  perPage: PER_PAGE,
};

/**
 * The one guard, used by both directions of travel. `?orderby=zzz` is a measured
 * 400, so a hand-edited URL must not be able to provoke one — and a header cycle
 * hands back a plain `string`, which is only related to this enum by
 * construction until something checks.
 */
export function orderbyFromKey(key: string | null): OrderBy {
  return (ACCEPTED_ORDERBY as readonly string[]).includes(key ?? "")
    ? (key as OrderBy)
    : EMPTY_QUERY.orderby;
}

export function queryFromParams(params: URLSearchParams): SegmentsQuery {
  const perPage = Number.parseInt(params.get("per_page") ?? "", 10);
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  return {
    orderby: orderbyFromKey(params.get("orderby")),
    /* This collection's own default is `asc` — measured: the bare listing is
       `name` ascending — which is the opposite of `/campaigns`, whose default is
       `desc`. Two collections, two defaults, neither generalised. */
    order: params.get("order") === "desc" ? "desc" : "asc",
    page,
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage) ? perPage : PER_PAGE,
  };
}

export function listParams(query: SegmentsQuery): URLSearchParams {
  return new URLSearchParams({
    per_page: String(query.perPage),
    page: String(query.page),
    orderby: query.orderby,
    order: query.order,
  });
}

/** The URL the panel shows: only what differs from the defaults. */
export function toUrlParams(query: SegmentsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.orderby !== EMPTY_QUERY.orderby) params.set("orderby", query.orderby);
  if (query.order !== EMPTY_QUERY.order) params.set("order", query.order);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.perPage !== EMPTY_QUERY.perPage) params.set("per_page", String(query.perPage));
  return params;
}

/** The query key mirrors the request, so the two can never disagree. */
export function segmentsKey(query: SegmentsQuery) {
  return ["segments", "list", listParams(query).toString()] as const;
}
