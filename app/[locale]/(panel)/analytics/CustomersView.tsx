"use client";

import { useTranslations } from "next-intl";
import type { CustomersReport } from "@/lib/api/schemas/analytics";
import { barShare, rateFraction } from "@/lib/analytics";
import { formatCount, formatRate } from "@/lib/format/money";
import { ListGroup, ListValueRow } from "@/components/primitives/GroupedList";
import { BarRow } from "@/components/primitives/Bar";
import { Isolate, Ltr } from "@/components/primitives/Ltr";

/**
 * Who bought, and whether they had bought before.
 *
 * **Three of these five figures count different things and one of them shares a
 * key name with a figure on another report.** All measured 2026-08-21:
 *
 *   `customers` 9      customers who placed a *counted* order in the window —
 *                      not the shop's customer count, which is 16
 *   `new` 9            of those, the ones whose first ever order is in the window
 *   `returning` 0      the remainder; a guest can be neither, having no identity
 *   `guest_orders` 185 **orders, not people** — and restricted to the counted
 *                      statuses, which is why `/analytics/orders` reports 389
 *                      guest orders over the same window and is also right
 *
 * That last pair is `by_status.confirmed` 74 against `confirmed_orders` 111 in a
 * third place: one key, two scopes, one payload, both correct. Printed unlabelled
 * beside each other, someone reconciles 389 against 185 and files a bug. So every
 * row here says what it counts, and the guest row says twice — that it counts
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
      <ListGroup title={t("customersHeadline")} footnote={t("customersScope")}>
        <ListValueRow
          label={t("figure.customers")}
          value={<Ltr>{formatCount(report.customers, locale)}</Ltr>}
        />
        <ListValueRow
          label={t("figure.guest_orders")}
          value={<Ltr>{formatCount(report.guest_orders, locale)}</Ltr>}
        />
      </ListGroup>

      <ListGroup
        title={t("newVsReturning")}
        /*
         * Two bars and no legend: one series, and the rows are named. The
         * `dataviz` rule is a legend for two or more *series*, not two or more
         * bars — a box with one swatch would restate the title.
         */
        footnote={<Isolate>{t("newVsReturningBase", { total: report.customers })}</Isolate>}
      >
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
      </ListGroup>

      <p className="mb-8 px-4 text-caption text-label-tertiary">{t("guestNote")}</p>
    </>
  );
}
