import {
  NOTIFICATION_STATUSES,
  isNotificationStatus,
  type NotificationStatus,
} from "@/lib/notifications";

/**
 * The notification list's URL state.
 *
 * Measured 2026-08-21 against the live router. **The filterable set is much
 * smaller than the row shape suggests**, and every one of the five below was
 * sent on its own rather than assumed:
 *
 *   ?channel=email                    39   honoured
 *   ?channel=sms                       0   honoured
 *   ?status=pending                   39   honoured
 *   ?dedupe_key=payment.received:4529  1   honoured, **exact match only**
 *   ?date_from=&date_to=                   honoured, Y-m-d, UTC, whole days
 *   ?recipient=                            honoured — added this branch
 *   ?subject_id=                           honoured — added this branch
 *
 *   ?event=order.placed               39   ACCEPTED AND IGNORED
 *   ?audience=admin                   39   ACCEPTED AND IGNORED
 *   ?search=yacine                    39   ACCEPTED AND IGNORED
 *   ?wilaya=16                        39   ACCEPTED AND IGNORED
 *   ?orderby=channel                       ACCEPTED AND IGNORED — see below
 *
 * `event` and `audience` are the two absences that shape the screen. Both are
 * published on every row, both are the obvious thing to filter by, and neither
 * is a parameter — so the panel offers no control for them at all rather than a
 * control that appears to work over one page and silently lies across the
 * second. §90 declined them deliberately: `dedupe_key`'s left half *is* the
 * event, and `audience` is separated by `recipient`.
 */

/**
 * `?status=` takes the three and refuses a fourth **by name**, in
 * `details.params`:
 *
 *   status is not one of pending, sent, and failed.
 *
 * `""` is the absence of the parameter and means all three, so the first segment
 * sends nothing — the coupons screen's rule, for the same reason.
 */
export const STATUS_FILTERS = ["", ...NOTIFICATION_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * The channel control's options.
 *
 * `""` is all. Unlike `status`, an unknown channel is a **200 with 0 rows** and
 * not a 400, so a stale URL here is an empty list rather than an error — but it
 * is still normalised below, because an empty list the reader cannot explain is
 * its own defect.
 */
export const CHANNEL_FILTERS = ["", "email", "sms"] as const;
export type ChannelFilter = (typeof CHANNEL_FILTERS)[number];

/**
 * **There is no sort control, and that is measured rather than an omission.**
 *
 * `?orderby=channel`, `?orderby=id&order=asc` and `?order=asc` all return the
 * identical first six ids as the unparameterised request, and `?orderby=nonsense`
 * is a 200 — it is not even validated. The ordering is `created_at DESC, id DESC`
 * in `NotificationRepository::search()` and nothing can change it.
 *
 * That is the opposite of the drain, which sends oldest first so a customer is
 * not told "delivered" before "shipped". An operator opens this screen because
 * something went wrong a minute ago.
 */

export const PER_PAGE = 20;

export type NotificationsQuery = {
  status: StatusFilter;
  channel: ChannelFilter;
  /** Exact `event:subject_id`. Set by following a row, never typed. */
  dedupeKey: string;
  /**
   * One order, every event about it — the customer's confirmations and the
   * shop's own alert together.
   *
   * Set by following a link from a notification's detail, never typed: it is
   * the query `dedupe_key` cannot express, and it is why `?subject_id=` was
   * added to the API on `feat/notification-filters`. `0` is the unset value and
   * is also what the API refuses (`minimum: 1`), so the two agree.
   */
  subjectId: number;
  /** `Y-m-d`, UTC, both ends inclusive of the whole day. */
  dateFrom: string;
  dateTo: string;
  page: number;
};

export const EMPTY_QUERY: NotificationsQuery = {
  status: "",
  channel: "",
  dedupeKey: "",
  subjectId: 0,
  dateFrom: "",
  dateTo: "",
  page: 1,
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

export function queryFromParams(params: URLSearchParams): NotificationsQuery {
  const status = params.get("status") ?? "";
  const channel = params.get("channel") ?? "";
  const dateFrom = params.get("date_from") ?? "";
  const dateTo = params.get("date_to") ?? "";

  return {
    /*
     * A hand-edited or stale URL must not provoke a 400 the screen then renders
     * as an error. `?status=delivered` is exactly that URL — a plausible guess
     * and a 400 — so anything outside the three falls back to no filter.
     */
    status: isNotificationStatus(status) ? (status as NotificationStatus) : "",
    channel: (CHANNEL_FILTERS as readonly string[]).includes(channel)
      ? (channel as ChannelFilter)
      : "",
    dedupeKey: params.get("dedupe_key") ?? "",
    /*
     * `Math.max(0, …)` rather than a bare parse: the API answers 400 below 1,
     * so a stale `?subject_id=0` or `?subject_id=-1` must become "unset" here
     * rather than travel and be refused.
     */
    subjectId: Math.max(0, Number.parseInt(params.get("subject_id") ?? "", 10) || 0),
    /*
     * The date pattern is enforced on the API side too — `?date_from=yesterday`
     * is a 400 — so this is the same argument as the status above. A malformed
     * date in a shared URL becomes no date rather than an error screen.
     */
    dateFrom: YMD.test(dateFrom) ? dateFrom : "",
    dateTo: YMD.test(dateTo) ? dateTo : "",
    page: positive(params.get("page")),
  };
}

/** What goes on the wire. Only what the API actually honours. */
export function listParams(query: NotificationsQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(PER_PAGE),
    page: String(query.page),
  });

  if (query.status !== "") params.set("status", query.status);
  if (query.channel !== "") params.set("channel", query.channel);
  if (query.dedupeKey !== "") params.set("dedupe_key", query.dedupeKey);
  if (query.subjectId > 0) params.set("subject_id", String(query.subjectId));
  if (query.dateFrom !== "") params.set("date_from", query.dateFrom);
  if (query.dateTo !== "") params.set("date_to", query.dateTo);
  return params;
}

