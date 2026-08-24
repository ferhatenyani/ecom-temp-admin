import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";

/**
 * A 404 on a product means gone — and here that is a real destination rather
 * than a defensive branch: `?force=true` removes permanently, and the next GET
 * of the same id answers 404. A trashed product does **not** land here; it reads
 * back with a 200 and `status: "trash"`, which the detail screen renders with a
 * standing notice rather than as an absence.
 *
 * `EmptyState` rather than `ErrorState`, and the difference is not cosmetic:
 * `ErrorState` opens with "something went wrong" and offers a retry, and neither
 * is true here. Nothing went wrong and there is nothing to retry — the record is
 * gone. The way out is the header's back link, which is rendered at every width.
 */
export default async function ProductNotFound() {
  // A not-found boundary receives no params, so the locale comes from next-intl's
  // request scope rather than from a prop.
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tProducts = await getTranslations({ locale, namespace: "products" });

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("notFoundTitle")}
        back={{ href: `/${locale}/products`, label: tProducts("title") }}
        divided={false}
      />
      <PageBody width="detail">
        <EmptyState icon="alert" message={tProducts("detail.notFound")} />
      </PageBody>
    </div>
  );
}
