"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { OverviewReport } from "@/lib/api/schemas/analytics";
import {
  dashboardCards,
  isEmptyWindow,
  MAX_CUSTOM_DAYS,
  rangeToParams,
  rateFraction,
  type CustomRangeProblem,
  type DashboardCard,
  type RangeQuery,
} from "@/lib/analytics";
import { SHOP_CURRENCY, formatCount, formatMoney, formatRate } from "@/lib/format/money";
import { formatDate } from "@/lib/format/date";
import { PageBody, PageHeader } from "@/components/ui/PageHeader";
import { RangeControl } from "@/components/ui/RangeControl";
import { Stat, StatGroup } from "@/components/ui/Stat";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Isolate, Ltr } from "@/components/primitives/Ltr";

/**
 * The dashboard: seven figures over one window, each one either the way into the
 * screen behind it or a number that says what it counts and stops there.
 *
 * ## Full width capped 1440, not `max-w-3xl`
 *
 * §2.3 puts analytics at full width capped 1440 (`PageBody width="wide"`), and
 * §0 retires `max-w-3xl` by name. Seven cards then go 1-up at the 340px floor,
 * 2-up at `sm` and 4-up at `lg`, with the lead card double-width so the grid is
 * two full rows rather than two rows with a hole in the second.
 *
 * ## Two card sets, and a second gate inside each
 *
 * `dashboardCards()` chooses the **set** by `canSeeMoney`, so neither set has
 * holes: without money, orders placed leads and completed and new customers take
 * the slots the money cards had. That choice is a unit test rather than a
 * screenshot.
 *
 * Inside the set, each card's *link* is chosen by the reader's capabilities. A
 * Support Agent is 403 on `/orders` and `/inventory` — measured — which is four
 * of their seven cards, and those render with the figure and no link. Never a
 * link to a refusal, never a disabled link.
 *
 * ## No chart, and no delta
 *
 * The payload carries **no comparison period and no series**: nothing named
 * `previous`, `change` or `history` on any of the seven reports, so a card
 * reading "+12 % vs last month" would be the panel inventing one. The only
 * distribution here is `orders.by_status`, which is exactly what
 * `/analytics?view=orders` draws — so drawing it again would be a second copy of
 * one report on the screen whose job is to hand people off to it.
 *
 * ## No stale marker, and an "as of" line instead
 *
 * §3.7 as amended on the customers branch: the marker is required where the data
 * can age past its own fetch, and this is a Server Component with no writes,
 * nothing polling and no refresh control — the sentence §3.7 points at. This
 * screen used to render `StaleBanner` behind `!navigator.onLine`, which is an
 * offline marker on a page with nothing to disable.
 *
 * What is true and worth saying is different: **the report sits behind a 60-second
 * server cache** — two live requests six seconds apart returned the identical
 * `generated_at` — so the figures can legitimately predate the navigation, and
 * the API publishes both the stamp and the TTL. That is a timestamp, not a
 * warning state, so it is a plain line under the title.
 */
/**
 * Why the report could not be read, in the two forms a refusal can take.
 *
 * `problem` is one this panel mirrors locally and therefore renders in the
 * reader's own language; `sentence` is the API's own text, kept for a refusal the
 * mirror has no wording for. Exactly one of them is ever set — see `page.tsx`.
 *
 * The split exists because "surface the API's own message" protects the
 * *information* and not the provider's English: a French shop is not helped by
 * "Required when range is custom." when `analytics.errorMissing` says the same
 * thing in the language the rest of the screen is written in.
 */
export type DashboardFailure = {
  problem: CustomRangeProblem;
  sentence: string | null;
};

