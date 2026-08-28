import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { campaignList, emailTemplateList, segmentList } from "@/lib/api/schemas/campaign";
import type { IconName } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card, NavList, NavRow } from "@/components/ui/Card";

/**
 * Marketing is three collections and a configuration report, and this is the
 * index of them.
 *
 * ## Why the index survives the redesign
 *
 * The old screen defended itself against a `Segmented` control, which DESIGN.md
 * §0 retires — so that argument expired with the control, exactly as the content
 * hub's did. What replaces it is the shape `/content` settled on: four
 * destinations sharing one capability and a URL prefix and **nothing else**. A
 * campaign is not a segment is not a template is not a pixel report: no shared
 * query, no shared envelope, no shared row. `AppShell`'s tree groups by domain
 * rather than by prefix, so they are not a sidebar group either, and the section
 * holds exactly one nav entry.
 *
 * A redirect to `/marketing/campaigns` would be the alternative and it is the one
 * thing that cannot happen: **nothing else in the panel links to `config` or to
 * `email-templates`**, so both would become URLs with no door. That is this
 * screen's whole job.
 *
 * What earns the navigation is the **count**, plus one line saying what is behind
 * each row — the four are unlike enough that "Segments 4" alone does not tell a
 * marketing manager which one they want.
 *
 * ## `NavList`, not a hand-rolled grid of cards
 *
 * `Card.tsx` grew `NavList`/`NavRow` on the content branch for precisely this
 * screen shape, and DESIGN.md §3's rule is that a page which needs a variant
 * extends the primitive rather than forking it. Four rows in one card is what the
 * primitive draws; the `description` slot it already had is what carries the
 * extra line, and it had no caller until now.
 *
 * ## No stale marker
 *
 * DESIGN.md §3.7, as amended on the customers branch. A Server Component with no
 * writes, nothing polling and no refresh control cannot hold data older than the
 * navigation that fetched it, and the half of the rule that does the real work —
 * "every write control disabled with that same reason" — has nothing to disable.
 */

type Destination = {
  key: string;
  href: string;
  icon: IconName;
  count: number | null;
};

export default async function MarketingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("campaigns");

  /*
   * `ac_manage_marketing` alone, which is the whole hub. The **second**
   * capability — `ac_manage_customers` — gates three routes further in (`send`,
   * the recipient list and a segment's count), and each of those says so where it
   * bites rather than here: a Marketing Manager can reach every screen in this
   * section and do most of what is on them.
   */
  if (!has(me, "ac_manage_marketing")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader title={t("hubTitle")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_marketing" />
        </PageBody>
      </div>
    );
  }

  /* Three counts in parallel; a failure in one is a missing count rather than a
     missing screen. An index that 500s because one collection is unhappy would
     take away the three destinations that work. */
  const soften = (error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  };

  const [campaigns, segments, templates] = await Promise.all([
    acFetch(campaignList, session, "/campaigns?per_page=1").catch(soften),
    acFetch(segmentList, session, "/segments?per_page=1").catch(soften),
    acFetch(emailTemplateList, session, "/email-templates?per_page=1").catch(soften),
  ]);

  const total = (result: { meta: Record<string, unknown> | null } | null) => {
    if (!result?.meta) return null;
    const parsed = listMeta.safeParse(result.meta);
    return parsed.success ? parsed.data.total : null;
  };

  const destinations: Destination[] = [
    { key: "campaigns", href: "/marketing/campaigns", icon: "mail", count: total(campaigns) },
    { key: "segments", href: "/marketing/segments", icon: "customers", count: total(segments) },
    { key: "templates", href: "/marketing/email-templates", icon: "note", count: total(templates) },
    /*
     * No count. It is one configuration object, not a collection — the same
     * reason the homepage carries none on the content hub — and "1" beside it
     * would be noise.
     */
    { key: "config", href: "/marketing/config", icon: "dashboard", count: null },
  ];

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader title={t("hubTitle")} />
      <PageBody width="detail">
        <Card footnote={t("hubNote")}>
          <NavList>
            {destinations.map((destination) => (
              <NavRow
                key={destination.key}
                href={`/${locale}${destination.href}`}
                label={t(destination.key)}
                description={t(`hub.${destination.key}`)}
                icon={destination.icon}
                meta={
                  /* `Ltr` around the number, never around the row: a full-width
                     cell wrapped in `Ltr` forces the *cell's* direction, which is
                     how the analytics branch put a provider name at the wrong end
                     of an Arabic row. */
                  destination.count !== null ? (
                    <Ltr numeric>{destination.count.toLocaleString(locale)}</Ltr>
                  ) : null
                }
              />
            ))}
          </NavList>
        </Card>
      </PageBody>
    </div>
  );
}
