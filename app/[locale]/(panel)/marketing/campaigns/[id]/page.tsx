import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { campaign as campaignSchema, segmentList } from "@/lib/api/schemas/campaign";
import { canSendCampaigns, has } from "@/lib/capabilities";
import { canEdit } from "@/lib/campaigns";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
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
  const t = await getTranslations("campaigns");

  if (!has(me, "ac_manage_marketing")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader title={t("campaigns")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_marketing" />
        </PageBody>
      </div>
    );
  }

  // `\d+` at the proxy and in the API's own pattern; `/campaigns/0` is a 400
  // rather than a 404, which this guard never reaches because `0` fails it too.
  if (!/^\d+$/.test(id) || id === "0") notFound();

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
   * component, which is what ADMIN_PANEL.md asks for. Measured: the retired
   * `ac_marketing_manager` role exercises it, 200 here and 403 on send.
   */
  if (canEdit(campaign.data)) {
    return (
      <Composer
        locale={locale}
        initial={campaign.data}
        canSendCampaigns={canSendCampaigns(me)}
        /*
         * The second half of the compound rule, on its own, because the audience
         * step needs it separately: it decides whether the `ids` audience gets a
         * customer picker or the comma-separated field. Derived here beside
         * `canSendCampaigns` rather than in a component — one place asks the
         * session what it holds.
         */
        canManageCustomers={has(me, "ac_manage_customers")}
      />
    );
  }

  /*
   * Only the record screen names its audience's segment, so only it pays for the
   * list — the composer has a picker that fetches on demand and only when the
   * audience is a segment at all. Softened: a failed segment list costs one row's
   * *name*, never the screen.
   */
  const segments = await acFetch(segmentList, session, "/segments?per_page=100").catch(
    (error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    },
  );

  return (
    <SentCampaign
      locale={locale}
      initial={campaign.data}
      canReadRecipients={has(me, "ac_manage_customers")}
      segments={segments?.data ?? []}
    />
  );
}
