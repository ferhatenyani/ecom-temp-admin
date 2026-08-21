import { DEFAULT_STATUS_FILTER, isStatusFilter, type StatusFilter } from "@/lib/cms";

/**
 * The Pages index's URL state.
 *
 * Two parameters and no more, because `GET /cms/pages` takes four and two of
 * them are pagination. Measured on the route as it was built:
 *
 *   ?status=   publish | draft | any        — the default is **publish**
 *   ?search=   matches the title and body   — and *never* the path
 *   ?page=, ?per_page=
 *
 * There is no `orderby`. The index is ordered by title on the server, which is
 * the one departure the route makes from `baseArgs()`'s `menu_order` default:
 * every page in this shop has `menu_order` 0, so the default degenerates to
 * newest-first, and an index sorted by creation date is one where the page you
 * are looking for moves every time somebody adds another.
 */

export const PER_PAGE = 50;

export type PagesQuery = {
  search: string;
  status: StatusFilter;
  page: number;
};

/**
 * **`any`, not the API's default.**
 *
 * Every other list in this panel opens with no `?status=` and gets everything.
 * This route's default is `publish`, so opening with nothing would hide every
 * draft — and a draft is the single most likely reason a content manager opened
 * this screen. `lib/cms.ts` carries the same note beside the constant.
 */
export const EMPTY_QUERY: PagesQuery = {
  search: "",
  status: DEFAULT_STATUS_FILTER,
  page: 1,
};

export function queryFromParams(params: URLSearchParams): PagesQuery {
  const status = params.get("status") ?? "";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  return {
    search: params.get("search") ?? "",
    // A hand-edited URL must not be able to provoke a 400 the screen then
    // renders as an error: `?status=trash` is a plausible guess and is refused
    // by the args schema, so anything outside the three falls back.
    status: isStatusFilter(status) ? status : EMPTY_QUERY.status,
    page,
  };
}

export function listParams(query: PagesQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(PER_PAGE),
    page: String(query.page),
    status: query.status,
  });

  if (query.search !== "") params.set("search", query.search);
  return params;
}

/** The URL the panel shows: only what differs from the defaults. */
export function toUrlParams(query: PagesQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search !== "") params.set("search", query.search);
  if (query.status !== EMPTY_QUERY.status) params.set("status", query.status);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

export function isFiltered(query: PagesQuery): boolean {
  return query.search !== "" || query.status !== EMPTY_QUERY.status;
}

export function pagesKey(query: PagesQuery) {
  return ["cms", "pages", listParams(query).toString()] as const;
}
