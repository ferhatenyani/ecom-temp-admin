import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { couponDetail } from "@/lib/api/schemas/coupon";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { CouponForm } from "./CouponForm";

/** `params` is a Promise in Next 16, like `searchParams` and `cookies()`. */
export default async function CouponPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { session, me } = await requireSession(locale);

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

  // The route is `\d+` at the proxy and in the API's own pattern; `new` is a
  // sibling route rather than an id, so it never reaches here.
  if (!/^\d+$/.test(id)) notFound();

  /*
   * A trashed coupon reads back **200 with `status: "trash"`** — measured, the
   * same behaviour a trashed product has — and only `?force=true` produces the
   * 404. So this is not a defensive branch: the form renders the trashed state
   * with its own banner and offers the permanent delete.
   */
  const coupon = await acFetch(couponDetail, session, `/coupons/${id}`).catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    },
  );

  return <CouponForm locale={locale} initialCoupon={coupon.data} mode="edit" />;
}
