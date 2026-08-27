import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";

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
 *
 * `EmptyState` rather than `ErrorState`, and the difference is not cosmetic:
 * `ErrorState` opens with "something went wrong" and offers a retry, and neither
 * is true. Nothing went wrong, and retrying the same path will answer the same
 * 404 forever. `detail` carries the three reasons, which is the slot the
 * shipping branch added for exactly this — a fact, and then what the absence
 * costs. The way out is the header's back link, rendered at every width.
 */
export default async function ContentPageNotFound() {
  // A not-found boundary receives no params, so the locale comes from next-intl's
  // request scope rather than from a prop.
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tContent = await getTranslations({ locale, namespace: "content" });

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("notFoundTitle")}
        back={{ href: `/${locale}/content/pages`, label: tContent("section.pages") }}
        divided={false}
      />
      <PageBody width="detail">
        <EmptyState
          icon="alert"
          message={tContent("pages.notFound")}
          detail={tContent("pages.notFoundReason")}
        />
      </PageBody>
    </div>
  );
}
