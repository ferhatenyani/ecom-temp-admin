import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import {
  shippingProviders as providersSchema,
  shippingRules as rulesSchema,
  type ShippingProvider,
} from "@/lib/api/schemas/shipping";
import { wilayas as wilayasSchema, type Wilaya } from "@/lib/api/schemas/order";
import { has } from "@/lib/capabilities";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { RulesScreen } from "./RulesScreen";

/**
 * The tariff rules and the resolver.
 *
 * Reached from the parcels header rather than from the sidebar — `nav-tree.ts`
 * keeps one `/shipping` entry, the way `/inventory/movements` is reached from the
 * stock list. `RulesScreen` carries the argument for the split; what this file
 * adds is the two things only the server can supply: the capability gate and the
 * sealed-credential fetch.
 */
export default async function ShippingRulesPage({
  params,
}: {
  /** A Promise in Next 16, like `searchParams` and `cookies()`. */
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("shipping");

  /* The same gate as the parcels list, and measured the same way: both tiers
     hold `ac_manage_shipping` and both are 200 on every route this screen calls.
     A 403 is a screen state, never a logout. */
  if (!has(me, "ac_manage_shipping")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader
          title={t("rulesTitle")}
          back={{ href: `/${locale}/shipping`, label: t("title") }}
          divided={false}
        />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_shipping" />
        </PageBody>
      </div>
    );
  }

  /*
   * Three reads in parallel, each failing alone.
   *
   * `null` from the rules read means *this could not load* and renders as such —
   * distinct from an empty array, which means *there is no tariff yet* and is the
   * ordinary state of a shop that has never set one. One `SectionError` serving
   * both is the defect the inventory branch found and fixed, so the two are
   * separate props here.
   *
   * The other two are chrome: a provider label falls back to its own slug, and a
   * missing wilaya list leaves the resolver's picker empty rather than the page
   * broken.
   */
  const [rules, providers, geography] = await Promise.all([
    acFetch(rulesSchema, session, "/shipping/rules")
      .then((r) => r.data)
      .catch(() => null),
    acFetch(providersSchema, session, "/shipping/providers")
      .then((r) => r.data)
      .catch(() => [] as ShippingProvider[]),
    acFetch(wilayasSchema, session, "/locations/wilayas")
      .then((r) => r.data)
      .catch(() => [] as Wilaya[]),
  ]);

  return (
    <RulesScreen
      locale={locale}
      rules={rules ?? []}
      failed={rules === null}
      providers={providers}
      wilayas={geography}
    />
  );
}
