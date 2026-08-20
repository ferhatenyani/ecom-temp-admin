"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Segmented } from "@/components/primitives/Segmented";
import type { SafeShipment } from "@/lib/shipping";
import type { ShippingProvider, ShippingRule } from "@/lib/api/schemas/shipping";
import type { Wilaya } from "@/lib/api/schemas/order";
import { RulesView } from "./RulesView";
import { ParcelsView } from "./ParcelsView";
import { paramsFromQuery, type ShippingQuery, type View } from "./query";

/**
 * One route, two views.
 *
 * **What the shop charges and what a courier quotes are separate and must look
 * separate.** The tariff is a set of rules the shop wrote; a parcel is a thing in
 * a van. They share a capability and a person and nothing else, so they are two
 * segments rather than two sections of one scroll.
 */
export function ShippingScreen({
  locale,
  query,
  rules,
  providers,
  initialShipments,
  shipmentsFailed,
  total,
  wilayas,
}: {
  locale: string;
  query: ShippingQuery;
  rules: ShippingRule[] | null;
  providers: ShippingProvider[];
  initialShipments: SafeShipment[];
  shipmentsFailed: boolean;
  total: number;
  wilayas: Wilaya[];
}) {
  const t = useTranslations("shipping");
  const router = useRouter();

  /**
   * The URL is the state. `push`, never `replace` — replacing the history entry
   * means going back from a filtered list skips the unfiltered one, which the
   * orders branch measured and the e2e suite asserts.
   */
  const navigate = useCallback(
    (next: ShippingQuery) => {
      const params = paramsFromQuery(next);
      const search = params.toString();
      router.push(`/${locale}/shipping${search === "" ? "" : `?${search}`}`);
    },
    [locale, router],
  );

  return (
    <div className="mx-auto max-w-3xl px-4">
      <div className="mb-6">
        <Segmented<View>
          label={t("title")}
          value={query.view}
          segments={[
            { value: "rules", label: t("tabRules") },
            { value: "parcels", label: t("tabShipments") },
          ]}
          // Changing view resets the page: page 3 of the parcels list is not a
          // position the tariff has.
          onChange={(view) => navigate({ ...query, view, page: 1 })}
        />
      </div>

      {query.view === "rules" ? (
        <RulesView rules={rules} providers={providers} wilayas={wilayas} locale={locale} />
      ) : (
        <ParcelsView
          query={query}
          initialShipments={initialShipments}
          failed={shipmentsFailed}
          total={total}
          providers={providers}
          wilayas={wilayas}
          locale={locale}
          onQueryChange={navigate}
        />
      )}
    </div>
  );
}
