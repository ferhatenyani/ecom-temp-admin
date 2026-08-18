"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { InventoryItem } from "@/lib/api/schemas/inventory";
import { STOCK_STATUSES } from "@/lib/product-status";
import { Scaffold } from "@/components/patterns/Scaffold";
import {
  EmptyState,
  ErrorState,
  StaleBanner,
} from "@/components/patterns/States";
import {
  FilterAllPill,
  FilterChips,
  FilterGroup,
  FilterPill,
  FilterPills,
  FilterSheet,
  FilterValue,
} from "@/components/patterns/FilterSheet";
import { ListGroup, ListLinkRow } from "@/components/primitives/GroupedList";
import { Segmented } from "@/components/primitives/Segmented";
import { Icon } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { itemLabel } from "@/lib/inventory";
import { StockRow } from "./StockRow";
import { SkuLookup } from "./SkuLookup";
import { Ledger } from "./Ledger";
import { RowSkeleton } from "./RowSkeleton";
import {
  PER_PAGE,
  VIEWS,
  fetchStock,
  isFiltered,
  queryFromParams,
  stockKey,
  toUrlParams,
  type InventoryQuery,
  type View,
} from "./query";

/**
 * The inventory section: one route, three views, low stock first.
 *
 * **The segmented control is how the screen says low stock is the default.**
 * docs/ADMIN_PANEL.md asks for a warehouse phone whose default screen is low
 * stock and not the full list; a control already sitting on its first segment
 * states that, with the other two views one tap away and neither of them where
 * the screen opens. Three separate routes would say the same thing less clearly
 * and cost two navigations to compare.
 */
