"use client";

import { useTranslations } from "next-intl";

/**
 * The loading state for both inventory lists.
 *
 * `SkeletonRows` in `components/patterns/States.tsx` is measured against an
 * **order** row — 81px, built from that row's own paddings — and is 10px per row
 * wrong here. Ten pixels over twenty rows is 200px of shift the moment data
 * lands, which is exactly the defect that component's docblock warns about. So
 * this is its own skeleton, built the same way: from the paddings and line
 * heights of the row it stands in for, not from a number kept in step by hand.
 *
 * A stock row and a movement row are deliberately the same geometry, so one
 * skeleton is honest for both and switching segments does not resize the list
 * under a reader's thumb:
 *
 *   py-3                       12 + 12   = 24
 *   line 1  min-h-6 (badge)              = 24
 *   gap-1                                =  4
 *   line 2  --text-footnote--line-height = 18
 *   hairline                             =  1
 *                                        ------
 *                                          71
 *
 * Verified against the rendered DOM rather than the arithmetic: **fr 71 vs 71,
 * ar 75 vs 75**, skeleton against real row, at 390, 440 and desktop. Arabic is
 * four pixels taller in both because the Arabic face is set a step larger — the
 * HIG's own note that Arabic beside Latin needs about two points to balance — so
 * `py-3` computes to 12.75px there. Everything on both sides of the comparison is
 * in `rem`, so the two scale together and the match holds; a skeleton with a
 * pixel anywhere in it would have drifted by 4px per row in one locale only,
 * which is the kind of defect that never shows up in the locale anybody tests.
 */
export function RowSkeleton({ rows = 8 }: { rows?: number }) {
  const t = useTranslations("states");

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t("loading")}
      className="mb-8 overflow-hidden rounded-lg bg-surface"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="list-row flex items-center gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {/* Line one takes its height from the badge, which is the tallest
                thing that ever sits on it. */}
            <div className="flex min-h-6 items-center gap-2">
              <div className="skeleton h-6 w-20 rounded-full" />
              <div className="skeleton h-5 w-28 rounded-sm" />
            </div>
            <div className="flex items-center gap-2">
              <div className="skeleton h-4.5 w-32 rounded-sm" />
            </div>
          </div>
          {/* The trailing figure: 25 + 2 + 16 = 43, under line one and two's 46,
              so it never sets the row height and never changes it. */}
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <div className="skeleton h-6 w-10 rounded-sm" />
            <div className="skeleton h-4 w-14 rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}
