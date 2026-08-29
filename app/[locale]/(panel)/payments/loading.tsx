import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import {
  CardSkeleton,
  RecordListSkeleton,
  Skeleton,
  TableSkeleton,
} from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for `/payments`.
 *
 * It mirrors the real screen's chrome rather than being a bare spinner: the same
 * header block, the same tab strip over the same filter row, the same table
 * geometry at `md`+ with the same record list below it, and the three COD cards
 * underneath in the same grid. A skeleton of the wrong shape is a layout shift
 * with extra steps.
 *
 * **Six body columns**, because six is the whole set — id · order · method ·
 * amount · status · created. Nothing on this table is `optional`, so there is no
 * stored preference that could make a first visit any other shape.
 *
 * **Four tab bands rather than seven.** The real strip carries "all" plus the six
 * statuses and scrolls; a placeholder drawing all of them would be drawing grey
 * blocks off both edges of a 340px screen. Four is what fits at the floor, and
 * the strip's height — the only thing that can shift — is the same either way.
 *
 * **The filter row is drawn twice over**, once as the search box and once as the
 * three labelled pickers: `FieldFrame` is a label over a control, so those three
 * are 18px taller than the box beside them and a placeholder that drew four equal
 * boxes would shift the whole table by that much when the real controls land.
 *
 * It draws the Super Admin's screen — a ledger and a report. A Manager sees a
 * forbidden box where the table is, which is not a shape a route-level skeleton
 * can know: the capability is on the session and this file runs before the fetch.
 * Drawing the majority screen and letting the refusal replace it is the honest
 * trade; the alternative is a skeleton that matches nobody.
 */
export default async function PaymentsLoading() {
  const t = await getTranslations("payments");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        actions={<Skeleton className="size-9 rounded-ui-md" />}
        toolbar={
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1 border-b border-ui-line">
              <Skeleton className="mb-1.5 h-7 w-14 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-20 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-16 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-24 rounded-ui-md" />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Skeleton className="h-9 min-w-56 flex-1 rounded-ui-md sm:max-w-80" />
              {/* Label over control, matching `FieldFrame`'s `gap-1.5`. */}
              <div className="flex w-full flex-col gap-1.5 sm:w-56">
                <Skeleton className="h-4.5 w-24" />
                <Skeleton className="ui-field w-full rounded-ui-md" />
              </div>
              <div className="flex w-full flex-col gap-1.5 sm:w-44">
                <Skeleton className="h-4.5 w-16" />
                <Skeleton className="ui-field w-full rounded-ui-md" />
              </div>
              <div className="flex w-full flex-col gap-1.5 sm:w-44">
                <Skeleton className="h-4.5 w-16" />
                <Skeleton className="ui-field w-full rounded-ui-md" />
              </div>
              <Skeleton className="ms-auto hidden h-8 w-24 rounded-ui-md md:block" />
              <Skeleton className="hidden h-8 w-24 rounded-ui-md md:block" />
            </div>
          </div>
        }
      />
      <PageBody width="full">
        <div className="hidden md:block">
          <TableSkeleton rows={8} cols={6} label={label} />
        </div>
        {/* `DataTable` wraps the record list in the card and pads it by 8px below
            `md`, so the placeholder wears the same box or the rows step inward
            when the data arrives. */}
        <div className="ui-card p-2 md:hidden">
          <RecordListSkeleton rows={6} label={label} />
        </div>

        {/* The COD report: five figure rows, five status rows, five rate rows —
            the counts the real cards render, so nothing shifts underneath. */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <CardSkeleton rows={5} label={label} />
          <CardSkeleton rows={5} label={label} />
          <CardSkeleton rows={5} footnote={1} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