/** The URL the panel shows: only what differs from the defaults. */
export function toUrlParams(query: NotificationsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.status !== "") params.set("status", query.status);
  if (query.channel !== "") params.set("channel", query.channel);
  if (query.dedupeKey !== "") params.set("dedupe_key", query.dedupeKey);
  if (query.subjectId > 0) params.set("subject_id", String(query.subjectId));
  if (query.dateFrom !== "") params.set("date_from", query.dateFrom);
  if (query.dateTo !== "") params.set("date_to", query.dateTo);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

export function isFiltered(query: NotificationsQuery): boolean {
  return (
    query.status !== "" ||
    query.channel !== "" ||
    query.dedupeKey !== "" ||
    query.subjectId > 0 ||
    query.dateFrom !== "" ||
    query.dateTo !== ""
  );
}

/** The query key mirrors the request, so the two can never disagree. */
export function notificationsKey(query: NotificationsQuery) {
  return ["notifications", listParams(query).toString()] as const;
}

/* ---------------------------------------------- one customer's own queue --- */

/**
 * The customer detail's section, in **one request**.
 *
 * `?recipient=` did not exist when this branch started: measured, it was
 * accepted and silently ignored, as were `?subject_id=`, `?event=` and
 * `?audience=`. Without it this section had to issue one request per order per
 * event name — four guesses per order on names the panel would have had to
 * hard-code, around thirty requests for an eight-order customer — so it was
 * added to the API on `feat/notification-filters` instead. The
 * `feat/cms-page-index` precedent, one collection over.
 *
 * A customer's `email` is the join. It is `recipient` on the row for every
 * `audience: "customer"` notification, and it is what the shop mails.
 */
export const CUSTOMER_PER_PAGE = 10;

export function customerNotificationsParams(email: string, page: number): URLSearchParams {
  return new URLSearchParams({
    recipient: email,
    per_page: String(CUSTOMER_PER_PAGE),
    page: String(page),
  });
}

export function customerNotificationsKey(email: string, page: number) {
  return ["notifications", "customer", email, page] as const;
}
