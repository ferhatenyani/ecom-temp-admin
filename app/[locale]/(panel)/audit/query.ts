import { PER_PAGE, isActionQuery, isFilterableResourceId, isResourceType } from "@/lib/audit";

export { PER_PAGE };

/**
 * The trail's URL state.
 *
 * Measured 2026-08-21 against the live router and **re-measured 2026-08-29**,
 * after the backend branch that made two of these work landed (`ecom-temp`
 * `bcd4437` / merge `cfc92da`). The live table is **17 732 rows — 887 pages at
 * 20** — with 85 distinct actions, 23 distinct `resource_type` and 222 distinct
 * actors:
 *
 *   ?actor_id=475                    honoured   AuditRepository.php:91-94
 *   ?action=notification.retried     honoured   pattern ^[a-z0-9._-]+$
 *   ?resource_type=notification      honoured   the **same** pattern
 *   ?resource_id=4640                honoured   string, maxLength 64
 *   ?date_from= / ?date_to=          honoured   Y-m-d, whole-day UTC both ends
 *
 *   ?search=                         ACCEPTED AND IGNORED — never declared in
 *                                    `indexArgs()`, so it is not a parameter of
 *                                    this route at all
 *   ?orderby= / ?order=              ACCEPTED AND IGNORED
 *
 * **No search box and no sort control**, and both absences are the measurement
 * rather than an omission. Writes are audited by field *name* and never by
 * value, so a free-text box would be searching a column that does not exist; and
 * `AuditRepository.php:50` is a literal `ORDER BY id DESC` with **no branch** —
 * a fact read from the source, which is a stronger kind of fact than a pair of
 * responses that agreed. `tests/Api/audit.php:376-379` is the backend's own
 * positive control. So no column carries a `sortKey`, nothing passes
 * `onSortChange`, and `DataTable` therefore renders no `aria-sort` at all.
 *
 * **Two of the five are validated and three are not, and the difference decides
 * two controls.** `action` and `resource_type` share `^[a-z0-9._-]+$`, so a
 * malformed value — `""` included — is a **400** rather than the silent 200 with
 * zero rows an unvalidated filter answers. That is what lets the resource-type
 * picker ship over a vocabulary this build knows 22 of 23 names for: the
 * validator is the guard against a typo, not the picker. `actor_id` is refused
 * below 1. Every coercion below exists so that a hand-edited or stale URL falls
 * back to *no filter* instead of provoking an error screen.
 */

/** Page size, and the three the footer offers. `?per_page=500` is a 400 quoting
    the measured `1..100` range back in `details.params`. */
export const PER_PAGE_OPTIONS = [20, 50, 100] as const;

export type AuditQuery = {
  /**
   * A free-text action, not a picker. **85 distinct actions on this install and
   * the set grows with every subsystem**; `lib/audit.ts`'s `ACTION_COUNT` block
   * carries the three reasons a picker is impossible, the third being that a
   * `.` is a `next-intl` path separator and every one of the 85 carries one.
   *
   * A *well-formed* action outside the vocabulary is a 200 with no rows, so a
   * stale URL is an empty list. A *malformed* one is a 400, which is why the
   * control validates against the API's own pattern and says why, and why
   * `queryFromParams` drops what the pattern refuses.
   */
  action: string;
  /** One of the 22 this build names, or `""`. The vocabulary of the control. */
  resourceType: string;
  /**
   * **A string, not a number.** The column is `varchar(64)` because the things
   * this trail records are not all numbered: `cms` is audited as
   * `ac_cms_homepage`, `menu` as `primary`, `shipping_provider` as `yalidine`.
   * Parsing it as an integer would turn those into 0 and match every row that
   * has no resource id at all.
   *
   * *(A page is audited by its numeric `ID` and a FAQ category by its numeric
   * term id — `CmsService.php:156,224,296` and `:436,479,512` — so the three
   * above are the real non-numeric cases. The conclusion is unchanged and the
   * examples were wrong.)*
   *
   * `"0"` never travels: see `isFilterableResourceId`.
   */
  resourceId: string;
  /** An account id. Set by the picker, or carried in from a link. `0` is unset
      and is also what the API refuses, so the two agree. */
  actorId: number;
  /** `Y-m-d`, UTC, both ends inclusive of the whole day. */
  dateFrom: string;
  dateTo: string;
  page: number;
  perPage: number;
};

