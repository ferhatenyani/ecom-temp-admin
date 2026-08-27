"use client";

import { useTranslations } from "next-intl";
import type { RevenueReport } from "@/lib/api/schemas/analytics";
import { COUNTED_STATUSES, revenueFigures } from "@/lib/analytics";
import { STATUS_TONE, type OrderStatus } from "@/lib/order-status";
import { formatCount, formatMoney } from "@/lib/format/money";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { Figure, Figures, ReportGrid, ReportNotes, Unavailable } from "./Report";

/**
 * The money report — the one route that can be refused outright, and the one
 * payload where two separate pairs of figures do not divide.
 *
 * Both pairs are on this screen deliberately, because hiding either would make
 * the other look like the whole truth:
 *
 *   901 placed / 323 counted           only four statuses are revenue
 *   812 200 net / 194 150 collected    booked against actually taken
 *
 * Every figure carries its population — `Figure.scope` is required, which is the
 * old `FigureRow.scope` enforcement kept through the migration. Below the
 * headline the report *proves* the second number rather than asserting it, and
 * refuses to claim the explanation if the arithmetic ever stops holding.
 */
export function RevenueView({ locale, report }: { locale: string; report: RevenueReport }) {
  const t = useTranslations("analytics");
  const tStatus = useTranslations("status");

  const figures = revenueFigures(report);

  const money = (value: string) => <Ltr>{formatMoney(value, report.currency, locale)}</Ltr>;
  const count = (value: string) => <Ltr>{formatCount(Number(value), locale)}</Ltr>;

  const group = (name: "headline" | "volume" | "deductions") =>
    figures.filter((figure) => figure.group === name);

  /*
   * `net` is the one figure whose own group's scope does not tell it apart from
   * its neighbour: net and gross are both "on the counted orders", and what
   * separates them is the refunds. `cardScope.net` says so and is the same
   * sentence the dashboard's lead card carries, so a reader arriving from there
   * meets the same words.
   */
  const scopeOf = (key: string, scope: string) =>
    key === "net" ? t("cardScope.net") : t(`scope.${scope}`);

  return (
    <>
      <Figures>
        {group("headline").map((figure) => (
          <Figure
            key={figure.key}
            label={t(`figure.${figure.key}`)}
            scope={scopeOf(figure.key, figure.scope)}
          >
            {figure.money ? money(figure.value) : count(figure.value)}
          </Figure>
        ))}
      </Figures>

      <ReportGrid>
        <Card
          title={t("revenueVolume")}
          /*
           * The reconciliation, stated only where it is proved. `orders_counted`
           * is on this report but `by_status` is not — it lives on
           * `/analytics/orders` — so this section names the four statuses and
           * points at the report that shows the arithmetic, rather than
           * reproducing a sum it cannot check from its own payload.
           */
          footnote={
            <Isolate>
              {t("countedBy", {
                placed: report.orders_placed,
                counted: report.orders_counted,
                statuses: COUNTED_STATUSES.length,
              })}
            </Isolate>
          }
        >
          <DataList>
            {group("volume").map((figure) => (
              <DataRow
                key={figure.key}
                label={t(`figure.${figure.key}`)}
                hint={t(`scope.${figure.scope}`)}
              >
                {figure.money ? money(figure.value) : count(figure.value)}
              </DataRow>
            ))}
          </DataList>
        </Card>

        <Card title={t("countedTitle")} footnote={t("countedWhy")}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {COUNTED_STATUSES.map((status) => (
                <Badge key={status} tone={STATUS_TONE[status as OrderStatus]}>
                  {tStatus(status)}
                </Badge>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-ui-caption text-ui-subtle">{t("countedExcluded")}</span>
              <div className="flex flex-wrap gap-1.5">
                {(["pending", "cancelled", "failed"] as const).map((status) => (
                  <Badge key={status} tone="neutral">
                    {tStatus(status)}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card
          title={t("revenueDeductions")}
          footnote={
            <Isolate>
              {t("refundNote", {
                count: report.refund_count,
                orders: report.refunded_orders,
              })}
            </Isolate>
          }
        >
          <DataList>
            {group("deductions").map((figure) => (
              <DataRow
                key={figure.key}
                label={t(`figure.${figure.key}`)}
                hint={t(`scope.${figure.scope}`)}
              >
                {figure.money ? money(figure.value) : count(figure.value)}
              </DataRow>
            ))}
          </DataList>
        </Card>

        {/*
          Absent from every response measured here, and present only when the
          window holds an order priced in something other than the shop's
          currency. The specification points at this field to explain 901 → 323
          and it is the wrong one — it would explain the gap between *this*
          report's already-currency-scoped `orders_placed` and the count on
          `/analytics/orders`. Rendered when it appears, because the day it does,
          every sum on this screen is over a narrower set than the counts beside
          it suggest.
        */}
        {report.excluded_currencies !== undefined ? (
          <Card title={t("excludedTitle")} footnote={t("excludedNote")}>
            <DataList>
              {Object.entries(report.excluded_currencies).map(([currency, orders]) => (
                <DataRow key={currency} label={currency}>
                  <Isolate>{t("excludedOrders", { count: orders })}</Isolate>
                </DataRow>
              ))}
            </DataList>
          </Card>
        ) : null}

        <Unavailable reasons={report.unavailable} />
      </ReportGrid>

      <ReportNotes>
        <p>{t("netVsCollected")}</p>
      </ReportNotes>
    </>
  );
}
