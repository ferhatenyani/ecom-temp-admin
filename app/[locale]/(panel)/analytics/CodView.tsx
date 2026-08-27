"use client";

import { useTranslations } from "next-intl";
import type { CodReport } from "@/lib/api/schemas/analytics";
import { byStatusSumsToTotal, codByStatus, codFigures, ratePercent, RATE_KEYS } from "@/lib/cod";
import { barShare } from "@/lib/analytics";
import { COD_STATUS_TONE, type CodStatus } from "@/lib/cod-status";
import { formatCount, formatRate } from "@/lib/format/money";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BarList, BarRow } from "@/components/ui/Bar";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { ReportGrid } from "./Report";

/**
 * The cash-on-delivery funnel, over a window.
 *
 * `/analytics/cod` is `/cod/statistics` with a range on it — measured key for
 * key — so this reuses `lib/cod.ts` rather than restating a shape that already
 * has a tested reader. `codFigures()` is what keeps the scope on every figure,
 * and this payload is why that type exists: **`by_status.confirmed` is 84 and
 * `confirmed_orders` is 126 in the same response**, both correct, one describing
 * the shop now and the other counting every order ever confirmed including the
 * 256 since cancelled.
 *
 * ## The only report on this screen with no headline row, and that is the payload
 *
 * The other five lead with two to four figures a shopkeeper opens the report
 * *for*, and the rest of the payload explains them. This one is five figures of
 * one kind — a funnel — two of which are the same word at two scopes. A stat tile
 * puts those two at the same size on the same line with the least room for a
 * label of any length; `payments/CodFunnel.tsx` reached that conclusion first, on
 * this exact payload, and it is still right now that `Stat` has a scope slot: the
 * scope here is not a qualifier on a headline, it is the thing that tells two
 * rows apart. So they are scope-labelled `DataRow`s, in the same three sections
 * the payments screen renders, and the two surfaces read the same.
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
    <ReportGrid>
      <Card
        title={t("codScoped")}
        /* Only when the breakdown really accounts for every order, because that
           is the fact the sentence rests on. */
        footnote={
          byStatusSumsToTotal(report) ? (
            <Isolate>{tCod("twoCounts", { total: report.total_orders })}</Isolate>
          ) : undefined
        }
      >
        <DataList>
          {figures.map((figure) => (
            <DataRow
              key={figure.key}
              label={figureLabel(figure.key)}
              /* The scope, on every figure, never optional — `CodFigure.scope`
                 has no constructor that omits it. Two rows labelled "confirmed"
                 with nothing between them is how a reader concludes one of them
                 is broken. */
              hint={tCod(
                figure.scope === "all"
                  ? "scopeAll"
                  : figure.scope === "now"
                    ? "scopeNow"
                    : "scopeEver",
              )}
            >
              <Ltr>{formatCount(figure.value, locale)}</Ltr>
            </DataRow>
          ))}
        </DataList>
      </Card>

      <Card title={tCod("breakdown")}>
        <BarList>
          {breakdown.map((row) => (
            <BarRow
              key={row.status}
              label={
                <Badge tone={COD_STATUS_TONE[row.status as CodStatus] ?? "neutral"}>
                  {tCodStatus.has(row.status as "pending")
                    ? tCodStatus(row.status as "pending")
                    : row.status}
                </Badge>
              }
              value={<Ltr>{formatCount(row.count, locale)}</Ltr>}
              share={barShare(row.count, max)}
            />
          ))}
        </BarList>
      </Card>

      <Card
        title={tCod("rates")}
        /* Naming the denominator is the same discipline as the scope above: a
           rate whose base is unstated is a rate somebody quotes against the
           wrong population. All five divide by `total_orders` — verified. */
        footnote={<Isolate>{tCod("rateBase", { total: report.total_orders })}</Isolate>}
      >
        <DataList>
          {RATE_KEYS.map((key) => (
            <DataRow
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
            >
              {/*
               * `ratePercent` parses `"0.2104"` to the fraction 0.2104 and
               * `formatRate` renders it as 21,0 %. Deliberately not
               * `formatPercent`, which takes a coupon's `"10.00"` meaning ten
               * percent — feeding it this would print 0,2 % and look entirely
               * plausible on a screen about conversion.
               */}
              <Ltr>{formatRate(ratePercent(report.rates[key]), locale)}</Ltr>
            </DataRow>
          ))}
        </DataList>
      </Card>
    </ReportGrid>
  );
}
