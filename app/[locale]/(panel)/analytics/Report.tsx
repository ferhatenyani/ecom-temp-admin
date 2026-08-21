"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { unavailableLines, type UnavailableKey } from "@/lib/analytics";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { Icon } from "@/components/primitives/Icon";

/**
 * The three pieces every report is built out of.
 */

/**
 * A figure with the population it describes underneath it.
 *
 * `scope` is a required prop for the same reason `CodFigure.scope` is a required
 * field: this screen puts 844 beside 289 and 719 700 beside 145 150, and a reader
 * given either pair unlabelled concludes one of them is broken. The scope line is
 * not a footnote — it is what makes the number true.
 */
export function FigureRow({
  label,
  scope,
  value,
}: {
  label: string;
  scope: string;
  value: ReactNode;
}) {
  return (
    <ListRow>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body text-label-secondary">{label}</span>
        <span className="text-caption text-label-tertiary">{scope}</span>
      </span>
      {/*
        `shrink-0` and a separate line for the label: `Button` set no width on
        the shipping branch and a long label at 390px rendered on top of the money
        figure beside it. A figure never shares its line with anything that can
        grow.
      */}
      <span className="ms-auto shrink-0 text-title-3 text-label">{value}</span>
    </ListRow>
  );
}

/**
 * What the API reports as unavailable rather than as zero.
 *
 * **The payload's `unavailable` is an object of English sentences**, not the list
 * of names the specification describes — one full paragraph per key, explaining
 * why the figure cannot be computed honestly. Rendering those raw puts English
 * prose at the foot of an Arabic sheet, which is the facet `scope_note` problem
 * in a second place.
 *
 * So a key the panel has wording for renders the panel's own line, in the page's
 * language. A key it does not renders the API's sentence, visibly attributed —
 * marked `lang="en"` and `dir="ltr"` so a screen reader switches voice and the
 * bidi algorithm does not lay an English paragraph out from the right. A future
 * fourth key therefore degrades to "readable but foreign" rather than to nothing.
 *
 * Never `0,00 DA`. A zero that means "we cannot know" is a number someone will
 * put in a report.
 */
export function Unavailable({ reasons }: { reasons: Record<string, string> }) {
  const t = useTranslations("analytics");
  const lines = unavailableLines(reasons);
  if (lines.length === 0) return null;

  return (
    <ListGroup title={t("unavailableTitle")} footnote={t("unavailableNote")}>
      {lines.map((line) => (
        <ListRow key={line.key} className="items-start">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-label-tertiary" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body text-label">
              {line.known ? t(`unavailable.${line.key as UnavailableKey}`) : line.key}
            </span>
            {line.known ? (
              <span className="text-caption text-label-secondary">
                {t(`unavailableWhy.${line.key as UnavailableKey}`)}
              </span>
            ) : (
              <span lang="en" dir="ltr" className="text-caption text-label-secondary">
                {line.note}
              </span>
            )}
          </span>
        </ListRow>
      ))}
    </ListGroup>
  );
}

/**
 * A window that holds nothing.
 *
 * **Measured: `range=today` on a shop with no orders today answers 200 with every
 * block present and every figure zero** — `best_sellers: []`, `providers: []`,
 * `by_wilaya: []`, every count `0` and every rate `"0.0000"`. Nothing is omitted,
 * so there is no missing key to detect it by and no error to render.
 *
 * Left alone, that is thirty zeros and a `0,0 %` delivery rate, which reads as a
 * report that failed rather than as a quiet Tuesday. This says which it is, and
 * distinguishes it from *no data at all* the way the empty state on every list in
 * the panel does — the window is the filter here, so the offer is to widen it.
 */
export function EmptyWindow({ onWiden }: { onWiden?: () => void }) {
  const t = useTranslations("analytics");
  return (
    <div className="rounded-lg bg-surface px-6 py-12 text-center">
      <p className="text-body text-label-secondary">{t("emptyWindow")}</p>
      {onWiden ? (
        <button
          type="button"
          onClick={onWiden}
          className="press mt-4 min-h-11 rounded-md px-4 text-headline text-accent"
        >
          {t("emptyWiden")}
        </button>
      ) : null}
    </div>
  );
}
