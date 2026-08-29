import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { FormSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches the page.
 *
 * **It draws one 640px column of form cards**, which is the whole reason this
 * file is worth having rather than a spinner: the real screen is
 * `PageBody width="form"`, and a full-width or two-column placeholder would paint
 * one shape and reflow into another the moment the data lands — a layout shift
 * with extra steps, §3.6's own words.
 *
 * The card counts are the real screen's and the field counts are the real cards':
 * content is three controls (title, body, excerpt), address three (slug, parent,
 * the read-only current path), publishing three (status, menu order, the
 * read-only modified stamp), and SEO five (title, description, canonical and the
 * two robot switches). The rename warning is not drawn — it appears only once
 * somebody has typed a new address, which nobody has on a screen that is still
 * loading.
 *
 * **The save bar is deliberately absent.** It is `sticky` and appears only when
 * the form goes dirty, which a form nobody has typed into is not — drawing one
 * here would settle downwards on every visit.
 */
export default async function ContentPageLoading() {
  const locale = await getLocale();
  const t = await getTranslations("content");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("section.pages")}
        subtitle={label}
        back={{ href: `/${locale}/content/pages`, label: t("section.pages") }}
        divided={false}
        actions={
          /* The one real control's box: a 36px secondary icon button opening the
             delete menu, so the header does not reflow when it lands. */
          <Skeleton className="size-9 rounded-ui-md" />
        }
      />

      <PageBody width="form">
        <div className="flex flex-col gap-4">
          <FormSkeleton fields={3} label={label} />
          <FormSkeleton fields={3} footnote={2} label={label} />
          <FormSkeleton fields={3} label={label} />
          <FormSkeleton fields={5} footnote={1} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
