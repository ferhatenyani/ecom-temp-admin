import type { ReactNode } from "react";

/**
 * The card, and the label/value list that lives inside one. See DESIGN.md §1.6
 * and §2.3.
 *
 * `.ui-card` in globals.css is the *surface* — border, radius, the almost-nothing
 * shadow. This is the **block**: that surface plus the heading, the padding and
 * the footnote a section needs, written once because the detail screens in this
 * run stack ten of them each and a hand-rolled `<section className="ui-card p-5">`
 * with an `<h2>` inside it is how twenty screens start disagreeing about card
 * padding.
 *
 * It is deliberately not `Form.tsx`'s `Section`, which is a different thing:
 * that one is a *bordered group inside an overlay*, 12px of padding and a
 * `--text-subheading` title, sized so seven of them stack under a Drawer's own
 * title without competing with it. A card on a page is the page's structure and
 * takes `--text-heading` per §3.4, and 20px of padding per §1.4 (16px below `sm`).
 *
 * **Nested cards are forbidden** (§1.6). A card that needs a card inside it is a
 * card whose child should be a bordered section — which is what `Section` is.
 */
export function Card({
  title,
  description,
  /** A measured caveat under the block — why an editor is unavailable, a scope. */
  footnote,
  /** A control beside the heading. One, and never the screen's primary action. */
  actions,
  /**
   * Drops the body's inline padding so a table can reach the card's own edges.
   *
   * The heading and the footnote keep theirs, so a flush card still reads as a
   * card with a title rather than as a table someone forgot to label.
   */
  flush = false,
  children,
}: {
  title?: string;
  description?: string;
  footnote?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  /* 20px at `sm` and up, 16px below — DESIGN.md §1.4's density targets. Declared
     once and applied per region, so the flush body can opt out of the inline half
     without also losing the block half. */
  const inline = "px-4 sm:px-5";

  return (
    <section className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5">
      {title ? (
        <div className={`${inline} flex items-start gap-3`}>
          <div className="min-w-0 flex-1">
            <h2 className="text-ui-heading text-ui-fg">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-ui-label text-ui-muted">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}

      <div className={flush ? "min-w-0" : `${inline} min-w-0`}>{children}</div>

      {footnote ? (
        <p className={`${inline} text-ui-label text-ui-subtle`}>{footnote}</p>
      ) : null}
    </section>
  );
}

/**
 * A label/value list — a real `<dl>`, because that is what it is.
 *
 * This is `ProductPeek`'s `Row` promoted out of the one screen that had it. The
 * aside column of a detail screen is almost entirely this shape: a fixed set of
 * labels against values a person glances at, and the *only* thing that varies
 * between screens is which labels. Twenty screens hand-rolling a `<div>` with a
 * `<dt>` and a `<dd>` in it is twenty chances to lose the `min-w-0` that keeps a
 * long value from blowing the 360px column out.
 */
export function DataList({ children }: { children: ReactNode }) {
  return <dl className="flex min-w-0 flex-col">{children}</dl>;
}

export function DataRow({
  label,
  /**
   * Label above the value rather than beside it, for prose.
   *
   * A customer note is a sentence and a wilaya name is a word; the same row
   * geometry cannot serve both. Side by side, a two-line note pushes its own
   * label off the baseline it shares with every other row on the card.
   */
  stacked = false,
  children,
}: {
  label: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`border-b border-ui-line py-2 last:border-b-0 ${
        stacked ? "flex flex-col gap-1" : "flex items-baseline justify-between gap-4"
      }`}
    >
      <dt className="shrink-0 text-ui-label text-ui-muted">{label}</dt>
      <dd
        className={`min-w-0 text-ui-compact text-ui-fg ${stacked ? "" : "text-end"}`}
      >
        {children}
      </dd>
    </div>
  );
}
