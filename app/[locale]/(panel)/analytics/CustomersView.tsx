"use client";

import { useTranslations } from "next-intl";
import type { CustomersReport } from "@/lib/api/schemas/analytics";
import { barShare, rateFraction } from "@/lib/analytics";
import { formatCount, formatRate } from "@/lib/format/money";
import { Card } from "@/components/ui/Card";
import { BarList, BarRow } from "@/components/ui/Bar";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { Figure, Figures, ReportGrid, ReportNotes, WideSection } from "./Report";

/**
 * Who bought, and whether they had bought before.
 *
 * **Three of these four figures count different things and one of them shares a
 * key name with a figure on another report.** All measured:
 *
 *   `customers` 9      accounts that placed a *counted* order in the window —
 *                      not the shop's customer count
 *   `new` 9            of those, the ones whose first ever order is in the window
 *   `returning` 0      the remainder; a guest can be neither, having no identity
 *   `guest_orders` 209 **orders, not people** — and restricted to the counted
 *                      statuses, which is why `/analytics/orders` reports 422
 *                      guest orders over the same window and is also right
 *
 * That last pair is `by_status.confirmed` 84 against `confirmed_orders` 126 in a
 * third place: one key, two scopes, one payload, both correct. Printed unlabelled
 * beside each other, someone reconciles 422 against 209 and files a bug. So every
 * figure here says what it counts, and the guest one says twice — that it counts
 * orders rather than people, and over which statuses.
 */
export function CustomersView({
  locale,
  report,
}: {
  locale: string;
  report: CustomersReport;
}) {
  const t = useTranslations("analytics");

  const max = Math.max(report.new, report.returning);

  return (
    <>
      <Figures>
        <Figure label={t("figure.customers")} scope={t("cardScope.customers")}>
          <Ltr>{formatCount(report.customers, locale)}</Ltr>
        </Figure>
        <Figure label={t("figure.guest_orders")} scope={t("scope.guestCounted")}>
          <Ltr>{formatCount(report.guest_orders, locale)}</Ltr>
        </Figure>
        <Figure label={t("figure.new")} scope={t("scope.firstOrder")}>
          <Ltr>{formatCount(report.new, locale)}</Ltr>
        </Figure>
        <Figure label={t("figure.returning")} scope={t("scope.hadOrdered")}>
          <Ltr>{formatCount(report.returning, locale)}</Ltr>
        </Figure>
      </Figures>

      <ReportGrid>
        <WideSection>
          <Card
            title={t("newVsReturning")}
            /*
             * Two bars and no legend: one series, and the rows are named. The
             * `dataviz` rule is a legend for two or more *series*, not two or
             * more bars — a box with one swatch would restate the title.
             */
            footnote={
              <Isolate>{t("newVsReturningBase", { total: report.customers })}</Isolate>
            }
          >
            <BarList>
              <BarRow
                label={t("figure.new")}
                value={<Ltr>{formatCount(report.new, locale)}</Ltr>}
                share={barShare(report.new, max)}
                note={<Ltr>{formatRate(rateFraction(report.rates.new), locale)}</Ltr>}
              />
              <BarRow
                label={t("figure.returning")}
                value={<Ltr>{formatCount(report.returning, locale)}</Ltr>}
                share={barShare(report.returning, max)}
                note={<Ltr>{formatRate(rateFraction(report.rates.returning), locale)}</Ltr>}
              />
            </BarList>
          </Card>
        </WideSection>
      </ReportGrid>

      <ReportNotes>
        <p>{t("customersScope")}</p>
        <p>{t("guestNote")}</p>
      </ReportNotes>
    </>
  );
}
