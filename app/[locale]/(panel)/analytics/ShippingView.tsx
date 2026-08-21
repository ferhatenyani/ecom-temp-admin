"use client";

import { useTranslations } from "next-intl";
import type { ShippingReport } from "@/lib/api/schemas/analytics";
import { barShare, rateFraction, statusCounts, wilayaSlices } from "@/lib/analytics";
import { SHIPMENT_STATUSES } from "@/lib/shipment-status";
import { SHOP_CURRENCY, formatCount, formatMoney, formatRate } from "@/lib/format/money";
import { ListGroup, ListRow, ListValueRow } from "@/components/primitives/GroupedList";
import { BarRow } from "@/components/primitives/Bar";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { Unavailable } from "./Report";

/**
 * Parcels, couriers, and the geography — which is mostly one row, and says so.
 *
 * **The unattributed orders outweigh every attributed wilaya combined.** Measured:
 * 249 orders and 652 400 against Adrar's 39 and Algiers' 1. That is not a
 * rounding remainder and it is not a bug — a wilaya comes off the *shipment*, and
 * an order that was never shipped carries only the free-text wilaya on its
 * address, which the backend refuses to guess at. It says so, in the payload, and
 * the row carries that sentence.
 *
 * So it is ranked as a row rather than drawn as a nameless wedge, in a fill that
 * marks it as a different *kind* of thing rather than a smaller one. A chart that
 * hid it behind "other" would show a reader a shop that sells almost entirely in
 * Adrar.
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

  return (
    <>
      <ListGroup title={t("shippingHeadline")}>
        <ListValueRow
          label={t("figure.shipments")}
          value={<Ltr>{formatCount(report.shipments.total, locale)}</Ltr>}
        />
        <ListValueRow
          label={t("figure.live")}
          value={<Ltr>{formatCount(report.shipments.live, locale)}</Ltr>}
        />
        <ListValueRow
          label={t("rateDelivery")}
          value={<Ltr>{formatRate(rateFraction(report.rates.delivery), locale)}</Ltr>}
        />
        <ListValueRow
          label={t("rateReturn")}
          value={<Ltr>{formatRate(rateFraction(report.rates.return), locale)}</Ltr>}
        />
      </ListGroup>

      <ListGroup
        title={t("byStatus")}
        footnote={<Isolate>{t("byStatusSum", { total: report.shipments.total })}</Isolate>}
      >
        {statuses.map((row) => (
          <BarRow
            key={row.status}
            label={
              tStatus.has(row.status as "pending") ? tStatus(row.status as "pending") : row.status
            }
            value={<Ltr>{formatCount(row.count, locale)}</Ltr>}
            share={barShare(row.count, statusMax)}
          />
        ))}
      </ListGroup>

      {/* -------------------------------------------------- the geography --- */}
      <ListGroup title={t("byWilaya")}>
        {slices.map((slice) => (
          <BarRow
            key={slice.key}
            muted={slice.kind === "unattributed"}
            label={
              slice.kind === "unattributed" ? (
                t("unattributed")
              ) : (
                /* The wilaya's own name in the page's language. For 16 the French
                   name is the English exonym *Algiers* by design — the Latin names
                   follow ISO 3166-2 to match WooCommerce's DZ state list and the
                   slug is derived from them, so a French display name would be a
                   new column rather than an edit. README carries the full reason. */
                <span dir="auto">{locale === "ar" ? slice.nameAr : slice.name}</span>
              )
            }
            value={<Ltr>{formatCount(slice.orders, locale)}</Ltr>}
            share={barShare(slice.orders, sliceMax)}
            note={
              <>
                {/* Pre-formatted rather than an ICU `number` argument: the
                    share is a fraction and `formatRate` is the one formatter
                    that reads a fraction, with the locale's own digits and
                    separator. */}
                <Isolate>
                  {t("sharePercent", { share: formatRate(slice.share, locale) })}
                </Isolate>
                {money && slice.revenue !== null ? (
                  <>
                    <span aria-hidden="true"> · </span>
                    <Ltr>{formatMoney(slice.revenue, report.currency ?? SHOP_CURRENCY, locale)}</Ltr>
                  </>
                ) : null}
                {/*
                  Why the largest row names no place — on the row itself, where
                  the reader is looking, rather than as a footnote under the
                  group.

                  **The API's own sentence is deliberately not rendered here.**
                  It carries this reason in English, and putting it on the row
                  laid an English paragraph across the middle of the Arabic sheet
                  — seen in the capture, which is the only place that ever looks
                  wrong. It is the same rule `unavailable` follows: a localised
                  line where the panel has wording, the API's text only where it
                  has none. Here it has wording, so the English never reaches the
                  screen.
                */}
                {slice.reason !== null ? (
                  <span className="mt-0.5 block">{t("unattributedWhy")}</span>
                ) : null}
              </>
            }
          />
        ))}
      </ListGroup>

      {/* --------------------------------------------------- the couriers --- */}
      <ListGroup title={t("byProvider")} footnote={t("byProviderNote")}>
        {report.providers.length === 0 ? (
          <ListRow>
            <span className="text-body text-label-secondary">{t("noProviders")}</span>
          </ListRow>
        ) : (
          report.providers.map((provider) => (
            <ListRow key={provider.provider} className="flex-col items-start gap-1">
              <span className="flex w-full items-baseline gap-3">
                {/*
                  The provider's own key, not a label. `/shipping/providers` is
                  what turns `manual` into *In-house delivery*, and it sits behind
                  `ac_manage_shipping` — which this report's reader may not hold,
                  since analytics is `ac_view_analytics` alone. Fetching it would
                  403 for exactly the person this screen exists for, so the raw
                  key renders as the identifier it is.

                  `Ltr` wraps the key alone and not the cell. Around the
                  full-width cell it forces the *cell* to LTR, and in Arabic the
                  name then rendered flush against the left edge with the count
                  beside it — both at the wrong end of the row. Seen in the
                  capture; the markup looked correct either way.
                */}
                <span className="min-w-0 flex-1 truncate text-body text-label">
                  <Ltr>{provider.provider}</Ltr>
                </span>
                <span className="shrink-0 text-body text-label">
                  <Ltr>{formatCount(provider.shipments, locale)}</Ltr>
                </span>
              </span>
              <span className="text-caption text-label-tertiary">
                <Isolate>
                  {t("providerNote", {
                    delivered: provider.delivered,
                    rate: formatRate(rateFraction(provider.rates.delivery), locale),
                  })}
                </Isolate>
              </span>
            </ListRow>
          ))
        )}
      </ListGroup>

      {money && report.shipping_revenue !== undefined ? (
        <ListGroup title={t("shippingRevenue")} footnote={t("shippingRevenueNote")}>
          <ListValueRow
            label={t("figure.shipping_revenue")}
            value={
              <Ltr>
                {formatMoney(report.shipping_revenue, report.currency ?? SHOP_CURRENCY, locale)}
              </Ltr>
            }
          />
        </ListGroup>
      ) : null}

      <Unavailable reasons={report.unavailable} />
    </>
  );
}
