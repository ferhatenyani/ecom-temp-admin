import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { segmentList } from "@/lib/api/schemas/campaign";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { SegmentsList } from "./SegmentsList";

export default async function SegmentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("campaigns");

  if (!has(me, "ac_manage_marketing")) {
    return (
      <Scaffold title={t("segments")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_marketing" />
        </div>
      </Scaffold>
    );
  }

  const initial = await acFetch(segmentList, session, "/segments?per_page=100").catch(
    (error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    },
  );

  return (
    <SegmentsList
      locale={locale}
      initialSegments={initial?.data ?? null}
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
