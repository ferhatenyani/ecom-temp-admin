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
 *
 * ## `channel` is honoured and gets no control, and that is the one reversal here
 *
 * The three rows above are not why. `?channel=email` and `?channel=sms` are both
 * real, and nothing about that measurement has changed.
 *
 * The standing rule is *"a picker over a working filter ships only when the
 * allowlisted enumeration is complete; the test is the enumeration, never the
 * parameter"* — shipping's provider filter, which also works and also does not
 * ship. **There is no allowlisted enumeration of channels anywhere in this API.**
 * `KNOWN_CHANNELS` in `lib/notifications.ts` is a panel-side copy of a server
 * constant that the same file says is four `add()` calls from being stale, and
 * `?channel=nonsense` is a **silent 200 with 0 rows** rather than a refusal — so a
 * picker is the only thing that could keep a typo unreachable, and a picker built
 * from a copy nobody keeps in step cannot offer the value that matters the day a
 * fifth channel lands. On this shop the control's two answers are also *all 25*
 * and *none*, which is §14's argument against the media `type` filter arriving a
 * second time.
 *
 * So the parameter is not sent, `query.channel` does not exist, and a stale
 * `?channel=sms` falls back to no filter the way a stale `?per_page=37` does on
 * coupons. The channel still **renders** — on the row and on the record — where it
 * can be read; it is a fact about the notification, not a question the operator
 * gets to ask.
 *
 * **What would make the control buildable is one request:** an allowlisted route
 * enumerating the channels this install has registered, the way
 * `GET /payments/methods` does for payment providers. With a complete
 * enumeration the picker ships the same afternoon.
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
 * **There is no sort control, and that is measured rather than an omission.**
 *
 * Re-taken 2026-08-28 against a discriminating fixture — 25 rows, 25 distinct
 * `dedupe_key`, 10 distinct `created_at`, so a tie cannot be mistaken for a
 * refusal to sort. Fourteen spellings — `orderby`/`order`/`sort`/`sort_by` over
 * every field on the row and both directions — returned the **identical 25-id
 * sequence**, and `?orderby=zzz` is a **200**: the parameter never reaches a
 * validator, so it cannot be reaching a sort. `NotificationRepository::search()`
 * ends in a literal `ORDER BY created_at DESC, id DESC` with no branch.
 *
 * So: no sort control, no `sortKey` on any column, and `aria-sort` on nothing —
 * `DataTable` gates the attribute on `sortKey && onSortChange` and this screen
 * passes neither.
 *
 * That resting order is the opposite of the drain, which sends oldest first so a
 * customer is not told "delivered" before "shipped". An operator opens this
 * screen because something went wrong a minute ago.
 */

/**
 * Page size, and the three the footer offers.
 *
 * Page and per-page live in the URL, on the coupons/customers/shipping/payments
 * shape — the arrangement `TableFooter` is written against, so the control is
 * used as-is rather than wrapped.
 *
 * All three are inside the API's measured `1..100`: `per_page=0` and
 * `per_page=1000` are both 400s. A stale `?per_page=37` falls back rather than
 * travelling, because the footer's select could not represent it afterwards and a
 * control that cannot show the state it is in is a control that lies about it.
 */
export const PER_PAGE_OPTIONS = [20, 50, 100] as const;
export const PER_PAGE = 20;

export type NotificationsQuery = {
  status: StatusFilter;
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
  perPage: number;
};

export const EMPTY_QUERY: NotificationsQuery = {
  status: "",
  dedupeKey: "",
  subjectId: 0,
  dateFrom: "",
  dateTo: "",
  page: 1,
  perPage: PER_PAGE,
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date bound, or nothing.
 *
 * Anything that does not match the API's own pattern is dropped rather than sent:
 * `?date_from=yesterday` is a 400 quoting the pattern back, and that refusal must
 * not be reachable from a URL somebody edited or from a control mid-entry.
 * `2026-13-45` *does* match the pattern and is not a date — it travels, and
 * answers a 200 with zero rows, because the router validates the shape and never
 * the calendar and the panel does not get to be stricter than the thing it is a
 * client of.
 */
export function dayFromInput(raw: string): string {
  return YMD.test(raw) ? raw : "";
}

function positive(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

export function queryFromParams(params: URLSearchParams): NotificationsQuery {
  const status = params.get("status") ?? "";
  const dateFrom = params.get("date_from") ?? "";
  const dateTo = params.get("date_to") ?? "";
  const perPage = Number.parseInt(params.get("per_page") ?? "", 10);

  return {
    /*
     * A hand-edited or stale URL must not provoke a 400 the screen then renders
     * as an error. `?status=delivered` is exactly that URL — a plausible guess
     * and a 400 — so anything outside the three falls back to no filter.
     */
    status: isNotificationStatus(status) ? (status as NotificationStatus) : "",
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
    dateFrom: dayFromInput(dateFrom),
    dateTo: dayFromInput(dateTo),
    page: positive(params.get("page")),
    /* A stale value falls back rather than travelling: 37 is a legal request and
       an illegible control, and 1000 is a 400. */
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(perPage) ? perPage : PER_PAGE,
  };
}

/**
 * What goes on the wire. Only what the API actually honours — and `channel` is
 * deliberately not on it even though it does: see the file docblock.
 */
export function listParams(query: NotificationsQuery): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(query.perPage),
    page: String(query.page),
  });

  /* Omitted when empty rather than sent blank. `?status=`, `?subject_id=` and
     both date bounds are each a 400 in their own family — measured — so a screen
     that sent a blank parameter would be refused on four of the five. */
  if (query.status !== "") params.set("status", query.status);
  if (query.dedupeKey !== "") params.set("dedupe_key", query.dedupeKey);
  if (query.subjectId > 0) params.set("subject_id", String(query.subjectId));
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
export function toUrlParams(query: NotificationsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.status !== "") params.set("status", query.status);
  if (query.dedupeKey !== "") params.set("dedupe_key", query.dedupeKey);
  if (query.subjectId > 0) params.set("subject_id", String(query.subjectId));
  if (query.dateFrom !== "") params.set("date_from", query.dateFrom);
  if (query.dateTo !== "") params.set("date_to", query.dateTo);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.perPage !== EMPTY_QUERY.perPage) params.set("per_page", String(query.perPage));
  return params;
}

export function isFiltered(query: NotificationsQuery): boolean {
  return (
    query.status !== "" ||
    query.dedupeKey !== "" ||
    query.subjectId > 0 ||
    query.dateFrom !== "" ||
    query.dateTo !== ""
  );
}

/**
 * Past the last page, which on this API is a **200 with zero rows** rather than a
 * 404 — so the table is not drawn, and with it goes the only control that could
 * page back. The inventory ledger's third recorded bug, avoided here rather than
 * repeated: the empty state offers the way out.
 */
export function isOverPaged(query: NotificationsQuery): boolean {
  return query.page > 1;
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
