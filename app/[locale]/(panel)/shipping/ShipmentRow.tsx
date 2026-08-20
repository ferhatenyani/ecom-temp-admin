"use client";

import { useTranslations } from "next-intl";
import { providerLabel, shipmentWilayaId, type SafeShipment } from "@/lib/shipping";
import { SHIPMENT_STATUS_TONE, type ShipmentStatus } from "@/lib/shipment-status";
import type { ShippingProvider } from "@/lib/api/schemas/shipping";
import type { Wilaya } from "@/lib/api/schemas/order";
import { ListRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Icon } from "@/components/primitives/Icon";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { formatWhen } from "@/lib/format/date";

/**
 * One parcel.
 *
 * The tracking number is the row's identity and is an identifier the shop
 * assigned, so it is `Ltr` — a tracking number reordered by the bidi algorithm is
 * a different tracking number, and the customer reading it back gets nothing.
 * The date is `Isolate`, because `Intl` puts U+200F marks in an Arabic date and
 * forcing a direction over them renders the components out of order.
 *
 * The wilaya comes off `metadata`, never off the order's address — the object
 * carries its own, and that is where analytics gets its geography.
 */
export function ShipmentRow({
  shipment,
  providers,
  wilayas,
  locale,
  onOpen,
}: {
  shipment: SafeShipment;
  providers: ShippingProvider[];
  wilayas: Wilaya[];
  locale: string;
  onOpen: () => void;
}) {
  const t = useTranslations("shipping");
  const tStatus = useTranslations("shipmentStatus");

  const wilayaId = shipmentWilayaId(shipment);
  const wilaya = wilayaId === null ? null : wilayas.find((w) => w.id === wilayaId);
  const place =
    wilaya === null || wilaya === undefined
      ? null
      : locale === "ar" && wilaya.name_ar !== ""
        ? wilaya.name_ar
        : wilaya.name;

  const tone = SHIPMENT_STATUS_TONE[shipment.status as ShipmentStatus] ?? "neutral";
  const label = tStatus.has(shipment.status as "pending")
    ? tStatus(shipment.status as "pending")
    : shipment.status;

  return (
    <ListRow className="p-0">
      <button
        type="button"
        onClick={onOpen}
        className="press-row flex min-h-11 w-full items-center gap-3 px-4 py-3 text-start"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <StatusBadge tone={tone}>{label}</StatusBadge>
            {/* `dir="auto"` so the clip lands at the string's own end — a Latin
                tracking number inside an Arabic page otherwise truncates from
                the left and eats its prefix. */}
            <Ltr className="truncate text-body text-label">{shipment.tracking_number}</Ltr>
          </span>
          <span className="truncate text-footnote text-label-secondary" dir="auto">
            {providerLabel(shipment.provider, providers)}
            {place ? (
              <>
                <span aria-hidden="true"> · </span>
                {place}
              </>
            ) : null}
            <span aria-hidden="true"> · </span>
            <Isolate>{formatWhen(shipment.created_at, locale)}</Isolate>
          </span>
        </span>
        {shipment.is_live ? (
          <span className="shrink-0 text-caption text-label-tertiary">{t("live")}</span>
        ) : null}
        <Icon name="chevron" flipInRtl className="size-4 shrink-0 text-label-tertiary" />
      </button>
    </ListRow>
  );
}
