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
import { DEFAULT_PRESET, isEmptyWindow, type RangeQuery } from "@/lib/analytics";
import { formatWhen } from "@/lib/format/date";
import { useOnline } from "@/lib/use-online";
import { Scaffold } from "@/components/patterns/Scaffold";
import { RangeControl } from "@/components/patterns/RangeControl";
import { ErrorState, ForbiddenState, StaleBanner } from "@/components/patterns/States";
import { EmptyWindow } from "./Report";
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
 * The six reports behind one range.
 *
 * **The report selector is pills, not a `Segmented`.** The segmented control's own
 * docblock caps it at four and it means it: at 390px the panel's four-segment
 * controls already measure 79–86px per label, and six would put every report name
 * under 60px and truncate half of them. So the same scrolling pill row the range
 * uses, one row above it — navigation on top, the one filter beneath, which is
 * the order they scope in.
 *
 * The URL is the state and `push`, never `replace`, is what makes the back button
 * return to the previous report rather than skipping the section.
 */
export function AnalyticsScreen({
  locale,
  query,
  loaded,
  forbidden,
  failed,
  canMoney,
  moneyVisible,
  moneyRequires,
  generatedAt,
}: {
  locale: string;
  query: AnalyticsQuery;
  loaded: Loaded | null;
  forbidden: string | null;
  failed: string | null;
  canMoney: boolean;
  moneyVisible: boolean;
  moneyRequires: string | null;
  generatedAt: string | null;
}) {
  const t = useTranslations("analytics");
  const router = useRouter();
  const online = useOnline();

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
   * **`products` is deliberately not in this list.** Its `low_stock` block is
   * not range-scoped — measured, it stays at 3 under `range=today` while
   * `best_sellers` empties — so replacing the whole report with "nothing
   * happened in this window" would hide a figure that is true right now.
   * `ProductsView` says its own best-sellers list is empty instead.
   */
  const headline =
    loaded === null
      ? null
      : loaded.view === "revenue"
        ? loaded.data.orders_placed
        : loaded.view === "orders"
          ? loaded.data.placed
          : loaded.view === "customers"
            ? loaded.data.customers + loaded.data.guest_orders
            : loaded.view === "shipping"
              ? loaded.data.shipments.total
              : loaded.view === "cod"
                ? loaded.data.total_orders
                : null;

  const empty = headline !== null && isEmptyWindow(headline);

  return (
    <Scaffold
      title={t("title")}
      toolbar={
        <div className="flex flex-col gap-3">
          <div
            role="group"
            aria-label={t("reportLabel")}
            className="pill-row -mb-1 flex gap-2 overflow-x-auto pb-1"
          >
            {VIEWS.map((view) => {
              const active = query.view === view;
              return (
                <button
                  key={view}
                  type="button"
                  onClick={() => setView(view)}
                  aria-pressed={active}
                  className={[
                    "press flex min-h-9 shrink-0 items-center rounded-full px-3",
                    "text-subhead whitespace-nowrap",
                    active
                      ? "tone-accent tonal font-medium"
                      : "bg-surface text-label-secondary",
                  ].join(" ")}
                >
                  {t(`report.${view}`)}
                </button>
              );
            })}
          </div>

          <RangeControl
            locale={locale}
            range={query.range}
            applied={applied}
            onChange={setRange}
          />
        </div>
      }
    >
      {/*
        The offline state, from the API's own `generated_at` rather than from a
        client cache timestamp — this screen is server-rendered per URL, so there
        is no TanStack `dataUpdatedAt` to read, and the API's stamp is the more
        honest number anyway: it is the age of the *data*, including the up-to-60
        seconds it may have spent in the server-side cache.
      */}
      {!online && generatedAt !== null ? (
        <StaleBanner time={formatWhen(generatedAt, locale)} />
      ) : null}

      <div className="mx-auto max-w-3xl px-4" data-testid={`report-${query.view}`}>
        {forbidden !== null ? (
          /*
           * The money gate, as the API enforced it. Not a hole in the revenue
           * report — a screen that says which permission is missing, using the
           * capability the response named.
           */
          <ForbiddenState capability={moneyRequires ?? forbidden} />
        ) : failed !== null ? (
          <ErrorState message={t("loadFailed")} detail={failed} />
        ) : loaded === null ? (
          <ErrorState message={t("loadFailed")} />
        ) : empty ? (
          /*
           * The window is genuinely quiet, and the action offered is the one
           * that can change it — the same shape every empty state in the panel
           * has: distinguish *no data yet* from *no results for this filter*,
           * and let the second clear the filter. Here the filter is the window.
           */
          <EmptyWindow
            onWiden={
              query.range.preset === DEFAULT_PRESET
                ? undefined
                : () => setRange({ preset: DEFAULT_PRESET, from: "", to: "" })
            }
          />
        ) : loaded.view === "revenue" ? (
          <RevenueView locale={locale} report={loaded.data} />
        ) : loaded.view === "orders" ? (
          <OrdersView locale={locale} report={loaded.data} money={canMoney && moneyVisible} />
        ) : loaded.view === "products" ? (
          <ProductsView
            locale={locale}
            report={loaded.data}
            money={canMoney && moneyVisible}
          />
        ) : loaded.view === "customers" ? (
          <CustomersView locale={locale} report={loaded.data} />
        ) : loaded.view === "shipping" ? (
          <ShippingView locale={locale} report={loaded.data} money={canMoney && moneyVisible} />
        ) : (
          <CodView locale={locale} report={loaded.data} />
        )}
      </div>
    </Scaffold>
  );
}
