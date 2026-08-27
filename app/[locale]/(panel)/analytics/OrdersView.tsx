"use client";

import { useTranslations } from "next-intl";
import type { OrdersReport } from "@/lib/api/schemas/analytics";
import { barShare, countedReconciliation, statusCounts } from "@/lib/analytics";
import { orderStatuses, STATUS_TONE, type OrderStatus } from "@/lib/order-status";
import { SHOP_CURRENCY, formatCount, formatMoney } from "@/lib/format/money";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BarList, BarRow } from "@/components/ui/Bar";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { Figure, Figures, ReportGrid } from "./Report";

/**
 * Order activity, and the one screen that can *prove* why the money report counts
 * fewer orders than the shop placed.
 *
 * `by_status` sums exactly to `placed` — 198+177+1+56+379+89+1 = 901 — which is
 * what makes the breakdown explanatory rather than merely adjacent. Four of those
 * statuses are revenue and three are not; the sum of the four is
 * `counted_as_revenue`, and this screen adds it up rather than asserting it.
 *
 * **The specification says `excluded_currencies` explains that gap. It does
 * not** — that field names orders priced in another currency, and it was absent
 * from every response measured. The gap is a status exclusion, and the
 * arithmetic is here.
 *
 * **`guest_orders` is 422 here and 209 on the customers report, and both are
 * right.** This one counts every status; that one counts only the four that are
 * revenue. Each says so in its own scope line, which is the only thing standing
 * between the two numbers and a bug report.
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
      <Figures>
        <Figure label={t("figure.orders_placed")} scope={t("scope.all")}>
          <Ltr>{formatCount(report.placed, locale)}</Ltr>
        </Figure>
        <Figure label={t("figure.orders_counted")} scope={t("scope.counted")}>
          <Ltr>{formatCount(report.counted_as_revenue, locale)}</Ltr>
        </Figure>
        <Figure label={t("figure.guest_orders")} scope={t("scope.guestAll")}>
          <Ltr>{formatCount(report.guest_orders, locale)}</Ltr>
        </Figure>
        {/*
          Money, and therefore absent without `ac_manage_orders` — measured, the
          key is simply not in the payload. `currency` goes with it, so the
          fallback is the shop's rather than a bare number with no unit. Three
          tiles rather than four is a shorter row, not a hole: nothing else on
          this payload is a headline, and inventing a fourth to fill the grid
          would put a figure on screen because of its width.
        */}
        {money && report.average_order_value !== undefined ? (
          <Figure label={t("figure.average_order_value")} scope={t("scope.counted")}>
            <Ltr>
              {formatMoney(report.average_order_value, report.currency ?? SHOP_CURRENCY, locale)}
            </Ltr>
          </Figure>
        ) : null}
      </Figures>

      <ReportGrid>
        <Card
          title={t("byStatus")}
          footnote={<Isolate>{t("byStatusSum", { total: report.placed })}</Isolate>}
        >
          <BarList>
            {rows.map((row) => (
              <BarRow
                key={row.status}
                label={
                  <Badge tone={STATUS_TONE[row.status as OrderStatus] ?? "neutral"}>
                    {label(row.status)}
                  </Badge>
                }
                value={<Ltr>{formatCount(row.count, locale)}</Ltr>}
                share={barShare(row.count, max)}
              />
            ))}
          </BarList>
        </Card>

        <Card
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
          {/*
            A `<ul>` rather than a `DataList`, because the label is a `Badge` and
            a `<dt>` takes a string — the COD funnel's reasoning, and where this
            shape came from. Colour never carries the meaning alone: the badge
            holds the word.
          */}
          <ul className="flex min-w-0 flex-col">
            {reconciliation.included.map((row) => (
              <li
                key={row.status}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ui-line py-2 last:border-b-0"
              >
                <Badge tone={STATUS_TONE[row.status as OrderStatus] ?? "neutral"}>
                  {label(row.status)}
                </Badge>
                <Ltr className="ms-auto text-ui-compact text-ui-fg">
                  {formatCount(row.count, locale)}
                </Ltr>
              </li>
            ))}
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ui-line py-2 last:border-b-0">
              <span className="text-ui-compact text-ui-muted">{t("countedExcluded")}</span>
              <Ltr className="ms-auto text-ui-compact text-ui-fg">
                {formatCount(
                  reconciliation.excluded.reduce((sum, row) => sum + row.count, 0),
                  locale,
                )}
              </Ltr>
            </li>
          </ul>
        </Card>
      </ReportGrid>
    </>
  );
}
