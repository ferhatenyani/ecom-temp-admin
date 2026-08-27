import { DEFAULT_STATUS_FILTER, isStatusFilter, type StatusFilter } from "@/lib/cms";

/**
 * The Pages index's URL state.
 *
 * Three parameters and no more, because `GET /cms/pages` takes four and two of
 * them are pagination. Measured on the route as it was built, 2026-08-21:
 *
 *   ?status=   publish | draft | any        — the API's default is **publish**
 *   ?search=   matches the title and body   — and *never* the path
 *   ?page=, ?per_page=
 *
 * **There is no `orderby` control, and the reason changed on the content
 * branch.** This file used to say "There is no `orderby`. The index is ordered by
 * title on the server" — which is a true statement about the route's *default*
 * and was being read as a measurement of the *parameter*. It is not one: nothing
 * in this repo records `orderby` on any `/cms/` collection as working or as
 * accepted-and-ignored, so the honest position is **unmeasured**, and under
 * DECISIONS.md's standing rule an unmeasured control does not ship. The
 * difference matters because "ignored" closes the question and "unmeasured"
 * leaves it open: the run has twice found a control recorded dead that the
 * backend had since repaired.
 *
 * The measurement to take, when somebody has the credential:
 *
 *   compare each `?orderby=` value's full id sequence against **the order its own
 *   field implies** — never against the collection's default, which is what
 *   produced two false records on this run — and count the distinct values, so a
 *   fixture that ties on every row cannot pass as proof.
 */

/**
 * **20, and it moved from 50 on the content branch.**
 *
 * Every other migrated list in the panel opens at 20, `TableFooter` offers 50 and
 * 100 beside it, and DECISIONS.md records the API's own default as 20 across nine
 * collections. 50 was neither the API's figure nor the panel's, and it had a
 * quiet cost: this shop's page count sits under it, so the pager had **never been
 * exercised** — a rendered control with no fixture behind it, which is exactly the
 * shape of the three paging defects this run has already fixed elsewhere.
 */
export const PER_PAGE_OPTIONS = [20, 50, 100] as const;
export const PER_PAGE = 20;

export type PagesQuery = {
  search: string;
  status: StatusFilter;
  page: number;
  perPage: number;
};

/**
 * **`any`, not the API's default.**
 *
 * Every other list in this panel opens with no `?status=` and gets everything.
 * This route's default is `publish`, so opening with nothing would hide every
 * draft — and a draft is the single most likely reason a content manager opened
 * this screen. `lib/cms.ts` carries the same note beside the constant.
 *
 * The consequence for the tab strip is worth stating, because it inverts the
 * habit: the tab that sends **nothing to the URL** is `any`, and `publish` — the
 * value the API would assume — is an explicit filter here.
 */
export const EMPTY_QUERY: PagesQuery = {
  search: "",
  status: DEFAULT_STATUS_FILTER,
  page: 1,
  perPage: PER_PAGE,
};

export function queryFromParams(params: URLSearchParams): PagesQuery {
  const status = params.get("status") ?? "";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const perPage = Number.parseInt(params.get("per_page") ?? "", 10);

  return {
    search: params.get("search") ?? "",
    // A hand-edited URL must not be able to provoke a 400 the screen then
    // renders as an error: `?status=trash` is a plausible guess and is refused
    // by the args schema, so anything outside the three falls back.
    status: isStatusFilter(status) ? status : EMPTY_QUERY.status,
    page,
    /* A stale `?per_page=37` falls back rather than travelling — the coupons
       shape. The picker offers three values and the API validates the parameter,
       so a fourth would be a refusal the person never asked for. */
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage) ? perPage : PER_PAGE,
  };
}

export function listParams(query: PagesQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(query.perPage),
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
  if (query.perPage !== EMPTY_QUERY.perPage) params.set("per_page", String(query.perPage));
  return params;
}

export function isFiltered(query: PagesQuery): boolean {
  return query.search !== "" || query.status !== EMPTY_QUERY.status;
}

export function pagesKey(query: PagesQuery) {
  return ["cms", "pages", listParams(query).toString()] as const;
}
