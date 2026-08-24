import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { TableSkeleton, RecordListSkeleton, Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for the ledger.
 *
 * **It draws the summary strip**, which is the whole reason this is worth having
 * rather than a spinner: the real screen puts a card of net-by-reason figures
 * above the rows, and a placeholder that omitted it would settle everything
 * downwards the moment the summary landed.
 *
 * Six body columns, because six are visible by default — reason · product · who ·
 * change · delta · when. The picker holds the note, which 1140 of the 1154 rows
 * leave empty.
 */
export default async function MovementsLoading() {
  const t = await getTranslations("inventory");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("ledger.title")}
        subtitle={label}
        actions={<Skeleton className="size-9 rounded-ui-md" />}
        toolbar={
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-24 rounded-ui-md" />
            <Skeleton className="ms-auto hidden h-8 w-24 rounded-ui-md md:block" />
            <Skeleton className="hidden h-8 w-24 rounded-ui-md md:block" />
          </div>
        }
      />
      <PageBody width="full">
        <div className="flex flex-col gap-4">
          {/* The summary card: a heading, then a grid of the same shape the real
              one draws — a badge over a figure over a count. */}
          <SkeletonRegion
            label={label}
            className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
          >
            <div className="px-4 sm:px-5">
              <Skeleton className="h-6 w-32" />
            </div>
            <div className="grid grid-cols-2 gap-4 px-4 sm:grid-cols-3 sm:px-5 lg:grid-cols-4 xl:grid-cols-5">
              {[0, 1, 2, 3].map((cell) => (
                <div key={cell} className="flex flex-col gap-1">
                  <Skeleton className="h-5 w-20 rounded-ui-md" />
                  <Skeleton className="h-6 w-14" />
                  <Skeleton className="h-4.5 w-24" />
                </div>
              ))}
            </div>
          </SkeletonRegion>

          <div className="hidden md:block">
            <TableSkeleton rows={8} cols={6} label={label} />
          </div>
          <div className="ui-card p-2 md:hidden">
            <RecordListSkeleton rows={6} label={label} />
          </div>
        </div>
      </PageBody>
    </div>
  );
}
