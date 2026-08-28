"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Notification } from "@/lib/api/schemas/notification";
import {
  STATE_TONE,
  eventMessageKey,
  isAudience,
  isKnownChannel,
  isNotificationEvent,
  queueState,
} from "@/lib/notifications";
import { formatDate, formatWhen } from "@/lib/format/date";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Badge } from "@/components/ui/Badge";
import type { Column } from "@/components/ui/DataTable";

/**
 * The queue's column definition — one source, two presentations.
 *
 * `DataTable` renders these as a real table at `md`+ and `RecordList` renders the
 * three-line form below it, so a phone and a monitor cannot drift apart about
 * which fields identify a notification. It replaces `NotificationRow.tsx`, which
 * drew one iOS inset row at every width; the three arguments that file made are
 * carried over below rather than restated, because they are the reason this is
 * not a mechanical column list.
 *
 * ## The badge is the derived `queueState()`, never `status`
 *
 * **This is the whole reason the screen exists.** A retryable failure is left
 * `status: "pending"` with the attempt counted and the error recorded —
 * `markFailed()` writes exactly that whenever the failure is retryable and
 * `attempts` is still under five — so a list badged on `status` shows a row the
 * drain has already choked on as though nothing had ever happened to it. That is
 * the one distinction an operator opens this queue to make, so it is the column
 * furthest from the identifier and the only coloured thing on the row.
 *
 * `retrying` is `warning` and not `danger`, and `lib/notifications.ts` argues it:
 * the row is still in the queue, the next drain will take it, and retrying it
 * answers 202 `already_pending: true` — so painting it the same red as a parked
 * row would teach a gesture that does nothing.
 *
 * ## The identifying cell is a real `<a href>`, and only in the table
 *
 * **There is no peek drawer.** `GET /{id}` is the list row **plus `message`**,
 * and `message` is the entire reason anybody opens the record — so a free peek
 * would show nothing this row does not already carry and a useful one spends a
 * request per open. `lib/api/schemas/notification.ts` measures the difference by
 * size as well as by key: 390 bytes against 630 for the same row's single read.
 * That is `customers/columns.tsx`'s argument exactly.
 *
 * So the row navigates — and because it navigates, the event is an anchor rather
 * than a span in a clickable row: that is the keyboard path, the middle click and
 * "open in new tab", none of which a `<div onClick>` has. **No `rowOpenerId`**,
 * per §3.2: the cell is already a link and following it is what clicking the row
 * does, so wrapping it in a `<button>` would be nested interactive content.
 *
 * The anchor is deliberately only in the **table**. `RecordList` navigates
 * through the stretched overlay button `DataTable` already gives it, so a row is
 * one anchor and not two — both presentations are in the DOM at every width, and
 * a link in each would double every `a[href*="/notifications/"]` a suite counts.
 *
 * ## No `sortKey` on any column, and that is the finding rather than an omission
 *
 * Fourteen `orderby`/`order`/`sort`/`sort_by` spellings returned an id sequence
 * identical to the bare listing against a fixture built to discriminate — 25 rows,
 * 25 distinct `dedupe_key`, 10 distinct `created_at` — and **`?orderby=zzz` is a
 * 200**, so the parameter never reaches a validator and cannot be reaching a sort.
 * `NotificationRepository::search()` ends in a literal `ORDER BY created_at DESC,
 * id DESC` with no branch. `DataTable` gates `aria-sort` on
 * `sortKey && onSortChange`, so with neither present every header honestly
 * announces nothing. `query.ts` carries the measurement.
 *
 * ## `last_error` is a column and not a click
 *
 * It is prose of unbounded length — `markFailed()` truncates at 500 bytes on the
 * way in and a mail plugin filtering `wp_mail` can put anything there — which is
 * an argument for keeping it off a table. It is also the screen's triage signal:
 * the sentence that says whether a failure is one address or the whole transport.
 * So it truncates here with `dir="auto"`, and the full value is on the record.
 *
 * **Quoted, never translated.** `NotificationPresenter` calls this "a provider
 * string — whatever the SMTP server said"; measured, it is not — `EmailChannel`
 * only ever sees `wp_mail()` return a boolean, so the column holds one of three
 * sentences this codebase wrote. But the set is not closed, which is why it is
 * evidence in quotation marks rather than a key.
 */

