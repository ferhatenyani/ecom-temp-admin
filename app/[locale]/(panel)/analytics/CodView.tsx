"use client";

import { useTranslations } from "next-intl";
import type { CodReport } from "@/lib/api/schemas/analytics";
import { byStatusSumsToTotal, codByStatus, codFigures, ratePercent, RATE_KEYS } from "@/lib/cod";
import { barShare } from "@/lib/analytics";
import { COD_STATUS_TONE, type CodStatus } from "@/lib/cod-status";
import { formatCount, formatRate } from "@/lib/format/money";
import { ListGroup, ListValueRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { BarRow } from "@/components/primitives/Bar";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { FigureRow } from "./Report";

/**
 * The cash-on-delivery funnel, over a window.
 *
 * `/analytics/cod` is `/cod/statistics` with a range on it — measured key for
 * key — so this reuses `lib/cod.ts` rather than restating a shape that already
 * has a tested reader. `codFigures()` is what keeps the scope on every figure,
 * and this payload is why that type exists: **`by_status.confirmed` is 80 and
 * `confirmed_orders` is 120 in the same response**, both correct, one describing
 * the shop now and the other counting every order ever confirmed including the
 * 242 since cancelled.
 *
 * The one thing that does *not* carry over is the heading. The payments screen
 * calls this block "the whole shop", because `/cod/statistics` takes no window.
 * This one does, so it says so — and the range control above is the thing that
 * moved it.
 */
export function CodView({ locale, report }: { locale: string; report: CodReport }) {
  const t = useTranslations("analytics");
  const tCod = useTranslations("cod");
  const tCodStatus = useTranslations("codStatus");

  const figures = codFigures(report);
  const breakdown = codByStatus(report);
  const max = breakdown.reduce((top, row) => Math.max(top, row.count), 0);

  const figureLabel = (key: (typeof figures)[number]["key"]) =>
    key === "total_orders"
      ? tCod("statTotal")
      : key === "current_confirmed"
        ? tCod("statCurrentConfirmed")
        : key === "ever_confirmed"
          ? tCod("statEverConfirmed")
          : key === "delivered_orders"
            ? tCod("statDelivered")
            : tCod("statReturned");

  return (
    <>
      <ListGroup
        title={t("codScoped")}
        footnote={
          byStatusSumsToTotal(report) ? (
            <Isolate>{tCod("twoCounts", { total: report.total_orders })}</Isolate>
          ) : undefined
        }
      >
        {figures.map((figure) => (
          <FigureRow
            key={figure.key}
            label={figureLabel(figure.key)}
            scope={tCod(
              figure.scope === "all" ? "scopeAll" : figure.scope === "now" ? "scopeNow" : "scopeEver",
            )}
            value={<Ltr>{formatCount(figure.value, locale)}</Ltr>}
          />
        ))}
      </ListGroup>

      <ListGroup title={tCod("breakdown")}>
        {breakdown.map((row) => (
          <BarRow
            key={row.status}
            label={
              <StatusBadge tone={COD_STATUS_TONE[row.status as CodStatus] ?? "neutral"}>
                {tCodStatus.has(row.status as "pending")
                  ? tCodStatus(row.status as "pending")
                  : row.status}
              </StatusBadge>
            }
            value={<Ltr>{formatCount(row.count, locale)}</Ltr>}
            share={barShare(row.count, max)}
          />
        ))}
      </ListGroup>

      <ListGroup
        title={tCod("rates")}
        footnote={<Isolate>{tCod("rateBase", { total: report.total_orders })}</Isolate>}
      >
        {RATE_KEYS.map((key) => (
          <ListValueRow
            key={key}
            label={tCod(
              key === "confirmation"
                ? "rateConfirmation"
                : key === "rejection"
                  ? "rateRejection"
                  : key === "cancellation"
                    ? "rateCancellation"
                    : key === "delivery"
                      ? "rateDelivery"
                      : "rateReturn",
            )}
            /*
             * `ratePercent` parses `"0.2109"` to the fraction 0.2109 and
             * `formatRate` renders it as 21,1 %. Deliberately not
             * `formatPercent`, which takes a coupon's `"10.00"` meaning ten
             * percent — feeding it this would print 0,2 % and look entirely
             * plausible on a screen about conversion.
             */
            value={<Ltr>{formatRate(ratePercent(report.rates[key]), locale)}</Ltr>}
          />
        ))}
      </ListGroup>
    </>
  );
}
