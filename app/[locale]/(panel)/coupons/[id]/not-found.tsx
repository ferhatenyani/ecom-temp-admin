import { getLocale, getTranslations } from "next-intl/server";
import { Scaffold } from "@/components/patterns/Scaffold";
import { Icon } from "@/components/primitives/Icon";

/**
 * A 404 on a coupon id.
 *
 * Reached one way in practice, and it is a state this screen creates itself:
 * **`?force=true` is the only thing that makes a coupon 404.** A trash answers
 * 200 with `status: "trash"` and keeps the coupon readable, so someone who
 * permanently deletes a coupon and then uses the back button lands here.
 */
export default async function CouponNotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tCoupons = await getTranslations({ locale, namespace: "coupons" });

  return (
    <Scaffold
      title={tCoupons("title")}
      back={{ href: `/${locale}/coupons`, label: tCoupons("title") }}
    >
      <div className="px-4">
        <div className="rounded-lg bg-surface px-6 py-12 text-center">
          <Icon name="alert" className="mx-auto size-8 text-label-tertiary" />
          <h2 className="mt-4 text-title-3 text-label">{t("notFoundTitle")}</h2>
          <p className="mt-2 text-body text-label-secondary">{tCoupons("notFound")}</p>
        </div>
      </div>
    </Scaffold>
  );
}
