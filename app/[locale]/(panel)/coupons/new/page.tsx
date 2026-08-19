import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { BLANK, CouponForm } from "../[id]/CouponForm";

/**
 * Creating a coupon.
 *
 * Its own route rather than a sheet: the form is eight sections tall and includes
 * a picker that opens a sheet of its own, and a sheet inside a sheet at the 390px
 * floor is two dismiss gestures stacked on one screen.
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
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_coupons" />
        </div>
      </Scaffold>
    );
  }

  return <CouponForm locale={locale} initialCoupon={BLANK} mode="create" />;
}
