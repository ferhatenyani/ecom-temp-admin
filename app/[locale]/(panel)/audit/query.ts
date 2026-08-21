import { PER_PAGE, isActionQuery, isResourceType } from "@/lib/audit";

export { PER_PAGE };

/**
 * The trail's URL state.
 *
 * Measured 2026-08-21 against the live router, **before and after** the backend
 * branch that made two of these work:
 *
 *   ?actor_id=475                    873 of 16 632   honoured
 *   ?action=notification.retried      84             honoured
 *   ?resource_type=notification       84             honoured
 *   ?resource_id=4640                  2             honoured — added this branch
 *   ?date_from= / ?date_to=                          honoured — added this branch
 *   ?search=                      16 632             ACCEPTED AND IGNORED
 *   ?orderby= / ?order=                              ACCEPTED AND IGNORED
 *   ?action=nonsense                   0             200, not validated
 *
 * **No search box and no sort control**, and both absences are the measurement
 * rather than an omission. Writes are audited by field *name* and never by
 * value, so a free-text box would be searching a column that does not exist;
 * the table is append-only, so its id order is its time order and there is no
 * second ordering worth offering.
 *
 * ADMIN_PANEL.md names five filters as though all five worked. Two of them did
 * not, and 16 632 rows at 20 a page is **832 pages** — so the clauses went into
 * `AuditRepository` on a narrow backend branch before a line of this screen
 * existed, rather than the screen shipping two controls that quietly lie.
 */

export type AuditQuery = {
  /**
   * A free-text action, not a picker. **85 distinct actions on this install and
   * the set grows with every subsystem**, and an unmatched one is a 200 with no
   * rows rather than a 400 — so a stale URL is an empty list and a picker would
   * be a list somebody has to maintain against a vocabulary nobody publishes.
   */
  action: string;
  /** One of the 22 this build names, or `""`. The vocabulary of the control. */
  resourceType: string;
  /**
   * **A string, not a number.** The column is `varchar(64)` because the things
   * this trail records are not all numbered: a page is audited by path, a FAQ
   * category by slug, a menu by location. Parsing it as an integer would turn
   * `conditions` into 0 and match every row that has no resource id at all.
   */
  resourceId: string;
  /** An account id. Set by following a link from a row, and by the picker. */
  actorId: number;
  /** `Y-m-d`, UTC, both ends inclusive of the whole day. */
  dateFrom: string;
  dateTo: string;
  page: number;
};

export const EMPTY_QUERY: AuditQuery = {
  action: "",
  resourceType: "",
  resourceId: "",
  actorId: 0,
  dateFrom: "",
  dateTo: "",
  page: 1,
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** The API's own `maxLength` on the column. Over it is a 400. */
const RESOURCE_ID_MAX = 64;

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

export function queryFromParams(params: URLSearchParams): AuditQuery {
  const action = params.get("action") ?? "";
  const resourceType = params.get("resource_type") ?? "";
  const resourceId = params.get("resource_id") ?? "";
  const dateFrom = params.get("date_from") ?? "";
  const dateTo = params.get("date_to") ?? "";

  return {
    /*
     * The API validates by pattern (`^[a-z0-9._-]+$`) and answers 400 on a
     * value outside it. A hand-edited URL must not provoke an error screen, so
     * anything the pattern refuses becomes no filter.
     */
    action: isActionQuery(action) ? action : "",
    resourceType: isResourceType(resourceType) ? resourceType : "",
    resourceId: resourceId.length <= RESOURCE_ID_MAX ? resourceId : "",
    actorId: Math.max(0, Number.parseInt(params.get("actor_id") ?? "", 10) || 0),
    dateFrom: YMD.test(dateFrom) ? dateFrom : "",
    dateTo: YMD.test(dateTo) ? dateTo : "",
    page: positive(params.get("page")),
  };
}

/** What goes on the wire. Only what the API actually honours. */
export function listParams(query: AuditQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(PER_PAGE),
    page: String(query.page),
  });

  if (query.action !== "") params.set("action", query.action);
  if (query.resourceType !== "") params.set("resource_type", query.resourceType);
  if (query.resourceId !== "") params.set("resource_id", query.resourceId);
  if (query.actorId > 0) params.set("actor_id", String(query.actorId));
  if (query.dateFrom !== "") params.set("date_from", query.dateFrom);
  if (query.dateTo !== "") params.set("date_to", query.dateTo);
  return params;
}

/** The URL the panel shows: only what differs from the defaults. */
export function toUrlParams(query: AuditQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.action !== "") params.set("action", query.action);
  if (query.resourceType !== "") params.set("resource_type", query.resourceType);
  if (query.resourceId !== "") params.set("resource_id", query.resourceId);
  if (query.actorId > 0) params.set("actor_id", String(query.actorId));
  if (query.dateFrom !== "") params.set("date_from", query.dateFrom);
  if (query.dateTo !== "") params.set("date_to", query.dateTo);
  if (query.page > 1) params.set("page", String(query.page));
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

/** The query key mirrors the request, so the two can never disagree. */
export function auditKey(query: AuditQuery) {
  return ["audit-logs", listParams(query).toString()] as const;
}
