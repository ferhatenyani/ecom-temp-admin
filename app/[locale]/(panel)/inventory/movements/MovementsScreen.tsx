"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { REASON_TONE } from "@/lib/movement-reason";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import {
  DataTable,
  TableControls,
  TableFooter,
  useTablePreferences,
} from "@/components/ui/DataTable";
import { FilterChips, FilterRow } from "@/components/ui/FilterBar";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { RecordListSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Card } from "@/components/ui/Card";
import { Badge, CountBadge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { buildColumns, movementRecord, type MovementColumnContext } from "./columns";
import { MovementFilters } from "./MovementFilters";
import {
  EMPTY_QUERY,
  drawerFilterCount,
  fetchMovements,
  fetchSummary,
  isFiltered,
  isOverPaged,
  movementsKey,
  queryFromParams,
  summaryKey,
  toUrlParams,
  type MovementsQuery,
} from "./query";

/**
 * The stock movement ledger — 1154 rows over 155 products, and the screen that
 * proves docs/ADMIN_PANEL.md's claim that no path changes stock without
 * recording it.
 *
 * ## Why it is a route rather than a third tab
 *
 * It used to be the third segment of the stock list's `Segmented` control. Two of
 * those three views are the same collection through two endpoints and belong in a
 * tab strip; this one is **different data with a different filter set, a
 * different page size and a summary of its own**, and folding it in meant one
 * screen holding two unrelated query objects and a control that changed which of
 * them was live. That was a phone-era compression — three routes cost two
 * navigations on a device with no room for a second screen — and a panel with a
 * sidebar has no such constraint.
 *
 * **No nav entry**, deliberately: the sidebar is already seventeen items, and a
 * ledger is somewhere you go *from* a stock screen. It is reached from the stock
 * list's header and from an item's own detail, which are the two places a person
 * is standing when they want it.
 *
 * ## Two requests, two failures
 *
 * The page of rows and the summary take the same filters and are separate
 * queries, because **a failed summary must not take the ledger down with it**:
 * the rows are the screen and the strip above them is context. The strip says so
 * itself when it cannot load, rather than vanishing — §3.7 wants an error and an
 * absence to be distinguishable, and a silently missing summary reads as a shop
 * with no movements.
 *
 * Neither is prefetched on the server, unlike every list before it in this run,
 * and that is a decision rather than an omission. The two queries fail
 * independently and retry independently, which is the arrangement above; doing
 * half of that on the server would mean writing the independence twice. The
 * route's `loading.tsx` draws the same shape in the meantime.
 */
export function MovementsScreen({ locale, meId }: { locale: string; meId: number | null }) {
  const t = useTranslations("inventory");
  const tReason = useTranslations("movementReason");
  const tA11y = useTranslations("a11y");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filtersOpen, setFiltersOpen] = useState(false);

  const query = useMemo(
    () => queryFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const online = useOnline();

  const movements = useQuery({
    queryKey: movementsKey(query, meId),
    queryFn: () => fetchMovements(query, meId),
    placeholderData: keepPreviousData,
  });

  const summary = useQuery({
    queryKey: summaryKey(query, meId),
    queryFn: () => fetchSummary(query, meId),
    placeholderData: keepPreviousData,
  });

  const rows = movements.data?.movements ?? [];
  const total = movements.data?.total ?? 0;
  const filtered = isFiltered(query);
  const overPaged = isOverPaged(query);

  function commit(next: MovementsQuery) {
    const params = toUrlParams(next);
    /* `push`, not `replace` — filter state in the URL is only half the promise
       and a working back button is the other half. */
    router.push(`/${locale}/inventory/movements${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  const commitFilter = (next: MovementsQuery) => commit({ ...next, page: 1 });

  const ctx: MovementColumnContext = useMemo(
    () => ({ locale, meId, t, tReason }),
    [locale, meId, t, tReason],
  );
  const columns = useMemo(() => buildColumns(ctx), [ctx]);
  const preferences = useTablePreferences("movements", columns);

  /** One chip per value, each removable on its own. */
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  const chip = (label: string, value: string) => t("chipValue", { label, value });
  if (query.reason !== "") {
    chips.push({
      key: "reason",
      label: chip(t("filter.reason"), tReason(query.reason)),
      onRemove: () => commitFilter({ ...query, reason: "" }),
    });
  }
  if (query.actor === "me") {
    chips.push({
      key: "actor",
      label: t("filter.mine"),
      onRemove: () => commitFilter({ ...query, actor: "" }),
    });
  }
  if (query.productId !== "") {
    chips.push({
      key: "product",
      label: chip(t("filter.product"), query.productId),
      onRemove: () => commitFilter({ ...query, productId: "" }),
    });
  }
  if (query.dateFrom !== "" || query.dateTo !== "") {
    chips.push({
      key: "window",
      label: chip(
        t("filter.window"),
        `${query.dateFrom || "…"} – ${query.dateTo || "…"}`,
      ),
      onRemove: () => commitFilter({ ...query, dateFrom: "", dateTo: "" }),
    });
  }

  const clearAll = () => commit({ ...EMPTY_QUERY, perPage: query.perPage });
  const firstPage = () => commit({ ...query, page: 1 });

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("ledger.title")}
        subtitle={
          <span data-testid="movements-count">
            <Isolate>{t("movesCount", { total })}</Isolate>
          </span>
        }
        back={{ href: `/${locale}/inventory`, label: t("title") }}
        actions={
          <IconButton
            label={t("refresh")}
            icon="refresh"
            variant="secondary"
            onClick={() => {
              void movements.refetch();
              void summary.refetch();
            }}
            loading={movements.isFetching || summary.isFetching}
          />
        }
        toolbar={
          <div className="flex flex-col gap-3">
            <FilterRow>
              <Button
                variant="secondary"
                size="sm"
                icon="filter"
                aria-label={t("filters")}
                onClick={() => setFiltersOpen(true)}
              >
                <span className="hidden sm:inline">{t("filters")}</span>
                {drawerFilterCount(query) > 0 ? (
                  <CountBadge>{drawerFilterCount(query)}</CountBadge>
                ) : null}
              </Button>
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
            {chips.length > 0 ? <FilterChips chips={chips} onClearAll={clearAll} /> : null}
          </div>
        }
      />

      <PageBody width="full">
        {!online && movements.dataUpdatedAt > 0 ? (
          <StaleBanner
            time={formatWhen(new Date(movements.dataUpdatedAt).toISOString(), locale)}
          />
        ) : null}

        <p aria-live="polite" className="sr-only" data-testid="movements-live">
          {tA11y("listUpdated", { total })}
        </p>

        <div className="flex flex-col gap-4">
          <Summary
            data={summary.data}
            failed={summary.isError}
            onRetry={() => void summary.refetch()}
          />

          {movements.isPending && rows.length === 0 ? (
            <>
              <div className="hidden md:block">
                <TableSkeleton rows={8} cols={6} label={t("loading")} />
              </div>
              <div className="ui-card p-2 md:hidden">
                <RecordListSkeleton rows={6} label={t("loading")} />
              </div>
            </>
          ) : movements.isError ? (
            <ErrorState
              message={(movements.error as Error).message}
              onRetry={() => void movements.refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={filtered ? "search" : "list"}
              /* Past the last page is the more specific fact and wins the one
                 action this state gets — `?page=999` answers 200 with an empty
                 array, and the page control lives inside the table that was not
                 drawn. See the stock list, where the same hole had no way out at
                 all on a view that takes no filters. */
              message={
                overPaged
                  ? t("empty.pastEnd")
                  : filtered
                    ? t("empty.noResults")
                    : t("empty.moves")
              }
              action={
                overPaged
                  ? { label: t("empty.firstPage"), onClick: firstPage }
                  : filtered
                    ? { label: t("empty.clear"), onClick: clearAll }
                    : undefined
              }
            />
          ) : (
            <DataTable
              preferences={preferences}
              rows={rows}
              columns={columns}
              rowKey={(movement) => String(movement.id)}
              rowLabel={(movement) => tReason(movement.reason)}
              record={(movement) => movementRecord(movement, ctx)}
              /* No `onRowClick`: a movement has no detail screen, and the one
                 thing on the row worth opening is the product, which is an anchor
                 in the cell that names it. */
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
        </div>
      </PageBody>

      <MovementFilters
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        query={query}
        onApply={commitFilter}
      />
    </div>
  );
}

/**
 * Net movement by reason, over whatever the ledger is currently filtered to.
 *
 * 1154 rows at 20 a page is 58 pages, and nobody reads 58 pages. This is the line
 * that answers "how much did we write off to damage this month" without any of
 * them — which is why the reason vocabulary is a closed enum at the API in the
 * first place.
 *
 * `date_from`/`date_to` are real here: measured, the unfiltered summary reports
 * `correction: −1540 over 166 movements` and the same call windowed to today
 * reports `−141 over 15`. The strip therefore always states its own scope, since
 * a number whose window is invisible is a number people misread.
 *
 * **Reasons with no rows are absent from the response, not zero**, so this
 * renders what came back rather than iterating the vocabulary. A zero row here
 * would be inventing a fact the API did not report; the filter drawer is where
 * the complete vocabulary belongs.
 *
 * One `Card` with a grid inside it rather than a card per reason: §1.6 forbids a
 * card inside a card, and nine of them scrolling sideways was a phone control
 * standing in for a table of nine numbers.
 */
function Summary({
  data,
  failed,
  onRetry,
}: {
  data: Record<string, { net: number; movements: number }> | undefined;
  failed: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("inventory");
  const tReason = useTranslations("movementReason");

  const entries = Object.entries(data ?? {}).filter(([reason]) => reason in REASON_TONE);

  /* An absence and a failure are different states and only one of them is worth
     a box: with no movements at all the list below already says so, and a second
     empty panel above it would say it twice. A failure is not an absence, so it
     keeps the card and says which. */
  if (failed) {
    return (
      <Card title={t("ledger.summaryTitle")}>
        <p role="status" className="flex flex-wrap items-center gap-3 text-ui-label text-ui-muted">
          <span className="min-w-0">{t("ledger.summaryFailed")}</span>
          <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
            {t("ledger.summaryRetry")}
          </Button>
        </p>
      </Card>
    );
  }

  if (entries.length === 0) return null;

  return (
    <Card title={t("ledger.summaryTitle")} footnote={t("ledger.summaryScope")}>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {entries.map(([reason, value]) => (
          <div key={reason} className="flex min-w-0 flex-col gap-1">
            <dt>
              <Badge tone={REASON_TONE[reason as keyof typeof REASON_TONE]}>
                {tReason(reason)}
              </Badge>
            </dt>
            <dd className="flex min-w-0 flex-col gap-0.5">
              {/* A bare signed figure — `Ltr`, and the sign is a glyph so the
                  tone is never the only signal. */}
              <Ltr
                className={`text-ui-heading ${
                  value.net > 0
                    ? "text-ui-success-fg"
                    : value.net < 0
                      ? "text-ui-danger-fg"
                      : "text-ui-fg"
                }`}
              >
                {value.net > 0 ? `+${value.net}` : value.net < 0 ? `−${Math.abs(value.net)}` : "0"}
              </Ltr>
              {/* A translated sentence with a number in it — `Isolate`. */}
              <Isolate className="text-ui-label text-ui-subtle">
                {t("ledger.movements", { count: value.movements })}
              </Isolate>
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
