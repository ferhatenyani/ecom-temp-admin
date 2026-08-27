"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { unavailableLines, type UnavailableKey } from "@/lib/analytics";
import { Card } from "@/components/ui/Card";
import { Stat, StatGroup } from "@/components/ui/Stat";
import { Icon } from "@/components/primitives/Icon";

/**
 * The pieces all six reports are built out of.
 */

/**
 * The grid the report sections sit in — 1-up at the 340px floor, 2-up at `lg`.
 *
 * §2.3 puts analytics at full width capped 1440 and §0 retires `max-w-3xl` by
 * name; this screen was the last one still rendering a 768px stripe down the
 * middle of a 1440px monitor. Two columns is the honest maximum: a report section
 * is a list of labelled figures and a third column would put a wilaya's name
 * under 200px.
 *
 * `items-start` rather than the grid's default stretch — the sections differ
 * wildly in length (two rows of rates beside eleven best sellers), and a stretched
 * short card is a card with a large empty foot rather than a tidier row.
 */
export function ReportGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
      {children}
    </div>
  );
}

/**
 * A section that takes the whole row.
 *
 * `Card` takes no `className` on purpose — the padding and the surface are not
 * the caller's to vary — so the span goes on a wrapper. Used where a section's
 * rows carry long content that a half-width column would truncate: the best
 * sellers' product names, and the wilaya rows with their reason underneath.
 */
export function WideSection({ children }: { children: ReactNode }) {
  return <div className="min-w-0 lg:col-span-2">{children}</div>;
}

/**
 * A headline figure, and **`scope` is required.**
 *
 * `Stat.scope` is optional, correctly — a dashboard card whose scope would
 * restate its own label is right not to pass one. On this screen it is never
 * optional, and the enforcement is the point rather than the wrapper: the old
 * `FigureRow.scope` was a required prop, and that is *why* this screen never
 * shipped a bare pair in three iterations. Losing it in the migration would lose
 * the only thing standing between a reader and six arithmetic traps:
 *
 *   `orders_placed` 901 against `orders_counted` 323   only four statuses are revenue
 *   `net` against `collected`                          booked against actually taken
 *   `guest_orders` on two reports                      422 all statuses, 209 counted only
 *   `by_status.confirmed` 84 against 126               the shop now, against ever
 *   `customers` 9                                      accounts that ordered *in this window*
 *   `low_stock` 3                                      current state, and not window-scoped
 *
 * Every one of those is two correct numbers that look like one number told twice.
 * DECISIONS.md §5, §9 and §11 are the same lesson arriving three times before
 * this one.
 */
export function Figure({
  label,
  scope,
  href,
  children,
}: {
  label: string;
  /** Required. See the docblock — this is the enforcement, not decoration. */
  scope: string;
  /** Only where this reader is not refused there; never a link to a 403. */
  href?: string;
  children: ReactNode;
}) {
  return (
    <Stat label={label} scope={scope} href={href}>
      {children}
    </Stat>
  );
}

/** The headline row. Named for the screen reader, like every `StatGroup`. */
export function Figures({ children }: { children: ReactNode }) {
  const t = useTranslations("analytics");
  return <StatGroup label={t("cardsLabel")}>{children}</StatGroup>;
}

/**
 * The notes under a report — at most three lines, and each about something on
 * screen.
 *
 * The dashboard branch's restraint rule, inherited: a caveat about one figure
 * belongs on that figure's own scope line, where the reader is already looking. A
 * footnote is for something that is true of the *report* rather than of one row.
 */
export function ReportNotes({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 text-ui-label text-ui-subtle">{children}</div>
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
    <Card title={t("unavailableTitle")} footnote={t("unavailableNote")}>
      <ul className="flex min-w-0 flex-col">
        {lines.map((line) => (
          <li
            key={line.key}
            className="flex min-w-0 items-start gap-2 border-b border-ui-line py-2 last:border-b-0"
          >
            <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-ui-subtle" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-ui-compact text-ui-fg">
                {line.known ? t(`unavailable.${line.key as UnavailableKey}`) : line.key}
              </span>
              {line.known ? (
                <span className="text-ui-caption text-ui-subtle">
                  {t(`unavailableWhy.${line.key as UnavailableKey}`)}
                </span>
              ) : (
                <span lang="en" dir="ltr" className="text-ui-caption text-ui-subtle">
                  {line.note}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
