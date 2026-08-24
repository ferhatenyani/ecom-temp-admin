import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { BLANK, CouponForm } from "../[id]/CouponForm";

/**
 * Creating a coupon.
 *
 * Its own route rather than an overlay: the form is seven sections tall and opens
 * a `Drawer` of its own for the restrictions, and a drawer inside a drawer at the
 * 340px floor is two dismiss gestures stacked on one screen.
 *
 * `POST /coupons` is on the proxy allowlist while `POST /products` is not, and the
 * difference is real rather than an inconsistency: a coupon has no variations, no
 * media and no option set, so creating one is the same form as editing one with an
 * empty object behind it.
 */
export default async function NewCouponPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { me } = await requireSession(locale);

  if (!has(me, "ac_manage_coupons")) {
    const t = await getTranslations("coupons");
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader
          title={t("createTitle")}
          back={{ href: `/${locale}/coupons`, label: t("title") }}
          divided={false}
        />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_coupons" />
        </PageBody>
      </div>
    );
  }

  return <CouponForm locale={locale} initialCoupon={BLANK} mode="create" />;
}
