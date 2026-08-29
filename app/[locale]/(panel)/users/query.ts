import { STAFF_STATUSES, isStaffStatus, type StaffStatus } from "@/lib/staff";

/**
 * The staff list's URL state.
 *
 * Measured 2026-08-29 against the harness, every parameter sent on its own
 * rather than assumed from the one beside it:
 *
 *   ?search=nadia          1 of 69   honoured — login, email, nicename and
 *                                    display name; **never a first or last
 *                                    name**, see `SEARCHED_COLUMNS`
 *   ?search=                         an **absence**, not a refusal
 *   ?status=suspended      1 of 69   honoured
 *   ?status=active        68 of 69   honoured, and it is a `NOT EXISTS` on the
 *                                    meta key rather than a comparison, because
 *                                    an active account stores no row at all
 *   ?status=                         **400** — an empty value is a value here
 *   ?role=ac_manager       5 of 69   honoured
 *   ?role=administrator    2 of 69   honoured, and no picker can offer it
 *   ?role=nonsense                   **400**
 *   ?orderby= / ?order=              a real enum in both halves — see below
 *   ?per_page=0 / =101               **400** each; 1..100 is the range
 *   ?page=999                        **200 with zero rows**, not a 404
 *
 * ## Sorting ships, and it is the strongest control this run has measured
 *
 * `UserController.php:135-140` declares `'enum' => UserRepository::ORDERBY` and
 * runs it through `rest_validate_request_arg`; `UserRepository.php:31` is the
 * list, `:89` the `in_array`, `:90` the direction. **`?orderby=zzz` and
 * `?order=zzz` are both 400**, where the same request on `/shipping` and
 * `/payments` is a silent 200 and on `/notifications` never reaches a validator
 * at all. Garbage reaching a refusal is the positive control §7 says to go and
 * take, and it is available here for free.
 *
 * Five fields × two directions were sent as ten separate requests and compared
 * over **all 69 rows**, not over a head window: **ten distinct id sequences**,
 * with `registered desc` byte-identical to the bare listing. Nothing ties —
 * every row carries a distinct login, address, display name and registration
 * minute — so a tie cannot be mistaken here for a refusal to sort, which is the
 * trap that had coupons recorded as unsortable for a week.
 *
 * Four of the five map onto columns and carry a `sortKey`; `ID` does not, and
 * that is the one editorial call in this file. A column of primary keys is
 * nothing anybody scans, and adding one purely to hang a sort on is chrome — so
 * `orderbyFromKey` still accepts it, `?orderby=ID` is a legal URL that works,
 * and no header claims it. That is exactly how coupons treats `date` and
 * marketing treats `id`, and the cost is the same: a URL-only sort leaves every
 * header honestly reading `aria-sort="none"`.
 *
 * **Below `md` there is no sort control at all**, and that is correct rather than
 * a gap: below `md` there is no table. `RecordList` is the presentation and it
 * takes no sort props, so there is no mobile sort menu to add — a control with
 * nothing on screen to act on is worse than none.
 *
 * ## The role filter ships with `/roles`'s seven, and `administrator` is
 * deliberately not the eighth
 *
 * This refines the standing rule rather than breaking it, and the difference is
 * worth stating because the rule reads the other way at a glance.
 *
 * *"A picker over a working filter ships only when the allowlisted enumeration is
 * complete"* exists **because** a wrong value is normally a silent 200 with zero
 * rows — that is true on `/shipping`, on `/notifications` and on `/media`, and
 * where it is true the picker is the only thing that can keep a typo
 * unreachable. **Here it is false**: `?role=nonsense` is a 400 naming the eight
 * values it will take. The validator does the typo-guard's job, so the picker is
 * not load-bearing as one.
 *
 * What is left is *reachability*, and there the enumeration is genuinely
 * incomplete. `GET /roles` publishes seven rows and no `administrator`, while
 * `?role=administrator` answers **two real accounts**. Hand-adding an eighth
 * option would be the panel copying a server constant into itself, which is
 * precisely what the notifications channel filter was taken off a shipped screen
 * for (§16). So:
 *
 *   - seven options, read from `/roles` at render time
 *   - the two administrators stay visible in the **unfiltered** list, with their
 *     role named on the row — `roleLabel()` falls through to `role_name`
 *   - the blind spot is one filter value, not two hidden accounts
 *
 * **What would close it is one request**: an allowlisted enumeration that lists
 * the roles the *collection* carries rather than the roles the matrix defines —
 * the same shape `GET /payments/methods` has, which is why the payments filter
 * could ship and the shipping one could not.
 *
 * ## Everything else in the URL
 *
 * Page and per-page live here on the coupons shape — the arrangement
 * `TableFooter` is written against, so the control is used as-is rather than
 * wrapped. This list has three filters, which is short enough that the reading
 * position is worth carrying too.
 */

/**
 * `""` is the absence of the parameter and means both.
 *
 * Load-bearing rather than tidy: **`?status=` is a 400** on this collection —
 * *"status is not one of active and suspended."* — so a first tab sending an
 * empty string would be a refusal rather than a redundant parameter. Coupons'
 * first tab sends nothing for the opposite reason (there it would be legal and
 * meaningless); here it must not send.
 */
