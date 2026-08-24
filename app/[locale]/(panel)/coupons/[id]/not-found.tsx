import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";

/**
 * A 404 on a coupon id.
 *
 * Reached one way in practice, and it is a state this screen creates itself:
 * **`?force=true` is the only thing that makes a coupon 404.** A trash answers
 * 200 with `status: "trash"` and keeps the coupon readable — the form renders
 * that with its own banner — so someone who permanently deletes a coupon and then
 * uses the back button lands here.
 *
 * `EmptyState` rather than `ErrorState`, and the difference is not cosmetic:
 * `ErrorState` opens with "something went wrong" and offers a retry, and neither
 * is true. Nothing went wrong and there is nothing to retry — the record is gone,
 * because somebody on this screen typed its code to say so. The way out is the
 * header's back link, which is rendered at every width.
 */
export default async function CouponNotFound() {
  // A not-found boundary receives no params, so the locale comes from next-intl's
  // request scope rather than from a prop.
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tCoupons = await getTranslations({ locale, namespace: "coupons" });

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("notFoundTitle")}
        back={{ href: `/${locale}/coupons`, label: tCoupons("title") }}
        divided={false}
      />
      <PageBody width="detail">
        <EmptyState icon="alert" message={tCoupons("notFound")} />
      </PageBody>
    </div>
  );
}
