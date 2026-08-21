import type { ReactNode } from "react";

/**
 * The bar row — the only chart mark in the panel, and a list row before it is a
 * chart.
 *
 * Label and value share the top line, the bar spans the full width beneath.
 * That is not a stylistic choice: a row whose bar competes for width with its
 * label is the row the shipping branch shipped, where a long action label at
 * 390px rendered **on top of** the money figure beside it. `shots.mjs` asserts
 * that geometrically now, and this layout cannot reproduce it — the two things
 * that vary in width are never on the same line as each other.
 *
 * **The bar is `aria-hidden` and carries no information of its own.** Its value
 * is printed as text on the same row, always, so the chart has its table view
 * built in rather than bolted beside it, and a reader who cannot see a length
 * loses nothing. That is also why there is no tooltip: there is nothing a
 * tooltip could reveal.
 *
 * The width is an inline `inlineSize`, not a Tailwind arbitrary value — the
 * bracket syntax is exactly what `scripts/check-design.sh` fails on, and it
 * cannot express a runtime percentage anyway. `barShare()` computes it, clamps
 * it, and refuses `NaN`: an invalid width reaches the DOM as "ignore this
 * declaration" and renders **full length**, which would silently turn a broken
 * figure into a maximum one.
 */
export function BarRow({
  label,
  value,
  share,
  note,
  /**
   * A row that is not a peer of the others — the wilaya report's `unattributed`,
   * which is the largest row and is not a place. Never the only signal: a muted
   * row is always named and carries its reason.
   */
  muted = false,
}: {
  label: ReactNode;
  value: ReactNode;
  /** 0–1, from `barShare()`. */
  share: number;
  note?: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="list-row flex min-h-11 w-full flex-col gap-1.5 px-4 py-3">
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 text-body text-label">{label}</span>
        <span className="shrink-0 text-body text-label">{value}</span>
      </div>

      <div aria-hidden="true" className="bar-track w-full overflow-hidden">
        <div
          className={`bar-fill ${muted ? "bar-fill-muted" : ""}`}
          style={{ inlineSize: `${(share * 100).toFixed(2)}%` }}
        />
      </div>

      {note ? <span className="text-caption text-label-tertiary">{note}</span> : null}
    </div>
  );
}
