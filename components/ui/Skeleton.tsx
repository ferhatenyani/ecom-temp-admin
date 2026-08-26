import type { ReactNode } from "react";

/**
 * Loading placeholders. See DESIGN.md §3.6.
 *
 * The rule these exist to enforce: a skeleton mirrors the real component's box
 * model — same paddings, same line heights, same row count — or it is a layout
 * shift with extra steps. So every skeleton here is built from the same spacing
 * constants as the thing it stands in for, not from a number that has to be kept
 * in step by hand.
 *
 * Choosing wrongly between the three loading mechanisms is a defect: a skeleton
 * is for the *first* load of a region whose shape is known. A background refetch
 * of data already on screen keeps the data and marks it refreshing — replacing
 * live content with a skeleton is the single most common way a list flickers.
 */

/** One block. `w` and `h` are Tailwind classes so nothing is an arbitrary value. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`ui-skeleton block ${className}`} />;
}

/**
 * The wrapper every skeleton region needs: one live region announcing "loading"
 * rather than N blocks announcing nothing. `aria-busy` is on the container so a
 * screen reader is told the region is working, not that it is empty.
 */
export function SkeletonRegion({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      {children}
    </div>
  );
}

/**
 * The table skeleton.
 *
 * `cols` drives the cell count and the widths cycle through a short pattern —
 * a table of identically-wide grey bars reads as a loading *graphic*, whereas
 * varied widths read as text that has not arrived.
 *
 * **The block heights are the real cells' line boxes, measured rather than
 * chosen.** A body cell is `ui-td px-3 py-3.5 text-ui-compact`: a 1.25rem line
 * box inside 0.875rem of padding on each side, plus the 1px row rule — 49px
 * comfortable, 41px compact. The blocks were `h-4` (1rem), which put every
 * skeleton row 4px short of the row that replaced it: invisible per row and 32px
 * of shift across the eight this renders. `h-5` is the same 1.25rem the text
 * occupies, so the two match at both densities and in both scripts — every value
 * here is in rem, and Arabic's 106.25% root scales the placeholder and the row
 * by the same factor.
 */
const CELL_WIDTHS = ["w-16", "w-28", "w-20", "w-24", "w-14", "w-20"] as const;

export function TableSkeleton({
  rows = 8,
  cols = 6,
  label,
  dense = false,
}: {
  rows?: number;
  cols?: number;
  label: string;
  dense?: boolean;
}) {
  return (
    <SkeletonRegion label={label} className="ui-card overflow-hidden">
      {/* The header band, matching .ui-th's surface and rule. */}
      <div className="flex items-center gap-4 border-b border-ui-line-strong bg-ui-surface-2 px-4 py-3">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className={`h-3 ${CELL_WIDTHS[i % CELL_WIDTHS.length]}`} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className={`ui-row flex items-center gap-4 px-4 ${dense ? "py-2.5" : "py-3.5"}`}
        >
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton
              key={c}
              className={`h-5 ${CELL_WIDTHS[(r + c) % CELL_WIDTHS.length]}`}
            />
          ))}
        </div>
      ))}
    </SkeletonRegion>
  );
}

/**
 * The record-list skeleton — the below-`md` counterpart. Three lines, because
 * `RecordList` renders exactly three.
 *
 * **Every measurement here comes from `RecordList` itself, not from taste.** The
 * card is `p-3` with a `gap-1` column, and its three lines are the line boxes
 * their text classes give them: `--text-subheading` at 1.375rem for the primary,
 * `--text-compact` at 1.25rem for the secondary, and `--text-compact` again for
 * the meta — the meta row's own class is `--text-label`, but both screens put a
 * `text-ui-compact` amount in it, and the taller child wins the line box. 96px a
 * card, which is what the real one measures.
 *
 * The outer gap is `gap-2` because `RecordList`'s `<ul>` is, not `gap-3`: a 4px
 * difference per record is 24px of shift across the six this renders, which is
 * the same class of defect as a mis-sized row and just as invisible per item.
 */
