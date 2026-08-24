import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { couponList } from "@/lib/api/schemas/coupon";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { SHOP_CURRENCY } from "@/lib/format/money";
import { CouponsList } from "./CouponsList";
import { listParams, queryFromParams } from "./query";

/**
 * The coupon list.
 *
 * A Server Component fetches the first page with the sealed credential and
 * streams it, so first paint carries data — the arrangement orders, products,
 * inventory and customers all use.
 */
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
   *
   * A 403 is a screen state, never a logout. Only a 401 clears the session.
   */
  if (!has(me, "ac_manage_coupons")) {
    const t = await getTranslations("coupons");
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {/* No subtitle, so `coupons-count` is absent rather than reporting a
            total nobody was allowed to read. The suite asserts that. */}
        <PageHeader title={t("title")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_coupons" />
        </PageBody>
      </div>
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
      // A failed first page renders through the client's error state rather than
      // crashing the route; the client retries against the same URL.
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
