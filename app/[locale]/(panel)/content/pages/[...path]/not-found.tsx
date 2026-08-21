import { getLocale, getTranslations } from "next-intl/server";
import { Scaffold } from "@/components/patterns/Scaffold";
import { Icon } from "@/components/primitives/Icon";

/**
 * A 404 on a page path.
 *
 * This screen carries a longer explanation than the other not-found screens,
 * because the API's 404 here is genuinely ambiguous and the panel is the only
 * place that can say so.
 *
 * `GET /cms/pages/{path}` answers **"No page at that path."** for two different
 * facts: the path names nothing, or it names a page whose status was excluded.
 * The detail route already asks with `?status=any`, which is publish plus draft
 * — so reaching this screen means the path really is unknown *or* the page is in
 * the trash, and the trash is deliberately not something `?status=` can reach.
 *
 * A rename is the third way here, and the likeliest: WordPress leaves no
 * redirect behind, so a bookmark or a back button pointing at the old address
 * lands exactly here.
 */
export default async function ContentPageNotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tContent = await getTranslations({ locale, namespace: "content" });

  return (
    <Scaffold
      title={tContent("section.pages")}
      back={{ href: `/${locale}/content/pages`, label: tContent("section.pages") }}
    >
      <div className="px-4">
        <div className="rounded-lg bg-surface px-6 py-12 text-center">
          <Icon name="alert" className="mx-auto size-8 text-label-tertiary" />
          <h2 className="mt-4 text-title-3 text-label">{t("notFoundTitle")}</h2>
          <p className="mt-2 text-body text-label-secondary">
            {tContent("pages.notFound")}
          </p>
          <p className="mt-1 text-footnote text-label-secondary">
            {tContent("pages.notFoundReason")}
          </p>
        </div>
      </div>
    </Scaffold>
  );
}
