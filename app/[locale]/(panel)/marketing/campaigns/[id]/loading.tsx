import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for a campaign.
 *
 * **It draws the composer, and it cannot do better.** `loading.tsx` receives no
 * `params` beyond the route's own and no data at all, so it cannot know whether
 * the id belongs to a draft — which renders a five-step wizard — or to a sent
 * campaign, which renders a two-column record. Four of this shop's five campaigns
 * settle by a card or two either way; the wizard is the shape a person reaches by
 * pressing "new", which is the only path that arrives here without a page already
 * painted behind it.
 *
 * What it does get right is the chrome both screens share: the back link, an
 * undivided header — §2.4, a detail page lets its first card do the separating —
 * a 36px action button, and the step band's own two rows (a 24px bar strip over
 * an 18px sentence), so the header does not resize when the real one lands.
 */
export default async function CampaignLoading() {
  const t = await getTranslations("campaigns");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("campaigns")}
        subtitle={t("loading")}
        divided={false}
        actions={<Skeleton className="size-9 rounded-ui-md" />}
        toolbar={
          <div className="flex flex-col gap-2">
            {/* Five bars, each in its own 24px block — `StepIndicator` draws a
                6px bar inside a `py-2.5` button, so a one-piece placeholder would
                settle by 18px the moment the real strip mounts. */}
            <div className="flex items-center gap-1.5 py-2.5">
              {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton key={index} className="h-1.5 flex-1 rounded-ui-sm" />
              ))}
            </div>
            <Skeleton className="h-4 w-48 rounded-ui-sm" />
          </div>
        }
      />
      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          <CardSkeleton rows={3} label={t("loading")} />
          <CardSkeleton rows={2} label={t("loading")} />
        </div>
      </PageBody>
    </div>
  );
}
