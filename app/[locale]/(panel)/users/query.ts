import { STAFF_STATUSES, isStaffStatus, type StaffStatus } from "@/lib/staff";

/**
 * The staff list's URL state.
 *
 * Measured 2026-08-21 against the live router. Every one of these was sent on
 * its own rather than assumed:
 *
 *   ?search=nadia          1 of 72   honoured — login, email, nicename and
 *                                    display name, unlike `/customers`
 *   ?role=ac_manager       7 of 72   honoured, and the enum includes the five
 *                                    retired roles plus `administrator`
 *   ?status=suspended      1 of 72   honoured — 0 before `seed-staff.mjs`
 *   ?status=active        71 of 72   honoured, and it is a `NOT EXISTS` on the
 *                                    meta key rather than a comparison, because
 *                                    an active account stores no row at all
 *   ?orderby=display_name            a real enum, 400 on a sixth value
 *
 * **No sort control is offered**, and unlike the notification queue that is a
 * screen decision rather than a measurement: the parameter works. Newest first
 * is the order somebody onboarding an account wants, sorting 72 rows by name
 * would sort mostly by username because a staff account often has neither name
 * set, and the search field answers "find this person" better than any ordering.
 */

export const PER_PAGE = 20;

/** `""` is the absence of the parameter and means both. */
export const STATUS_FILTERS = ["", ...STAFF_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export type UsersQuery = {
  search: string;
  status: StatusFilter;
  /**
   * A role key, or `""`. **Not validated against the seven here**: the enum on
   * the API is `UserRoles::staff()`, which includes `administrator`, and the
   * picker is fed from `GET /roles` at render time. A stale value is a 400 on
   * the API, so `queryFromParams` keeps only what looks like a role key and lets
   * the request decide — the alternative is a hard-coded list in two places.
   */
  role: string;
  page: number;
};

export const EMPTY_QUERY: UsersQuery = { search: "", status: "", role: "", page: 1 };

/** The same shape the API's own `sanitize_key` accepts. */
const ROLE_KEY = /^[a-z0-9_]+$/;

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

export function queryFromParams(params: URLSearchParams): UsersQuery {
  const status = params.get("status") ?? "";
  const role = params.get("role") ?? "";

  return {
    search: params.get("search") ?? "",
    /*
     * A hand-edited or stale URL must not provoke a 400 the screen renders as
     * an error. `?status=disabled` is exactly that URL — a plausible guess and
     * a 400 — so anything outside the two falls back to no filter.
     */
    status: isStaffStatus(status) ? (status as StaffStatus) : "",
    role: ROLE_KEY.test(role) ? role : "",
    page: positive(params.get("page")),
  };
}

/** What goes on the wire. Only what the API actually honours. */
export function listParams(query: UsersQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(PER_PAGE),
    page: String(query.page),
  });

  if (query.search !== "") params.set("search", query.search);
  if (query.status !== "") params.set("status", query.status);
  if (query.role !== "") params.set("role", query.role);
  return params;
}

/** The URL the panel shows: only what differs from the defaults. */
export function toUrlParams(query: UsersQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search !== "") params.set("search", query.search);
  if (query.status !== "") params.set("status", query.status);
  if (query.role !== "") params.set("role", query.role);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

export function isFiltered(query: UsersQuery): boolean {
  return query.search !== "" || query.status !== "" || query.role !== "";
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
