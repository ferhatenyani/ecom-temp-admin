"use client";

import { useTranslations } from "next-intl";
import type { ShippingReport } from "@/lib/api/schemas/analytics";
import { barShare, rateFraction, statusCounts, wilayaSlices } from "@/lib/analytics";
import { SHIPMENT_STATUSES } from "@/lib/shipment-status";
import { SHOP_CURRENCY, formatCount, formatMoney, formatRate } from "@/lib/format/money";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { BarList, BarRow } from "@/components/ui/Bar";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { Figure, Figures, ReportGrid, Unavailable, WideSection } from "./Report";

/**
 * Parcels, couriers, and the geography — which is mostly one row, and says so.
 *
 * **The unattributed orders outweigh every attributed wilaya combined.** Measured:
 * 281 orders and 741 700 against Adrar's 40 and Algiers' 2 — 42 across both named
 * wilayas together. That is not a rounding remainder and it is not a bug: a wilaya
 * comes off the *shipment*, and an order that was never shipped carries only the
 * free-text wilaya on its address, which the backend refuses to guess at. It says
 * so, in the payload, and the row carries that sentence.
 *
 * So it is ranked as a row rather than drawn as a nameless wedge, in a fill that
 * marks it as a different *kind* of thing rather than a smaller one, and the
 * section's footnote states the proportion outright. A reader who misses that
 * misreads the whole map: a chart that hid it behind "other" would show a shop
 * that sells almost entirely in Adrar.
 */
