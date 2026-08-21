"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ProductsReport } from "@/lib/api/schemas/analytics";
import { barShare, hasRankingSignal } from "@/lib/analytics";
import { SHOP_CURRENCY, formatCount, formatMoney } from "@/lib/format/money";
import { ListGroup, ListLinkRow, ListValueRow } from "@/components/primitives/GroupedList";
import { BarRow } from "@/components/primitives/Bar";
import { EmptyState } from "@/components/patterns/States";
import { Isolate, Ltr } from "@/components/primitives/Ltr";

/**
 * What sold, and what is about to run out.
 *
 * **The bars are drawn only when there is a ranking to draw.** Measured over the
 * thirty-day window the units are 80, 70, 41, 40, 22, 12, 11, 9, 5, 3 — a genuine
 * spread, and bars carry it well. Narrow the window and it collapses: `range=today`
 * returns `[]`, and a two-order day returns two rows of one unit each, where a bar
 * chart draws two identical full-length bars and implies a ranking that does not
 * exist. `hasRankingSignal()` decides, and the flat case renders the same rows as
 * a plain list of counts — which states exactly what is known.
 *
 * Every row navigates to the product behind it. A dashboard number that cannot be
 * drilled into is decoration.
 */
export function ProductsView({
  locale,
  report,
  money,
}: {
  locale: string;
  report: ProductsReport;
  money: boolean;
}) {
  const t = useTranslations("analytics");

  const sellers = report.best_sellers;
  const max = sellers.reduce((top, row) => Math.max(top, row.units), 0);
  const ranked = hasRankingSignal(sellers.map((row) => row.units));

  return (
    <>
      <ListGroup
        title={t("bestSellers")}
        footnote={
          sellers.length === 0 ? undefined : ranked ? (
            <Isolate>{t("bestSellersLimit", { limit: report.best_sellers_limit })}</Isolate>
          ) : (
            /* Said rather than drawn: the rows are all the same size, so a chart
               here would invent a difference the data does not have. */
            t("bestSellersFlat")
          )
        }
      >
        {sellers.length === 0 ? (
          <div className="px-4 py-6">
            <p className="text-body text-label-secondary">{t("bestSellersEmpty")}</p>
          </div>
        ) : (
          sellers.map((row) => {
            /* The product's own name, in whatever language it was entered — this
               shop mixes French catalogue names with English fixture names — so
               `dir="auto"`. Without it `truncate` clips a French name from its
               front on the Arabic page. */
            const name = (
              <Link
                href={`/${locale}/products/${row.product_id}`}
                dir="auto"
                className="press-row block truncate text-body text-label"
              >
                {row.name}
              </Link>
            );

            const units = <Ltr>{formatCount(row.units, locale)}</Ltr>;
            const note = (
              <Isolate>
                {money && row.revenue !== undefined
                  ? t("sellerNoteMoney", {
                      orders: row.orders,
                      revenue: formatMoney(row.revenue, SHOP_CURRENCY, locale),
                    })
                  : t("sellerNote", { orders: row.orders })}
              </Isolate>
            );

            return ranked ? (
              <BarRow
                key={row.product_id}
                label={name}
                value={units}
                share={barShare(row.units, max)}
                note={note}
              />
            ) : (
              <ListValueRow key={row.product_id} label={name} value={units} />
            );
          })
        )}
      </ListGroup>

      <ListGroup title={t("lowStockTitle")} footnote={t("lowStockNote")}>
        {report.low_stock.products === 0 ? (
          <EmptyState message={t("lowStockNone")} />
        ) : (
          <ListLinkRow
            href={`/${locale}/inventory`}
            ariaLabel={t("lowStockTitle")}
          >
            <span className="flex items-center gap-3">
              <span className="min-w-0 flex-1 text-body text-label">
                {t("lowStockLabel")}
              </span>
              <Ltr className="shrink-0 text-title-3 text-label">
                {formatCount(report.low_stock.products, locale)}
              </Ltr>
            </span>
          </ListLinkRow>
        )}
      </ListGroup>
    </>
  );
}
