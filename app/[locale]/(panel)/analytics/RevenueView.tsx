"use client";

import { useTranslations } from "next-intl";
import type { RevenueReport } from "@/lib/api/schemas/analytics";
import { COUNTED_STATUSES, revenueFigures } from "@/lib/analytics";
import { STATUS_TONE, type OrderStatus } from "@/lib/order-status";
import { formatCount, formatMoney } from "@/lib/format/money";
import { ListGroup, ListRow, ListValueRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { FigureRow, Unavailable } from "./Report";

/**
 * The money report — the one route that can be refused, and the one payload where
 * two separate pairs of figures do not divide.
 *
 * Both pairs are on this screen deliberately, because hiding either would make
 * the other look like the whole truth:
 *
 *   844 placed / 289 counted   — only four statuses are revenue
 *   719 700 net / 145 150 collected — booked versus actually taken
 *
 * Every figure carries its population. Below the volume figures the report
 * *proves* the second number rather than asserting it, and refuses to claim the
 * explanation if the arithmetic ever stops holding.
 */
export function RevenueView({ locale, report }: { locale: string; report: RevenueReport }) {
  const t = useTranslations("analytics");
  const tStatus = useTranslations("status");

  const figures = revenueFigures(report);

  const money = (value: string) => (
    <Ltr>{formatMoney(value, report.currency, locale)}</Ltr>
  );
  const count = (value: string) => <Ltr>{formatCount(Number(value), locale)}</Ltr>;

  const group = (name: "headline" | "volume" | "deductions") =>
    figures
      .filter((figure) => figure.group === name)
      .map((figure) => (
        <FigureRow
          key={figure.key}
          label={t(`figure.${figure.key}`)}
          scope={t(`scope.${figure.scope}`)}
          value={figure.money ? money(figure.value) : count(figure.value)}
        />
      ));

  return (
    <>
      <ListGroup title={t("revenueHeadline")} footnote={t("netVsCollected")}>
        {group("headline")}
      </ListGroup>

      <ListGroup
        title={t("revenueVolume")}
        /*
         * The reconciliation, stated only where it is proved. `orders_counted`
         * is on this report but `by_status` is not — it lives on
         * `/analytics/orders` — so this screen names the four statuses and
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
        {group("volume")}
      </ListGroup>

      <ListGroup title={t("countedTitle")} footnote={t("countedWhy")}>
        <ListRow className="flex-wrap gap-2">
          {COUNTED_STATUSES.map((status) => (
            <StatusBadge key={status} tone={STATUS_TONE[status as OrderStatus]}>
              {tStatus(status)}
            </StatusBadge>
          ))}
        </ListRow>
        <ListRow className="flex-wrap gap-2">
          <span className="w-full text-caption text-label-tertiary">
            {t("countedExcluded")}
          </span>
          {(["pending", "cancelled", "failed"] as const).map((status) => (
            <StatusBadge key={status} tone="neutral">
              {tStatus(status)}
            </StatusBadge>
          ))}
        </ListRow>
      </ListGroup>

      <ListGroup title={t("revenueDeductions")}>{group("deductions")}</ListGroup>

      {/*
        Absent from every response measured here, and present only when the
        window holds an order priced in something other than the shop's
        currency. The specification points at this field to explain 844 → 289
        and it is the wrong one — it would explain the gap between *this*
        report's already-currency-scoped `orders_placed` and the count on
        `/analytics/orders`. Rendered when it appears, because the day it does,
        every sum on this screen is over a narrower set than the counts beside
        it suggest.
      */}
      {report.excluded_currencies !== undefined ? (
        <ListGroup title={t("excludedTitle")} footnote={t("excludedNote")}>
          {Object.entries(report.excluded_currencies).map(([currency, orders]) => (
            <ListValueRow
              key={currency}
              label={<Ltr>{currency}</Ltr>}
              value={<Isolate>{t("excludedOrders", { count: orders })}</Isolate>}
            />
          ))}
        </ListGroup>
      ) : null}

      <Unavailable reasons={report.unavailable} />

      <p className="mb-8 px-4 text-caption text-label-tertiary">
        <Isolate>
          {t("refundNote", {
            count: report.refund_count,
            orders: report.refunded_orders,
          })}
        </Isolate>
      </p>
    </>
  );
}
