import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { couponDetail } from "@/lib/api/schemas/coupon";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
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
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader
          title={t("title")}
          back={{ href: `/${locale}/coupons`, label: t("title") }}
          divided={false}
        />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_coupons" />
        </PageBody>
      </div>
    );
  }

  // The route is `\d+` at the proxy and in the API's own pattern; `new` is a
  // sibling route rather than an id, so it never reaches here.
  if (!/^\d+$/.test(id)) notFound();

  /*
   * A trashed coupon reads back **200 with `status: "trash"`** — measured, the
   * same behaviour a trashed product has — and only `?force=true` produces the
   * 404. So this is not a defensive branch: the form renders the trashed state
   * with its own banner, offers the permanent delete, and saving is what restores
   * it as a draft.
   */
  const coupon = await acFetch(couponDetail, session, `/coupons/${id}`).catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    },
  );

  /**
   * When this render happened, for §3.7's stale marker.
   *
   * The same reasoning the product and order details record: this is a Server
   * Component, so the age of what is on screen is the age of *this* render.
   * `react-hooks/purity` flags reading the clock in a component body and is right
   * about the client case it is written for; an async Server Component runs once
   * per request and never re-renders, so this is part of the fetch rather than
   * part of the render. Recording it in a mount effect instead gives an age that
   * stops moving after `router.refresh()`, which re-renders the server tree
   * without remounting the client one.
   */
  // eslint-disable-next-line react-hooks/purity -- see above: a Server Component renders once per request.
  const fetchedAt = Date.now();

  return (
    <CouponForm
      locale={locale}
      initialCoupon={coupon.data}
      fetchedAt={fetchedAt}
      mode="edit"
    />
  );
}
