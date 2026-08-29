"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { InventoryItem } from "@/lib/api/schemas/inventory";
import { itemLabel } from "@/lib/inventory";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import {
  DataTable,
  TableControls,
  TableFooter,
  useTablePreferences,
} from "@/components/ui/DataTable";
import { FilterChips, FilterRow, FilterTabs, SearchField } from "@/components/ui/FilterBar";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { ExportNotice, exportHref, useExportFrom } from "@/components/ui/ExportNotice";
import { RecordListSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { CountBadge } from "@/components/ui/Badge";
import { Isolate } from "@/components/primitives/Ltr";
import { buildColumns, inventoryRecord, type InventoryColumnContext } from "./columns";
import { InventoryFilters } from "./InventoryFilters";
import { SkuLookup } from "./SkuLookup";
import {
  VIEWS,
  fetchStock,
  isFiltered,
  isOverPaged,
  queryFromParams,
  stockKey,
  toUrlParams,
  type InventoryQuery,
  type View,
} from "./query";

/**
 * The stock list, rebuilt on the new design system.
 *
 * ## Low stock is a view of this list; the ledger is not
 *
 * The screen this replaces had **three** views behind one `Segmented` control:
 * low stock, everything, and the movements ledger. Two of those are the same
 * collection through two endpoints and belong in a tab strip. The third is
 * different data with its own filter set, its own summary and its own page size,
 * and making it a third segment was a phone-era compression — it is
 * `/inventory/movements` now, reached from the header here and from the item
 * detail. **No new nav entry**: the sidebar is already seventeen items, and a
 * ledger is somewhere you go from a stock screen rather than a section of the
 * panel.
 *
 * ## The low tab renders fewer controls, and that is the design
 *
 * `/inventory/low-stock` takes **pagination only** — it has no `search`, no
 * `stock_status`, no `include_variations`. So when that tab is active the search
 * field and the Filters button are **not rendered** rather than disabled, and the
 * sentence saying where they went stays on screen. Not rendering a control that
 * cannot act is the rule the nav already follows for capabilities, and here it is
 * load-bearing rather than tidy: **an unknown query parameter on this API answers
 * 200 with the full result set**, so a filter that silently does nothing is
 * indistinguishable on screen from one that works.
 *
 * The SKU lookup stays on both, because it is not a filter of this list: it is
 * its own endpoint and its answer is a navigation.
 *
 * ## What is deliberately absent
 *
 * **No peek drawer**, and this is the first list in the run to refuse one that
 * would have been free — `columns.tsx` carries the argument.
 *
 * **No sorting.** `orderby` on `/inventory` is accepted and unmeasured.
 *
 * **No bulk anything.** `POST /inventory/bulk` exists, takes 100 items, and is
 * held off the proxy allowlist by `lib/api/allowlist.ts:75-77` with
 * `tests/boundary.test.ts:219` asserting it stays there — the same precedent
 * `POST /products/bulk` set. With no bulk write there is nothing for a selection
 * column to do that the export link does not already do for the whole shop.
 */
export function InventoryList({
  locale,
  initialQuery,
  initialItems,
  initialTotal,
}: {
  locale: string;
  initialQuery: InventoryQuery;
  initialItems: InventoryItem[] | null;
  initialTotal: number | null;
}) {
  const t = useTranslations("inventory");
  const tStock = useTranslations("stockStatus");
  const tA11y = useTranslations("a11y");
  const tStates = useTranslations("states");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filtersOpen, setFiltersOpen] = useState(false);

  /* Every piece of list state lives in the URL on this screen. With two filters
     and a tab the URL stays short enough that the reading position is worth
     carrying — the customers list's split rather than the products list's. */
  const query = useMemo(
    () => queryFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const from = useExportFrom();

  /*
   * The fifth state. When the browser is certain it is offline, the rows on
   * screen are as old as the last successful fetch and staleness is never
   * silent. `navigator.onLine` is trusted in one direction only — it reports the
   * interface rather than reachability, which is why the refresh control stays
   * enabled: a van's phone holding one bar reports itself online and a warehouse
   * basement reports itself offline, and only one of those is worth blocking.
   */
  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: stockKey(query),
    queryFn: () => fetchStock(query),
    /* Nothing here polls. A stockroom's shelves do not move under a person the
       way an order book does, and the refresh control is one click away. */
    initialData:
      initialItems !== null &&
      stockKey(query).join("|") === stockKey(initialQuery).join("|")
        ? { items: initialItems, total: initialTotal ?? initialItems.length }
        : undefined,
    /* Keeps the previous page on screen while the next loads, so changing the
       tab or the page never flashes a skeleton over content still valid. */
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const filtered = isFiltered(query);
  const overPaged = isOverPaged(query);

  /*
   * Not wrapped in `useCallback`. The React Compiler is on in this project and
   * memoizes this already; a manual dependency list disagreeing with the
   * compiler's inference makes it skip optimising the whole component.
   */
  function commit(next: InventoryQuery) {
    const params = toUrlParams(next);
    /* `push`, not `replace`. Filter state living in the URL is only half the
       promise; the other half is that the back button works, and `replace`
       overwrites the current entry so going back from a filtered list skips the
       unfiltered one. This suite asserts it. */
    router.push(`/${locale}/inventory${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  /* A new filter resets to page one; paging and per-page do not. */
  const commitFilter = (next: InventoryQuery) => commit({ ...next, page: 1 });

  const ctx: InventoryColumnContext = useMemo(
    () => ({
      locale,
      t,
      tStock,
      typeLabel: (type: string) => (t.has(`type.${type}`) ? t(`type.${type}`) : type),
    }),
    [locale, t, tStock],
  );
  const columns = useMemo(() => buildColumns(ctx), [ctx]);

  /* Held here rather than inside `DataTable` so the controls sit in the toolbar
     rather than floating above the card. */
  const preferences = useTablePreferences("inventory", columns);

  const tabs = VIEWS.map((view) => ({ value: view, label: t(`view.${view}`) }));

  /**
   * The chips: one per **value**, and only on the tab that has values.
   *
   * The tab itself is not a chip — it is a visible control two rows above, and a
   * chip repeating it would be removable in a way that leaves no tab selected.
   */
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (query.view === "all") {
    const chip = (label: string, value: string) => t("chipValue", { label, value });
    if (query.search !== "") {
      chips.push({
        key: "search",
        label: chip(t("filter.product"), query.search),
        onRemove: () => commitFilter({ ...query, search: "" }),
      });
    }
    if (query.stockStatus !== "") {
      chips.push({
        key: "stock-status",
        label: chip(t("filter.stockStatus"), tStock(query.stockStatus)),
        onRemove: () => commitFilter({ ...query, stockStatus: "" }),
      });
    }
    if (query.manageStock !== "") {
      chips.push({
        key: "manage-stock",
        label: chip(
          t("filter.manageStock"),
          t(`manageStock.${query.manageStock === "true" ? "true" : "false"}`),
        ),
        onRemove: () => commitFilter({ ...query, manageStock: "" }),
      });
    }
  }

  const drawerCount =
    (query.stockStatus !== "" ? 1 : 0) + (query.manageStock !== "" ? 1 : 0);

  const clearAll = () =>
    commitFilter({ ...query, search: "", stockStatus: "", manageStock: "" });
  const firstPage = () => commit({ ...query, page: 1 });
  const offlineReason = tStates("offlineWrites");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        /* `Isolate` and never `Ltr`: this is a translated sentence with a number
           in it, not an identifier, and forcing LTR laid "16 عميلًا" out from the
           left on the customers list. */
        subtitle={
          <span data-testid="inventory-count">
            <Isolate>
              {query.view === "low" ? t("lowCount", { total }) : t("count", { total })}
            </Isolate>
          </span>
        }
        actions={
          <>
            <IconButton
              label={t("refresh")}
              icon="refresh"
              variant="secondary"
              onClick={() => void refetch()}
              loading={isFetching}
            />
            {/* The ledger, from the header rather than from a nav entry — see
                this file's docblock. A `Link`, so middle click and "open in new
                tab" work: reading the ledger beside the list is exactly what
                somebody reconciling a count wants two tabs for. */}
            <ButtonLink
              href={`/${locale}/inventory/movements`}
              variant="secondary"
              icon="list"
            >
              {t("ledger.open")}
            </ButtonLink>
            {/* A real link, so the browser performs the download and the
                credential is attached server-side — never in the document. Its
                capability is `ac_manage_inventory`, the same one gating this
                screen, so there is no second gate to apply.

                Disabled while the browser reports itself offline: this one
                genuinely leaves the page, and navigating to a route that cannot
                answer replaces the panel with the browser's own error page.

                `from` is where a refusal comes back to: the route answers a 303
                to this list, tab and filters intact, and `ExportNotice` below
                says what happened. Before it, a 403 replaced the panel with raw
                JSON. */}
            <ButtonLink
              href={exportHref("inventory", from)}
              variant="secondary"
              icon="download"
              prefetch={false}
              disabled={!online}
              title={online ? undefined : offlineReason}
            >
              {t("export")}
            </ButtonLink>
          </>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            {/*
              **The lookup gets its own row, above the tabs.**

              It sat beside the search box in the first draft and that was wrong
              at 1440: two boxes of nearly the same width, eight pixels apart,
              both search-shaped, doing opposite things — one *navigates* on an
              exact SKU and leaves the list, the other *narrows* the list. The
              placeholders and the icons differ and that is not enough; adjacency
              is what people read.

              Above the tabs rather than below them, because it is not a control
              of the list at all: scan and you are gone. It renders on both views
              for the same reason.
            */}
            <SkuLookup locale={locale} />

            <FilterTabs<View>
              tabs={tabs}
              value={query.view}
              onChange={(view) => commitFilter({ ...query, view })}
              label={t("viewLabel")}
            />

            <FilterRow>
              {query.view === "all" ? (
                <>
                  <SearchField
                    value={query.search}
                    onSubmit={(next) => commitFilter({ ...query, search: next })}
                    placeholder={t("searchPlaceholder")}
                    label={t("searchLabel")}
                    clearLabel={t("clearSearch")}
                  />
                  {/* The label hides below `sm`, the way the table controls
                      beside it do: measured on the products branch at 340px,
                      three labelled buttons in this row left the search field
                      55px wide. The count stays visible at every width because it
                      is the part the icon cannot carry, and the `aria-label` is
                      what keeps the button named once the word is gone. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="filter"
                    aria-label={t("filters")}
                    onClick={() => setFiltersOpen(true)}
                  >
                    <span className="hidden sm:inline">{t("filters")}</span>
                    {drawerCount > 0 ? <CountBadge>{drawerCount}</CountBadge> : null}
                  </Button>
                </>
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

            {/* Why this tab has no search and no Filters button. It renders
                whether or not the report is empty: it explains an absence, and
                the absence is most confusing on the screen with nothing on it. */}
            {query.view === "low" ? (
              <p className="text-ui-label text-ui-subtle">{t("lowHasNoFilters")}</p>
            ) : null}

            {chips.length > 0 ? (
              <FilterChips chips={chips} onClearAll={clearAll} />
            ) : null}
          </div>
        }
      />

      <PageBody width="full">
        {/* Inside `<main>`, where the reader was looking. Above the stale marker
            because it reports the thing they just did, not the age of the rows. */}
        <ExportNotice />

        {(!online || isError) && dataUpdatedAt > 0 ? (
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)}
            reason={online ? "refreshFailed" : "offline"}
          />
        ) : null}

        {/* A live region, so a filter that changes the result count announces it.
            Its own testid: `inventory-count` above is the *visible* count and is
            what the suite asserts on, and two elements sharing one testid is a
            strict-mode violation the moment either is queried. */}
        <p aria-live="polite" className="sr-only" data-testid="inventory-live">
          {tA11y("listUpdated", { total })}
        </p>

        {isPending && items.length === 0 ? (
          <>
            <div className="hidden md:block">
              <TableSkeleton rows={8} cols={5} label={t("loading")} />
            </div>
            {/* The card and its padding are `DataTable`'s below `md`, so the
                skeleton wears them too — otherwise the rows shift 8px inward the
                moment the data lands. */}
            <div className="ui-card p-2 md:hidden">
              <RecordListSkeleton rows={6} label={t("loading")} />
            </div>
          </>
        ) : isError && items.length === 0 ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={filtered ? "search" : "box"}
            /*
             * Three empty states, and the third is the bug this branch fixes.
             *
             * A page past the last one answers 200 with an empty array, and the
             * page control lives inside the table that was not drawn — so an
             * empty page 3 had no control on it at all. On the `all` view "clear
             * the filters" was at least a way out; on `low` there are no filters
             * by construction, `isFiltered()` is false, and the browser's back
             * button was the only escape from a screen the panel had navigated to
             * itself. Being past the first page is the more specific fact, so it
             * wins the one action this state gets.
             */
            message={
              overPaged
                ? t("empty.pastEnd")
                : filtered
                  ? t("empty.noResults")
                  : query.view === "low"
                    ? t("empty.low")
                    : t("empty.all")
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
            rows={items}
            columns={columns}
            rowKey={(item) => String(item.id)}
            rowLabel={(item) => tA11y("stockItem", { name: itemLabel(item).product })}
            record={(item) => inventoryRecord(item, ctx)}
            /* Navigates rather than previewing — see `columns.tsx`. The name cell
               is a real anchor on top of this, for the keyboard and the middle
               click; it stops propagation so only one push happens. */
            onRowClick={(item) => router.push(`/${locale}/inventory/${item.id}`)}
            /* No `sort` and no `onSortChange` — `columns.tsx` carries the whole
               argument. Passing neither is what keeps `aria-sort` off the headers
               too: the primitive gates the attribute on a handler existing. */
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

      <InventoryFilters
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        query={query}
        onApply={commitFilter}
      />
    </div>
  );
}
