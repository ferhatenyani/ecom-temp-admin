import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

/**
 * The FAQ list's placeholder, shared by `loading.tsx` and the list's own
 * first-load branch so the two cannot drift apart.
 *
 * **Every measurement is the real row's**, per DESIGN.md §3.6. A row is
 * `flex items-center gap-3 py-2` holding a two-line column — the question at
 * `--text-subheading` (1.375rem) over a badge line at 1.25rem — and a 44px
 * `Reorder` pair at the trailing edge. The pair is the tallest thing in the row,
 * so the row is 44 + 16 = 60px; a placeholder sized to the text alone would be
 * 4px short per row and 24px across six.
 *
 * The frame is `Card`'s own — `gap-3 py-4 sm:py-5`, `px-4 sm:px-5` inside — and
 * **untitled**, because the real list is one card with no heading: there is one
 * FAQ list, and a card labelled "FAQ" under a page titled "FAQ" is chrome.
 */
export function FaqRowsSkeleton({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <SkeletonRegion
      label={label}
      className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
    >
      <div className="px-4 sm:px-5">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="ui-row flex items-center gap-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Skeleton className="h-5.5 w-56" />
              <Skeleton className="h-5 w-24 rounded-ui-md" />
            </div>
            <Skeleton className="h-11 w-22 shrink-0 rounded-ui-md" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}
