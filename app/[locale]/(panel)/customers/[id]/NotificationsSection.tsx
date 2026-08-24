"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Notification } from "@/lib/api/schemas/notification";
import { acRead } from "@/lib/api/browser";
import {
  QUEUE_STATES,
  STATE_TONE,
  eventMessageKey,
  isKnownChannel,
  isNotificationEvent,
  queueState,
  stateCounts,
} from "@/lib/notifications";
import { formatDate } from "@/lib/format/date";
import { Card } from "@/components/ui/Card";
import { Badge, Dot } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/Button";
import { SectionError } from "@/components/ui/States";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import {
  CUSTOMER_PER_PAGE,
  customerNotificationsKey,
  customerNotificationsParams,
} from "../../notifications/query";

/**
 * This customer's own queue, on their detail screen.
 *
 * ## One request, and it took a backend branch to make that true
 *
 * Measured 2026-08-21 before `feat/notification-filters`: `?recipient=`,
 * `?subject_id=`, `?event=` and `?audience=` were all accepted and silently
 * ignored, and `?dedupe_key=` is exact-match-only. So the only way to build this
 * was one request per order per event name — four guesses per order on names the
 * panel would have had to hard-code, around thirty requests for an eight-order
 * customer, most of them 200s with nothing in them. `feat/cms-page-index` is the
 * precedent: when a screen is not buildable as specified, the read goes into the
 * API rather than being assembled out of fan-out here.
 *
 * ## It shares the reader and **not** the row, which is a change
 *
 * `query.ts` next door is the data — the parameter set, the page size, the query
 * key — and sharing it is correct: this section and the top-level screen ask the
 * same question of the same collection.
 *
 * `NotificationRow` is the *UI*, and this no longer imports it. That screen has
 * not migrated: its row is built out of `StatusBadge`, `text-body` and
 * `text-footnote`, every one of them retired by DESIGN.md §0, and importing it
 * would leave a retired-primitive island inside a migrated detail — the exact
 * defect the redesign exists to stamp out, in the one place nobody would look for
 * it. The row is rendered locally with the migrated primitives, and the
 * notifications screen migrates later and owns its own.
 *
 * ## Two things this section deliberately does not do
 *
 * **No retry.** The action lives on the notification's own screen, where the
 * frozen message it would re-queue is visible. Retrying from a summary row is
 * re-sending something you have not read.
 *
 * **No admin rows.** It filters on `recipient`, which is this customer's address,
 * so an `admin.new_order` about their order — addressed to the shop — is
 * correctly absent. That is worth knowing when a count here disagrees with the
 * count on the order, and the footnote says it.
 */
