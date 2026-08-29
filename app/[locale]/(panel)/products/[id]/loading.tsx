import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { DetailGrid } from "@/components/ui/Detail";
import {
  CardSkeleton,
  FormSkeleton,
  Skeleton,
  SkeletonRegion,
} from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches the product
 * and the sub-resources beside it.
 *
 * **It draws the two-column grid**, which is the whole reason this file is worth
 * having rather than a spinner. On a 1440px monitor the real screen is a wide
 * column of form cards with a 360px aside; a single-column placeholder would
 * paint one shape and reflow into another the moment the data lands, which is a
 * layout shift with extra steps — §3.6's own words.
 *
 * The card counts are the real screen's, and `FormSkeleton`'s field counts are
 * the real cards': identity has four controls, pricing four blocks, inventory
 * three (the quantity field is conditional and the majority of the catalogue
 * manages stock), descriptions two, SEO four. The aside is a three-control
 * publication card, the category list and the record's four label/value rows.
 *
 * **The variations card is deliberately absent**, which is the opposite of the
 * call the order detail's placeholder makes about its gated sections — and for
 * the opposite reason. There, most sessions hold the capability, so drawing them
 * optimistically settles downwards for a minority. Here two products in the shop
 * are variable, so drawing that card would settle downwards on nearly every
 * product detail in the panel.
 */
export default async function ProductDetailLoading() {
  const t = await getTranslations("products");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        divided={false}
        actions={
          /* The one real control's box: a 36px secondary icon button opening the
             delete menu, so the header does not reflow when it lands. */
          <Skeleton className="size-9 rounded-ui-md" />
        }
      />

      <PageBody width="split">
        <DetailGrid
          main={
            <>
              <FormSkeleton fields={4} footnote={2} label={label} />
              <FormSkeleton fields={4} label={label} />
              <FormSkeleton fields={3} label={label} />
              <FormSkeleton fields={2} footnote={1} label={label} />
              <FormSkeleton fields={4} label={label} />
              <CardSkeleton rows={1} footnote={2} label={label} />
            </>
          }
          aside={
            <>
              {/* Publication: status, catalogue visibility, featured. */}
              <FormSkeleton fields={3} label={label} />
              {/* The category list is checkable rows rather than fields: 36px
                  each, gap-1, inside the card's own padding — `.ui-field` so the
                  placeholder grows to 44px on a coarse pointer exactly as the
                  rows do. */}
              <SkeletonRegion
                label={label}
                className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
              >
                <div className="px-4 sm:px-5">
                  <Skeleton className="h-6 w-32" />
                </div>
                <div className="flex flex-col gap-1 px-4 sm:px-5">
                  {[0, 1, 2, 3, 4, 5, 6].map((row) => (
                    <Skeleton key={row} className="ui-field w-full rounded-ui-md" />
                  ))}
                </div>
              </SkeletonRegion>
              <CardSkeleton rows={4} label={label} />
            </>
          }
        />
      </PageBody>
    </div>
  );
}
