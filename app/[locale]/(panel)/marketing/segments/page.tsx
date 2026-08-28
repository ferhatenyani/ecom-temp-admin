import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { segmentList } from "@/lib/api/schemas/campaign";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { SegmentsList } from "./SegmentsList";
import { listParams, queryFromParams } from "./query";

export default async function SegmentsPage({
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
        <PageHeader title={t("segments")} />
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

  const initial = await acFetch(segmentList, session, `/segments?${listParams(query)}`).catch(
    (error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    },
  );

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <SegmentsList
      locale={locale}
      initialQuery={query}
      initialSegments={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
      /*
       * A segment's **count** needs `ac_manage_customers` on top of the marketing
       * capability — it is a count of customers — while the list itself does not.
       * Measured: a Marketing Manager is 200 on `/segments` and 403 on
       * `/segments/{id}/preview`. So the rows render and the numbers say whose
       * permission they are.
       */
      canCount={has(me, "ac_manage_customers")}
    />
  );
}
