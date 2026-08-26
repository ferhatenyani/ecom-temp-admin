import { getTranslations } from "next-intl/server";
import type { CodStatistics } from "@/lib/api/schemas/payment";
import { byStatusSumsToTotal, codByStatus, codFigures, ratePercent, RATE_KEYS } from "@/lib/cod";
import { COD_STATUS_TONE, type CodStatus } from "@/lib/cod-status";
import { moneyLocale } from "@/lib/format/money";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Isolate, Ltr } from "@/components/primitives/Ltr";

/**
 * The cash-on-delivery report, below the ledger.
 *
 * ## Why it is on this page at all, and why it is not in an aside
 *
 * `/payments` is `ac_manage_payments` and `/cod/statistics` is
 * `ac_view_analytics`, and those are not the same readership: measured
 * 2026-08-26, a Manager is **403** on all three payments routes and **200** on
 * this one. So a Manager who reaches this URL sees a forbidden box where the
 * ledger was and then the whole report — refusing them a figure they are entitled
 * to in order to keep one screen tidy would be the panel inventing a rule the API
 * does not have.
 *
 * Which is also why it is a full-width block underneath rather than a 360px
 * aside: for that reader the report *is* the page, and an aside would squeeze it
 * into a third of the screen for the benefit of a ledger they cannot see. Three
 * cards in a grid — 1-up at the 340px floor, 2-up at `md`, 3-up at `xl`.
 *
 * ## Scope-labelled rows, and deliberately not `StatGroup`/`Stat`
 *
 * This payload is the sharpest instance in the whole API of two numbers that look
 * like the same number: **`by_status.confirmed` is 84 while `confirmed_orders` is
 * 126, in one response, and both are correct.** The first is the shop *now* and
 * sums with its four siblings exactly to `total_orders`; the second counts every
 * order ever confirmed and is what `rates.confirmation` divides by.
 *
 * A 4-up stat block puts those two at the same size on the same line with the
 * least room for a label of any length, and has no slot at all for the line that
 * tells them apart. So every figure is a `DataRow` carrying its own scope —
 * `lib/cod.ts` makes `CodFigure.scope` non-optional so nothing can print one
 * without it, and `DataRow.hint` is the slot, added for this and inherited by
 * `analytics/CodView.tsx`. It is the customers-statistics decision (DECISIONS.md
 * §5) arriving in the place it bites hardest.
 *
 * ## No stale marker here
 *
 * §3.7's amendment: a screen that cannot hold data older than its own last fetch
 * says so in its own docblock, and this is the sentence it points at. This is a
 * Server Component with no writes, nothing polling and no refresh control — what
 * is on screen is exactly as old as the navigation that fetched it. The ledger
 * above holds a client cache **and** writes, so it carries the marker; a second
 * one here would be true and useless.
 */
export async function CodFunnel({
  statistics,
  locale,
}: {
  statistics: CodStatistics;
  locale: string;
}) {
  const t = await getTranslations("cod");
  const tStatus = await getTranslations("codStatus");

  const figures = codFigures(statistics);
  const breakdown = codByStatus(statistics);

  /* One formatter for the block. `moneyLocale` is the panel's single source for
     "which BCP-47 tag does this locale actually mean" — `fr` alone renders `DZD`
     where `fr-DZ` renders `DA`, and Arabic is pinned to Latin digits because
     Algeria writes them. Counts want the same tag as the money beside them. */
  const number = new Intl.NumberFormat(moneyLocale(locale));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Card
        title={t("statistics")}
        /* Only when the breakdown really accounts for every order, because that
           is the fact the sentence rests on. `byStatusSumsToTotal` is what makes
           the two confirmed counts explicable rather than contradictory. */
        footnote={
          byStatusSumsToTotal(statistics) ? (
            <Isolate>{t("twoCounts", { total: statistics.total_orders })}</Isolate>
          ) : undefined
        }
      >
        <DataList>
          {figures.map((figure) => (
            <DataRow
              key={figure.key}
              label={t(
                figure.key === "total_orders"
                  ? "statTotal"
                  : figure.key === "current_confirmed"
                    ? "statCurrentConfirmed"
                    : figure.key === "ever_confirmed"
                      ? "statEverConfirmed"
                      : figure.key === "delivered_orders"
                        ? "statDelivered"
                        : "statReturned",
              )}
              /* The scope, on every figure, never optional. Two numbers labelled
                 "confirmed" with no scope between them is how a reader concludes
                 one of them is broken. */
              hint={t(
                figure.scope === "all"
                  ? "scopeAll"
                  : figure.scope === "now"
                    ? "scopeNow"
                    : "scopeEver",
              )}
            >
              {/* A count the shop assigned — `Ltr`, and tabular, so five figures
                  line up down the card. */}
              <Ltr>{number.format(figure.value)}</Ltr>
            </DataRow>
          ))}
        </DataList>
      </Card>

      <Card title={t("breakdown")}>
        {/*
          A `<ul>` rather than a `DataList`, because the label here is a *badge*
          and `DataRow`'s `<dt>` takes a string. Same shape and same reasoning as
          the customer report's status breakdown, which is where it came from.
          Colour never carries the meaning alone — the badge holds the word.
        */}
        <ul className="flex flex-col">
          {breakdown.map(({ status, count }) => (
            <li
              key={status}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ui-line py-2 last:border-b-0"
            >
              <Badge tone={COD_STATUS_TONE[status as CodStatus] ?? "neutral"}>
                {tStatus.has(status as "pending") ? tStatus(status as "pending") : status}
              </Badge>
              <Ltr className="ms-auto text-ui-compact text-ui-fg">
                {number.format(count)}
              </Ltr>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title={t("rates")}
        /* Naming the denominator is the same discipline as the scope above: a
           rate whose base is unstated is a rate somebody quotes against the wrong
           population. All five divide by `total_orders` — verified. */
        footnote={<Isolate>{t("rateBase", { total: statistics.total_orders })}</Isolate>}
      >
        <DataList>
          {RATE_KEYS.map((key) => {
            const value = ratePercent(statistics.rates[key]);
            return (
              <DataRow
                key={key}
                label={t(
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
                {/* A rate that does not parse renders as an em dash rather than
                    as `NaN %` — see `ratePercent`. */}
                {value === null ? (
                  <span className="text-ui-subtle">—</span>
                ) : (
                  <Ltr>
                    {new Intl.NumberFormat(moneyLocale(locale), {
                      style: "percent",
                      maximumFractionDigits: 1,
                    }).format(value)}
                  </Ltr>
                )}
              </DataRow>
            );
          })}
        </DataList>
      </Card>
    </div>
  );
}
