"use client";

import { useTranslations } from "next-intl";
import type { OrdersReport } from "@/lib/api/schemas/analytics";
import { barShare, countedReconciliation, statusCounts } from "@/lib/analytics";
import { orderStatuses, STATUS_TONE, type OrderStatus } from "@/lib/order-status";
import { SHOP_CURRENCY, formatCount, formatMoney } from "@/lib/format/money";
import { ListGroup, ListRow, ListValueRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { BarRow } from "@/components/primitives/Bar";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { FigureRow } from "./Report";

/**
 * Order activity, and the one screen that can *prove* why the money report counts
 * fewer orders than the shop placed.
 *
 * `by_status` sums exactly to `placed` — 197+160+1+45+357+83+1 = 844 — which is
 * what makes the breakdown explanatory rather than merely adjacent. Four of those
 * statuses are revenue and three are not; the sum of the four is
 * `counted_as_revenue`, and this screen adds it up rather than asserting it.
 *
 * **The specification says `excluded_currencies` explains that gap. It does
 * not** — that field names orders priced in another currency, and it was absent
 * from every response measured. The gap is a status exclusion, and the
 * arithmetic is here.
 */
export function OrdersView({
  locale,
  report,
  money,
}: {
  locale: string;
  report: OrdersReport;
  money: boolean;
}) {
  const t = useTranslations("analytics");
  const tStatus = useTranslations("status");

  const rows = statusCounts(report.by_status, orderStatuses);
  const max = rows.reduce((top, row) => Math.max(top, row.count), 0);
  const reconciliation = countedReconciliation(report);

  const label = (status: string) =>
    tStatus.has(status as "pending") ? tStatus(status as "pending") : status;

  return (
    <>
      <ListGroup title={t("ordersHeadline")}>
        <FigureRow
          label={t("figure.orders_placed")}
          scope={t("scope.all")}
          value={<Ltr>{formatCount(report.placed, locale)}</Ltr>}
        />
        <FigureRow
          label={t("figure.orders_counted")}
          scope={t("scope.counted")}
          value={<Ltr>{formatCount(report.counted_as_revenue, locale)}</Ltr>}
        />
        <FigureRow
          label={t("figure.guest_orders")}
          scope={t("scope.all")}
          value={<Ltr>{formatCount(report.guest_orders, locale)}</Ltr>}
        />
        {/*
          Money, and therefore absent without `ac_manage_orders` — measured, the
          key is simply not in the payload. `currency` goes with it, so the
          fallback is the shop's rather than a bare number with no unit.
        */}
        {money && report.average_order_value !== undefined ? (
          <FigureRow
            label={t("figure.average_order_value")}
            scope={t("scope.counted")}
            value={
              <Ltr>
                {formatMoney(
                  report.average_order_value,
                  report.currency ?? SHOP_CURRENCY,
                  locale,
                )}
              </Ltr>
            }
          />
        ) : null}
      </ListGroup>

      <ListGroup
        title={t("byStatus")}
        footnote={<Isolate>{t("byStatusSum", { total: report.placed })}</Isolate>}
      >
        {rows.map((row) => (
          <BarRow
            key={row.status}
            label={
              <StatusBadge tone={STATUS_TONE[row.status as OrderStatus] ?? "neutral"}>
                {label(row.status)}
              </StatusBadge>
            }
            value={<Ltr>{formatCount(row.count, locale)}</Ltr>}
            share={barShare(row.count, max)}
          />
        ))}
      </ListGroup>

      <ListGroup
        title={t("countedTitle")}
        /*
         * `proves` is the floor on this claim. It is true only when the four
         * counted statuses on *this* payload actually sum to
         * `counted_as_revenue` — so if the backend's definition ever changes
         * under the panel, the screen reports the gap and stops explaining it,
         * rather than printing a confident sentence that has quietly become
         * false. A sweep that cannot fail is a sweep that reports success.
         */
        footnote={
          reconciliation.proves ? (
            <Isolate>
              {t("countedProved", {
                counted: reconciliation.counted,
                placed: reconciliation.placed,
              })}
            </Isolate>
          ) : (
            t("countedUnproved")
          )
        }
      >
        {reconciliation.included.map((row) => (
          <ListValueRow
            key={row.status}
            label={
              <StatusBadge tone={STATUS_TONE[row.status as OrderStatus] ?? "neutral"}>
                {label(row.status)}
              </StatusBadge>
            }
            value={<Ltr>{formatCount(row.count, locale)}</Ltr>}
          />
        ))}
        <ListRow>
          <span className="text-body text-label-secondary">{t("countedExcluded")}</span>
          <Ltr className="ms-auto shrink-0 text-body text-label">
            {formatCount(
              reconciliation.excluded.reduce((sum, row) => sum + row.count, 0),
              locale,
            )}
          </Ltr>
        </ListRow>
      </ListGroup>
    </>
  );
}
