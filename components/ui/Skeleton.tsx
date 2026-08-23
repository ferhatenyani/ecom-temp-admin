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
 * The table skeleton. Row heights come from the same `--row-h` the real table
 * uses, so switching density does not desynchronise them.
 *
 * `cols` drives the cell count and the widths cycle through a short pattern —
 * a table of identically-wide grey bars reads as a loading *graphic*, whereas
 * varied widths read as text that has not arrived.
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
              className={`h-4 ${CELL_WIDTHS[(r + c) % CELL_WIDTHS.length]}`}
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
 */
export function RecordListSkeleton({
  rows = 6,
  label,
}: {
  rows?: number;
  label: string;
}) {
  return (
    <SkeletonRegion label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ui-card flex flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="ms-auto h-5 w-16 rounded-ui-md" />
          </div>
          <Skeleton className="h-3.5 w-40" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="ms-auto h-3.5 w-20" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** A metric tile, for dashboards and analytics headers. */
export function StatSkeleton({ count = 4, label }: { count?: number; label: string }) {
  return (
    <SkeletonRegion
      label={label}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ui-card flex flex-col gap-3 p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** A form section: label/field pairs at the real field height. */
export function FormSkeleton({ fields = 4, label }: { fields?: number; label: string }) {
  return (
    <SkeletonRegion label={label} className="ui-card flex flex-col gap-5 p-5">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full rounded-ui-md" />
        </div>
      ))}
    </SkeletonRegion>
  );
}
