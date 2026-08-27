"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type {
  CodReport,
  CustomersReport,
  OrdersReport,
  ProductsReport,
  RevenueReport,
  ShippingReport,
} from "@/lib/api/schemas/analytics";
import {
  isEmptyWindow,
  MAX_CUSTOM_DAYS,
  type CustomRangeProblem,
  type RangeQuery,
} from "@/lib/analytics";
import { formatDate } from "@/lib/format/date";
import { PageBody, PageHeader } from "@/components/ui/PageHeader";
import { FilterTabs } from "@/components/ui/FilterBar";
import { RangeControl } from "@/components/ui/RangeControl";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/ui/States";
import { Isolate } from "@/components/primitives/Ltr";
import { paramsFromQuery, VIEWS, type AnalyticsQuery, type View } from "./query";
import { RevenueView } from "./RevenueView";
import { OrdersView } from "./OrdersView";
import { ProductsView } from "./ProductsView";
import { CustomersView } from "./CustomersView";
import { ShippingView } from "./ShippingView";
import { CodView } from "./CodView";

/**
 * What one of the six routes answered. A discriminated union rather than six
 * nullable props, so a view cannot be handed another view's payload.
 */
export type Loaded =
  | { view: "revenue"; data: RevenueReport }
  | { view: "orders"; data: OrdersReport }
  | { view: "products"; data: ProductsReport }
  | { view: "customers"; data: CustomersReport }
  | { view: "shipping"; data: ShippingReport }
  | { view: "cod"; data: CodReport };

/**
 * Why the report could not be read, in the two forms a refusal can take.
 *
 * `problem` is one this panel mirrors locally and therefore renders in the
 * reader's own language; `sentence` is the API's own text, kept for a refusal the
 * mirror has no wording for. Exactly one of them is ever set — see `page.tsx`.
 */
export type AnalyticsFailure = {
  problem: CustomRangeProblem;
  sentence: string | null;
};

/**
 * The six reports behind one range.
 *
 * ## Two controls, and they are not peers
 *
 * The report selector is **navigation** — which report am I reading — and the
 * range is a **filter** over whichever one that is. Stacked as two identical
 * strips they read as two filters of equal rank, which is exactly the hierarchy
 * this screen has to get right. So the selector is `FilterTabs` in its default
 * shape: full-bleed, closed by a rule, the selected label underlined in ink, the
 * same strip every list in the panel uses for its own primary axis. The range is
 * the same primitive in its `chips` shape — a *labelled* group of pills inside
 * the content column, with the applied-window line under it. Label, ground,
 * bleed and rule all differ; the vertical order is the dashboard's.
 *
 * `FilterTabs` gained the variant rather than this screen hand-rolling a pill
 * row, which is what the old one did with `.pill-row` and `.tonal` — both
 * retired, and `.tonal` measured at 1.98:1. `RangeControl` renders `chips`
 * unconditionally and `/dashboard` was moved onto it in the same edit, so the
 * rule holds panel-wide rather than on this screen alone: a full-bleed underlined
 * strip under the header always means *which view*, a labelled "Période" chip
 * group always means *the window*. See `RangeControl`'s docblock for why that is
 * positional rather than a matter of rank.
 *
 * ## One route, and the window is why
 *
 * The six reports share a date range. Six routes would mean six copies of the
 * control and a window that resets every time somebody moves between reports —
 * a person comparing COD confirmation against shipping delivery over the same
 * fortnight would have to set the fortnight twice. `push`, never `replace`, so
 * the back button returns to the previous report rather than skipping the
 * section.
 *
 * ## No stale marker; an "as of" line instead
 *
 * This screen rendered `StaleBanner` behind `!useOnline()` — an offline marker on
 * a page with no writes to disable and no client cache to go stale, which is
 * §3.7 as amended on the customers branch. What is true is different and the API
 * publishes it: the reports sit behind a **60-second server cache**
 * (`meta.cache_ttl`), so a Server Component can legitimately hold figures that
 * predate the navigation, by a stated amount. That is a timestamp, not a warning
 * state, so it is a plain line under the title — the dashboard's treatment, and
 * the same two keys.
 */
