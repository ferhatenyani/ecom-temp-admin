import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { DetailGrid } from "@/components/ui/Detail";
import { CardSkeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches the
 * customer and the two sub-resources beside it.
 *
 * **It draws the two-column grid**, which is the whole reason this file is worth
 * having rather than a spinner. On a 1440px monitor the real screen is a wide
 * main column with a 360px aside; a single-column placeholder would paint one
 * shape and reflow into another the moment the data lands, which is a layout
 * shift with extra steps — §3.6's own words.
 *
 * The card counts are the real screen's. Main: the statistics report (four
 * scope-labelled figures), the orders card and the notification queue. Aside:
 * identity's six rows, consent's two, and one address card.
 *
 * **One address card, not two**, and the choice is the same one the order
 * detail's placeholder makes about its gated sections, decided the other way:
 * `shipping` is populated on exactly one customer in this shop, so drawing a
 * second card would settle downwards on nearly every customer detail in the
 * panel. Drawing the orders card unconditionally goes the other way and is the
 * same reasoning — a route-level `loading.tsx` runs before the page has fetched
 * anything, so it cannot know that 11 of the 16 have never ordered; but it also
 * cannot know *which* customer this is, and a placeholder that never draws the
 * card would flash one in for the five who have.
 */
export default async function CustomerDetailLoading() {
  const t = await getTranslations("customers");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader title={t("title")} subtitle={label} divided={false} />

      <PageBody width="split">
        <DetailGrid
          main={
            <>
              <CardSkeleton rows={4} footnote={2} label={label} />
              <CardSkeleton rows={4} label={label} />
              <CardSkeleton rows={3} footnote={2} label={label} />
            </>
          }
          aside={
            <>
              <CardSkeleton rows={6} label={label} />
              <CardSkeleton rows={2} footnote={2} label={label} />
              <CardSkeleton rows={4} label={label} />
            </>
          }
        />
      </PageBody>
    </div>
  );
}
