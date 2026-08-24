import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { DetailGrid } from "@/components/ui/Detail";
import { CardSkeleton, Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches the order
 * and the eight sub-resources beside it.
 *
 * **It draws the two-column grid**, which is the whole reason this file is worth
 * having rather than a spinner. On a 1440px monitor the real screen is a wide
 * main column with a 360px aside; a single-column placeholder would paint one
 * shape and then reflow into another the moment the data lands, which is a
 * layout shift with extra steps — §3.6's own words.
 *
 * The card counts are the real screen's: main has items, timeline and (with the
 * capabilities) parcels and payments; the aside has summary, customer and COD.
 * The two gated sections are drawn optimistically, because the placeholder
 * cannot know the session's capabilities — a route-level `loading.tsx` runs
 * before the page has fetched anything, `requireSession` included. Drawing them
 * and having them not arrive costs one settle downwards; not drawing them and
 * having them arrive costs one every time for the majority of users who can see
 * them.
 */
export default async function OrderDetailLoading() {
  const t = await getTranslations("orders.detail");
  const tOrders = await getTranslations("orders");
  const label = tOrders("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("back")}
        subtitle={label}
        divided={false}
        actions={
          <>
            {/* The two real controls' boxes: a 36px icon button and the primary
                action beside it, so the header does not reflow. */}
            <Skeleton className="size-9 rounded-ui-md" />
            <Skeleton className="h-9 w-40 rounded-ui-md" />
          </>
        }
      />

      <PageBody width="split">
        <DetailGrid
          main={
            <>
              {/* Items: a heading, a table header band and three rows at the
                  real cell height, then the totals block. */}
              <SkeletonRegion
                label={label}
                className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
              >
                <div className="px-4 sm:px-5">
                  <Skeleton className="h-6 w-28" />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-4 border-b border-ui-line-strong bg-ui-surface-2 px-4 py-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-10" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                  {[0, 1, 2].map((row) => (
                    <div
                      key={row}
                      className="flex items-center justify-between gap-4 border-b border-ui-line px-4 py-3"
                    >
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-5 w-8" />
                      <Skeleton className="h-5 w-20" />
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-4 px-4 pt-3">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                </div>
              </SkeletonRegion>

              <CardSkeleton rows={5} label={label} />
              <CardSkeleton rows={2} label={label} />
              <CardSkeleton rows={2} label={label} />
            </>
          }
          aside={
            <>
              <CardSkeleton rows={5} label={label} />
              <CardSkeleton rows={5} label={label} />
              <CardSkeleton rows={3} label={label} />
            </>
          }
        />
      </PageBody>
    </div>
  );
}