export function AnalyticsScreen({
  locale,
  query,
  loaded,
  forbidden,
  failure,
  canMoney,
  moneyVisible,
  moneyRequires,
  capabilities,
  generatedAt,
  cacheTtl,
}: {
  locale: string;
  query: AnalyticsQuery;
  loaded: Loaded | null;
  /** The money gate fired. The fallback capability; `moneyRequires` wins. */
  forbidden: string | null;
  /** Why the request failed, if it did. Never set together with `forbidden`. */
  failure: AnalyticsFailure | null;
  canMoney: boolean;
  moneyVisible: boolean;
  moneyRequires: string | null;
  /** `me.capabilities` — which figures on a report are links. */
  capabilities: readonly string[];
  generatedAt: string | null;
  /** `meta.cache_ttl`, in seconds. Why the stamp may be behind the navigation. */
  cacheTtl: number | null;
}) {
  const t = useTranslations("analytics");
  const router = useRouter();

  const navigate = useCallback(
    (next: AnalyticsQuery) => {
      const search = paramsFromQuery(next).toString();
      router.push(`/${locale}/analytics${search === "" ? "" : `?${search}`}`);
    },
    [locale, router],
  );

  const setView = (view: View) => navigate({ ...query, view });
  const setRange = (range: RangeQuery) => navigate({ ...query, range });

  /*
   * The window the figures describe, straight off the response — never the
   * picker's own state. See `RangeControl` for the measurement that makes this
   * the rule rather than a preference.
   */
  const applied = loaded?.data.range ?? null;

  /*
   * Whether the window holds anything, decided here rather than inside each
   * report — because the *remedy* lives here. The window is this screen's state,
   * so the offer to widen it is this screen's to make, and a view given the
   * decision could only state the problem.
   *
   * **`products` is in this list now, and that is the dashboard's change.** It
   * used to be excluded because `low_stock` is not range-scoped and the empty
   * state *replaced* the report, which would have hidden the one figure still
   * worth reading. The empty state now sits above the report and keeps it, so
   * the exclusion is no longer needed — and the products report is the one place
   * the caveat can be said in the reader's own words, which is what
   * `emptyWindowDetail` is for.
   */
  const headline =
    loaded === null
      ? null
      : loaded.view === "revenue"
        ? loaded.data.orders_placed
        : loaded.view === "orders"
          ? loaded.data.placed
          : loaded.view === "products"
            ? loaded.data.best_sellers.length
            : loaded.view === "customers"
              ? loaded.data.customers + loaded.data.guest_orders
              : loaded.view === "shipping"
                ? loaded.data.shipments.total
                : loaded.data.total_orders;

  const empty = headline !== null && isEmptyWindow(headline);

  /*
   * The refusal in the reader's own language where the panel has one, and the
   * API's own words only where it does not — the same rule `unavailableLines()`
   * follows, and the dashboard's. These three sentences are already written: the
   * range control shows them while somebody is still typing, and they are the
   * same three refusals.
   */
  const detail =
    failure === null
      ? undefined
      : failure.problem === "missing"
        ? t("errorMissing")
        : failure.problem === "reversed"
          ? t("errorReversed")
          : failure.problem === "too-long"
            ? t("errorTooLong", { max: MAX_CUSTOM_DAYS })
            : (failure.sentence ?? undefined);

  /*
   * An absolute stamp rather than `formatWhen`'s relative one, and the reason is
   * mechanical: a relative time computed from `new Date()` on the server and
   * again on the client differs the moment a rounding boundary falls between
   * them, which is a hydration error the capture harness fails on. `Isolate`,
   * never `Ltr`: `formatDate` is `Intl`-formatted and the Arabic output carries
   * U+200F marks that a forced direction would reorder.
   */
  const asOf =
    generatedAt === null ? undefined : (
      <Isolate>
        {cacheTtl === null
          ? t("asOf", { time: formatDate(generatedAt, locale) })
          : t("asOfCached", { time: formatDate(generatedAt, locale), seconds: cacheTtl })}
      </Isolate>
    );

  const money = canMoney && moneyVisible;

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={asOf}
        toolbar={
          <div className="flex flex-col gap-3">
            <FilterTabs
              label={t("reportLabel")}
              value={query.view}
              onChange={setView}
              tabs={VIEWS.map((view) => ({ value: view, label: t(`report.${view}`) }))}
            />
            <RangeControl
              locale={locale}
              range={query.range}
              applied={applied}
              onChange={setRange}
            />
          </div>
        }
      />

      <PageBody width="wide">
        {/*
          The box the suite addresses, and the box the money gate renders inside.
          `report-<view>` is asserted eleven times across the spec and is produced
          only here.
        */}
        <div data-testid={`report-${query.view}`} className="flex min-w-0 flex-col gap-6">
          {forbidden !== null ? (
            /*
             * The money gate, as the API enforced it — and the toolbar above is
             * still live, so the reader can move to a report they can read. Not a
             * hole in the revenue report: a box that says which permission is
             * missing, naming the capability **the response itself** gave
             * (`meta.money_requires`), the same discipline as rendering a 409's
             * `allowed` list rather than the panel's own idea of the rule.
             */
            <ForbiddenState capability={moneyRequires ?? forbidden} />
          ) : loaded === null ? (
            /* The API's own information and a retry — `router.refresh()` re-runs
               the Server Component against the same URL, which is the only thing
               that can help here. */
            <ErrorState
              message={t("loadFailed")}
              detail={detail}
              onRetry={() => router.refresh()}
            />
          ) : (
            <>
              {/*
                A quiet window is said, not implied. Every report answers 200 with
                its full shape and every figure zero — measured on all six — so
                without this the screen is thirty zeros and a 0,0 % delivery rate,
                which reads as a report that failed rather than as a quiet Tuesday.

                **It sits above the report rather than replacing it**, which is the
                dashboard's arrangement and the products report is why: `low_stock`
                is not range-scoped, so it is a real figure inside an empty window
                and an empty state that swallowed the report would hide the one
                number still worth reading. §3.7's distinction applies with the
                window as the filter, so it offers to widen — to the widest preset
                the API has, and on `90d` the action is not rendered rather than
                rendered doing nothing.
              */}
              {empty ? (
                <EmptyState
                  icon="clock"
                  message={t("emptyWindow")}
                  detail={
                    query.view === "products" ? t("emptyWindowDetail") : undefined
                  }
                  action={
                    query.range.preset === "90d"
                      ? undefined
                      : {
                          label: t("emptyWiden"),
                          onClick: () => setRange({ preset: "90d", from: "", to: "" }),
                        }
                  }
                />
              ) : null}

              {loaded.view === "revenue" ? (
                <RevenueView locale={locale} report={loaded.data} />
              ) : loaded.view === "orders" ? (
                <OrdersView locale={locale} report={loaded.data} money={money} />
              ) : loaded.view === "products" ? (
                <ProductsView
                  locale={locale}
                  report={loaded.data}
                  money={money}
                  capabilities={capabilities}
                />
              ) : loaded.view === "customers" ? (
                <CustomersView locale={locale} report={loaded.data} />
              ) : loaded.view === "shipping" ? (
                <ShippingView locale={locale} report={loaded.data} money={money} />
              ) : (
                <CodView locale={locale} report={loaded.data} />
              )}
            </>
          )}
        </div>
      </PageBody>
    </div>
  );
}
