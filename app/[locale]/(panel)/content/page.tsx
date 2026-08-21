import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { pageList, bannerList, faqList } from "@/lib/api/schemas/cms";
import { mediaList } from "@/lib/api/schemas/media";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ForbiddenState } from "@/components/patterns/States";
import { ListGroup, ListLinkRow } from "@/components/primitives/GroupedList";
import { Icon, type IconName } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";

/**
 * Content is five collections and a media library, and this is the hub.
 *
 * Not a segmented control, which is the pattern `/inventory` uses for its three
 * views. Six destinations do not fit one at the 390px floor — each segment would
 * be 65px, below the 44px target only because the labels would have wrapped
 * first — and unlike inventory's three, these six share no query, no filter bar
 * and no row shape. A page is not a banner is not a menu.
 *
 * So it is the iOS Settings grammar instead: a grouped list of destinations,
 * each carrying the count behind it. The count is the part that earns the extra
 * tap — "Bannières 4" tells a content manager whether to go in, which is exactly
 * what the hub is for.
 *
 * Every count is fetched with `?status=any`, and that is the inversion worth
 * noticing. Everywhere else in this panel the absence of `?status=` means "all";
 * here it means **publish only**, so a hub that sent nothing would report 3 FAQs
 * where there are 4 and hide the draft the person came to finish.
 */

type Section = {
  key: string;
  href: string;
  icon: IconName;
  count: number | null;
};

export default async function ContentPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("content");

  if (!has(me, "ac_manage_content")) {
    return (
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_content" />
        </div>
      </Scaffold>
    );
  }

  /*
   * Six requests for six counts, in parallel, and a failure in any one of them
   * is a missing count rather than a missing screen. A hub that 500s because the
   * FAQ endpoint is unhappy would take away the five destinations that work.
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

  const sections: Section[] = [
    { key: "pages", href: "/content/pages", icon: "note", count: total(pages) },
    /*
     * The homepage carries no count — it is one document, not a collection, and
     * "1" beside it would be noise. Its own screen reports the section count and
     * the drop report, which are the numbers that mean something.
     */
    { key: "homepage", href: "/content/homepage", icon: "dashboard", count: null },
    { key: "banners", href: "/content/banners", icon: "image", count: total(banners) },
    { key: "faqs", href: "/content/faqs", icon: "note", count: total(faqs) },
    { key: "menus", href: "/content/menus", icon: "list", count: null },
    { key: "media", href: "/media", icon: "image", count: total(media) },
  ];

  return (
    <Scaffold title={t("title")}>
      <div className="mx-auto max-w-3xl px-4">
        <ListGroup footnote={t("hubNote")}>
          {sections.map((section) => (
            <ListLinkRow
              key={section.key}
              href={`/${locale}${section.href}`}
              ariaLabel={t(`section.${section.key}`)}
            >
              <span className="flex items-center gap-3">
                <Icon name={section.icon} className="size-5 shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate text-body text-label" dir="auto">
                  {t(`section.${section.key}`)}
                </span>
                {/*
                  A count is a bare number, so `Ltr` — and `Ltr` around the
                  number, never around the row. A full-width cell wrapped in
                  `Ltr` forces the *cell's* direction, which is how the analytics
                  branch put a provider name at the wrong end of an Arabic row.
                */}
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
