import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import {
  shipments as shipmentsSchema,
  shippingProviders as providersSchema,
  shippingRules as rulesSchema,
  type Shipment,
  type ShippingProvider,
  type ShippingRule,
} from "@/lib/api/schemas/shipping";
import { wilayas as wilayasSchema, type Wilaya } from "@/lib/api/schemas/order";
import { stripLabelUrlsFrom } from "@/lib/shipping";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ShippingScreen } from "./ShippingScreen";
import { queryFromParams, shipmentParams } from "./query";

/**
 * The shipping section — the tariff and the parcels.
 *
 * A Server Component fetches with the sealed credential and streams, so first
 * paint carries data; everything after belongs to TanStack Query.
 *
 * **Every shipment is stripped of its label URLs here**, on the server, before it
 * becomes a prop. In the App Router that is the boundary that matters: props are
 * serialised into the RSC payload and the RSC payload is in the document, so a
 * shipment handed to a client component unstripped would put a courier's
 * credential into the HTML whether or not anything rendered it. See
 * `stripLabelUrls` for what the field actually is and why the spec's description
 * of it is wrong.
 */
export default async function ShippingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("shipping");

  /*
   * `ac_manage_shipping` is held by both tiers after the two-tier collapse —
   * measured: Super Admin and Manager both 200 on every route this screen calls.
   * The gate stays because capabilities decide what renders and a third tier
   * would make it bite again, and because a person who types the URL without the
   * capability gets a clean refusal rather than a page of failed requests.
   */
  if (!has(me, "ac_manage_shipping")) {
    return (
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_shipping" />
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

  /*
   * Four reads in parallel, each failing alone. `null` means "this could not
   * load" and renders as such — distinct from an empty array, which means "there
   * is nothing here" and is the ordinary state of `/shipping/rules` on a shop
   * that has never set a tariff.
   *
   * The wilaya list is fetched even on the parcels view because a shipment row
   * names the wilaya it was sent to, off `metadata.wilaya_id`.
   */
  const [rulesResult, providersResult, shipmentsResult, geography] = await Promise.all([
    acFetch(rulesSchema, session, "/shipping/rules")
      .then((r) => r.data)
      .catch(() => null),
    acFetch(providersSchema, session, "/shipping/providers")
      .then((r) => r.data)
      .catch(() => [] as ShippingProvider[]),
    acFetch(shipmentsSchema, session, "/shipments", {
      query: Object.fromEntries(shipmentParams(query)),
    })
      .then((r) => ({
        data: r.data,
        total: typeof r.meta?.total === "number" ? r.meta.total : 0,
      }))
      .catch(() => null),
    acFetch(wilayasSchema, session, "/locations/wilayas")
      .then((r) => r.data)
      .catch(() => [] as Wilaya[]),
  ]);

  const rules: ShippingRule[] | null = rulesResult;
  const providers: ShippingProvider[] = providersResult ?? [];
  const initialShipments: Shipment[] = shipmentsResult?.data ?? [];
  const total = shipmentsResult?.total ?? 0;

  return (
    <Scaffold title={t("title")}>
      <ShippingScreen
        locale={locale}
        query={query}
        rules={rules}
        providers={providers}
        // Stripped here, never in the component. The names of the keys that were
        // removed travel with each row so a label button can exist; the URLs do
        // not travel at all.
        initialShipments={stripLabelUrlsFrom(initialShipments)}
        shipmentsFailed={shipmentsResult === null}
        total={total}
        wilayas={geography ?? []}
      />
    </Scaffold>
  );
}
