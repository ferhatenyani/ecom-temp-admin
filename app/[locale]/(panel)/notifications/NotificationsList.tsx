"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Notification } from "@/lib/api/schemas/notification";
import { acRead } from "@/lib/api/browser";
import { QUEUE_STATES, STATE_TONE, stateCounts } from "@/lib/notifications";
import { useOnline } from "@/lib/use-online";
import { formatDay, formatWhen } from "@/lib/format/date";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState, StaleBanner } from "@/components/patterns/States";
import { ListGroup, ListLinkRow } from "@/components/primitives/GroupedList";
import { Segmented } from "@/components/primitives/Segmented";
import { Dot } from "@/components/primitives/StatusBadge";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { NotificationRow } from "./NotificationRow";
import { RowSkeleton } from "../inventory/RowSkeleton";
import {
  CHANNEL_FILTERS,
  PER_PAGE,
  STATUS_FILTERS,
  isFiltered,
  listParams,
  notificationsKey,
  queryFromParams,
  toUrlParams,
  type ChannelFilter,
  type NotificationsQuery,
  type StatusFilter,
} from "./query";

async function fetchNotifications(query: NotificationsQuery) {
  const { data, total } = await acRead<Notification[]>(`/notifications?${listParams(query)}`);
  return { notifications: data, total };
}

/**
 * The queue: did it send?
 *
 * **There is no sort control and no event filter, and both absences are
 * measured.** `?orderby=` and `?order=` are accepted and ignored — even
 * `?orderby=nonsense` answers 200 — so the ordering is `created_at DESC` and
 * nothing can change it. `?event=` and `?audience=` are likewise accepted and
 * ignored, and both are published on every row, which makes them exactly the
 * controls a person would build first and exactly the ones that would appear to
 * work over one page and lie across the second. So neither is offered.
 *
 * What is offered is what the API honours: status, channel and a date range.
 */
