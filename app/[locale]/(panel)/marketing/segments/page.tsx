import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { segmentList } from "@/lib/api/schemas/campaign";
import { wilayas as wilayasSchema, type Wilaya } from "@/lib/api/schemas/order";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { SegmentsList } from "./SegmentsList";
import { listParams, queryFromParams } from "./query";

export default async function SegmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("campaigns");

  if (!has(me, "ac_manage_marketing")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader title={t("segments")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_marketing" />
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

  /*
   * The two reads, in parallel — the second is the wilaya picker's source.
   *
   * **Fetched here rather than in the modal**, which is the shape all five
   * existing wilaya pickers already have: `/locations/wilayas` is unpaginated
   * (`LocationController::searchArgs()` declares `search` and `active_only` and
   * nothing else, under a docblock headed *"No pagination"*), public
   * (`permission_callback => '__return_true'`, the one such route in the plugin),
   * and 69 rows that never move. So it is one server read for the whole screen
   * rather than a client query behind a dialog that is usually shut, and the
   * panel gains no sixth way of getting the same list.
   *
   * `.catch(() => [])` like the other four call sites, and the modal draws the
   * empty case: a picker that will not load must not make the criterion
   * unfillable, which is `DestinationFields`' rule.
   *
   * `active_only` is deliberately not sent, for the reason `DestinationFields`
   * records at length — a place missing from a list with no explanation is
   * indistinguishable from one the shop has never heard of — and here it is
   * sharper still: a segment names where past orders *went*, so a wilaya
   * switched off for delivery today is exactly the kind a stored segment refers
   * to.
   */
  const [initial, geography] = await Promise.all([
    acFetch(segmentList, session, `/segments?${listParams(query)}`).catch((error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    }),
    acFetch(wilayasSchema, session, "/locations/wilayas")
      .then((result) => result.data)
      .catch(() => [] as Wilaya[]),
  ]);

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <SegmentsList
      locale={locale}
      initialQuery={query}
      initialSegments={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
      /*
       * A segment's **count** needs `ac_manage_customers` on top of the marketing
       * capability — it is a count of customers — while the list itself does not.
       * Measured: a Marketing Manager is 200 on `/segments` and 403 on
       * `/segments/{id}/preview`. So the rows render and the numbers say whose
       * permission they are.
       */
      canCount={has(me, "ac_manage_customers")}
      wilayas={geography}
      /*
       * **`ac_manage_coupons`, and it is the right capability rather than a
       * surprising one.** The product criteria are named through
       * `GET /coupons/eligible-products`, which `CouponController:38` gates on
       * `Capabilities::MANAGE_COUPONS` — and which is the only route in the
       * plugin that resolves a list of product ids in one request, because
       * `ProductController::indexArgs()` declares no `include` at all.
       *
       * Every role that holds `ac_manage_marketing` — the capability this whole
       * screen is gated on, three rows up — also holds this one: Super Admin has
       * all thirteen, Admin has eleven including coupons, and Marketing
       * Manager's four are marketing, content, **coupons** and analytics. So
       * this is false only for a hand-edited credential, and
       * `CriterionField.tsx` says why the fallback is worded as a guard rather
       * than as a live path. `product-lookup.ts` carries the route argument.
       */
      canPickProducts={has(me, "ac_manage_coupons")}
    />
  );
}
