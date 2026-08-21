import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { overviewReport } from "@/lib/api/schemas/analytics";
import { analyticsParams, rangeFromParams } from "@/lib/analytics";
import { canSeeMoney, has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { DashboardScreen } from "./DashboardScreen";

/**
 * The dashboard — **one request, not the six the specification lists.**
 *
 * ADMIN_PANEL.md names `/analytics/overview`, `/orders`, `/products`,
 * `/customers`, `/cod` and `/shipping` for this screen. Measured 2026-08-21: the
 * overview *nests* all of them. Its payload carries `orders` (with `by_status`),
 * `customers`, `cod`, `shipping`, `inventory` and `revenue` as blocks, and every
 * figure the spec's five cards need is in there. The other five routes would add
 * five round trips, five failure modes and five cache entries to re-fetch numbers
 * this one already returned.
 *
 * The only thing overview lacks is `best_sellers`, which is not a dashboard card
 * — it is the products report, and the card that leads there is a link.
 */
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("analytics");

  if (!has(me, "ac_view_analytics")) {
    return (
      <Scaffold title={t("dashboardTitle")}>
        <div className="px-4">
          <ForbiddenState capability="ac_view_analytics" />
        </div>
      </Scaffold>
    );
  }

  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") incoming.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) incoming.set(key, value[0]);
  }
  const range = rangeFromParams(incoming);

  const result = await acFetch(overviewReport, session, "/analytics/overview", {
    query: analyticsParams(range),
  })
    .then((response) => response)
    .catch(() => null);

  return (
    <DashboardScreen
      locale={locale}
      range={range}
      report={result?.data ?? null}
      canMoney={canSeeMoney(me)}
      generatedAt={
        typeof result?.meta?.generated_at === "string" ? result.meta.generated_at : null
      }
    />
  );
}