export function NotificationsList({
  locale,
  initialQuery,
  initialNotifications,
  initialTotal,
}: {
  locale: string;
  initialQuery: NotificationsQuery;
  initialNotifications: Notification[] | null;
  initialTotal: number | null;
}) {
  const t = useTranslations("notifications");
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = queryFromParams(new URLSearchParams(searchParams.toString()));

  // One clock for the whole list, taken on render rather than per row: `new
  // Date()` inside a row gives twenty slightly different answers and re-derives
  // on every filter change.
  const now = new Date();

  const commit = (next: NotificationsQuery, options: { resetPage?: boolean } = {}) => {
    const target = options.resetPage === false ? next : { ...next, page: 1 };
    const params = toUrlParams(target);
    router.push(`/${locale}/notifications${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  };

  const online = useOnline();
  const [dates, setDates] = useState({ from: query.dateFrom, to: query.dateTo });

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: notificationsKey(query),
    queryFn: () => fetchNotifications(query),
    initialData:
      initialNotifications !== null &&
      notificationsKey(query).join("|") === notificationsKey(initialQuery).join("|")
        ? {
            notifications: initialNotifications,
            total: initialTotal ?? initialNotifications.length,
          }
        : undefined,
    placeholderData: keepPreviousData,
  });

  const notifications = data?.notifications ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = isFiltered(query);
  const counts = stateCounts(notifications);

  return (
    <Scaffold
      title={t("title")}
      trailing={
        <button
          type="button"
          onClick={() => void refetch()}
          aria-label={t("refresh")}
          className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
        >
          <Icon name="refresh" className={isFetching ? "size-5 spin" : "size-5"} />
        </button>
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <Segmented<StatusFilter>
            segments={STATUS_FILTERS.map((value) => ({
              value,
              label: value === "" ? t("status.all") : t(`status.${value}`),
            }))}
            value={query.status}
            onChange={(status) => commit({ ...query, status })}
            label={t("statusLabel")}
          />

          {/*
            A second segmented control rather than a filter sheet. Two groups of
            three and four values do not earn a sheet — the products screen has
            nine filters and that is what `FilterSheet` exists for — and a sheet
            here would hide the one control that proves the second channel is
            real behind a tap.
          */}
          <Segmented<ChannelFilter>
            segments={CHANNEL_FILTERS.map((value) => ({
              value,
              label: value === "" ? t("channel.all") : t(`channel.${value}`),
            }))}
            value={query.channel}
            onChange={(channel) => commit({ ...query, channel })}
            label={t("channelLabel")}
          />

          <DateRange />
        </div>
      }
    >
      {!online && dataUpdatedAt > 0 ? (
        <div className="mx-auto max-w-3xl">
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale, now)} />
        </div>
      ) : null}

      <div className="mx-auto max-w-3xl px-4">
        {/*
          Neither `dedupe_key` nor `subject_id` is a control — one is
          exact-match-only and the other is an order id, so nobody types either.
          Both arrive by following a link from a notification's detail, and a
          list silently narrowed by a parameter with no visible control is a
          screen that looks broken. So each renders as a removable chip.
        */}
        {query.dedupeKey !== "" || query.subjectId > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {query.dedupeKey !== "" ? (
              <span className="tone-accent tonal flex min-h-8 items-center gap-1 rounded-full ps-3 pe-1 text-footnote">
                <Ltr numeric={false} className="min-w-0 max-w-56 truncate">
                  {query.dedupeKey}
                </Ltr>
                <button
                  type="button"
                  onClick={() => commit({ ...query, dedupeKey: "" })}
                  aria-label={t("clearKey")}
                  className="press flex size-6 shrink-0 items-center justify-center rounded-full"
                >
                  <Icon name="close" className="size-3.5" />
                </button>
              </span>
            ) : null}
            {query.subjectId > 0 ? (
              <span
                className="tone-accent tonal flex min-h-8 items-center gap-1 rounded-full ps-3 pe-1 text-footnote"
                data-testid="subject-chip"
              >
                {/* A label and an id in one truncating run, so `Isolate` — the
                    label leads and resolves the direction. */}
                <Isolate className="min-w-0 max-w-56 truncate">
                  {t("subjectChip", { id: query.subjectId })}
                </Isolate>
                <button
                  type="button"
                  onClick={() => commit({ ...query, subjectId: 0 })}
                  aria-label={t("clearSubject")}
                  className="press flex size-6 shrink-0 items-center justify-center rounded-full"
                >
                  <Icon name="close" className="size-3.5" />
                </button>
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
          <p aria-live="polite" className="text-footnote text-label-secondary" data-testid="notifications-count">
            <Isolate numeric>{t("count", { total })}</Isolate>
          </p>
          {/*
            **A page summary, and the label says so.** There is no `meta.summary`
            on this route — the pending/sent/failed counts exist only on the CLI
            drain's `--summary` — so a queue-wide breakdown would cost one request
            per state. Counting what is on screen and calling it that is the
            honest version; calling it "the queue" would not be.
          */}
          {notifications.length > 0 ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-label-tertiary">
              {QUEUE_STATES.filter((state) => counts[state] > 0).map((state) => (
                <span key={state} className="flex items-center gap-1">
                  <Dot tone={STATE_TONE[state]} />
                  <Isolate numeric>
                    {t(`pageSummary.${state}`, { count: counts[state] })}
                  </Isolate>
                </span>
              ))}
            </p>
          ) : null}
        </div>

        {isPending && notifications.length === 0 ? (
          <RowSkeleton rows={6} />
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : notifications.length === 0 ? (
          <EmptyState
            message={filtered ? t("empty.noResults") : t("empty.none")}
            action={
              filtered
                ? {
                    label: t("empty.clear"),
                    onClick: () => {
                      setDates({ from: "", to: "" });
                      commit({
                        ...query,
                        status: "",
                        channel: "",
                        dedupeKey: "",
                        subjectId: 0,
                        dateFrom: "",
                        dateTo: "",
                      });
                    },
                  }
                : undefined
            }
          />
        ) : (
          <>
            <ListGroup>
              {notifications.map((notification) => (
                <ListLinkRow
                  key={notification.id}
                  href={`/${locale}/notifications/${notification.id}`}
                  ariaLabel={notification.dedupe_key}
                >
                  <NotificationRow notification={notification} locale={locale} now={now} />
                </ListLinkRow>
              ))}
            </ListGroup>

            {total > PER_PAGE ? (
              <nav className="mb-8 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={query.page <= 1}
                  onClick={() =>
                    commit({ ...query, page: Math.max(1, query.page - 1) }, { resetPage: false })
                  }
                  aria-label={t("previousPage")}
                  className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
                >
                  <Icon name="back" flipInRtl className="size-5" />
                </button>
                <span className="text-footnote text-label-secondary">
                  <Ltr numeric>
                    {query.page} / {pageCount}
                  </Ltr>
                </span>
                <button
                  type="button"
                  disabled={query.page >= pageCount}
                  onClick={() => commit({ ...query, page: query.page + 1 }, { resetPage: false })}
                  aria-label={t("nextPage")}
                  className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
                >
                  <Icon name="chevron" flipInRtl className="size-5" />
                </button>
              </nav>
            ) : null}
          </>
        )}
      </div>
    </Scaffold>
  );

  /**
   * The date range.
   *
   * Two native date inputs rather than the analytics branch's `RangeControl`:
   * that control offers presets over a *report* period and commits both ends at
   * once, while this filter is `Y-m-d` in **UTC** with each end covering its
   * whole day — `date_from` alone is a legal, useful request and the preset
   * grammar has no way to express it.
   *
   * Held as a draft and committed on change of either end, so a half-entered
   * range never reaches the API as a 400: the pattern is enforced server-side
   * (`?date_from=yesterday` is a 400) and `queryFromParams` drops anything that
   * is not `Y-m-d`, so the two agree.
   */
  function DateRange() {
    const apply = (next: { from: string; to: string }) => {
      setDates(next);
      commit({ ...query, dateFrom: next.from, dateTo: next.to });
    };

    return (
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-surface-2 px-3">
          <Icon name="clock" className="size-4 shrink-0 text-label-secondary" />
          <input
            type="date"
            value={dates.from}
            max={dates.to || undefined}
            onChange={(event) => apply({ ...dates, from: event.target.value })}
            aria-label={t("dateFrom")}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-footnote text-label outline-none"
          />
          <span aria-hidden="true" className="shrink-0 text-footnote text-label-tertiary">
            –
          </span>
          <input
            type="date"
            value={dates.to}
            min={dates.from || undefined}
            onChange={(event) => apply({ ...dates, to: event.target.value })}
            aria-label={t("dateTo")}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-footnote text-label outline-none"
          />
        </div>
        {dates.from !== "" || dates.to !== "" ? (
          <button
            type="button"
            onClick={() => apply({ from: "", to: "" })}
            className="press min-h-11 shrink-0 rounded-md px-2 text-footnote text-accent"
          >
            {t("clearDates")}
          </button>
        ) : null}
        {/*
          The range is UTC and the panel says so once, here, rather than beside
          every date on the screen. `formatDay` renders these in UTC for the same
          reason the analytics boundaries are — they are calendar days the server
          drew, not instants in the shop's clock.
        */}
        {query.dateFrom !== "" || query.dateTo !== "" ? (
          <p className="w-full text-caption text-label-tertiary">
            <Isolate>
              {t("dateScope", {
                from: query.dateFrom === "" ? "…" : formatDay(query.dateFrom, locale),
                to: query.dateTo === "" ? "…" : formatDay(query.dateTo, locale),
              })}
            </Isolate>
          </p>
        ) : null}
      </div>
    );
  }
}
