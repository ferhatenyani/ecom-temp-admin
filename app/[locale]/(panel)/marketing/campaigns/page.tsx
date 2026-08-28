import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { campaignList, segmentList } from "@/lib/api/schemas/campaign";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { CampaignsList } from "./CampaignsList";
import { listParams, queryFromParams } from "./query";

/** `searchParams` is a Promise in Next 16, like `params` and `cookies()`. */
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

  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") incoming.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) incoming.set(key, value[0]);
  }
  const query = queryFromParams(incoming);

  const soften = (error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  };

  /*
   * Two requests in parallel, and the second is not a luxury.
   *
   * The segment list feeds the filter picker *and* the audience column's ability
   * to name which segment a campaign points at — "Un segment" is the one thing
   * that column could say without it, on a list where three of four rows have
   * one. It is 100 rows at most (four on this shop), it is allowlisted for the
   * same capability as the list itself, and fetching it here rather than in the
   * client avoids a waterfall behind first paint.
   *
   * A failure in either is softened rather than thrown: the list renders its own
   * error state with a retry, and an empty segment list costs the picker rather
   * than the screen.
   */
  const [initial, segments] = await Promise.all([
    acFetch(campaignList, session, `/campaigns?${listParams(query)}`).catch(soften),
    acFetch(segmentList, session, "/segments?per_page=100").catch(soften),
  ]);

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <CampaignsList
      locale={locale}
      initialQuery={query}
      initialCampaigns={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
      segments={segments?.data ?? []}
    />
  );
}
