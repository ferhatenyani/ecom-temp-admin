import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { CardSkeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for the section index.
 *
 * Three `?per_page=1` requests decide the counts, so this is what a first visit
 * sees while they run. `CardSkeleton` at four rows is the real box: one `Card`
 * holding a `NavList` of four `NavRow`s, each a 44px row with a bottom rule.
 */
export default async function MarketingLoading() {
  const t = await getTranslations("campaigns");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader title={t("hubTitle")} subtitle={t("loading")} />
      <PageBody width="detail">
        <CardSkeleton rows={4} titled={false} label={t("loading")} />
      </PageBody>
    </div>
  );
}
