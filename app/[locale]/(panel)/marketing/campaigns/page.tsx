import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { campaignList } from "@/lib/api/schemas/campaign";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { CampaignsList } from "./CampaignsList";
import { listParams, queryFromParams } from "./query";

export default async function CampaignsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
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

  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") incoming.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) incoming.set(key, value[0]);
  }
  const query = queryFromParams(incoming);

  const initial = await acFetch(campaignList, session, `/campaigns?${listParams(query)}`).catch(
    (error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    },
  );

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <CampaignsList
      locale={locale}
      initialQuery={query}
      initialCampaigns={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
    />
  );
}
