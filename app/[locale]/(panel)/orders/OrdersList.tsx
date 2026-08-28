"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { acRead } from "@/lib/api/browser";
import type { Order, Wilaya } from "@/lib/api/schemas/order";
import { orderStatuses } from "@/lib/order-status";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import {
  DataTable,
  TableFooter,
  TableControls,
  useTablePreferences,
} from "@/components/ui/DataTable";
import { FilterTabs, SearchField, FilterChips, FilterRow } from "@/components/ui/FilterBar";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { TableSkeleton, RecordListSkeleton } from "@/components/ui/Skeleton";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { Isolate } from "@/components/primitives/Ltr";
import {
  buildColumns,
  orderOpenerId,
  orderRecord,
  type OrderColumnContext,
} from "./columns";
import { OrderPeek } from "./OrderPeek";
import { downloadCsv } from "@/lib/csv";
import { toCsv } from "./export";
import { fetchOrders, ordersKey, type OrdersQuery } from "./query";

type StatusFilter = "" | (typeof orderStatuses)[number];

/**
 * The orders list — the panel's most-used screen, rebuilt on the new system.
 *
 * ## What is deliberately absent, and why
 *
 * **No sortable columns.** `DataTable` supports sorting and `/orders`
 * `collectionParams()` accepts `orderby` and `order`, but this API has a
 * measured history of accepting those and silently ignoring them: on
 * `/products`, five `orderby` values returned **byte-identical** id sequences
 * to `orderby=date`, and on `/notifications` they are not parameters at all
 * (`?orderby=nonsense` answers 200). Shipping a sort control that quietly does
 * nothing is worse than shipping none, so the columns carry no `sortKey` until
 * someone verifies each one against the live router. The primitive is ready.
 *
 * **No date-range filter.** `date_from`/`date_to` are in `collectionParams()`
 * but unverified against the same failure mode. Same reasoning.
 *
 * Status and search are both *measured* to work — `?status=processing,pending`
 * is a 400, which is why the tabs are single-select, and `?search=Nadia` takes
 * 633 rows to 92.
 */
