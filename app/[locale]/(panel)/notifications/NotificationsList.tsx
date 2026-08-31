"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Notification } from "@/lib/api/schemas/notification";
import { acRead } from "@/lib/api/browser";
import {
  eventMessageKey,
  isNotificationEvent,
} from "@/lib/notifications";
import { useOnline } from "@/lib/use-online";
import { useHydrated } from "@/lib/use-hydrated";
import { formatDate, formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import {
  DataTable,
  TableControls,
  TableFooter,
  useTablePreferences,
} from "@/components/ui/DataTable";
import { FilterChips, FilterRow, FilterTabs } from "@/components/ui/FilterBar";
import { DateField } from "@/components/ui/Form";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { RecordListSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Button, IconButton } from "@/components/ui/Button";
import { Isolate } from "@/components/primitives/Ltr";
import {
  buildColumns,
  notificationRecord,
  type NotificationColumnContext,
} from "./columns";
import {
  EMPTY_QUERY,
  STATUS_FILTERS,
  dayFromInput,
  isFiltered,
  isOverPaged,
  listParams,
  notificationsKey,
  queryFromParams,
  toUrlParams,
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
 * ## Four filter dimensions in one row, and no drawer
 *
 * Payments' count and payments' judgement: the status tabs above, then the two
 * date bounds and a clear button. Products needed a `Drawer` with
 * draft-then-apply at nine dimensions; four fit a row, and a drawer here would be
 * a click and a modal between a person and a filter that was already on screen.
 *
 * **The first status tab sends no parameter**, and here that is load-bearing
 * rather than tidy: `?status=` is a **400** on this collection — *"status is not
 * one of pending, sent, and failed."* — not an absence, so a first tab sending an
 * empty string would be a refusal rather than a redundant parameter.
 *
 * **No `FilterChips` for those three.** They restate controls standing six inches
 * above them: the status is the highlighted tab and each date bound is legible in
 * its own picker. That is payments' argument at the same count.
 *
 * That last clause used to read "printed in the page's own language by `echo`,
 * directly under its own picker", and the change is the drawn date control rather
 * than a change of mind: the bound is now legible *in the field itself*, in the
 * reader's own field order, so the readback that used to carry it is deleted and
 * the argument against a chip is if anything stronger. What the chip row *does*
 * carry is the two dimensions no control on screen restates — see below.
 *
 * ## `dedupe_key` and `subject_id` are URL-only, and they earn chips
 *
 * This is the one screen in the run where chips are the honest answer rather than
 * a duplication. Nobody types a dedupe key and nobody types an order id: both
 * arrive by following a link from a notification's detail. So the list can be
 * silently narrowed by a parameter with no visible control, which is a screen
 * that looks broken. Each renders as a removable chip instead.
 *
 * There is deliberately **no `recipient` filter**, though the parameter works and
 * this branch is why it exists. It is exact-match-only — `?recipient=amina`
 * answers 0 rows against `?recipient=amina@example.test`'s 3 — nobody types an
 * address, and "this person's queue" already has its own surface on the customer
 * detail.
 *
 * ## What this screen deliberately does not ship
 *
 * **No sorting and no `aria-sort`** — see `columns.tsx`. **No search box**:
 * `?search=`, `?s=` and `?q=` each answer all 25 rows. **No `event` and no
 * `audience` filter**: both accepted and ignored, and both published on every row,
 * which is exactly what makes them the controls somebody would build first and the
 * ones that would appear to work over one page and lie across the second. **No
 * `channel` filter**, and that one *is* honoured — the reason is the enumeration
 * rather than the parameter, and `query.ts` argues it. **No primary action**:
 * `POST /notifications` does not exist; a notification is written by an order or a
 * payment, never by hand.
 *
 * ## The stale marker, and the half of §3.7 that has nothing to bite on
 *
 * §3.7's amendment exempts a screen that cannot hold data older than its own last
 * fetch. This is not one: it is a client component over a react-query cache, it
 * polls, and it has a manual refresh. So the marker ships.
 *
 * The rule's other half — *"and every write control disabled with that same
 * reason"* — has **nothing to disable here**. The list writes nothing; the queue's
 * only write is `retry`, which lives on the detail and is disabled there with this
 * same sentence. That is the shape the customers and dashboard screens use, and
 * this paragraph is the sentence §3.7 asks a screen to carry in its own docblock.
 *
 * It is **not** gated on `!navigator.onLine` alone, which is the anti-pattern the
 * dashboard branch was corrected for. A polling list can hold stale pixels while
 * the browser still reports an interface: a background refetch that fails leaves
 * rows on screen that are older than they look, and that is exactly the condition
 * the marker exists to name. So the gate is *offline **or** the last fetch failed*,
 * over data that exists at all.
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
  const tA11y = useTranslations("a11y");
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = useMemo(
    () => queryFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  /*
   * The fifth state's first half. `navigator.onLine` is trusted in one direction
   * only — it reports the interface rather than reachability — which is why the
   * refresh control stays enabled below.
   */
  const online = useOnline();

  /* See `NotificationColumnContext.hydrated`: this queue's rows are minutes old,
     so a relative stamp is a hydration mismatch on the server-rendered first
     page. */
  const hydrated = useHydrated();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: notificationsKey(query),
    queryFn: () => fetchNotifications(query),
    initialData:
      initialNotifications !== null &&
      notificationsKey(query)[1] === notificationsKey(initialQuery)[1]
        ? {
            notifications: initialNotifications,
            total: initialTotal ?? initialNotifications.length,
          }
        : undefined,
    /*
     * **A queue drains without the operator acting**, and this is the screen
     * somebody leaves open on a second monitor while a drain runs. Orders' numbers
     * and orders' reason: nothing below 30 s, because reads are 600/min per
     * credential and shared across every tab this person has open, and a hidden
     * tab is not watching a queue.
     */
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    /* Keeps the previous page on screen while the next loads, so changing a
       filter, the tab or the page never flashes a skeleton over content still
       valid. §3.6's third mechanism, and what makes the poll invisible. */
    placeholderData: keepPreviousData,
  });

  const notifications = data?.notifications ?? [];
  const total = data?.total ?? 0;
  const filtered = isFiltered(query);
  const overPaged = isOverPaged(query);

  /* Not wrapped in `useCallback`: the React Compiler is on in this project and
     memoizes this already; a manual dependency list disagreeing with the
     compiler's inference makes it skip optimising the whole component. */
  function commit(next: NotificationsQuery) {
    const params = toUrlParams(next);
    /* `push`, not `replace` — going back from a filtered list must reach the
       unfiltered one. */
    router.push(`/${locale}/notifications${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  /* A new filter resets to page one; paging and per-page do not. Page 3 of a
     differently filtered list is a different set of rows. */
  const commitFilter = (next: NotificationsQuery) => commit({ ...next, page: 1 });

  /* The one affordance no individual control offers: dropping every dimension at
     once, chips included, while keeping the reading position's page size. Same
     control, same words and same handler as the no-results empty state. */
  const clearAll = () => commit({ ...EMPTY_QUERY, perPage: query.perPage });

  /* One clock for the whole list, taken on render rather than per row: `new
     Date()` inside a cell gives twenty slightly different answers and re-derives
     on every filter change. */
  const now = new Date();

  const ctx: NotificationColumnContext = { locale, hydrated, now, t };
  const columns = buildColumns(ctx);

  /* Held here rather than inside `DataTable` so the controls sit in the toolbar
     beside the filters instead of floating above the card. */
  const preferences = useTablePreferences("notifications", columns);

  const chips = [
    ...(query.dedupeKey !== ""
      ? [
          {
            key: "dedupe_key",
            /* The key itself, because it is what the chip is *about* — an
               operator quotes this string in a ticket and it is the only filter
               that answers "this event, for this order" exactly. `FilterChips`
               renders a chip's label `dir="auto"`, which resolves LTR over an
               all-ASCII identifier and is the right answer inside the Arabic
               panel too. */
            label: query.dedupeKey,
            onRemove: () => commitFilter({ ...query, dedupeKey: "" }),
          },
        ]
      : []),
    ...(query.subjectId > 0
      ? [
          {
            key: "subject_id",
            label: t("subjectChip", { id: query.subjectId }),
            onRemove: () => commitFilter({ ...query, subjectId: 0 }),
          },
        ]
      : []),
  ];

  /* Offline, or the last fetch failed over rows still on screen. See the
     docblock: a polling list goes stale while the interface is still up. */
  const stale = dataUpdatedAt > 0 && (!online || isError);

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        /*
         * The visible count, and the testid the suite waits on before asserting
         * anything else. `Isolate` and never `Ltr`: this is a translated sentence
         * with a number in it, not an identifier, and forcing LTR lays an Arabic
         * count out from the left.
         */
        subtitle={
          <span data-testid="notifications-count">
            <Isolate>{t("count", { total })}</Isolate>
          </span>
        }
        /*
         * One control, and it is not a primary. **Nothing on this screen creates a
         * notification**: `POST /notifications` does not exist, and a row is
         * written by an order or a payment. A "new notification" button would name
         * an action this panel does not have.
         */
        actions={
          <IconButton
            label={t("refresh")}
            icon="refresh"
            variant="secondary"
            onClick={() => void refetch()}
            loading={isFetching}
          />
        }
        toolbar={
          <div className="flex flex-col gap-3">
            <FilterTabs<StatusFilter>
              tabs={STATUS_FILTERS.map((value) => ({
                value,
                label: value === "" ? t("status.all") : t(`status.${value}`),
              }))}
              value={query.status}
              onChange={(status) => commitFilter({ ...query, status })}
              label={t("statusLabel")}
            />

            {/* `align="end"` because the two date pickers carry a visible label
                above the box and the clear button does not — see `FilterRow`. */}
            <FilterRow align="end">
              {/*
                Two bounds, each bounding the other so an inverted range is hard
                to express — it is a 200 with zero rows rather than a refusal, so
                nothing on screen would explain it.

                **`echo` was on both and is deleted with the drawn picker.** It
                read the applied bound back underneath in the page's own language,
                because the native `<input type="date">` above it printed that same
                bound in the *browser's* — `mm/dd/yyyy` under an Arabic label.
                `DatePicker` renders the field in the reader's own field order, so
                a readback would now put the same date on the screen twice.

                Both ends are still whole calendar days in **UTC**, which is a
                property of `/notifications` rather than of the control:
                `dayFromInput` is where that is enforced.
              */}
              <div className="w-full sm:w-44">
                <DateField
                  label={t("dateFrom")}
                  value={query.dateFrom}
                  max={query.dateTo === "" ? undefined : query.dateTo}
                  onChange={(next) => commitFilter({ ...query, dateFrom: dayFromInput(next) })}
                />
              </div>

              <div className="w-full sm:w-44">
                <DateField
                  label={t("dateTo")}
                  value={query.dateTo}
                  min={query.dateFrom === "" ? undefined : query.dateFrom}
                  onChange={(next) => commitFilter({ ...query, dateTo: dayFromInput(next) })}
                />
              </div>

              {/*
                **Not rendered when nothing is filtered**, per §3.3: a control that
                cannot act is absent rather than disabled, and "clear" with nothing
                to clear cannot act.
              */}
              {filtered ? (
                <Button variant="ghost" size="sm" icon="close" onClick={clearAll}>
                  {t("empty.clear")}
                </Button>
              ) : null}

              <div className="ms-auto">
                <TableControls
                  columns={columns}
                  visible={preferences.visible}
                  onVisibleChange={preferences.setVisible}
                  density={preferences.density}
                  onDensityChange={preferences.setDensity}
                />
              </div>
            </FilterRow>

            {/* The two dimensions no control above restates. `onClearAll` is not
                passed: the clear button in the row above is that control, and a
                second one inside the chip strip would be the duplication the chips
                themselves are here to avoid. */}
            <FilterChips chips={chips} />
          </div>
        }
      />

      <PageBody width="full">
        {stale ? (
          /* The cause, not just the age. This screen is the first to reach the
             marker with the interface still up, so `offline` would have been the
             banner stating something it has not established. */
          <StaleBanner
            time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale, now)}
            reason={online ? "refreshFailed" : "offline"}
          />
        ) : null}

        {/* A live region, so a filter that changes the result count announces it.
            Its own testid: `notifications-count` above is the *visible* count and
            is what the suite asserts on, and two elements sharing one testid is a
            strict-mode violation the moment either is queried. */}
        <p aria-live="polite" className="sr-only" data-testid="notifications-live">
          {tA11y("listUpdated", { total })}
        </p>

        {isPending && notifications.length === 0 ? (
          <>
            <div className="hidden md:block">
              <TableSkeleton rows={8} cols={6} label={t("loading")} />
            </div>
            {/* The card and its 8px padding are `DataTable`'s below `md`, so the
                skeleton wears them too or the rows step inward when data lands. */}
            <div className="ui-card p-2 md:hidden">
              <RecordListSkeleton rows={6} label={t("loading")} />
            </div>
          </>
        ) : isError && notifications.length === 0 ? (
          /*
           * **The error state and the empty state print different strings**, which
           * is the inventory #2 defect: a failed request and an empty queue are
           * not the same fact, and only one of them is fixed by pressing retry.
           *
           * Reached only when there is nothing on screen. A refetch that fails
           * over rows already rendered keeps them — §3.6's third mechanism — and
           * says so through the stale marker above, because replacing live content
           * with a full-page error is how a poll turns a blip into a blank screen.
           */
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={filtered || overPaged ? "search" : "mail"}
            /*
             * **Three empty states, and telling them apart is the point.** Past the
             * last page is the most specific fact and wins the one action this
             * state gets — `?page=999` answers a 200 with an empty array, so the
             * table is not drawn and with it goes the only control that could page
             * back. No results for these filters offers to clear them; `status=sent`,
             * `status=failed` and either date bound can each empty this list, so the
             * second half has real producers. Nothing queued at all offers nothing,
             * and that is correct: a notification is written by an order or a
             * payment, and a button here would name an action this panel does not
             * have.
             */
            message={
              overPaged
                ? t("empty.pastEnd")
                : filtered
                  ? t("empty.noResults")
                  : t("empty.none")
            }
            action={
              overPaged
                ? { label: t("empty.firstPage"), onClick: () => commit({ ...query, page: 1 }) }
                : filtered
                  ? { label: t("empty.clear"), onClick: clearAll }
                  : undefined
            }
          />
        ) : (
          <DataTable
            preferences={preferences}
            rows={notifications}
            columns={columns}
            rowKey={(notification) => String(notification.id)}
            /*
             * Named by its date as well as its event, because the queue holds one
             * row per event per order — seven rows reading "Commande confirmée" is
             * the ordinary case, and read out of a links list they would be seven
             * identical names pointing at seven different records. The customer
             * section learned this first.
             */
            rowLabel={(notification) =>
              tA11y("notification", {
                event: isNotificationEvent(notification.event)
                  ? t(`event.${eventMessageKey(notification.event)}`)
                  : notification.event,
                date: formatDate(notification.created_at, locale),
              })
            }
            record={(notification) => notificationRecord(notification, ctx)}
            /*
             * Navigates rather than previewing — see `columns.tsx`. The event cell
             * is a real anchor on top of this, for the keyboard and the middle
             * click; it stops propagation so only one push happens. **No
             * `rowOpenerId`**: §3.2 says to omit it when that cell is already a
             * link and following it is what clicking the row does.
             */
            onRowClick={(notification) =>
              router.push(`/${locale}/notifications/${notification.id}`)
            }
            footer={
              <TableFooter
                page={query.page}
                perPage={query.perPage}
                total={total}
                onPageChange={(page) => commit({ ...query, page })}
                onPerPageChange={(perPage) => commit({ ...query, perPage, page: 1 })}
              />
            }
          />
        )}
      </PageBody>
    </div>
  );
}
