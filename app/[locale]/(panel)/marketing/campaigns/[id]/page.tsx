import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { campaign as campaignSchema } from "@/lib/api/schemas/campaign";
import { canSendCampaigns, has } from "@/lib/capabilities";
import { canEdit } from "@/lib/campaigns";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { Composer } from "./Composer";
import { SentCampaign } from "./SentCampaign";

/** `params` is a Promise in Next 16, like `searchParams` and `cookies()`. */
export default async function CampaignPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { session, me } = await requireSession(locale);

  if (!has(me, "ac_manage_marketing")) {
    const t = await getTranslations("campaigns");
    return (
      <Scaffold title={t("campaigns")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_marketing" />
        </div>
      </Scaffold>
    );
  }

  // `\d+` at the proxy and in the API's own pattern; `new` is a sibling route.
  if (!/^\d+$/.test(id)) notFound();

  const campaign = await acFetch(campaignSchema, session, `/campaigns/${id}`).catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    },
  );

  /*
   * **Two screens behind one route, chosen by `is_editable`.**
   *
   * The API publishes the flag, so the panel does not decide — and it is not the
   * same question as "is it a draft": a future status that is editable would come
   * out right here without a change. A sent campaign is a record and gets a
   * record's screen; walking a wizard through something nobody can change would
   * be a costume.
   *
   * `canSendCampaigns()` is the compound rule — `ac_manage_marketing` **and**
   * `ac_manage_customers` — and it is passed down rather than re-derived in a
   * component, which is what ADMIN_PANEL.md asks for. Measured today, the retired
   * `ac_marketing_manager` role exercises it: 200 here, 403 on send.
   */
  return canEdit(campaign.data) ? (
    <Composer locale={locale} initial={campaign.data} canSendCampaigns={canSendCampaigns(me)} />
  ) : (
    <SentCampaign
      locale={locale}
      initial={campaign.data}
      canReadRecipients={has(me, "ac_manage_customers")}
    />
  );
}
