"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ProductsReport } from "@/lib/api/schemas/analytics";
import { barShare, hasRankingSignal } from "@/lib/analytics";
import { SHOP_CURRENCY, formatCount, formatMoney } from "@/lib/format/money";
import { Card } from "@/components/ui/Card";
import { BarList, BarRow } from "@/components/ui/Bar";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { Figure, Figures, ReportGrid, ReportNotes, WideSection } from "./Report";

/**
 * What sold, and what is about to run out.
 *
 * ## The bars are drawn only when there is a ranking to draw
 *
 * Measured over the thirty-day window the units are 84, 76, 44, 43, 26, 14, 14,
 * 9, 5, 3 — a genuine spread, and bars carry it well. Narrow the window and it
 * collapses: `range=today` returns `[]`, and a two-order day returns two rows of
 * one unit each, where a bar chart draws two identical full-length bars and
 * implies a ranking that does not exist. `hasRankingSignal()` decides, and the
 * flat case renders the same rows as a plain list of counts — which states
 * exactly what is known.
 *
 * ## Ten rows, and there is no control because there is no knob
 *
 * `best_sellers_limit` is 10 and it is **published, not adjustable**. Measured
 * 2026-08-26: `limit=3`, `per_page=3` and `best_sellers_limit=3` each answer ten
 * rows with `best_sellers_limit: 10` — the field exists so a caller can say how
 * many it is looking at, not so it can ask for fewer. So there is no "show more",
 * and the footnote *says* the limit is the API's rather than leaving its absence
 * looking like an unfinished control. This run's oldest rule: a control ships
 * only when someone measured it working.
 *
 * ## `low_stock` is the one figure the range does not move
 *
 * Measured flat at 3 across a 90× window while `best_sellers` empties entirely —
 * it counts the shop's current state, not the period. It says so in its own scope
 * line, which is the treatment the dashboard's `Stock bas` card already carries
 * and the same sentence, so a reader arriving from there meets the same words.
 *
 * Its link is capability-gated, and that is the dashboard's second lesson: a
 * Support Agent is **403 on `/inventory`** — measured 2026-08-26 — so for that
 * reader the figure renders unlinked. Never a link to a refusal, never a disabled
 * link. The figure stays, because the number is not what is refused.
 */
export function ProductsView({
  locale,
  report,
  money,
  capabilities,
}: {
  locale: string;
  report: ProductsReport;
  money: boolean;
  /** `me.capabilities` — which of the two destinations here are links. */
  capabilities: readonly string[];
}) {
  const t = useTranslations("analytics");

  const sellers = report.best_sellers;
  const max = sellers.reduce((top, row) => Math.max(top, row.units), 0);
  const ranked = hasRankingSignal(sellers.map((row) => row.units));

  const lowStock = report.low_stock.products;
  /* Nothing to open when the count is zero — §3.3's rule reaching a figure, the
     same way an empty filter offers no clear button. */
  const lowStockHref =
    lowStock > 0 && capabilities.includes("ac_manage_inventory")
      ? `/${locale}/inventory`
      : undefined;
  const canOpenProducts = capabilities.includes("ac_manage_products");

  return (
    <>
      <Figures>
        <Figure
          label={t("lowStockLabel")}
          scope={t("cardScope.low_stock")}
          href={lowStockHref}
        >
          <Ltr>{formatCount(lowStock, locale)}</Ltr>
        </Figure>
      </Figures>

      <ReportGrid>
        <WideSection>
          <Card
            title={t("bestSellers")}
            footnote={
              sellers.length === 0 ? undefined : ranked ? (
                <Isolate>{t("bestSellersLimit", { limit: report.best_sellers_limit })}</Isolate>
              ) : (
                /* Said rather than drawn: the rows are all the same size, so a
                   chart here would invent a difference the data does not have. */
                t("bestSellersFlat")
              )
            }
          >
            {sellers.length === 0 ? (
              <p className="py-2 text-ui-compact text-ui-muted">{t("bestSellersEmpty")}</p>
            ) : (
              /* `BarList` renders a `<ul>` either way; only the mark is dropped
                 when there is no ranking. A `BarRow` at share 0 is not the flat
                 case — `.bar-fill` has a 2px floor so a row with one unit is
                 never an empty track, which would draw ten identical nubs here
                 and read as a chart that failed rather than as one that was
                 correctly not drawn. */
              <BarList>
                {sellers.map((row) => {
                  /* The product's own name, in whatever language it was entered
                     — this shop mixes French catalogue names with English
                     fixture names — so `dir="auto"`. Without it a French name is
                     laid out from the wrong end on the Arabic page. */
                  const name = canOpenProducts ? (
                    <Link
                      href={`/${locale}/products/${row.product_id}`}
                      dir="auto"
                      className="ui-ring ui-interactive block truncate rounded-ui-sm hover:text-ui-accent"
                    >
                      {row.name}
                    </Link>
                  ) : (
                    <span dir="auto" className="block truncate">
                      {row.name}
                    </span>
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

                  return (
                    <BarRow
                      key={row.product_id}
                      label={name}
                      value={units}
                      share={ranked ? barShare(row.units, max) : null}
                      note={note}
                    />
                  );
                })}
              </BarList>
            )}
          </Card>
        </WideSection>
      </ReportGrid>

      <ReportNotes>
        <p>{t("lowStockNote")}</p>
      </ReportNotes>
    </>
  );
}
