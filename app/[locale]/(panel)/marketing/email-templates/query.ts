/**
 * The template list's URL state, which is **paging and nothing else**.
 *
 * Measured 2026-08-28, one parameter at a time: `?orderby=`, `?status=` and
 * `?search=` are all accepted and all **ignored** — none of them changes the three
 * rows or their order — and there is no write of any kind, because §85 makes a
 * template an `ac_email_template` post authored in wp-admin where the revisions
 * and the media library already are. `lib/api/allowlist.ts` carries the two GETs
 * and nothing else.
 *
 * So this screen ships no search, no sort and no filter, and that is a
 * measurement rather than an omission: a control over a parameter the route
 * ignores is a control that silently does nothing, which is this run's oldest
 * rule. `?orderby=zzz` is a **200** here, the strong negative — it never reaches
 * a validator — where the same value on `/campaigns` is a 400.
 *
 * The rows arrive in the order the shop stores them (`name` ascending, so the
 * typo row sits between the other two). That is the API's own ordering rather
 * than a sort this screen asked for, and no header claims it.
 */

export const PER_PAGE_OPTIONS = [20, 50, 100] as const;
export const PER_PAGE = 20;

export type TemplatesQuery = { page: number; perPage: number };

export const EMPTY_QUERY: TemplatesQuery = { page: 1, perPage: PER_PAGE };

export function queryFromParams(params: URLSearchParams): TemplatesQuery {
  const perPage = Number.parseInt(params.get("per_page") ?? "", 10);
  return {
    page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
    /* Falls back rather than travelling: the footer's select could not represent
       a `?per_page=37`, and a control that cannot show the state it is in is a
       control that lies about it. `?per_page=101` is a measured 400 besides. */
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage) ? perPage : PER_PAGE,
  };
}

export function listParams(query: TemplatesQuery): URLSearchParams {
  return new URLSearchParams({
    per_page: String(query.perPage),
    page: String(query.page),
  });
}

/** The URL the panel shows: only what differs from the defaults. */
export function toUrlParams(query: TemplatesQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.page > 1) params.set("page", String(query.page));
  if (query.perPage !== EMPTY_QUERY.perPage) params.set("per_page", String(query.perPage));
  return params;
}