export function ShippingView({
  locale,
  report,
  money,
}: {
  locale: string;
  report: ShippingReport;
  money: boolean;
}) {
  const t = useTranslations("analytics");
  const tStatus = useTranslations("shipmentStatus");

  const statuses = statusCounts(report.shipments.by_status, SHIPMENT_STATUSES);
  const statusMax = statuses.reduce((top, row) => Math.max(top, row.count), 0);

  const slices = wilayaSlices(report);
  const sliceMax = slices.reduce((top, row) => Math.max(top, row.orders), 0);

  /* The named wilayas against the slice that has no name, so the footnote states
     the imbalance rather than leaving the reader to add the rows up. */
  const named = slices
    .filter((slice) => slice.kind === "wilaya")
    .reduce((sum, slice) => sum + slice.orders, 0);

  return (
    <>
      <Figures>
        <Figure label={t("figure.shipments")} scope={t("scope.shipmentsAll")}>
          <Ltr>{formatCount(report.shipments.total, locale)}</Ltr>
        </Figure>
        <Figure label={t("figure.live")} scope={t("scope.shipmentsLive")}>
          <Ltr>{formatCount(report.shipments.live, locale)}</Ltr>
        </Figure>
        <Figure label={t("rateDelivery")} scope={t("cardScope.shipping_delivery")}>
          <Ltr>{formatRate(rateFraction(report.rates.delivery), locale)}</Ltr>
        </Figure>
        <Figure label={t("rateReturn")} scope={t("cardScope.shipping_delivery")}>
          <Ltr>{formatRate(rateFraction(report.rates.return), locale)}</Ltr>
        </Figure>
      </Figures>

      <ReportGrid>
        <Card
          title={t("byStatus")}
          footnote={
            <Isolate>{t("byStatusSum", { total: report.shipments.total })}</Isolate>
          }
        >
          <BarList>
            {statuses.map((row) => (
              <BarRow
                key={row.status}
                label={
                  tStatus.has(row.status as "pending")
                    ? tStatus(row.status as "pending")
                    : row.status
                }
                value={<Ltr>{formatCount(row.count, locale)}</Ltr>}
                share={barShare(row.count, statusMax)}
              />
            ))}
          </BarList>
        </Card>

        <Card title={t("byProvider")} footnote={t("byProviderNote")}>
          {report.providers.length === 0 ? (
            <p className="py-2 text-ui-compact text-ui-muted">{t("noProviders")}</p>
          ) : (
            <DataList>
              {report.providers.map((provider) => (
                /*
                  The provider's own key, not a label. `/shipping/providers` is
                  what turns `manual` into *In-house delivery*, and it sits behind
                  `ac_manage_shipping` — which this report's reader may not hold,
                  since analytics is `ac_view_analytics` alone. Fetching it would
                  403 for exactly the person this screen exists for, so the raw
                  key renders as the identifier it is.
                */
                <DataRow
                  key={provider.provider}
                  label={provider.provider}
                  hint={t("providerNote", {
                    delivered: provider.delivered,
                    rate: formatRate(rateFraction(provider.rates.delivery), locale),
                  })}
                >
                  <Ltr>{formatCount(provider.shipments, locale)}</Ltr>
                </DataRow>
              ))}
            </DataList>
          )}
        </Card>

        {/* ------------------------------------------------ the geography --- */}
        <WideSection>
          <Card
            title={t("byWilaya")}
            /* The imbalance, stated where the reader is already looking. It is
               the report's actual headline: most of this shop's orders cannot be
               placed on the map at all. */
            footnote={
              <Isolate>
                {t("byWilayaNote", {
                  unattributed: report.unattributed.orders,
                  named,
                  wilayas: report.by_wilaya.length,
                })}
              </Isolate>
            }
          >
            <BarList>
              {slices.map((slice) => (
                <BarRow
                  key={slice.key}
                  muted={slice.kind === "unattributed"}
                  label={
                    slice.kind === "unattributed" ? (
                      t("unattributed")
                    ) : (
                      /* The wilaya's own name in the page's language. For 16 the
                         French name is the English exonym *Algiers* by design —
                         the Latin names follow ISO 3166-2 to match WooCommerce's
                         DZ state list and the slug is derived from them, so a
                         French display name would be a new column rather than an
                         edit. README carries the full reason. */
                      <span dir="auto">{locale === "ar" ? slice.nameAr : slice.name}</span>
                    )
                  }
                  value={<Ltr>{formatCount(slice.orders, locale)}</Ltr>}
                  share={barShare(slice.orders, sliceMax)}
                  note={
                    <>
                      {/* Pre-formatted rather than an ICU `number` argument: the
                          share is a fraction and `formatRate` is the one
                          formatter that reads a fraction, with the locale's own
                          digits and separator. */}
                      <Isolate>
                        {t("sharePercent", { share: formatRate(slice.share, locale) })}
                      </Isolate>
                      {money && slice.revenue !== null ? (
                        <>
                          <span aria-hidden="true"> · </span>
                          <Ltr>
                            {formatMoney(
                              slice.revenue,
                              report.currency ?? SHOP_CURRENCY,
                              locale,
                            )}
                          </Ltr>
                        </>
                      ) : null}
                      {/*
                        Why the largest row names no place — on the row itself,
                        where the reader is looking, rather than only as a
                        footnote under the section.

                        **The API's own sentence is deliberately not rendered
                        here.** It carries this reason in English, and putting it
                        on the row laid an English paragraph across the middle of
                        the Arabic sheet — seen in the capture, which is the only
                        place that ever looks wrong. It is the same rule
                        `unavailable` follows: a localised line where the panel
                        has wording, the API's text only where it has none. Here
                        it has wording, so the English never reaches the screen.
                      */}
                      {slice.reason !== null ? (
                        <span className="mt-0.5 block">{t("unattributedWhy")}</span>
                      ) : null}
                    </>
                  }
                />
              ))}
            </BarList>
          </Card>
        </WideSection>

        {money && report.shipping_revenue !== undefined ? (
          <Card title={t("shippingRevenue")} footnote={t("shippingRevenueNote")}>
            <DataList>
              {/* No hint: it is the only row in the section and the footnote
                  already says which figure this is *not*. A scope line that
                  restates its own label is noise. */}
              <DataRow label={t("figure.shipping_revenue")}>
                <Ltr>
                  {formatMoney(
                    report.shipping_revenue,
                    report.currency ?? SHOP_CURRENCY,
                    locale,
                  )}
                </Ltr>
              </DataRow>
            </DataList>
          </Card>
        ) : null}

        <Unavailable reasons={report.unavailable} />
      </ReportGrid>
    </>
  );
}
