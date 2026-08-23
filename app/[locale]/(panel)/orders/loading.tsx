import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { TableSkeleton, RecordListSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches page one.
 *
 * It mirrors the real screen's chrome rather than being a bare spinner: the same
 * header block, the same toolbar height, and the same table geometry. A skeleton
 * of the wrong shape is a layout shift with extra steps — which is the whole
 * reason this file exists instead of a `<Spinner />`.
 */
export default async function OrdersLoading() {
  const t = await getTranslations("orders");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={t("loading")}
        toolbar={
          <div className="flex flex-col gap-3">
            {/* The tab strip's height, so the table does not jump when it lands. */}
            <div className="-mx-4 border-b border-ui-line px-4 sm:-mx-6 sm:px-6 xl:-mx-8 xl:px-8">
              <div className="flex items-center gap-4 pb-2.5">
                {[16, 20, 24, 20, 18].map((w, i) => (
                  <Skeleton key={i} className={`h-4 w-${w}`} />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-full rounded-ui-md sm:w-80" />
              <Skeleton className="ms-auto hidden h-8 w-24 rounded-ui-md sm:block" />
              <Skeleton className="hidden h-8 w-24 rounded-ui-md sm:block" />
            </div>
          </div>
        }
      />
      <PageBody width="full">
        <div className="hidden md:block">
          <TableSkeleton rows={8} cols={6} label={t("loading")} />
        </div>
        <div className="md:hidden">
          <RecordListSkeleton rows={6} label={t("loading")} />
        </div>
      </PageBody>
    </div>
  );
}
