import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { TableSkeleton, RecordListSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for the segment list.
 *
 * **No toolbar band**, and that is the screen rather than an omission: there is
 * no search and no filter on this collection, and the one control — the `name`
 * header's sort — belongs to the table. A placeholder drawing a filter row here
 * would promise a control the real screen does not have, which is the same
 * untruth as an empty state offering to clear a filter that does not exist.
 *
 * **Three body columns**: name, criteria, matches. None is optional, so a stored
 * preference cannot change the count and this is the shape every visit gets.
 */
export default async function SegmentsLoading() {
  const t = await getTranslations("campaigns");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("segments")}
        subtitle={label}
        actions={
          <>
            <Skeleton className="size-9 rounded-ui-md" />
            <Skeleton className="h-9 w-44 rounded-ui-md" />
          </>
        }
      />
      <PageBody width="full">
        <div className="hidden md:block">
          <TableSkeleton rows={4} cols={3} label={label} />
        </div>
        <div className="ui-card p-2 md:hidden">
          <RecordListSkeleton rows={4} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