export type NotificationColumnContext = {
  locale: string;
  /**
   * Whether React has taken this list's DOM over yet.
   *
   * **Relative time cannot be server-rendered, and this is the one screen in the
   * panel where that bites.** `formatWhen` is relative under 24 hours, so a row
   * queued a minute ago renders "il y a une minute" on the server and "il y a 2
   * minutes" on the client a moment later; React reports the mismatch and
   * regenerates the whole tree. It was found in the dev log after every e2e test
   * passed, because nothing on screen looks wrong afterwards.
   *
   * A dozen other screens use `formatWhen` unguarded and none of them shows it,
   * because their rows are hours or days old and `formatWhen` falls back to the
   * absolute form past 24 hours. This queue's rows are *minutes* old — the seed
   * writes them at run time. So the server renders the absolute date, which is
   * stable, and the client upgrades once it owns the DOM.
   */
  hydrated: boolean;
  /** One clock for the whole list, taken on render — not `new Date()` per row. */
  now: Date;
  t: (key: string, values?: Record<string, string | number>) => string;
};

/**
 * The event in the reader's language, or its own key.
 *
 * `NOTIFICATION_EVENTS` is a copy of a server-side constant with nothing keeping
 * the two in step — the argument `unknownSectionTypes()` makes for the homepage —
 * so a ninth event renders as itself rather than as a blank row. `eventMessageKey`
 * is what makes the lookup work at all: `next-intl` resolves a `.` as a path
 * separator, so `order.placed` cannot be a flat key, and the failure is *silent*
 * — the raw key path renders as plausible text.
 */
function eventName(notification: Notification, t: NotificationColumnContext["t"]): string {
  return isNotificationEvent(notification.event)
    ? t(`event.${eventMessageKey(notification.event)}`)
    : notification.event;
}

/**
 * Who the message was for.
 *
 * **18 of the 39 rows measured were addressed to the shop, not to a customer.**
 * "Did it send?" means two different things on one list: a customer row is *did
 * this person get their confirmation*, an admin row is *did the shop find out it
 * had an order*. The second failing is an operational problem and not a support
 * one, and a screen that renders them identically buries that. A third audience
 * renders as itself, for the reason an unknown event does.
 */
function audienceName(notification: Notification, t: NotificationColumnContext["t"]): string {
  return isAudience(notification.audience)
    ? t(`audience.${notification.audience}`)
    : notification.audience;
}

/** The channel in the reader's language, or as itself. §29's other four are one
    class and one `add()` away on the backend, so this must never blank a row. */
function channelName(notification: Notification, t: NotificationColumnContext["t"]): string {
  return isKnownChannel(notification.channel)
    ? t(`channel.${notification.channel}`)
    : notification.channel;
}

/** The state badge, which every presentation of a notification carries. */
export function StateBadge({
  notification,
  t,
}: {
  notification: Notification;
  t: NotificationColumnContext["t"];
}) {
  const state = queueState(notification);
  return <Badge tone={STATE_TONE[state]}>{t(`state.${state}`)}</Badge>;
}

/**
 * The error, quoted — and only where it still says something.
 *
 * A `sent` row can carry a `last_error` from an attempt that later succeeded, and
 * printing it beside a success badge reads as a contradiction rather than as
 * history. The record shows it either way.
 */
function errorQuote(notification: Notification, t: NotificationColumnContext["t"]): string | null {
  if (notification.last_error === null) return null;
  if (queueState(notification) === "sent") return null;
  return t("errorQuote", { error: notification.last_error });
}

