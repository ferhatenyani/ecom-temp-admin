import { getLocale, getTranslations } from "next-intl/server";
import { Scaffold } from "@/components/patterns/Scaffold";
import { Icon } from "@/components/primitives/Icon";

/**
 * A 404 on a campaign id.
 *
 * Reached by a stale link, or after deleting a draft and using the back button —
 * which is the one path this screen creates itself, since **only a draft can be
 * deleted**. A sent or cancelled campaign answers 409 and stays readable, so it
 * never lands here.
 */
export default async function CampaignNotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tCampaigns = await getTranslations({ locale, namespace: "campaigns" });

  return (
    <Scaffold
      title={tCampaigns("campaigns")}
      back={{ href: `/${locale}/marketing/campaigns`, label: tCampaigns("campaigns") }}
    >
      <div className="px-4">
        <div className="rounded-lg bg-surface px-6 py-12 text-center">
          <Icon name="alert" className="mx-auto size-8 text-label-tertiary" />
          <h2 className="mt-4 text-title-3 text-label">{t("notFoundTitle")}</h2>
          <p className="mt-2 text-body text-label-secondary">{tCampaigns("notFound")}</p>
        </div>
      </div>
    </Scaffold>
  );
}