export function DashboardScreen({
  locale,
  range,
  report,
  canMoney,
  capabilities,
  generatedAt,
  cacheTtl,
  failure,
}: {
  locale: string;
  range: RangeQuery;
  report: OverviewReport | null;
  canMoney: boolean;
  /** `me.capabilities` — which cards are links. */
  capabilities: readonly string[];
  generatedAt: string | null;
  /** `meta.cache_ttl`, in seconds. Why the stamp may be behind the navigation. */
  cacheTtl: number | null;
  /** Why the request was refused, if it was. See `page.tsx`. */
  failure: DashboardFailure | null;
}) {
  const t = useTranslations("analytics");
  const router = useRouter();

  const setRange = useCallback(
    (next: RangeQuery) => {
      const search = rangeToParams(next).toString();
      router.push(`/${locale}/dashboard${search === "" ? "" : `?${search}`}`);
    },
    [locale, router],
  );

  const cards =
    report === null ? [] : dashboardCards(report, { money: canMoney, capabilities, range });

  /* A card with a capability and no link is one this reader is refused; a card
     with neither never had a destination. The footnotes say each in its own
     words, and only when it is on screen. */
  const anyRefused = cards.some((card) => card.requires !== undefined && card.href === undefined);

  /*
   * The refusal in the reader's own language where the panel has one, and the
   * API's own words only where it does not — the same rule `unavailableLines()`
   * follows for the three lines the revenue report reports as unavailable. These
   * three sentences are already written: the range control shows them while
   * somebody is still typing, and they are the same three refusals.
   */
  const detail =
    failure === null
      ? undefined
      : failure.problem === "missing"
        ? t("errorMissing")
        : failure.problem === "reversed"
          ? t("errorReversed")
          : failure.problem === "too-long"
            ? t("errorTooLong", { max: MAX_CUSTOM_DAYS })
            : (failure.sentence ?? undefined);

  const render = (card: DashboardCard): string => {
    if (card.kind === "money") {
      return formatMoney(card.value, report?.revenue?.currency ?? SHOP_CURRENCY, locale);
    }
    if (card.kind === "rate") return formatRate(rateFraction(card.value), locale);
    return formatCount(Number(card.value), locale);
  };

  /*
   * An absolute stamp rather than `formatWhen`'s relative one, and the reason is
   * mechanical: this component renders on the server and hydrates on the client,
   * and a relative time computed from `new Date()` on both sides differs the
   * moment a rounding boundary falls between them — a hydration mismatch React
   * logs as an error, which the capture harness fails on. A date has no clock in
   * it. `Isolate`, never `Ltr`: `formatDate` is `Intl`-formatted and the Arabic
   * output carries U+200F marks that a forced direction would reorder.
   */
  const asOf =
    generatedAt === null ? undefined : (
      <Isolate>
        {cacheTtl === null
          ? t("asOf", { time: formatDate(generatedAt, locale) })
          : t("asOfCached", { time: formatDate(generatedAt, locale), seconds: cacheTtl })}
      </Isolate>
    );

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("dashboardTitle")}
        subtitle={asOf}
        toolbar={
          <RangeControl
            locale={locale}
            range={range}
            applied={report?.range ?? null}
            onChange={setRange}
          />
        }
      />

      <PageBody width="wide">
        {report === null ? (
          /* The API's own sentence and a retry — `router.refresh()` re-runs the
             Server Component against the same URL, which is the only thing that
             can help here. The old screen discarded the status, the code and the
             message inside a `.catch(() => null)`. */
          <ErrorState
            message={t("loadFailed")}
            detail={detail}
            onRetry={() => router.refresh()}
          />
        ) : (
          <div className="flex flex-col gap-6">
            {/*
              A quiet window is said, not implied. `range=today` on a shop with
              no orders today answers 200 with every figure zero — measured — so
              without this the screen is seven zeros and reads as a report that
              failed.

              The cards stay underneath it, and that is the point rather than an
              oversight: `inventory.low_stock` is **not** range-scoped — 3 across
              a 90× window — so it is a real figure inside an empty window, and
              an empty state that replaced the grid would hide the one number
              that still means something.

              §3.7's distinction, applied: the window is the filter here, so this
              is *no results for this filter* and offers to widen it — up to the
              widest preset the API has. On `90d` there is nothing wider, so the
              action is not rendered rather than rendered doing nothing.
            */}
            {isEmptyWindow(report.orders.placed) ? (
              <EmptyState
                icon="clock"
                message={t("emptyWindow")}
                detail={t("emptyWindowDetail")}
                action={
                  range.preset === "90d"
                    ? undefined
                    : {
                        label: t("emptyWiden"),
                        onClick: () => setRange({ preset: "90d", from: "", to: "" }),
                      }
                }
              />
            ) : null}

            <StatGroup label={t("cardsLabel")}>
              {cards.map((card) => (
                <Stat
                  key={card.key}
                  testId={`card-${card.key}`}
                  label={t(`card.${card.key}`)}
                  /* Never a bare figure beside a figure it does not divide into
                     — `net` against `collected`, 901 placed against 56
                     completed, 9 accounts against 209 guest orders. */
                  scope={t(`cardScope.${card.key}`)}
                  href={card.href === undefined ? undefined : `/${locale}${card.href}`}
                  wide={card.hero}
                >
                  {/* Tabular, so a column of figures lines up down the grid. */}
                  <Ltr>{render(card)}</Ltr>
                </Stat>
              ))}
            </StatGroup>

            {/*
              Three lines at most, and never four.

              A first draft explained `awaiting`'s missing link down here, which
              put two footnotes answering the same question — *why has this card
              no chevron?* — under one grid. A caveat belongs on the card that
              needs it, where the reader is already looking: `low_stock` carries
              its exception in its own scope line and `awaiting` now does too. The
              refused-list line stays a footnote because it is about the reader
              rather than about one card, and it renders only for the reader it
              concerns.
            */}
            <div className="flex flex-col gap-2 text-ui-label text-ui-subtle">
              {/* Not "every figure is on the displayed period", which this line
                  used to claim and which is false for low stock. */}
              <p>
                <Isolate>{t("dashboardNote", { orders: report.orders.placed })}</Isolate>
              </p>
              <p>{t("noteRange")}</p>
              {anyRefused ? <p>{t("noteForbidden")}</p> : null}
            </div>
          </div>
        )}
      </PageBody>
    </div>
  );
}