export function NotificationsSection({
  locale,
  email,
  initialNotifications,
  initialTotal,
}: {
  locale: string;
  /** The join. `recipient` on every `audience: "customer"` row is this address. */
  email: string;
  /** `null` when the request failed, or was never made because there is no join. */
  initialNotifications: Notification[] | null;
  initialTotal: number;
}) {
  const t = useTranslations("notifications");
  const [page, setPage] = useState(1);

  const { data, isError, error } = useQuery({
    queryKey: customerNotificationsKey(email, page),
    queryFn: async () => {
      const { data, total } = await acRead<Notification[]>(
        `/notifications?${customerNotificationsParams(email, page)}`,
      );
      return { notifications: data, total };
    },
    initialData:
      page === 1 && initialNotifications !== null
        ? { notifications: initialNotifications, total: initialTotal }
        : undefined,
    placeholderData: keepPreviousData,
    /* A customer with no e-mail cannot be joined on at all — `recipient` is the
       key and an empty one would filter nothing and return the whole queue. */
    enabled: email !== "" && initialNotifications !== null,
  });

  if (email === "") {
    return (
      <Card title={t("customerSection")}>
        <p className="text-ui-body text-ui-muted">{t("customer.noEmail")}</p>
      </Card>
    );
  }

  if (initialNotifications === null || isError) {
    return (
      <Card title={t("customerSection")}>
        <SectionError>
          {isError ? (error as Error).message : t("customer.failed")}
        </SectionError>
      </Card>
    );
  }

  const notifications = data?.notifications ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / CUSTOMER_PER_PAGE));
  const counts = stateCounts(notifications);

  if (notifications.length === 0) {
    return (
      <Card title={t("customerSection")} footnote={t("customer.noneNote")}>
        <p className="text-ui-body text-ui-muted">{t("customer.none")}</p>
      </Card>
    );
  }

  return (
    <Card
      title={t("customerSection")}
      /*
        Says which rows these are, because the answer is not all of them: the
        filter is this person's address, so the shop's own alerts about their
        orders are not here. A count that quietly disagreed with the order screen
        would be read as a bug.
      */
      footnote={t("customer.scopeNote")}
      actions={<Pager page={page} pages={pages} onPage={setPage} />}
    >
      {/*
        The page's own tally, and the label has to say "this page": there is no
        `meta.summary` on `GET /notifications` — the counts exist only on the CLI
        drain — so a total per state would cost one request per state.
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ui-line pb-2">
        {QUEUE_STATES.filter((state) => counts[state] > 0).map((state) => (
          <span
            key={state}
            className="flex items-center gap-1.5 text-ui-caption text-ui-subtle"
          >
            <Dot tone={STATE_TONE[state]} />
            <Isolate>{t(`pageSummary.${state}`, { count: counts[state] })}</Isolate>
          </span>
        ))}
      </div>

      <ul className="flex flex-col">
        {notifications.map((notification) => (
          <NotificationLine
            key={notification.id}
            notification={notification}
            locale={locale}
          />
        ))}
      </ul>
    </Card>
  );
}

/**
 * One row of the queue, rendered with the migrated primitives.
 *
 * **The badge is the derived state, not `status`.** A row that has been tried and
 * failed retryably is still `status: "pending"` — `markFailed()` writes it — so a
 * list badged on `status` alone shows a row the drain has already choked on as
 * though nothing had happened to it. That distinction is the entire reason an
 * operator looks at this at all.
 */
function NotificationLine({
  notification,
  locale,
}: {
  notification: Notification;
  locale: string;
}) {
  const t = useTranslations("notifications");
  const state = queueState(notification);

  /*
   * An event this build has no name for renders as its own key rather than as a
   * blank. `NOTIFICATION_EVENTS` is a copy of a server-side constant with no
   * contract keeping the two in step, and a ninth event must not produce an
   * empty row. `eventMessageKey` is what makes the lookup work at all —
   * `next-intl` resolves a `.` as a path separator, so `order.placed` cannot be
   * a flat key.
   */
  const event = isNotificationEvent(notification.event)
    ? t(`event.${eventMessageKey(notification.event)}`)
    : notification.event;

  const when = formatDate(notification.created_at, locale);

  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-ui-line py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          href={`/${locale}/notifications/${notification.id}`}
          /*
           * Named by its date as well as its event, because seven of these are
           * "Commande confirmée" on customer 24 alone — the queue holds one row
           * per event per order, so the visible label repeats by construction.
           * Read out of a links list they were seven identical names pointing at
           * seven different rows; the date is the field that tells them apart.
           */
          aria-label={t("customerRowLabel", { event, date: when })}
          className="ui-ring min-w-0 rounded-ui-md text-ui-compact text-ui-accent hover:underline"
        >
          <span dir="auto" className="block truncate">
            {event}
          </span>
        </Link>
        <Badge tone={STATE_TONE[state]} className="ms-auto">
          {t(`state.${state}`)}
        </Badge>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {/* An address is an identifier and reorders inside Arabic text without
            isolation — a recipient read back wrong is a mail to a stranger.
            `numeric={false}` because it is not a figure. */}
        <Ltr numeric={false} className="min-w-0 truncate text-ui-label text-ui-muted">
          {notification.recipient}
        </Ltr>
        {/* `Intl` formatted, so `Isolate`. Absolute rather than `formatWhen`'s
            relative form: this queue is the one screen in the panel whose rows
            are *minutes* old — the seed writes them at run time — and a relative
            stamp renders one sentence on the server and another on the client,
            which React reports as a hydration mismatch and repairs by
            regenerating the whole tree. Found in the dev log after all eight e2e
            tests passed, because nothing looks wrong afterwards. */}
        <Isolate className="ms-auto shrink-0 text-ui-label text-ui-subtle">{when}</Isolate>
      </div>

      {/*
        The two facts that qualify the badge, and only when they say something.
        A channel the panel has no label for is shown raw, for the reason an
        unknown event is.
      */}
      {notification.channel !== "email" ? (
        <p className="text-ui-caption text-ui-subtle">
          {isKnownChannel(notification.channel)
            ? t(`channel.${notification.channel}`)
            : notification.channel}
        </p>
      ) : null}

      {/*
        The error, quoted rather than translated.

        `NotificationPresenter` calls this "whatever the SMTP server said". It is
        not — `EmailChannel` only ever sees `wp_mail()` return a boolean, so the
        column holds one of three sentences this codebase wrote. But the set is
        not closed: a mail plugin filtering `wp_mail` can put anything here, and
        `markFailed()` truncates at 500 bytes on the way in. So it is presented as
        a quotation with its own direction — never as the panel's own sentence.
      */}
      {notification.last_error !== null && state !== "sent" ? (
        <p dir="auto" className="line-clamp-2 text-ui-caption text-ui-subtle">
          {t("errorQuote", { error: notification.last_error })}
        </p>
      ) : null}
    </li>
  );
}

/** The card's own pager, in the heading row where it does not move with the rows. */
function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (next: number) => void;
}) {
  const t = useTranslations("ui.table");
  if (pages <= 1) return null;

  return (
    <div className="flex items-center gap-1">
      <IconButton
        label={t("previousPage")}
        icon="back"
        flipInRtl
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(Math.max(1, page - 1))}
      />
      <span className="px-1 text-ui-label text-ui-muted" data-numeric="">
        {t("pageOf", { page, pages })}
      </span>
      <IconButton
        label={t("nextPage")}
        icon="chevron"
        flipInRtl
        variant="secondary"
        size="sm"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      />
    </div>
  );
}