export function OrdersList({
  locale,
  initialQuery,
  initialOrders,
  initialTotal,
  wilayas,
}: {
  locale: string;
  initialQuery: OrdersQuery;
  initialOrders: Order[] | null;
  initialTotal: number | null;
  wilayas: Wilaya[];
}) {
  const t = useTranslations("orders");
  const tStatus = useTranslations("status");
  const tA11y = useTranslations("a11y");
  const tUi = useTranslations("ui");
  const router = useRouter();
  const searchParams = useSearchParams();

  const status = (searchParams.get("status") ?? "") as StatusFilter;
  const search = searchParams.get("search") ?? "";
  const peekId = searchParams.get("peek");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(initialQuery.perPage);

  const query: OrdersQuery = { status, search, page, perPage };

  const wilayasByCode = useMemo(
    () => new Map(wilayas.map((w) => [w.code, w])),
    [wilayas],
  );

  /**
   * This is the one list that polls: 30 s, paused when the document is hidden.
   * Nothing below 30 s — reads are 600/min per credential and shared across
   * every tab this person has open.
   */
  const online = useOnline();
  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ordersKey(query),
    queryFn: () => fetchOrders(query),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    initialData:
      query.status === initialQuery.status &&
      query.search === initialQuery.search &&
      query.page === 1 &&
      query.perPage === initialQuery.perPage &&
      initialOrders !== null
        ? { orders: initialOrders, total: initialTotal ?? initialOrders.length }
        : undefined,
    /* Keeps the previous page on screen while the next loads, so changing a
       filter never flashes a skeleton over content that is still valid. */
    placeholderData: keepPreviousData,
  });

  /*
   * Not wrapped in `useCallback`. The React Compiler is on in this project and
   * memoizes this already; a manual `useCallback` here listed
   * [locale, router, searchParams] while the compiler inferred `setPage` as
   * well, and a mismatch makes it skip optimising the whole component rather
   * than trust either list.
   */
  function setParams(
    next: Partial<Record<"status" | "search" | "peek", string>>,
    resetPage = true,
  ) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (resetPage) setPage(1);
    /**
     * `push`, not `replace`. Filter state in the URL is only half the promise;
     * the other half is that the back button works, and `replace` overwrites
     * the current entry so going back from a filtered list skips the
     * unfiltered one entirely.
     *
     * Safe here because this runs on a tab change or a submitted search —
     * never per keystroke, which would fill the history with prefixes.
     */
    router.push(`/${locale}/orders${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;
  const hasFilter = status !== "" || search !== "";

  const ctx: OrderColumnContext = useMemo(
    () => ({ locale, wilayasByCode, t, tStatus }),
    [locale, wilayasByCode, t, tStatus],
  );
  const columns = useMemo(() => buildColumns(ctx), [ctx]);

  /* Held here rather than inside DataTable so the controls can live in the
     toolbar beside the search field, where they belong, instead of floating
     above the card. */
  const preferences = useTablePreferences("orders", columns);

  /* The peek target comes from the URL, so a preview is shareable and the back
     button closes it. It resolves against the page already in memory —
     `GET /orders/{id}` returns the same object as the list row, so opening a
     preview costs no request. */
  const inPage = peekId ? (orders.find((o) => String(o.id) === peekId) ?? null) : null;

  /**
   * **And when it is not on the page in memory, it is fetched**, because
   * otherwise the URL is a dead link.
   *
   * Resolving only against `orders` is correct for the way the id usually gets
   * into the URL — somebody clicked a visible row — and wrong for the reason the
   * id is in the URL at all: a peek is shareable and bookmarkable, and a link
   * arriving from someone else's filter, or from any page but the first, opened
   * nothing and said nothing. Found on the media branch, where `?peek=5001` was
   * an id on page three and the capture rendered a library with no drawer.
   *
   * `enabled` only on a miss, so the free path stays free — this costs a request
   * exactly when the alternative was a blank screen. `retry: false`, and a
   * failure opens nothing: an id naming no order is a link to a record that is
   * not there, and the list behind it is intact and readable.
   */
  const peekQuery = useQuery({
    queryKey: ["orders", "item", peekId],
    enabled: peekId !== null && inPage === null,
    queryFn: async () => (await acRead<Order>(`/orders/${peekId}`)).data,
    retry: false,
  });

  const peeked = inPage ?? peekQuery.data ?? null;

  /* Every status the API accepts gets a tab. The old segmented control showed
     four of eight because a fifth did not fit at 390px; a scrolling strip has
     no such limit, and `on-hold` and `failed` stop being unreachable. */
  const tabs = [
    { value: "" as StatusFilter, label: t("all") },
    ...orderStatuses.map((s) => ({ value: s as StatusFilter, label: tStatus(s) })),
  ];

  const chips = [
    ...(search
      ? [
          {
            key: "search",
            label: t("chipSearch", { term: search }),
            onRemove: () => setParams({ search: "" }),
          },
        ]
      : []),
    ...(status
      ? [
          {
            key: "status",
            label: tStatus(status),
            onRemove: () => setParams({ status: "" }),
          },
        ]
      : []),
  ];

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={<Isolate>{t("count", { total })}</Isolate>}
        actions={
          <>
            <IconButton
              label={t("refresh")}
              icon="refresh"
              variant="secondary"
              onClick={() => void refetch()}
              loading={isFetching}
            />
            {/* A real link, so the browser performs the download and the
                credential is attached server-side — never in the document. */}
            <ButtonLink
              href={`/api/export/orders`}
              variant="secondary"
              icon="download"
              prefetch={false}
            >
              {t("export")}
            </ButtonLink>
          </>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            <FilterTabs
              tabs={tabs}
              value={status}
              onChange={(next) => setParams({ status: next })}
              label={t("status")}
            />
            <FilterRow>
              <SearchField
                value={search}
                onSubmit={(next) => setParams({ search: next })}
                placeholder={t("searchPlaceholder")}
                label={t("searchLabel")}
                clearLabel={t("clearSearch")}
              />
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
            {chips.length > 0 ? (
              <FilterChips
                chips={chips}
                onClearAll={() => setParams({ status: "", search: "" })}
              />
            ) : null}
          </div>
        }
      />

      <PageBody width="full">
        {/* The count is a live region: a filter that changes the result count
            must announce it, or a screen-reader user has no idea it worked. */}
        <p aria-live="polite" className="sr-only" data-testid="orders-count">
          {tA11y("listUpdated", { total })}
        </p>

        {/*
          **The one list that polls had no stale marker at all**, which §3.7 has
          required since the redesign began — the gap survived because this was
          the first screen of the run and the rule was proved on later ones. It
          matters more here than anywhere: a 30-second poll that starts failing
          leaves rows ageing on screen with nothing saying so, and after the
          §3.7-4 amendment those rows now *stay* instead of being replaced by an
          error. Keeping them is only honest if the screen reports their age.
        */}
        {(!online || isError) && dataUpdatedAt > 0 ? (
          <StaleBanner
            time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)}
            reason={online ? "refreshFailed" : "offline"}
          />
        ) : null}

        {isPending && orders.length === 0 ? (
          <>
            <div className="hidden md:block">
              <TableSkeleton rows={8} cols={6} label={t("loading")} />
            </div>
            <div className="md:hidden">
              <RecordListSkeleton rows={6} label={t("loading")} />
            </div>
          </>
        ) : isError && orders.length === 0 ? (
          <ErrorState
            message={(error as Error).message}
            onRetry={() => void refetch()}
          />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={hasFilter ? "search" : "orders"}
            message={hasFilter ? t("empty.noResults") : t("empty.noneYet")}
            action={
              hasFilter
                ? {
                    label: t("empty.clear"),
                    onClick: () => setParams({ status: "", search: "" }),
                  }
                : undefined
            }
          />
        ) : (
          <DataTable
            preferences={preferences}
            rows={orders}
            columns={columns}
            rowKey={(order) => String(order.id)}
            rowLabel={(order) => tA11y("orderNumber", { number: order.number })}
            record={(order) => orderRecord(order, ctx)}
            /*
             * `onRowClick` is the *pointer* path only — a `<tr>` is not
             * focusable — and until this branch that was the *whole* path at
             * `md`+: the row's only other focusables are the bulk checkbox and
             * the actions `Menu`, and neither opens the peek. `rowOpenerId` makes
             * the order-number cell a real `<button>`. See DECISIONS.md §10.
             */
            onRowClick={(order) => setParams({ peek: String(order.id) }, false)}
            rowOpenerId={(order) => orderOpenerId(order.id)}
            selectable
            selectionActions={(selected) => (
              <Button
                variant="secondary"
                size="sm"
                icon="download"
                onClick={() => {
                  /* Built from the rows already in memory rather than through
                     /api/export/orders, which forwards only `limit` and drops
                     every other parameter by design — there is no way to ask it
                     for a specific set of ids, and widening that route is a
                     security surface change for a convenience. */
                  const chosen = orders.filter((o) => selected.includes(String(o.id)));
                  downloadCsv(
                    toCsv(chosen, ctx, { name: t("columns.customer"), status: t("columns.status") }),
                    `orders-${selected.length}.csv`,
                  );
                }}
              >
                {t("exportSelected")}
              </Button>
            )}
            rowActions={(order) => (
              <Menu
                label={tA11y("orderNumber", { number: order.number })}
                trigger={
                  <IconButton
                    label={tUi("table.actions")}
                    icon="more"
                    size="sm"
                    variant="ghost"
                  />
                }
                actions={[
                  {
                    key: "open",
                    label: t("openFull"),
                    icon: "external",
                    href: `/${locale}/orders/${order.id}`,
                  },
                  {
                    key: "peek",
                    label: t("preview"),
                    icon: "search",
                    onSelect: () => setParams({ peek: String(order.id) }, false),
                  },
                  {
                    key: "copy",
                    label: t("copyNumber"),
                    icon: "note",
                    onSelect: () => {
                      void navigator.clipboard?.writeText(order.number);
                    },
                  },
                ]}
              />
            )}
            footer={
              <TableFooter
                page={page}
                perPage={perPage}
                total={total}
                onPageChange={setPage}
                onPerPageChange={(next) => {
                  setPerPage(next);
                  setPage(1);
                }}
              />
            }
          />
        )}
      </PageBody>

      <OrderPeek
        order={peeked}
        ctx={ctx}
        onOpenChange={(open) => {
          if (!open) setParams({ peek: "" }, false);
        }}
      />
    </div>
  );
}
