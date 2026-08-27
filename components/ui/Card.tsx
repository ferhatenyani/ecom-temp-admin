import type { ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/primitives/Icon";

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

/**
 * One label/value row.
 *
 * ## The label and the value share a line only while they both fit
 *
 * **A truncated amount is a wrong number, not merely an ugly one**, and this row
 * used to produce them. The old geometry was `flex items-baseline
 * justify-between gap-4` with `shrink-0` on the label and `min-w-0` on the
 * value, which is three instructions that add up to *the label always wins*: the
 * label refuses to give up a pixel, the value is allowed to shrink below its own
 * content, and `Card`'s `overflow-hidden` then clips whatever hangs out.
 *
 * Measured on the customer detail at the 340px floor, in French: the statistics
 * card's label "Chiffre d'affaires terminé" is ~165px of a ~274px row, and the
 * money beside it rendered as **"7 100,0"** where the value is `7 100,00 DA` and
 * **"3 550,00 D"** where it is `3 550,00 DA`. Nothing errors, nothing overflows
 * the document — `formatMoney` joins its groups with U+202F NARROW NO-BREAK
 * SPACE, so the amount is one unbreakable run that cannot wrap and is simply cut
 * off inside the row. The capture harness's overflow assertion is on the
 * *document*, so it passed on every one of those frames.
 *
 * Three changes, and each closes one of the three instructions above:
 *
 *   `flex-wrap`          the value drops to its own line rather than being
 *                        squeezed into a gap too small for it. `ms-auto` keeps
 *                        it at the inline end on whichever line it lands on,
 *                        which is why `justify-between` is gone — an auto margin
 *                        does the same job and still works on a line of one.
 *   label `min-w-0`      a label longer than the row wraps instead of setting
 *                        the row's minimum width and pushing the value out.
 *   value `break-words`  the last resort for a run with no break opportunity in
 *                        it at all. A broken number is still readable; a clipped
 *                        one is a different number.
 *
 * Fixed here rather than on the screen that found it, because the shape is every
 * detail screen's aside: the order and product details stack eleven of these
 * between them and inherit the repair.
 */
export function DataRow({
  label,
  /**
   * A second line under the label, saying what this figure counts.
   *
   * **Added on the payments branch, and it is the slot a scope needs.** The COD
   * report puts `by_status.confirmed` (84) and `confirmed_orders` (126) in one
   * payload; both are correct and they answer different questions, so
   * `lib/cod.ts` makes `CodFigure.scope` non-optional and there has to be
   * somewhere to render it. `label` is a `string` and cannot hold two lines, and
   * concatenating the scope into it produces "Actuellement confirmées · état
   * actuel" — one run of text where the eye wants a label and a qualifier.
   *
   * It lives on the `<dt>` rather than beside the value because the scope
   * qualifies the *question*, not the answer. `items-baseline` aligns the value
   * with the label's first line, so a row with a hint and a row without still
   * read down the card as one column of figures.
   *
   * Optional, and most rows are right not to pass it: a hint that restates the
   * label is noise. `analytics/CodView.tsx` renders the same five figures and
   * inherits this.
   */
  hint,
  /**
   * Label above the value rather than beside it, for prose.
   *
   * A customer note is a sentence and a wilaya name is a word; the same row
   * geometry cannot serve both. Side by side, a two-line note pushes its own
   * label off the baseline it shares with every other row on the card.
   *
   * Still worth setting even with the wrapping above: `stacked` says the value
   * *starts* under its label, which is what prose wants. Wrapping is the
   * fallback for a value that turned out not to fit, and it stays end-aligned.
   */
  stacked = false,
  children,
}: {
  label: string;
  hint?: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`border-b border-ui-line py-2 last:border-b-0 ${
        stacked ? "flex flex-col gap-1" : "flex flex-wrap items-baseline gap-x-4 gap-y-0.5"
      }`}
    >
      <dt className="min-w-0 text-ui-label text-ui-muted">
        {label}
        {hint ? <span className="block text-ui-caption text-ui-subtle">{hint}</span> : null}
      </dt>
      <dd
        className={`min-w-0 text-ui-compact text-ui-fg ${
          stacked ? "" : "ms-auto text-end break-words"
        }`}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * A list of destinations inside a card — the third row kind, beside `DataRow`.
 *
 * Built on the content branch for the section hub, which is six links to six
 * unrelated screens. Neither existing shape fits one:
 *
 *   `DataRow` is a `<dt>`/`<dd>` pair. A destination is not a value of a
 *   property, and putting an anchor inside a `<dd>` says it is.
 *   `Stat` is a figure. The count beside "Bannières" is a hint that helps
 *   somebody decide whether to go in, not a metric — rendered at
 *   `--text-display` it would claim to be the reason the screen exists.
 *
 * So: a real `<ul>` of real anchors, the whole row clickable, the count as
 * secondary text and a chevron that flips with the reader. This is the shape a
 * settings index and a transfer index both want next, which is why it is here
 * rather than in `content/`.
 *
 * **The count is optional and the chevron is not.** A destination with nothing
 * to count — the homepage is one document, the menus are two — renders without
 * it rather than with a `0` or a `1` that means nothing. What must never vary is
 * whether the row looks like a link: every row here goes somewhere.
 */
export function NavList({ children }: { children: ReactNode }) {
  return <ul className="flex min-w-0 flex-col">{children}</ul>;
}

export function NavRow({
  href,
  label,
  /** One line under the label, saying what is behind the link. */
  description,
  /** Rendered at the inline end. A count, a badge — never a control. */
  meta,
  icon,
}: {
  href: string;
  label: string;
  description?: string;
  meta?: ReactNode;
  icon?: IconName;
}) {
  return (
    <li className="border-b border-ui-line last:border-b-0">
      <Link
        href={href}
        className="ui-interactive ui-ring ui-hover-fill -mx-2 flex min-h-11 items-center gap-3 rounded-ui-md px-2 py-2.5"
      >
        {/* `Icon` is `aria-hidden` in the primitive — the row's accessible name
            is the label, and an icon repeating it is noise to a screen reader. */}
        {icon ? <Icon name={icon} className="size-4 shrink-0 text-ui-subtle" /> : null}

        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui-body font-medium text-ui-fg">{label}</span>
          {description ? (
            <span className="mt-0.5 block text-ui-label text-ui-muted">{description}</span>
          ) : null}
        </span>

        {meta ? <span className="shrink-0 text-ui-caption text-ui-muted">{meta}</span> : null}
        <Icon name="chevron" flipInRtl className="size-4 shrink-0 text-ui-subtle" />
      </Link>
    </li>
  );
}
