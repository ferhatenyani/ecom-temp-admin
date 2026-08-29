import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { DetailGrid } from "@/components/ui/Detail";
import { CardSkeleton, FormSkeleton, Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches the item and
 * then its shelf's ledger.
 *
 * **It draws the two-column grid**, which is the whole reason this is worth
 * having rather than a spinner. On a 1440px monitor the real screen is a wide main
 * column with a 360px aside; a single-column placeholder would paint one shape and
 * reflow into another the moment the data lands, which is a layout shift with
 * extra steps — §3.6's own words.
 *
 * The card counts are the real screen's. Main: the quantity block, the adjust form
 * (four controls), the settings form (four controls) and five ledger rows. Aside:
 * the identity list.
 *
 * **The adjust card is drawn even though a third of the shop cannot use it.** 8 of
 * the 28 top-level rows manage no stock and render a refusal there instead — but a
 * route-level `loading.tsx` runs before the page has fetched anything and cannot
 * know which row this is. Drawing it and having it turn out to be a notice costs
 * one settle downwards on those rows; not drawing it costs one on the twenty
 * where the form is the reason the screen was opened.
 */
export default async function InventoryItemLoading() {
  const t = await getTranslations("inventory");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        divided={false}
        actions={<Skeleton className="h-9 w-40 rounded-ui-md" />}
      />

      <PageBody width="split">
        <DetailGrid
          main={
            <>
              {/* The quantity block: a heading, the display-sized figure with its
                  badges beside it, and the threshold line under it. */}
              <SkeletonRegion
                label={label}
                className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
              >
                <div className="px-4 sm:px-5">
                  <Skeleton className="h-6 w-28" />
                </div>
                <div className="flex flex-col gap-3 px-4 sm:px-5">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-8.5 w-16" />
                    <Skeleton className="h-5 w-20 rounded-ui-md" />
                  </div>
                  <Skeleton className="h-4.5 w-24" />
                </div>
              </SkeletonRegion>

              <FormSkeleton fields={4} label={label} />
              <FormSkeleton fields={4} footnote={2} label={label} />
              <CardSkeleton rows={5} label={label} />
            </>
          }
          aside={<CardSkeleton rows={5} label={label} />}
        />
      </PageBody>
    </div>
  );
}
