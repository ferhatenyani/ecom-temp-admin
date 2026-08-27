import type { ReactNode } from "react";

/**
 * The bar mark, and it is the only chart in the panel. See DESIGN.md §3.2.
 *
 * ## Why this is a `ui` file rather than an edit to `components/primitives/Bar.tsx`
 *
 * The primitive is on the retired type and colour scale — `text-body`,
 * `text-label`, `text-caption`, `list-row` — and it is retired-adjacent rather
 * than retired: teardown owns deleting it. Its *reasoning* survives intact and is
 * restated below, because none of it was about the tokens.
 *
 * ## `.bar-track` and `.bar-fill` keep their class names on purpose
 *
 * `e2e/analytics.spec.ts:437` queries `.bar-fill` by raw class and measures the
 * rendered rectangle against its track's, which is the suite's only proof that an
 * RTL bar grows from the right rather than merely claiming to. A rename would
 * take that assertion with it, and an assertion about bidi geometry cannot be
 * rewritten as an assertion about markup — that is the whole reason it is written
 * the way it is. The classes were retuned to the `ui` tokens in `globals.css`
 * instead; the hue is ink, not accent, for the reason recorded there.
 *
 * ## §3.5's "no coloured bars" is about decorative accent bars, not data marks
 *
 * That rule and the §8 checklist line under it both read as absolutes, and both
 * are enforced by `check-design.sh` as `border-{l,r,s,e}-{2,4,8}` — a **border**
 * on the leading edge of a row or card, standing in for a status the row should
 * have spelled out. A data mark whose length *is* the datum is a different
 * object, and DESIGN.md §3.2 has specified one since the redesign began. §3.5 now
 * says "decorative" so the two rules cannot be read as contradicting each other;
 * the amendment records why.
 *
 * ## The bar carries no information of its own
 *
 * It is `aria-hidden` and its value is printed as text on the same row, always —
 * so the chart has its table view built in rather than bolted beside it, and a
 * reader who cannot see a length loses nothing. That is also why there is no
 * tooltip: there would be nothing for it to reveal. Identity comes from the
 * label — a name, or a `Badge` carrying the status word — and never from the
 * colour.
 *
 * ## Label and value never share a line with the bar
 *
 * The two things that vary in width are on the top line together and the bar
 * spans the full width beneath. A row whose bar competes for width with its label
 * is the row the shipping branch shipped, where a long label at 390px rendered on
 * top of the figure beside it.
 *
 * The width is an inline `inlineSize` rather than a Tailwind arbitrary value: the
 * bracket syntax is exactly what `scripts/check-design.sh` fails on, and it
 * cannot express a runtime percentage anyway. `barShare()` computes it, clamps it
 * to 0–1 and refuses `NaN` — an invalid width reaches the DOM as "ignore this
 * declaration" and renders **full length**, which would silently turn a broken
 * figure into a maximum one.
 */

/**
 * The list a set of bars lives in — a real `<ul>`, because that is what it is.
 *
 * Not a `DataList`: a `<dl>`'s `<dt>` takes a string, and half the labels on this
 * screen are a `Badge`. Same shape and same reasoning as the COD funnel's status
 * breakdown, which is where it came from.
 */
export function BarList({ children }: { children: ReactNode }) {
  return <ul className="flex min-w-0 flex-col">{children}</ul>;
}

export function BarRow({
  label,
  value,
  share,
  note,
  /**
   * A row that is not a peer of the others — the wilaya report's `unattributed`,
   * which is the largest row in the set and is not a place.
   *
   * Never the only signal: a muted row is always named and always carries its
   * reason on the line underneath.
   */
  muted = false,
}: {
  label: ReactNode;
  /** The value as text, wrapped by the caller — `Ltr` for a figure, per §6. */
  value: ReactNode;
  /**
   * 0–1 from `barShare()`, or **`null` for a set with no ranking in it.**
   *
   * `hasRankingSignal()` is what decides: a window holding two orders returns two
   * best sellers of one unit each, where bars draw two identical full lengths and
   * imply a ranking that does not exist. `null` drops the mark and leaves the row
   * as a named count, which states exactly what is known.
   *
   * It has to be `null` rather than `0`, because `.bar-fill` carries a 2px floor
   * so that a row with one order is never an empty track — ten rows at share 0
   * would draw ten identical nubs and read as a chart that failed rather than as
   * one that was correctly not drawn.
   */
  share: number | null;
  note?: ReactNode;
  muted?: boolean;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5 border-b border-ui-line py-2.5 last:border-b-0">
      {/* `flex-wrap` and `ms-auto` are `DataRow`'s lesson: a value squeezed into
          a gap too small for it is clipped rather than wrapped, and a clipped
          amount is a wrong number. The value drops to its own line instead and
          stays at the inline end of whichever line it lands on. */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 text-ui-compact text-ui-fg">{label}</span>
        <span className="ms-auto shrink-0 text-ui-compact text-ui-fg">{value}</span>
      </div>

      {share === null ? null : (
        <div aria-hidden="true" className="bar-track w-full overflow-hidden">
          {/*
            **Zero draws no mark at all**, and the 2px floor on `.bar-fill` is why
            this is a condition rather than a width of 0%. That floor exists so a
            row holding one order out of 379 is not an empty track — at 0.4 % it
            rounds away — and it cannot tell "almost nothing" from "nothing":
            `returning: 0` on the customers report rendered a 2px nub that says
            *a little*, which is a wrong number in the one place a bar is allowed
            to carry one. Seen on the Arabic capture at 768.
          */}
          {share > 0 ? (
            <div
              className={`bar-fill ${muted ? "bar-fill-muted" : ""}`}
              style={{ inlineSize: `${(share * 100).toFixed(2)}%` }}
            />
          ) : null}
        </div>
      )}

      {note ? <span className="text-ui-caption text-ui-subtle">{note}</span> : null}
    </li>
  );
}
