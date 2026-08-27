import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { pageList, bannerList, faqList } from "@/lib/api/schemas/cms";
import { mediaList } from "@/lib/api/schemas/media";
import type { IconName } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card, NavList, NavRow } from "@/components/ui/Card";

/**
 * Content is five collections, a document and a media library, and this is the
 * index of them.
 *
 * ## Why the index survives the redesign
 *
 * The old screen justified itself against a `Segmented` control, which is
 * DESIGN.md §0-retired, so that argument expired with the control. The one that
 * replaces it is the one `/inventory` and `/shipping` already make and then
 * *lose* at six: those sections have two destinations each and reach the second
 * from the first's header, which is right for two and is chrome at five. Nor do
 * these six belong in the sidebar — they share a capability and a URL prefix and
 * nothing else. A page is not a banner is not a menu: no shared query, no shared
 * filter bar, no shared row shape, and `AppShell`'s tree groups by domain rather
 * than by prefix.
 *
 * What earns the extra navigation is the **count**. "Bannières 4" tells a content
 * manager whether to go in, which is the entire job of an index.
 *
 * ## Every count is fetched with `?status=any`, and that inversion is the point
 *
 * Everywhere else in this panel the absence of `?status=` means "all"; on
 * `/cms/*` it means **publish only**. A hub that sent nothing would report three
 * FAQs where there are four and hide the draft the person came to finish.
 * `lib/cms.ts` carries the same note beside `DEFAULT_STATUS_FILTER`.
 *
 * ## `/media` is here and also in the sidebar, and both are honest
 *
 * `nav-tree.ts` files it under **catalog**, because a product photograph is what
 * most of that library is; this index files it under **content**, because the
 * library is also where a banner's picture comes from. Two front doors to one
 * screen is what `/inventory/movements` already has. Recorded rather than
 * "fixed": removing either one would take a true statement off the screen.
 *
 * ## No stale marker
 *
 * DESIGN.md §3.7, as amended on the customers branch. This is a Server Component
 * with no writes, nothing polling and no refresh control, so what is on screen is
 * exactly as old as the navigation that fetched it and cannot drift from it. A
 * banner reporting that age would be true and useless, and the half of the rule
 * that does the real work — "every write control disabled with that same reason"
 * — has nothing to disable.
 */

type Destination = {
  key: string;
  href: string;
  icon: IconName;
  count: number | null;
};

export default async function ContentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("content");

  if (!has(me, "ac_manage_content")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader title={t("title")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_content" />
        </PageBody>
      </div>
    );
  }

  /*
   * Four requests for four counts, in parallel, and a failure in any one of them
   * is a missing count rather than a missing screen. An index that 500s because
   * the FAQ endpoint is unhappy would take away the five destinations that work.
   */
  const soften = (error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  };

  const [pages, banners, faqs, media] = await Promise.all([
    acFetch(pageList, session, "/cms/pages?per_page=1&status=any").catch(soften),
    acFetch(bannerList, session, "/cms/banners?per_page=1&status=any").catch(soften),
    acFetch(faqList, session, "/cms/faqs?per_page=1&status=any").catch(soften),
    acFetch(mediaList, session, "/media?per_page=1").catch(soften),
  ]);

  const total = (result: { meta: Record<string, unknown> | null } | null) => {
    if (!result?.meta) return null;
    const parsed = listMeta.safeParse(result.meta);
    return parsed.success ? parsed.data.total : null;
  };

  const destinations: Destination[] = [
    { key: "pages", href: "/content/pages", icon: "note", count: total(pages) },
    /*
     * The homepage carries no count — it is one document, not a collection, and
     * "1" beside it would be noise. Its own screen reports the section count and
     * the drop report, which are the numbers that mean something. `menus` is the
     * same argument at two: the locations are a fixed pair, so counting them
     * reports a constant.
     */
    { key: "homepage", href: "/content/homepage", icon: "dashboard", count: null },
    { key: "banners", href: "/content/banners", icon: "image", count: total(banners) },
    { key: "faqs", href: "/content/faqs", icon: "note", count: total(faqs) },
    { key: "menus", href: "/content/menus", icon: "list", count: null },
    { key: "media", href: "/media", icon: "image", count: total(media) },
  ];

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader title={t("title")} />
      <PageBody width="detail">
        <Card footnote={t("hubNote")}>
          <NavList>
            {destinations.map((destination) => (
              <NavRow
                key={destination.key}
                href={`/${locale}${destination.href}`}
                label={t(`section.${destination.key}`)}
                icon={destination.icon}
                meta={
                  /*
                    `Ltr` around the number, never around the row. A full-width
                    cell wrapped in `Ltr` forces the *cell's* direction, which is
                    how the analytics branch put a provider name at the wrong end
                    of an Arabic row.
                  */
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