export const STATUS_FILTERS = ["", ...STAFF_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * The five the API takes, in `UserRepository::ORDERBY` order.
 *
 * `ID` is capitalised and the enum is case-sensitive — `?orderby=id` is a 400.
 * Worth pinning, because it is the one value here that does not look like the
 * others and the only one no header can produce.
 */
const ACCEPTED_ORDERBY = [
  "registered",
  "ID",
  "display_name",
  "user_email",
  "user_login",
] as const;
export type OrderBy = (typeof ACCEPTED_ORDERBY)[number];

/**
 * Page size, and the three the footer offers.
 *
 * All three are inside the API's measured `1..100`: `per_page=0` and
 * `per_page=101` are both 400s rather than clamps. A stale `?per_page=37` is a
 * legal request and an illegible control, so it falls back rather than
 * travelling — a control that cannot show the state it is in is a control that
 * lies about it.
 */
export const PER_PAGE_OPTIONS = [20, 50, 100] as const;
export const PER_PAGE = 20;

export type UsersQuery = {
  search: string;
  status: StatusFilter;
  /**
   * A role key, or `""`.
   *
   * **Not validated against the seven here**, and that is deliberate: the API's
   * enum is `UserRoles::staff()`, which includes `administrator`, while the
   * picker is fed from `GET /roles`, which does not. Validating against either
   * one in this file would put a third list in a third place. `queryFromParams`
   * keeps only what *looks* like a role key and lets the request decide — the
   * value is a 400 if it is wrong, and a 400 on a hand-edited URL is a screen
   * that says so rather than a screen that quietly shows everything.
   */
  role: string;
  orderby: OrderBy;
  order: "asc" | "desc";
  page: number;
  perPage: number;
};

export const EMPTY_QUERY: UsersQuery = {
  search: "",
  status: "",
  role: "",
  orderby: "registered",
  order: "desc",
  page: 1,
  perPage: PER_PAGE,
};

/** The same shape the API's own `sanitize_key` accepts. */
const ROLE_KEY = /^[a-z0-9_]+$/;

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

/**
 * The one guard, used by both directions of travel.
 *
 * A hand-edited or stale URL must not be able to provoke a 400 the screen then
 * has to render as an error, and a header cycle handing back a key must not be
 * able to either — `SortState.key` is a plain `string`, so a column's `sortKey`
 * and this enum are related only by construction until something checks.
 */
export function orderbyFromKey(key: string | null): OrderBy {
  return (ACCEPTED_ORDERBY as readonly string[]).includes(key ?? "")
    ? (key as OrderBy)
    : EMPTY_QUERY.orderby;
}

export function queryFromParams(params: URLSearchParams): UsersQuery {
  const status = params.get("status") ?? "";
  const role = params.get("role") ?? "";
  const perPage = Number.parseInt(params.get("per_page") ?? "", 10);

  return {
    search: params.get("search") ?? "",
    /*
     * A hand-edited or stale URL must not provoke a 400 the screen renders as
     * an error. `?status=disabled` is exactly that URL — a plausible guess and
     * a 400 — so anything outside the two falls back to no filter.
     */
    status: isStaffStatus(status) ? (status as StaffStatus) : "",
    role: ROLE_KEY.test(role) ? role : "",
    /* `?orderby=zzz` is a 400 the same way `?status=disabled` is, so it falls
       back too. `?orderby=registered` is honoured rather than rewritten even
       though it names the resting order: it is a legal request, and
       `toUrlParams` drops it again on the next commit. */
    orderby: orderbyFromKey(params.get("orderby")),
    /* Only ever read alongside `orderby`, and the API's own default is `desc` —
       measured: `orderby=ID` with no `order` answers 778, 776, 774, 770. */
    order: params.get("order") === "asc" ? "asc" : "desc",
    page: positive(params.get("page")),
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage) ? perPage : PER_PAGE,
  };
}

/** What goes on the wire. Only what the API actually honours. */
export function listParams(query: UsersQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(query.perPage),
    page: String(query.page),
    orderby: query.orderby,
    order: query.order,
  });

  /* Each omitted when empty rather than sent blank. `?status=` and `?role=` are
     each a 400, and `?search=` is an absence — so on two of the three a screen
     that sent a blank parameter would be refused outright. */
  if (query.search !== "") params.set("search", query.search);
  if (query.status !== "") params.set("status", query.status);
  if (query.role !== "") params.set("role", query.role);
  return params;
}

/**
 * The URL the panel shows: only what differs from the defaults.
 *
 * `push`, never `replace`, at the call site — replacing the history entry means
 * going back from a filtered list skips the unfiltered one.
 */
export function toUrlParams(query: UsersQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search !== "") params.set("search", query.search);
  if (query.status !== "") params.set("status", query.status);
  if (query.role !== "") params.set("role", query.role);
  if (query.orderby !== EMPTY_QUERY.orderby) params.set("orderby", query.orderby);
  if (query.order !== EMPTY_QUERY.order) params.set("order", query.order);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.perPage !== EMPTY_QUERY.perPage) params.set("per_page", String(query.perPage));
  return params;
}

/**
 * Whether a control on screen has narrowed the list.
 *
 * The sort is deliberately not part of this: re-ordering 69 rows does not hide
 * any of them, so a "clear filters" button that also reset the sort would undo
 * something the person did not ask to undo — and the no-results empty state
 * would offer to clear an ordering that cannot produce no results.
 */
export function isFiltered(query: UsersQuery): boolean {
  return query.search !== "" || query.status !== "" || query.role !== "";
}

/**
 * Past the last page, which on this API is a **200 with zero rows** rather than
 * a 404 — so the table is not drawn, and with it goes the only control that
 * could page back. The inventory ledger's third recorded bug, avoided rather
 * than repeated: the empty state offers the way out.
 */
export function isOverPaged(query: UsersQuery): boolean {
  return query.page > 1;
}

/** The query key mirrors the request, so the two can never disagree. */
export function usersKey(query: UsersQuery) {
  return ["users", listParams(query).toString()] as const;
}

export function rolesKey() {
  return ["roles"] as const;
}

export function userKey(id: number) {
  return ["users", id] as const;
}
