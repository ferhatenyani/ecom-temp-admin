"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Coupon } from "@/lib/api/schemas/coupon";
import { acRead } from "@/lib/api/browser";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import {
  DataTable,
  TableControls,
  TableFooter,
  useTablePreferences,
} from "@/components/ui/DataTable";
import { FilterRow, FilterTabs, SearchField } from "@/components/ui/FilterBar";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { RecordListSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { ButtonLink, IconButton } from "@/components/ui/Button";
import { Isolate } from "@/components/primitives/Ltr";
import { buildColumns, couponRecord, type CouponColumnContext } from "./columns";
import {
  STATUS_FILTERS,
  couponsKey,
  isFiltered,
  listParams,
  queryFromParams,
  toUrlParams,
  type CouponsQuery,
  type StatusFilter,
} from "./query";

async function fetchCoupons(query: CouponsQuery) {
  const { data, total } = await acRead<Coupon[]>(`/coupons?${listParams(query)}`);
  return { coupons: data, total };
}

/**
 * The coupon list, rebuilt on the new design system.
 *
 * ## Two controls, and the shape of each is measured
 *
 * **The status tabs are three, and the first sends no parameter at all.** With no
 * `?status=` the API returns publish *and* draft together — so "all" is the
 * absence of the filter rather than a value, and a first tab sending `?status=`
 * with an empty string would put a meaningless parameter in every URL for the
 * same result. There is no fourth tab: **`?status=trash` is a 400**, while a
 * trashed coupon still reads back from `/coupons/{id}` with a 200. It is
 * reachable by id and by nothing else, which is why `READABLE_COUPON_STATUSES` is
 * wider than what this control can offer.
 *
 * **Search matches the code and nothing else**, and the screen says so rather
 * than implying otherwise — the field is labelled "rechercher un code" and the
 * no-results state repeats the limit, because the person who needs that sentence
 * is the one already looking at no results. `query.ts` carries the measurement.
 *
 * There are no filter chips: with two filters both are visible in the controls
 * themselves — the search term in its box, the status in the highlighted tab —
 * and a chip would repeat what is already on screen.
 *
 * ## What this screen does not ship
 *
 * **No sorting** — `orderby` is validated and then ignored, so no column carries
 * a `sortKey` and no header announces `aria-sort`. **No peek** — the detail is
 * the row plus `restrictions`, which is what you would open a preview for; the
 * code is a real anchor instead. **No bulk selection**, because there is no
 * measured bulk endpoint. **No export**: `EXPORT_SUBJECTS` in `lib/transfer.ts`
 * is products, orders, inventory and customers, so an export control here would
 * be a button pointing at a route that does not exist.
 *
 * ## The stale marker stays
 *
 * §3.7's amendment exempts a screen that cannot hold data older than its own last
 * fetch — a Server Component with no writes, nothing polling and no refresh. This
 * is none of those: it is a client component over a react-query cache with a
 * manual refresh button, exactly like the three migrated lists before it, so the
 * pixels can outlive the fetch that produced them and the marker says so.
 */
export function CouponsList({
  locale,
  currency,
  initialQuery,
  initialCoupons,
  initialTotal,
}: {
  locale: string;
  currency: string;
  initialQuery: CouponsQuery;
  initialCoupons: Coupon[] | null;
  initialTotal: number | null;
}) {
  const t = useTranslations("coupons");
  const tA11y = useTranslations("a11y");
  const router = useRouter();
  const searchParams = useSearchParams();

  /* Every piece of list state lives in the URL on this screen — see `query.ts`
     for why it carries the reading position as well as the filter. */
  const query = useMemo(
    () => queryFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  /*
   * The fifth state. When the browser is certain it is offline, the rows on
   * screen are as old as the last successful fetch and staleness is never
   * silent. `navigator.onLine` is trusted in one direction only — it reports the
   * interface rather than reachability — which is why the refresh control stays
   * enabled below.
   */
  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: couponsKey(query),
    queryFn: () => fetchCoupons(query),
    initialData:
      initialCoupons !== null && couponsKey(query)[1] === couponsKey(initialQuery)[1]
        ? { coupons: initialCoupons, total: initialTotal ?? initialCoupons.length }
        : undefined,
    /* Keeps the previous page on screen while the next loads, so changing the
       search, the tab or the page never flashes a skeleton over content still
       valid. */
    placeholderData: keepPreviousData,
  });

  const coupons = data?.coupons ?? [];
  const total = data?.total ?? 0;
  const filtered = isFiltered(query);

  /*
   * One clock for the whole list, taken on render rather than per row. Every row
   * asks whether its expiry has passed, and `new Date()` inside a cell would give
   * twenty slightly different answers and re-derive on every keystroke in the
   * search box. It also makes the expiry rendering testable, which a `Date`
   * created inside a leaf component is not.
   */
  const now = new Date();

  /*
   * Not wrapped in `useCallback`. The React Compiler is on in this project and
   * memoizes this already; a manual dependency list disagreeing with the
   * compiler's inference makes it skip optimising the whole component.
   */
  function commit(next: CouponsQuery) {
    const params = toUrlParams(next);
    /* `push`, not `replace`. Filter state living in the URL is only half the
       promise; the other half is that the back button works, and `replace`
       overwrites the current entry so going back from a filtered list skips the
       unfiltered one. */
    router.push(`/${locale}/coupons${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  /* A new filter resets to page one; paging and per-page do not. */
  const commitFilter = (next: CouponsQuery) => commit({ ...next, page: 1 });

  /* Not memoized: `now` is deliberately new on every render, so a dependency
     list naming it would be a `useMemo` that never hits. The React Compiler is on
     and memoizes what is genuinely stable here. */
  const ctx: CouponColumnContext = { locale, currency, t, now };
  const columns = buildColumns(ctx);

  /* Held here rather than inside `DataTable` so the controls sit in the toolbar
     beside the search field instead of floating above the card. */
  const preferences = useTablePreferences("coupons", columns);

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
          <span data-testid="coupons-count">
            <Isolate>{t("count", { total })}</Isolate>
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
            {/*
              **The primary, and it ships because it can act**: `POST /coupons` is
              on the proxy allowlist, unlike `POST /products`, and the difference
              is real rather than an inconsistency — a coupon has no variations,
              no media and no option set, so creating one is the same form as
              editing one with an empty object behind it.

              A real link rather than a button: middle click and "open in new tab"
              are how somebody drafts a second coupon beside the list they are
              reading.
            */}
            <ButtonLink href={`/${locale}/coupons/new`} variant="primary" icon="plus">
              {t("new")}
            </ButtonLink>
          </>
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

            <FilterRow>
              <SearchField
                value={query.search}
                onSubmit={(next) => commitFilter({ ...query, search: next })}
                placeholder={t("searchPlaceholder")}
                /* Names the one field the endpoint actually matches. */
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
          </div>
        }
      />

      <PageBody width="full">
        {!online && dataUpdatedAt > 0 ? (
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
        ) : null}

        {/* A live region, so a filter that changes the result count announces it.
            Its own testid: `coupons-count` above is the *visible* count and is
            what the suite asserts on, and two elements sharing one testid is a
            strict-mode violation the moment either is queried. */}
        <p aria-live="polite" className="sr-only" data-testid="coupons-live">
          {tA11y("listUpdated", { total })}
        </p>

        {isPending && coupons.length === 0 ? (
          <>
            <div className="hidden md:block">
              <TableSkeleton rows={8} cols={6} label={t("loading")} />
            </div>
            {/* The card and its padding are `DataTable`'s below `md`, so the
                skeleton wears them too — otherwise the rows shift 8px inward the
                moment the data lands. */}
            <div className="ui-card p-2 md:hidden">
              <RecordListSkeleton rows={6} label={t("loading")} />
            </div>
          </>
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : coupons.length === 0 ? (
          <EmptyState
            icon={filtered ? "search" : "tag"}
            /*
             * **Two empty states, and telling them apart is the point.** No data
             * at all offers the create action — `POST /coupons` is allowlisted, so
             * unlike the customers list this one has something to offer. No
             * results for a filter offers to clear it, and names the limit the
             * search has: it matches the code, never the description, and an
             * unmatched search is otherwise an ordinary empty list with nothing
             * on screen to say the field never had a chance.
             */
            message={filtered ? t("empty.noResults") : t("empty.none")}
            action={
              filtered
                ? {
                    label: t("empty.clear"),
                    onClick: () => commitFilter({ ...query, search: "", status: "" }),
                  }
                : {
                    label: t("new"),
                    onClick: () => router.push(`/${locale}/coupons/new`),
                  }
            }
          />
        ) : (
          <DataTable
            preferences={preferences}
            rows={coupons}
            columns={columns}
            rowKey={(coupon) => String(coupon.id)}
            rowLabel={(coupon) => tA11y("couponCode", { code: coupon.code })}
            record={(coupon) => couponRecord(coupon, ctx)}
            /* Navigates rather than previewing — see `columns.tsx`. The code cell
               is a real anchor on top of this, for the keyboard and the middle
               click; it stops propagation so only one push happens. */
            onRowClick={(coupon) => router.push(`/${locale}/coupons/${coupon.id}`)}
            /* No `sort` and no `onSortChange`. Passing neither is what keeps
               `aria-sort` off the headers: the primitive gates the attribute on a
               handler existing, precisely so a table cannot announce itself
               sortable by columns nothing on screen can sort. */
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
