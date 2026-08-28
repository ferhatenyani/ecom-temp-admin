"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { acRead } from "@/lib/api/browser";
import { providerLabel, stripLabelUrlsFrom, type SafeShipment } from "@/lib/shipping";
import type { Shipment, ShippingProvider } from "@/lib/api/schemas/shipping";
import type { Wilaya } from "@/lib/api/schemas/order";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { SHOP_CURRENCY } from "@/lib/format/money";
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
import {
  buildColumns,
  parcelOpenerId,
  parcelRecord,
  type ParcelColumnContext,
} from "./columns";
import { ParcelDrawer } from "./ParcelDrawer";
import {
  EMPTY_QUERY,
  STATUS_FILTERS,
  isFiltered,
  listParams,
  orderIdFromInput,
  parcelsKey,
  queryFromParams,
  toUrlParams,
  type ParcelsQuery,
  type StatusFilter,
} from "./query";

/**
 * The parcels list, and what `/shipping` now lands on.
 *
 * ## Two controls, and the shape of each is measured
 *
 * **Status is eleven tabs and the first sends no parameter.** The enum has ten
 * values, `?status=zzz` is a 400 naming all ten, and the absence of the
 * parameter is "every status" — a first tab sending `?status=` would be a
 * meaningless parameter in every URL, and on this collection an empty string is
 * not a member of the enum anyway. `FilterTabs` scrolls, which is the reason it
 * replaced `Segmented`: ten values plus "all" do not fit at 340px and do not
 * need to.
 *
 * **The search box matches the order number and nothing else**, and it says so —
 * the field is labelled for it and the no-results state repeats the limit,
 * because the person who needs that sentence is the one already looking at no
 * results. `?search=` is **not a parameter of this route**: measured, it returns
 * all 129 rows, identical to `?bogus_param=1`. `order_id` is, and it is an exact
 * match, so it is submit-gated rather than firing per keystroke.
 *
 * There are no filter chips: both filters are visible in the controls themselves
 * — the term in its box, the status in the highlighted tab — and a chip would
 * repeat what is already on screen.
 *
 * ## What this screen deliberately does not ship
 *
 * **No provider filter** — the parameter works (87 `manual` / 42 `acfake` of 129)
 * but `GET /shipping/providers` returns only `manual`, so a picker built from the
 * sole allowlisted enumeration cannot offer the value that matters, and a
 * free-text box is not a filter here: `?provider=zzz` is a silent 200 with 0
 * rows, not a refusal. **No `is_live` filter** — accepted and ignored, all 130
 * rows back on `true`, re-measured 2026-08-25 with a live row present. **No
 * sorting and no `aria-sort`** — see `columns.tsx`. **No bulk and no export**:
 * shipping is not in `EXPORT_SUBJECTS`, so an export control would point at a
 * route that does not exist. `query.ts` carries all four measurements.
 *
 * ## The stale marker stays
 *
 * §3.7's amendment exempts a screen that cannot hold data older than its own last
 * fetch. This is not one: it is a client component over a react-query cache with
 * a manual refresh **and it writes** — so both halves of the rule bite, the
 * banner reports the age and the drawer's two write controls are disabled with
 * that same reason.
 */
