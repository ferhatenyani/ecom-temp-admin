import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for the pixel report.
 *
 * It draws the shape this shop actually serves: the disabled-integration notice
 * first — `enabled: false` with no providers is measured, so the notice is on
 * screen for every reader rather than being an edge case — then the status card
 * and the two event cards. A placeholder that omitted the notice would settle
 * every card down the page by 68px the moment the data landed.
 */
export default async function MarketingConfigLoading() {
  const t = await getTranslations("campaigns");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader title={t("marketing.title")} subtitle={label} />
      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-17 w-full rounded-ui-lg" />
          <CardSkeleton rows={2} label={label} />
          <CardSkeleton rows={1} label={label} />
          <CardSkeleton rows={1} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
