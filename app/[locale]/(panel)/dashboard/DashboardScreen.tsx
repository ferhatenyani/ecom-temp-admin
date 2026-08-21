"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { OverviewReport } from "@/lib/api/schemas/analytics";
import {
  dashboardCards,
  rangeToParams,
  rateFraction,
  type DashboardCard,
  type RangeQuery,
} from "@/lib/analytics";
import { SHOP_CURRENCY, formatCount, formatMoney, formatRate } from "@/lib/format/money";
import { formatWhen } from "@/lib/format/date";
import { useOnline } from "@/lib/use-online";
import { Scaffold } from "@/components/patterns/Scaffold";
import { RangeControl } from "@/components/patterns/RangeControl";
import { ErrorState, StaleBanner } from "@/components/patterns/States";
import { Icon } from "@/components/primitives/Icon";
import { Isolate, Ltr } from "@/components/primitives/Ltr";

/**
 * The dashboard: a column of cards, each one a tap target into the list behind
 * it.
 *
 * **Two card sets, chosen by `canSeeMoney`,** and the choice is made in
 * `dashboardCards()` so it is a unit test rather than a screenshot. Neither set
 * has holes: without money the grid keeps its shape and its count, leading on
 * orders placed with new customers in the slot the money cards had. A layout that
 * drops two cards and leaves the gaps tells a Support Agent the screen is broken.
 *
 * No deltas and no sparklines. The API publishes no comparison period and no time
 * series, so a card carrying "+12 % vs last month" would be the panel inventing
 * one. The `dataviz` stat-tile contract makes both optional for exactly this
 * reason.
 */
export function DashboardScreen({
  locale,
  range,
  report,
  canMoney,
  generatedAt,
}: {
  locale: string;
  range: RangeQuery;
  report: OverviewReport | null;
  canMoney: boolean;
  generatedAt: string | null;
}) {
  const t = useTranslations("analytics");
  const router = useRouter();
  const online = useOnline();

  const setRange = useCallback(
    (next: RangeQuery) => {
      const search = rangeToParams(next).toString();
      router.push(`/${locale}/dashboard${search === "" ? "" : `?${search}`}`);
    },
    [locale, router],
  );

  const cards = report === null ? [] : dashboardCards(report, canMoney);

  const render = (card: DashboardCard): string => {
    if (card.kind === "money") {
      return formatMoney(card.value, report?.revenue?.currency ?? SHOP_CURRENCY, locale);
    }
    if (card.kind === "rate") return formatRate(rateFraction(card.value), locale);
    return formatCount(Number(card.value), locale);
  };

  return (
    <Scaffold
      title={t("dashboardTitle")}
      toolbar={
        <RangeControl
          locale={locale}
          range={range}
          applied={report?.range ?? null}
          onChange={setRange}
        />
      }
    >
      {!online && generatedAt !== null ? (
        <StaleBanner time={formatWhen(generatedAt, locale)} />
      ) : null}

      <div className="mx-auto max-w-3xl px-4">
        {report === null ? (
          <ErrorState message={t("loadFailed")} />
        ) : (
          <>
            {/*
              A quiet window is said, not implied. `range=today` on a shop with
              no orders today answers 200 with every figure zero — measured —
              so without this line the screen is six zeros and reads as a report
              that failed.
            */}
            {report.orders.placed === 0 ? (
              <p className="mb-4 rounded-lg bg-surface px-4 py-3 text-body text-label-secondary">
                {t("emptyWindow")}
              </p>
            ) : null}

            <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3">
              {cards.map((card) => (
                <Link
                  key={card.key}
                  href={`/${locale}${card.href}`}
                  data-testid={`card-${card.key}`}
                  className={[
                    "press-row flex min-h-24 flex-col justify-between gap-2 rounded-lg bg-surface p-4",
                    // The hero spans the row. Exactly one per view.
                    card.hero ? "col-span-2 md:col-span-3" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-footnote text-label-secondary">
                      {t(`card.${card.key}`)}
                    </span>
                    <Icon
                      name="chevron"
                      flipInRtl
                      className="mt-0.5 size-3.5 shrink-0 text-label-tertiary"
                    />
                  </span>

                  {/*
                    The hero uses proportional figures and the tiles use tabular:
                    `tabular-nums` gives every digit the width of a zero, which
                    makes a large standalone number look loose, while a grid of
                    tiles is a column that must align. `Ltr` sets tabular by
                    default, so the hero opts out.
                  */}
                  <Ltr
                    numeric={!card.hero}
                    className={
                      card.hero
                        ? "text-large-title text-label"
                        : "text-title-2 text-label"
                    }
                  >
                    {render(card)}
                  </Ltr>

                  <span className="text-caption text-label-tertiary">
                    {t(`cardScope.${card.key}`)}
                  </span>
                </Link>
              ))}
            </div>

            <p className="mb-8 px-1 text-caption text-label-tertiary">
              <Isolate>{t("dashboardNote", { orders: report.orders.placed })}</Isolate>
            </p>
          </>
        )}
      </div>
    </Scaffold>
  );
}
