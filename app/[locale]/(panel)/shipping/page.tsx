import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import {
  shipments as shipmentsSchema,
  shippingProviders as providersSchema,
  type ShippingProvider,
} from "@/lib/api/schemas/shipping";
import { wilayas as wilayasSchema, type Wilaya } from "@/lib/api/schemas/order";
import { stripLabelUrlsFrom } from "@/lib/shipping";
import { has } from "@/lib/capabilities";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { ParcelsList } from "./ParcelsList";
import { listParams, queryFromParams } from "./query";

/**
 * The parcels list.
 *
 * A Server Component fetches page one with the sealed credential and streams it,
 * so first paint carries data — the arrangement orders, products, inventory,
 * customers and coupons all use.
 *
 * **Every shipment is stripped of its label URLs here**, on the server, before it
 * becomes a prop. In the App Router that is the boundary that matters: props are
 * serialised into the RSC payload and the RSC payload is in the document, so a
 * shipment handed to a client component unstripped would put a courier's
 * credential into the HTML whether or not anything rendered it. See
 * `stripLabelUrls` for what the field actually is.
 */
export default async function ShippingPage({
  params,
  searchParams,
}: {
  /** A Promise in Next 16, like `searchParams` and `cookies()`. */
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);

  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") incoming.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) incoming.set(key, value[0]);
  }

  /*
   * **This route used to open on the tariff**, behind `?view=rules|parcels`, and
   * the split moved the tariff to `/shipping/rules`. That is a flip of what
   * `/shipping` shows, so an old bookmark or a link in somebody's notes pointing
   * at `?view=rules` would silently land on a different screen than it named.
   * It redirects instead. `?view=parcels` needs nothing — it is this route
   * already, and the parameter is ignored on the way through.
   *
   * Before the session check would leak the existence of the route to an
   * unauthenticated visitor; after the capability check would send a person
   * without `ac_manage_shipping` to a second refusal on a different URL. Here,
   * between the two, is the only place it belongs.
   */
  if (incoming.get("view") === "rules") redirect(`/${locale}/shipping/rules`);

  /*
   * `ac_manage_shipping` is held by both tiers after the two-tier collapse —
   * measured: Super Admin and Manager both 200 on every route this screen calls.
   * The gate stays because capabilities decide what renders and a third tier
   * would make it bite again, and because a person who types the URL without the
   * capability gets a clean refusal rather than a page of failed requests.
   *
   * A 403 is a screen state, never a logout. Only a 401 clears the session.
   */
  if (!has(me, "ac_manage_shipping")) {
    const t = await getTranslations("shipping");
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {/* No subtitle, so `parcels-count` is absent rather than reporting a
            total nobody was allowed to read. */}
        <PageHeader title={t("title")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_shipping" />
        </PageBody>
      </div>
    );
  }

  const query = queryFromParams(incoming);

  /*
   * Three reads in parallel, each failing alone.
   *
   * A failed **parcels** page renders through the client's error state rather
   * than crashing the route, and the client retries against the same URL. The
   * other two are chrome for the rows: a provider label falls back to its own
   * slug and a missing wilaya renders as "destination not recorded", so neither
   * failure is worth taking the screen down for.
   */
  const [initial, providersResult, geography] = await Promise.all([
    acFetch(shipmentsSchema, session, `/shipments?${listParams(query)}`).catch(
      (error: unknown) => {
        if (error instanceof ApiError) return null;
        throw error;
      },
    ),
    acFetch(providersSchema, session, "/shipping/providers")
      .then((r) => r.data)
      .catch(() => [] as ShippingProvider[]),
    acFetch(wilayasSchema, session, "/locations/wilayas")
      .then((r) => r.data)
      .catch(() => [] as Wilaya[]),
  ]);

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <ParcelsList
      locale={locale}
      initialQuery={query}
      /* Stripped here, never in the component. The names of the keys that were
         removed travel with each row so a label link can exist; the URLs do not
         travel at all. */
      initialParcels={initial === null ? null : stripLabelUrlsFrom(initial.data)}
      initialTotal={meta?.success ? meta.data.total : null}
      providers={providersResult}
      wilayas={geography}
    />
  );
}