export const EMPTY_QUERY: AuditQuery = {
  action: "",
  resourceType: "",
  resourceId: "",
  actorId: 0,
  dateFrom: "",
  dateTo: "",
  page: 1,
  perPage: PER_PAGE,
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** The API's own `maxLength` on the column. Over it is a 400, not a clip. */
const RESOURCE_ID_MAX = 64;

/**
 * A date bound, or nothing.
 *
 * `?date_from=yesterday` is a 400 quoting the pattern back, and that refusal
 * must not be reachable from a URL somebody edited. `2026-13-45` *does* match
 * the pattern and is not a date — it travels and answers a 200 with zero rows,
 * because the router validates the shape and never the calendar, and the panel
 * does not get to be stricter than the thing it is a client of.
 */
export function dayFromInput(raw: string): string {
  return YMD.test(raw) ? raw : "";
}

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

export function queryFromParams(params: URLSearchParams): AuditQuery {
  const action = params.get("action") ?? "";
  const resourceType = params.get("resource_type") ?? "";
  const resourceId = params.get("resource_id") ?? "";
  const perPage = Number.parseInt(params.get("per_page") ?? "", 10);

  return {
    /*
     * The API validates by pattern (`^[a-z0-9._-]+$`) and answers 400 on a
     * value outside it. A hand-edited URL must not provoke an error screen, so
     * anything the pattern refuses becomes no filter. The *control* does not get
     * to do this silently — it refuses and says why — because a box that turns
     * what somebody typed into the unfiltered list is a different thing.
     */
    action: isActionQuery(action) ? action : "",
    resourceType: isResourceType(resourceType) ? resourceType : "",
    /*
     * `"0"` is dropped here rather than at the wire, so nothing downstream ever
     * holds a value it cannot honestly send: `?resource_id=0` answers the whole
     * collection because PHP's `array_filter` drops the falsy string, while rows
     * genuinely carry it. See `isFilterableResourceId`.
     */
    resourceId:
      isFilterableResourceId(resourceId) && resourceId.length <= RESOURCE_ID_MAX
        ? resourceId
        : "",
    /* `Math.max(0, …)` rather than a bare parse: `?actor_id=0` is a **400**
       (`minimum: 1`), so a stale zero or a negative must become "unset" here
       rather than travel and be refused. */
    actorId: Math.max(0, Number.parseInt(params.get("actor_id") ?? "", 10) || 0),
    dateFrom: dayFromInput(params.get("date_from") ?? ""),
    dateTo: dayFromInput(params.get("date_to") ?? ""),
    page: positive(params.get("page")),
    /* A stale value falls back rather than travelling: 37 is a legal request and
       an illegible control, and 500 is a 400. */
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage) ? perPage : PER_PAGE,
  };
}

/** What goes on the wire. Only what the API actually honours. */
export function listParams(query: AuditQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(query.perPage),
    page: String(query.page),
  });

  /* Omitted when empty rather than sent blank: `?action=` and
     `?resource_type=` each fail their own pattern, so a screen that sent a blank
     parameter would be refused on two of the five. */
  if (query.action !== "") params.set("action", query.action);
  if (query.resourceType !== "") params.set("resource_type", query.resourceType);
  if (isFilterableResourceId(query.resourceId)) params.set("resource_id", query.resourceId);
  if (query.actorId > 0) params.set("actor_id", String(query.actorId));
  if (query.dateFrom !== "") params.set("date_from", query.dateFrom);
  if (query.dateTo !== "") params.set("date_to", query.dateTo);
  return params;
}

/**
 * The URL the panel shows: only what differs from the defaults.
 *
 * `push`, never `replace`, at the call site — replacing the history entry means
 * going back from a filtered list skips the unfiltered one.
 */
export function toUrlParams(query: AuditQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.action !== "") params.set("action", query.action);
  if (query.resourceType !== "") params.set("resource_type", query.resourceType);
  if (isFilterableResourceId(query.resourceId)) params.set("resource_id", query.resourceId);
  if (query.actorId > 0) params.set("actor_id", String(query.actorId));
  if (query.dateFrom !== "") params.set("date_from", query.dateFrom);
  if (query.dateTo !== "") params.set("date_to", query.dateTo);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.perPage !== EMPTY_QUERY.perPage) params.set("per_page", String(query.perPage));
  return params;
}

export function isFiltered(query: AuditQuery): boolean {
  return (
    query.action !== "" ||
    query.resourceType !== "" ||
    query.resourceId !== "" ||
    query.actorId > 0 ||
    query.dateFrom !== "" ||
    query.dateTo !== ""
  );
}

/**
 * Past the last page, which on this API is a **200 with zero rows** rather than
 * a 404 — so the table is not drawn, and with it goes the only control that
 * could page back. At 887 pages a URL carrying a stale page number is the
 * ordinary case rather than a curiosity, and "the journal is empty" would be a
 * false sentence about a table holding 17 732 rows.
 */
export function isOverPaged(query: AuditQuery): boolean {
  return query.page > 1;
}

/** The query key mirrors the request, so the two can never disagree. */
export function auditKey(query: AuditQuery) {
  return ["audit-logs", listParams(query).toString()] as const;
}
