import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";

/**
 * A 404 in the panel means gone. (On the storefront's `/account/orders/{id}` the
 * same status means "not yours" — a distinction worth keeping in mind when this
 * component is reused.)
 *
 * `EmptyState` rather than `ErrorState`, and the difference is not cosmetic:
 * `ErrorState` opens with "something went wrong" and offers a retry, and neither
 * is true here. Nothing went wrong and there is nothing to retry — the record is
 * gone. The title is the header's, and the way out is its back link, which is now
 * rendered at every width.
 */
export default async function OrderNotFound() {
  // A not-found boundary receives no params, so the locale comes from next-intl's
  // request scope rather than from a prop.
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tDetail = await getTranslations({ locale, namespace: "orders.detail" });

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("notFoundTitle")}
        back={{ href: `/${locale}/orders`, label: tDetail("back") }}
        divided={false}
      />
      <PageBody width="detail">
        <EmptyState icon="alert" message={t("notFoundBody")} />
      </PageBody>
    </div>
  );
}