export function RecordListSkeleton({
  rows = 6,
  label,
}: {
  rows?: number;
  label: string;
}) {
  return (
    <SkeletonRegion label={label} className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ui-card flex flex-col gap-1 p-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5.5 w-32" />
            <Skeleton className="ms-auto h-5 w-16 rounded-ui-md" />
          </div>
          <Skeleton className="h-5 w-40" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="ms-auto h-5 w-20" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

/**
 * A card of label/value rows — the shape a detail screen's aside is made of, and
 * the one §3.6 listed and nobody had built.
 *
 * **Every measurement is `Card`'s and `DataRow`'s, not a guess.** The card is
 * `flex flex-col gap-3 py-4 sm:py-5` with `px-4 sm:px-5` inside, its heading is
 * `--text-heading` at a 1.5rem line box, and a `DataRow` is `py-2` around a
 * `--text-compact` value at 1.25rem with a 1px rule under it — 37px a row. So the
 * blocks here are `h-5` inside `py-2 border-b`, which is the row's own geometry
 * rather than a height that happens to look close.
 *
 * `rows` is the caller's, because the real cards differ: the summary card has
 * six rows and the customer card has five, and a placeholder that renders four
 * for both is a placeholder that shifts twice.
 */
export function CardSkeleton({
  rows = 4,
  label,
  /** A card with no heading — a totals block, a bare list. */
  titled = true,
}: {
  rows?: number;
  label: string;
  titled?: boolean;
}) {
  return (
    <SkeletonRegion
      label={label}
      className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
    >
      {titled ? (
        <div className="px-4 sm:px-5">
          <Skeleton className="h-6 w-32" />
        </div>
      ) : null}
      <div className="px-4 sm:px-5">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-4 border-b border-ui-line py-2 last:border-b-0"
          >
            <Skeleton className={`h-5 ${CELL_WIDTHS[i % CELL_WIDTHS.length]}`} />
            <Skeleton
              className={`h-5 ${CELL_WIDTHS[(i + 3) % CELL_WIDTHS.length]}`}
            />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/**
 * A metric tile, for dashboards and analytics headers.
 *
 * **This shipped with no consumer and did not match the component it stands in
 * for**, which is the failure mode §3.6 exists to prevent arriving in the
 * skeleton itself: `StatGroup`/`Stat` were specified by §3.2 and built on the
 * dashboard branch, and until then nothing had ever rendered beside this to
 * compare it against. It was `p-5 gap-3` around `h-3` / `h-7` / `h-3` blocks;
 * every one of those five numbers was wrong.
 *
 * Every measurement is now `Stat`'s own. The card is `p-4 sm:p-5` with a `gap-2`
 * column — `Card`'s padding, §1.4's density target — and its three lines are the
 * line boxes their type classes give them: `--text-label` at 1.125rem for the
 * label, `--text-display` at 2.125rem for the value, `--text-caption` at 1rem for
 * the scope. The old `h-7` value block was 6px short of the figure that replaces
 * it and the two `h-3` label blocks 6px and 4px short of theirs, which is 16px of
 * shift per tile and 112px across the dashboard's seven.
 *
 * `wide` draws the first tile double-width, because `Stat`'s lead card spans two
 * columns and a placeholder that draws seven equal tiles reflows the whole grid
 * when the real one lands.
 */
export function StatSkeleton({
  count = 4,
  label,
  wide = false,
}: {
  count?: number;
  label: string;
  wide?: boolean;
}) {
  return (
    <SkeletonRegion
      label={label}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`ui-card flex flex-col gap-2 p-4 sm:p-5 ${
            wide && i === 0 ? "sm:col-span-2" : ""
          }`}
        >
          <Skeleton className="h-4.5 w-24" />
          <Skeleton className="h-8.5 w-32" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/**
 * A card of form fields — the shape the product detail's main column is made of,
 * and the counterpart to `CardSkeleton` for a card that holds controls rather
 * than a label/value list.
 *
 * **Every measurement is `Card`'s and `Form.tsx`'s, not a guess**, and it is a
 * correction rather than a restyle: this used to be `p-5` with `gap-5` between
 * `h-3` labels, which is not the box model of anything on screen. The real card
 * is `flex flex-col gap-3 py-4 sm:py-5` with `px-4 sm:px-5` inside and a
 * `--text-heading` title at a 1.5rem line box; a real field is `FieldFrame`'s
 * `gap-1.5` column of a `--text-label` label at 1.125rem over a `.ui-field`
 * control at 2.25rem, and the fields stack at 16px. `h-3` against an 18px label
 * is 6px short per field, which is 42px across the seven this screen's identity
 * card renders.
 *
 * `.ui-field` grows to 44px on a coarse pointer and `h-9` cannot, so the control
 * block carries `.ui-field` itself rather than a fixed height — the placeholder
 * and the control it stands in for are then the same height on a phone too.
 *
 * `titled` is the caller's because a card without a heading exists (a bare list),
 * and `fields` is because the real cards differ — identity has four controls and
 * inventory has three, and a placeholder that renders four for both shifts once.
 */
export function FormSkeleton({
  fields = 4,
  label,
  titled = true,
}: {
  fields?: number;
  label: string;
  titled?: boolean;
}) {
  return (
    <SkeletonRegion
      label={label}
      className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
    >
      {titled ? (
        <div className="px-4 sm:px-5">
          <Skeleton className="h-6 w-32" />
        </div>
      ) : null}
      <div className="flex flex-col gap-4 px-4 sm:px-5">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className={`h-4.5 ${CELL_WIDTHS[i % CELL_WIDTHS.length]}`} />
            <Skeleton className="ui-field w-full rounded-ui-md" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