export function ParcelsList({
  locale,
  initialQuery,
  initialParcels,
  initialTotal,
  providers,
  wilayas,
}: {
  locale: string;
  initialQuery: ParcelsQuery;
  initialParcels: SafeShipment[] | null;
  initialTotal: number | null;
  providers: ShippingProvider[];
  wilayas: Wilaya[];
}) {
  const t = useTranslations("shipping");
  const tA11y = useTranslations("a11y");
  const tStatus = useTranslations("shipmentStatus");
  const tDelivery = useTranslations("deliveryType");
  const tProvider = useTranslations("shippingProvider");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState<SafeShipment | null>(null);

  const query = useMemo(
    () => queryFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: parcelsKey(query),
    /*
     * Every row is stripped again on arrival. The server strips what it streams;
     * this strips what the browser fetches afterwards, and both are needed — a
     * client-side refetch goes through the proxy and comes back with `metadata`
     * exactly as the API sends it, credential keys included.
     */
    queryFn: async () => {
      const result = await acRead<Shipment[]>(`/shipments?${listParams(query)}`);
      return { parcels: stripLabelUrlsFrom(result.data), total: result.total };
    },
    initialData:
      initialParcels !== null && parcelsKey(query)[1] === parcelsKey(initialQuery)[1]
        ? { parcels: initialParcels, total: initialTotal ?? initialParcels.length }
        : undefined,
    /* Keeps the previous page on screen while the next loads, so changing the
       filter, the tab or the page never flashes a skeleton over content still
       valid. §3.6's third mechanism. */
    placeholderData: keepPreviousData,
  });

  const parcels = data?.parcels ?? [];
  const total = data?.total ?? 0;
  const filtered = isFiltered(query);

  /*
   * The wilaya lookup, built once for the page. 58 wilayas against up to 100
   * rows, and `find` per row per render is the shape that turns a filter
   * keystroke into 5 800 comparisons.
   */
  const wilayaName = useMemo(() => {
    const byId = new Map(wilayas.map((w) => [w.id, w]));
    return (id: number | null) => {
      const found = id === null ? undefined : byId.get(id);
      if (found === undefined) return null;
      return locale === "ar" && found.name_ar !== "" ? found.name_ar : found.name;
    };
  }, [wilayas, locale]);

  /* Not wrapped in `useCallback`: the React Compiler is on in this project and
     memoizes this already; a manual dependency list disagreeing with the
     compiler's inference makes it skip optimising the whole component. */
  function commit(next: ParcelsQuery) {
    const params = toUrlParams(next);
    /* `push`, not `replace` — going back from a filtered list must reach the
       unfiltered one. */
    router.push(`/${locale}/shipping${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  /* A new filter resets to page one; paging and per-page do not. Page 3 of a
     differently filtered list is a different set of rows. */
  const commitFilter = (next: ParcelsQuery) => commit({ ...next, page: 1 });

  /* Message key → API `label` → raw slug. The API's label for `manual` is
     "In-house delivery", which was rendering as English in both localised
     panels; `acfake` has no key and stays itself. See `providerLabel`. */
  const providerName = (name: string) =>
    providerLabel(name, providers, (key) =>
      tProvider.has(key as "manual") ? tProvider(key as "manual") : null,
    );

  const ctx: ParcelColumnContext = {
    locale,
    currency: SHOP_CURRENCY,
    providers,
    providerName,
    wilayaName,
    t,
    tStatus: (status) => (tStatus.has(status as "pending") ? tStatus(status as "pending") : status),
    tDelivery: (type) => tDelivery(type as "home"),
    hasDelivery: (type) => tDelivery.has(type as "home"),
  };
  const columns = buildColumns(ctx);

  /* Held here rather than inside `DataTable` so the controls sit in the toolbar
     beside the search field instead of floating above the card. */
  const preferences = useTablePreferences("shipments", columns);

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={
          <span data-testid="parcels-count">
            <Isolate>{t("count", { count: total })}</Isolate>
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
              The way to the tariff, and the only one: `nav-tree.ts` keeps a
              single `/shipping` entry, because the rules are somewhere you go
              *from* the parcels rather than a seventeenth item in a sidebar that
              already has seventeen. A real link, so middle click and "open in a
              new tab" work while somebody is reading the list beside it.
            */}
            <ButtonLink href={`/${locale}/shipping/rules`} variant="secondary">
              {t("tabRules")}
            </ButtonLink>
          </>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            <FilterTabs<StatusFilter>
              tabs={STATUS_FILTERS.map((value) => ({
                value,
                label: value === "" ? t("allStatuses") : tStatus(value),
              }))}
              value={query.status}
              onChange={(status) => commitFilter({ ...query, status })}
              label={t("statusLabel")}
            />

            <FilterRow>
              <SearchField
                value={query.orderId}
                /* Digits only, and non-digits are stripped rather than refused:
                   a pasted "Commande 4586" means 4586. See `orderIdFromInput`. */
                onSubmit={(next) =>
                  commitFilter({ ...query, orderId: orderIdFromInput(next) })
                }
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
          </div>
        }
      />

      <PageBody width="full">
        {(!online || isError) && dataUpdatedAt > 0 ? (
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)}
            reason={online ? "refreshFailed" : "offline"}
          />
        ) : null}

        {/* A live region, so a filter that changes the result count announces it.
            Its own testid: `parcels-count` above is the *visible* count, and two
            elements sharing one testid is a strict-mode violation the moment
            either is queried. */}
        <p aria-live="polite" className="sr-only" data-testid="parcels-live">
          {tA11y("listUpdated", { total })}
        </p>

        {isPending && parcels.length === 0 ? (
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
        ) : isError && parcels.length === 0 ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : parcels.length === 0 ? (
          <EmptyState
            icon={filtered ? "search" : "box"}
            /*
             * **Two empty states, and telling them apart is the point.** No
             * parcels at all is a shop that has shipped nothing, and there is no
             * create action to offer here — a parcel is created against an
             * *order*, on the order's own screen, and a button pointing anywhere
             * else would name a screen this action does not live on. No results
             * for a filter offers to clear it.
             */
            message={filtered ? t("noShipmentsFilter") : t("noShipments")}
            action={
              filtered
                ? {
                    label: t("clearFilter"),
                    onClick: () => commit({ ...EMPTY_QUERY, perPage: query.perPage }),
                  }
                : undefined
            }
          />
        ) : (
          <DataTable
            preferences={preferences}
            rows={parcels}
            columns={columns}
            rowKey={(parcel) => String(parcel.id)}
            rowLabel={(parcel) =>
              tA11y("parcelTracking", {
                tracking: parcel.tracking_number || String(parcel.id),
              })
            }
            record={(parcel) => parcelRecord(parcel, ctx)}
            /*
             * The whole row opens the drawer, and there is no trailing `Menu`:
             * the drawer holds the actions and a 40px column repeating "open" is
             * not an action.
             *
             * `onRowClick` is the *pointer* path only — a `<tr>` is not
             * focusable. `rowOpenerId` is what makes the tracking cell a real
             * `<button>`, which is the keyboard path and the drawer's focus
             * target. Both end here.
             */
            onRowClick={(parcel) => setOpen(parcel)}
            rowOpenerId={(parcel) => parcelOpenerId(parcel.id)}
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

      <ParcelDrawer
        parcel={open}
        providerName={providerName}
        wilayaName={wilayaName}
        locale={locale}
        online={online}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      />
    </div>
  );
}
