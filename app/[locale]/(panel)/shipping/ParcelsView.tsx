"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { acRead } from "@/lib/api/browser";
import { stripLabelUrlsFrom, type SafeShipment } from "@/lib/shipping";
import { SHIPMENT_STATUSES } from "@/lib/shipment-status";
import type { Shipment, ShippingProvider } from "@/lib/api/schemas/shipping";
import type { Wilaya } from "@/lib/api/schemas/order";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { SelectField } from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { EmptyState, SectionError, SkeletonRows } from "@/components/patterns/States";
import { Isolate } from "@/components/primitives/Ltr";
import { ShipmentRow } from "./ShipmentRow";
import { ShipmentSheet } from "./ShipmentSheet";
import { PER_PAGE, shipmentParams, type ShippingQuery, type StatusFilter } from "./query";

/**
 * The parcels list.
 *
 * **There is no "live only" filter, and that is the useful one.** `?is_live=true`
 * is accepted and ignored — measured, it returns all 111 rows, identical to
 * `?bogus_param=1` — so the single question an operator most wants to ask is one
 * the server cannot answer. Offering a control that silently returned everything
 * would be worse than not offering it, so the filter is by status and the row
 * carries the live/finished distinction itself.
 */
export function ParcelsView({
  query,
  initialShipments,
  failed,
  total,
  providers,
  wilayas,
  locale,
  onQueryChange,
}: {
  query: ShippingQuery;
  initialShipments: SafeShipment[];
  failed: boolean;
  total: number;
  providers: ShippingProvider[];
  wilayas: Wilaya[];
  locale: string;
  onQueryChange: (next: ShippingQuery) => void;
}) {
  const t = useTranslations("shipping");
  const tStatus = useTranslations("shipmentStatus");
  const [open, setOpen] = useState<SafeShipment | null>(null);

  /*
   * The server component already fetched this exact page, so the first render
   * uses it and no request is made until the filter or the page moves.
   *
   * Every row is stripped again on arrival. The server strips what it streams;
   * this strips what the browser fetches afterwards, and both are needed — a
   * client-side refetch goes through the proxy and comes back with `metadata`
   * exactly as the API sends it.
   */
  const shipments = useQuery({
    queryKey: ["shipments", query.status, query.page],
    initialData:
      failed || query.page !== 1
        ? undefined
        : { data: initialShipments as unknown as Shipment[], total },
    queryFn: async () => {
      const result = await acRead<Shipment[]>(`/shipments?${shipmentParams(query)}`);
      return { data: result.data, total: result.total };
    },
    select: (result) => ({
      rows: stripLabelUrlsFrom(result.data as Shipment[]),
      total: result.total,
    }),
  });

  const rows = shipments.data?.rows ?? [];
  const count = shipments.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(count / PER_PAGE));

  return (
    <>
      <div className="mb-6 overflow-hidden rounded-lg bg-surface">
        <SelectField<StatusFilter>
          label={t("tabShipments")}
          value={query.status}
          onChange={(status) => onQueryChange({ ...query, status, page: 1 })}
          options={[
            { value: "", label: t("allStatuses") },
            ...SHIPMENT_STATUSES.map((status) => ({
              value: status as StatusFilter,
              label: tStatus(status),
            })),
          ]}
        />
      </div>

      <ListGroup
        title={t("parcels")}
        footnote={
          shipments.isSuccess ? (
            <Isolate>{t("count", { count })}</Isolate>
          ) : undefined
        }
      >
        {failed && shipments.isError ? (
          <ListRow>
            <SectionError>{t("noShipments")}</SectionError>
          </ListRow>
        ) : shipments.isPending ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <ListRow>
            <EmptyState
              message={query.status === "" ? t("noShipments") : t("noShipmentsFilter")}
              action={
                query.status === ""
                  ? undefined
                  : {
                      label: t("clearFilter"),
                      onClick: () => onQueryChange({ ...query, status: "", page: 1 }),
                    }
              }
            />
          </ListRow>
        ) : (
          rows.map((shipment) => (
            <ShipmentRow
              key={shipment.id}
              shipment={shipment}
              providers={providers}
              wilayas={wilayas}
              locale={locale}
              onOpen={() => setOpen(shipment)}
            />
          ))
        )}
      </ListGroup>

      {pages > 1 ? (
        <div className="mb-8 flex items-center justify-between gap-3">
          <Button
            variant="tinted"
            disabled={query.page <= 1}
            onClick={() => onQueryChange({ ...query, page: query.page - 1 })}
          >
            ‹
          </Button>
          <span className="text-footnote text-label-secondary">
            <Isolate>{`${query.page} / ${pages}`}</Isolate>
          </span>
          <Button
            variant="tinted"
            disabled={query.page >= pages}
            onClick={() => onQueryChange({ ...query, page: query.page + 1 })}
          >
            ›
          </Button>
        </div>
      ) : null}

      <ShipmentSheet
        shipment={open}
        providers={providers}
        wilayas={wilayas}
        locale={locale}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
