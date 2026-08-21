import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { campaignList, emailTemplateList, segmentList } from "@/lib/api/schemas/campaign";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ForbiddenState } from "@/components/patterns/States";
import { ListGroup, ListLinkRow } from "@/components/primitives/GroupedList";
import { Icon, type IconName } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";

/**
 * Marketing is three collections and a configuration screen, and this is the hub.
 *
 * The `/content` grammar, applied to a smaller set for the same reason: four
 * destinations sharing one capability, no query, no filter bar and no row shape
 * between them — a campaign is not a segment is not a template. A segmented
 * control would fit four at 390px, but it would put four unrelated screens behind
 * one toolbar and make the composer a *tab*, which it cannot be: it is a
 * five-step sequence that owns its whole screen.
 *
 * It is one entry in `/more` rather than three, which is what the content hub
 * was created to avoid — `/more` holding three near-identical rows for one
 * capability.
 */

type Section = {
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
   * the recipient list and a segment's count), and each of those says so where
   * it bites rather than here: a Marketing Manager can reach every screen in
   * this section and do most of what is on them.
   */
  if (!has(me, "ac_manage_marketing")) {
    return (
      <Scaffold title={t("hubTitle")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_marketing" />
        </div>
      </Scaffold>
    );
  }

  // Three counts in parallel; a failure in one is a missing count rather than a
  // missing screen, exactly as the content hub argues.
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

  const sections: Section[] = [
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
    <Scaffold title={t("hubTitle")}>
      <div className="mx-auto max-w-3xl px-4">
        <ListGroup>
          {sections.map((section) => (
            <ListLinkRow
              key={section.key}
              href={`/${locale}${section.href}`}
              ariaLabel={t(section.key)}
            >
              <span className="flex items-center gap-3">
                <Icon name={section.icon} className="size-5 shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate text-body text-label">
                  {t(section.key)}
                </span>
                {/* A bare number, so `Ltr` — and around the number, never the cell. */}
                {section.count !== null ? (
                  <Ltr className="shrink-0 text-footnote text-label-secondary">
                    {section.count.toLocaleString(locale)}
                  </Ltr>
                ) : null}
              </span>
            </ListLinkRow>
          ))}
        </ListGroup>
      </div>
    </Scaffold>
  );
}
