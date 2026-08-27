import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

/**
 * The banner list's placeholder, shared by `loading.tsx` and the list's own
 * first-load branch so the two cannot drift apart.
 *
 * **Every measurement is the real row's**, per DESIGN.md §3.6. A banner row is
 * `flex items-center gap-3 py-2` holding a 40px thumbnail, a two-line column —
 * `--text-subheading` at 1.375rem over `--text-label` at 1.125rem with a 2px gap
 * — and a 44px `Reorder` pair at the trailing edge. The 44px control is the
 * tallest thing in the row, so the row is 44 + 16 = 60px and the thumbnail is
 * *not* what sets the height. A placeholder built around the thumbnail would be
 * 4px short per row.
 *
 * The frame is `Card`'s own — `gap-3 py-4 sm:py-5` with `px-4 sm:px-5` inside
 * and a `--text-heading` title at 1.5rem — because the real list renders one
 * `Card` per placement.
 *
 * It draws **one** card, because a first visit to this shop has one placement
 * with rows in it and the second is a single banner; drawing two would settle
 * upward more often than it settles down.
 */
export function BannerRowsSkeleton({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <SkeletonRegion
      label={label}
      className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
    >
      <div className="px-4 sm:px-5">
        <Skeleton className="h-6 w-32" />
      </div>
      <div className="px-4 sm:px-5">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="ui-row flex items-center gap-3 py-2">
            <Skeleton className="size-10 shrink-0 rounded-ui-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Skeleton className="h-5.5 w-40" />
              <Skeleton className="h-4.5 w-28" />
            </div>
            {/* The reorder pair: two 44px buttons, which is what makes the row
                60px rather than the 56px the thumbnail alone would give. */}
            <Skeleton className="h-11 w-22 shrink-0 rounded-ui-md" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
