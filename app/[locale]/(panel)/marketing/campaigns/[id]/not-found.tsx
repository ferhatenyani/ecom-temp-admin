import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";

/**
 * A 404 on a campaign id.
 *
 * Reached by a stale link, by a peek URL somebody shared after the row was
 * deleted, or after deleting a draft and pressing back — which is the one path
 * this screen creates itself, since **only a draft can be deleted**. A sent or
 * cancelled campaign answers 409 and stays readable, so it never lands here.
 *
 * `EmptyState` rather than a hand-rolled box: this is the *absence* of a record
 * rather than a failure, so there is nothing to retry, and the one useful control
 * is the way back to the list. The back link in the header is the second.
 */
export default async function CampaignNotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tCampaigns = await getTranslations({ locale, namespace: "campaigns" });

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("notFoundTitle")}
        back={{
          href: `/${locale}/marketing/campaigns`,
          label: tCampaigns("campaigns"),
        }}
      />
      <PageBody width="detail">
        <EmptyState icon="alert" message={tCampaigns("notFound")} />
      </PageBody>
    </div>
  );
}