export function buildColumns(ctx: NotificationColumnContext): Column<Notification>[] {
  const { locale, hydrated, now, t } = ctx;

  const when = (notification: Notification) =>
    hydrated
      ? formatWhen(notification.created_at, locale, now)
      : formatDate(notification.created_at, locale);

  return [
    {
      key: "event",
      header: t("columns.event"),
      required: true,
      cell: (notification) => (
        <Link
          href={`/${locale}/notifications/${notification.id}`}
          /* The row navigates too. Without this the anchor's click bubbles and
             the same push happens twice. */
          onClick={(event) => event.stopPropagation()}
          className="ui-ring min-w-0 rounded-ui-md hover:underline"
        >
          {/* `dir="auto"` rather than nothing: a translated label resolves the
              page's own script, and an event this build has no name for is an
              ASCII key that would otherwise be clipped from its front inside the
              Arabic panel. `.ui-td` is `nowrap`, so the cap is what stops the
              longest label setting the column's width. */}
          <span dir="auto" className="block max-w-56 truncate">
            {eventName(notification, t)}
          </span>
        </Link>
      ),
    },
    {
      key: "recipient",
      header: t("columns.recipient"),
      /* An address is an identifier and reorders inside Arabic text without
         isolation — a recipient read back wrong is a mail to a stranger.
         `numeric={false}` because it is not a figure. */
      cell: (notification) => (
        <Ltr numeric={false} className="block max-w-56 truncate">
          {notification.recipient}
        </Ltr>
      ),
    },
    {
      key: "audience",
      header: t("columns.audience"),
      cell: (notification) => audienceName(notification, t),
    },
    {
      key: "attempts",
      header: t("columns.attempts"),
      align: "end",
      /*
       * Off by default, and the reason is that the badge already carries the fact
       * it explains: a row with attempts on it is badged `retrying` or `failed`,
       * and a row with none is badged `queued`. The *number* matters when
       * triaging one row — five is `MAX_ATTEMPTS`, so a row on four is one drain
       * from being parked — and that is the record's job, where it is stated as
       * "n sur 5" rather than as a bare figure.
       *
       * Zero renders as an empty cell rather than as `0`, which is the coupons
       * `minimum_amount` treatment: never attempted is not the same fact as
       * attempted zero times, and only one of the two is true here.
       */
      optional: true,
      cell: (notification) =>
        notification.attempts > 0 ? <Ltr>{notification.attempts}</Ltr> : null,
    },
    {
      key: "lastError",
      header: t("columns.lastError"),
      /* `dir="auto"` so the ellipsis lands at the sentence's own end: the API's
         three sentences are English inside a French or Arabic table, and a
         truncate over an inherited RTL run clips them from the front. */
      cell: (notification) => {
        const quote = errorQuote(notification, t);
        return quote === null ? null : (
          <span dir="auto" className="block max-w-72 truncate" data-testid="row-error">
            {quote}
          </span>
        );
      },
    },
    {
      key: "created",
      header: t("columns.created"),
      align: "end",
      /* `Isolate`, never `Ltr`: `Intl` puts U+200F marks inside an Arabic date on
         purpose and forcing a direction over them renders the parts out of
         order. */
      cell: (notification) => <Isolate>{when(notification)}</Isolate>,
    },
    {
      key: "state",
      header: t("columns.state"),
      /* Status ends, per §3.2. Last, because it is the answer and the row reads
         left to right towards it. */
      align: "end",
      cell: (notification) => <StateBadge notification={notification} t={t} />,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * Which three is editorial rather than "the first three columns": on a phone a
 * person is identifying the notification (what it was and what became of it),
 * placing it against a person and an audience (who was told, and whether it was
 * the customer or the shop), and triaging it (what went wrong, and when).
 *
 * The channel is on neither line and is not a gap: it is `email` on every row
 * this shop has, so a line carrying it would be a constant. It is on the record,
 * where the day a second channel exists it will be read.
 */
export function notificationRecord(
  notification: Notification,
  ctx: NotificationColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { locale, hydrated, now, t } = ctx;
  const quote = errorQuote(notification, t);

  return {
    primary: (
      <>
        <span
          dir="auto"
          className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg"
        >
          {eventName(notification, t)}
        </span>
        <StateBadge notification={notification} t={t} />
      </>
    ),
    secondary: (
      <>
        <Ltr numeric={false} className="min-w-0 flex-1 truncate">
          {notification.recipient}
        </Ltr>
        <span className="shrink-0">{audienceName(notification, t)}</span>
      </>
    ),
    meta: (
      <>
        {/* The error where there is one, the channel where there is something to
            say about it, and nothing at all on an ordinary sent row — the date
            still holds the line's end either way. */}
        <span dir="auto" className="min-w-0 flex-1 truncate">
          {quote ?? (notification.channel === "email" ? "" : channelName(notification, t))}
        </span>
        <span className="shrink-0 text-ui-compact text-ui-fg">
          <Isolate>
            {hydrated
              ? formatWhen(notification.created_at, locale, now)
              : formatDate(notification.created_at, locale)}
          </Isolate>
        </span>
      </>
    ),
  };
}
