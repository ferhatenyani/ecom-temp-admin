import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { couponList } from "@/lib/api/schemas/coupon";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { SHOP_CURRENCY } from "@/lib/format/money";
import { CouponsList } from "./CouponsList";
import { listParams, queryFromParams } from "./query";

export default async function CouponsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);

  /*
   * **The inverse of the customers screen, and that is what makes this branch
   * carry two forbidden fixtures.**
   *
   * Measured 2026-08-19: `ac_manage_coupons` is held by Super Admin, Manager and
   * Marketing Manager. A **Support Agent is 403 here** while being 200 on
   * `/customers`, and a **Marketing Manager is 200 here** while being 403 there.
   * The ready-made forbidden fixture from the last two branches works for neither
   * screen on its own.
   */
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

  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") incoming.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) incoming.set(key, value[0]);
  }
  const query = queryFromParams(incoming);

  const initial = await acFetch(couponList, session, `/coupons?${listParams(query)}`).catch(
    (error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    },
  );

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <CouponsList
      locale={locale}
      currency={SHOP_CURRENCY}
      initialQuery={query}
      initialCoupons={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
    />
  );
}