export function InventoryScreen({
  locale,
  initialQuery,
  initialItems,
  initialTotal,
  meId,
}: {
  locale: string;
  initialQuery: InventoryQuery;
  initialItems: InventoryItem[] | null;
  initialTotal: number | null;
  meId: number | null;
}) {
  const t = useTranslations("inventory");
  const tStock = useTranslations("stockStatus");
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = queryFromParams(new URLSearchParams(searchParams.toString()));
  const [searchDraft, setSearchDraft] = useState(query.search);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<InventoryQuery>(query);

  const commit = (next: InventoryQuery, options: { resetPage?: boolean } = {}) => {
    const target =
      options.resetPage === false ? next : { ...next, page: 1, movesPage: 1 };
    const params = toUrlParams(target);
    // `push`, not `replace` — filter state in the URL is only half the promise
    // and a working back button is the other half. The orders and products
    // branches both assert this in e2e and so does this one.
    router.push(`/${locale}/inventory${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  };

  const online = useOnline();
  const stockView = query.view !== "moves";

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: stockKey(query),
    queryFn: () => fetchStock(query),
    enabled: stockView,
    // Nothing here polls. A stockroom's shelves do not change under a person the
    // way an order book does, and the refresh control is one tap in the nav bar.
    initialData:
      initialItems !== null &&
      stockKey(query).join("|") === stockKey(initialQuery).join("|")
        ? { items: initialItems, total: initialTotal ?? initialItems.length }
        : undefined,
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = isFiltered(query);

  const openSheet = () => {
    setDraft(query);
    setSheetOpen(true);
  };

  /* --------------------------------------------------------------- chips --- */

  const chips: { key: string; label: string; value: string; onRemove: () => void }[] = [];
  if (query.view === "all") {
    if (query.search !== "") {
      chips.push({
        key: "search",
        label: t("filter.product"),
        value: query.search,
        onRemove: () => {
          setSearchDraft("");
          commit({ ...query, search: "" });
        },
      });
    }
    if (query.stockStatus !== "") {
      chips.push({
        key: "stock-status",
        label: t("filter.stockStatus"),
        value: tStock(query.stockStatus),
        onRemove: () => commit({ ...query, stockStatus: "" }),
      });
    }
    if (query.manageStock !== "") {
      chips.push({
        key: "manage-stock",
        label: t("filter.manageStock"),
        value: t(`manageStock.${query.manageStock === "true" ? "true" : "false"}`),
        onRemove: () => commit({ ...query, manageStock: "" }),
      });
    }
  }

  const segments = VIEWS.map((view) => ({ value: view, label: t(`view.${view}`) }));

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
          <Segmented<View>
            segments={segments}
            value={query.view}
            onChange={(view) => commit({ ...query, view })}
            label={t("viewLabel")}
          />

          {/*
            The lookup belongs to the two stock views, where the mode is "find the
            thing in my hand". The ledger is a reading screen and its own filter
            row already fills this space; the segmented control puts the lookup one
            tap away from there.
          */}
          {stockView ? <SkuLookup locale={locale} /> : null}

          {query.view === "all" ? (
            <>
              <form
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  commit({ ...query, search: searchDraft.trim() });
                }}
                className="flex items-center gap-2 rounded-md bg-surface-2 px-3"
              >
                <Icon name="search" className="size-4 shrink-0 text-label-secondary" />
                <input
                  type="search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder={t("searchPlaceholder")}
                  aria-label={t("searchLabel")}
                  enterKeyHint="search"
                  className="min-h-11 min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-tertiary"
                />
                {searchDraft ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchDraft("");
                      commit({ ...query, search: "" });
                    }}
                    aria-label={t("clearSearch")}
                    className="press flex size-8 items-center justify-center rounded-full text-label-secondary"
                  >
                    <Icon name="close" className="size-4" />
                  </button>
                ) : null}
              </form>

              <FilterPills>
                <FilterAllPill count={chips.length} onClick={openSheet} />
                <FilterPill
                  label={t("filter.stockStatus")}
                  value={query.stockStatus !== "" ? tStock(query.stockStatus) : undefined}
                  onClick={openSheet}
                />
                <FilterPill
                  label={t("filter.manageStock")}
                  value={
                    query.manageStock !== ""
                      ? t(`manageStock.${query.manageStock === "true" ? "true" : "false"}`)
                      : undefined
                  }
                  onClick={openSheet}
                />
              </FilterPills>
            </>
          ) : null}
        </div>
      }
    >
      {!online && dataUpdatedAt > 0 ? (
        <div className="mx-auto max-w-3xl">
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
        </div>
      ) : null}

      <div className="mx-auto max-w-3xl px-4">
        {query.view === "moves" ? (
          <Ledger locale={locale} query={query} meId={meId} commit={commit} />
        ) : (
          <>
            {chips.length > 0 ? (
              <FilterChips
                chips={chips}
                onClearAll={() => {
                  setSearchDraft("");
                  commit({ ...query, search: "", stockStatus: "", manageStock: "" });
                }}
              />
            ) : null}

            <p
              aria-live="polite"
              className="mb-2 px-1 text-footnote text-label-secondary"
              data-testid="inventory-count"
            >
              <Ltr numeric>
                {query.view === "low" ? t("lowCount", { total }) : t("count", { total })}
              </Ltr>
            </p>

            {/*
              **The low-stock report takes no filters and the screen says so.**
              `/inventory/low-stock` registers pagination and `status` only —
              verified against the live router — so there is no search box and no
              filter row on this view. Rendering controls the API ignores would be
              the worst outcome available here: an unknown query parameter comes
              back 200 with the full result set, so a filter that does nothing is
              indistinguishable on screen from one that works.
            */}
            {query.view === "low" && total > 0 ? (
              <p className="mb-3 px-1 text-caption text-label-tertiary">
                {t("lowHasNoFilters")}
              </p>
            ) : null}

            {isPending && items.length === 0 ? (
              <RowSkeleton />
            ) : isError ? (
              <ErrorState
                message={(error as Error).message}
                onRetry={() => void refetch()}
              />
            ) : items.length === 0 ? (
              <EmptyState
                message={
                  filtered
                    ? t("empty.noResults")
                    : query.view === "low"
                      ? t("empty.low")
                      : t("empty.all")
                }
                action={
                  filtered
                    ? {
                        label: t("empty.clear"),
                        onClick: () => {
                          setSearchDraft("");
                          commit({ ...query, search: "", stockStatus: "", manageStock: "" });
                        },
                      }
                    : undefined
                }
              />
            ) : (
              <>
                <ListGroup>
                  {items.map((item) => (
                    <ListLinkRow
                      key={item.id}
                      href={`/${locale}/inventory/${item.id}`}
                      ariaLabel={itemLabel(item).product}
                    >
                      <StockRow item={item} />
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
                      onClick={() =>
                        commit({ ...query, page: query.page + 1 }, { resetPage: false })
                      }
                      aria-label={t("nextPage")}
                      className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
                    >
                      <Icon name="chevron" flipInRtl className="size-5" />
                    </button>
                  </nav>
                ) : null}
              </>
            )}
          </>
        )}
      </div>

      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={t("filtersTitle")}
        onApply={() => {
          setSheetOpen(false);
          commit(draft);
        }}
        onClear={() => setDraft({ ...draft, search: "", stockStatus: "", manageStock: "" })}
      >
        {/*
          `stock_status` is a closed enum the API validates: `?stock_status=zzz`
          is a 400, unlike `?nonsense=zzz` which is a silent 200. So every value
          offered here is one of the three the API named, and no count is shown —
          `/inventory` publishes no facets, and a number counted from the twenty
          rows in hand would be presented as if it covered all thirty-three.
        */}
        <FilterGroup title={t("filter.stockStatus")}>
          {STOCK_STATUSES.map((status) => (
            <FilterValue
              key={status}
              label={tStock(status)}
              count={null}
              selected={draft.stockStatus === status}
              onToggle={() =>
                setDraft({
                  ...draft,
                  stockStatus: draft.stockStatus === status ? "" : status,
                })
              }
            />
          ))}
        </FilterGroup>

        {/*
          Tracking, as a filter rather than a fact buried in the rows. 8 of the 28
          top-level products track no quantity at all; being able to see only the
          20 that do is what makes the full list usable for a stocktake, and being
          able to see only the 8 that do not is how someone finds a product that
          should be tracked and is not.

          Three states, not two: absent is not `false`. The API only receives
          `manage_stock` when it is actually set — `InventoryController::index()`
          checks `has_param` for exactly this reason.
        */}
        <FilterGroup title={t("filter.manageStock")}>
          <FilterValue
            label={t("manageStock.true")}
            count={null}
            selected={draft.manageStock === "true"}
            onToggle={() =>
              setDraft({ ...draft, manageStock: draft.manageStock === "true" ? "" : "true" })
            }
          />
          <FilterValue
            label={t("manageStock.false")}
            count={null}
            selected={draft.manageStock === "false"}
            onToggle={() =>
              setDraft({ ...draft, manageStock: draft.manageStock === "false" ? "" : "false" })
            }
          />
        </FilterGroup>
      </FilterSheet>
    </Scaffold>
  );
}
