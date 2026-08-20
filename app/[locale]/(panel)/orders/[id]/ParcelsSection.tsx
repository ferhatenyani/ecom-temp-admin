"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { createShipmentGate, providerLabel, type SafeShipment } from "@/lib/shipping";
import { SHIPMENT_STATUS_TONE, type ShipmentStatus } from "@/lib/shipment-status";
import type { ShippingProvider } from "@/lib/api/schemas/shipping";
import type { Wilaya } from "@/lib/api/schemas/order";
import { formatWhen } from "@/lib/format/date";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { SectionError } from "@/components/patterns/States";
import { useToast } from "@/components/primitives/Toast";
import { CreateParcelSheet } from "./CreateParcelSheet";

/**
 * The parcels for one order.
 *
 * **A parcel's status never moves the order**, and the two are shown side by side
 * without ever being merged — verified: moving shipment 220 to `delivered` left
 * order 3939 at `processing` with `date_modified` untouched.
 *
 * **One live shipment per order**, enforced by the database. The create button is
 * absent with the reason while one is live, and the reason names the parcel
 * because the 409 does: `details.shipment_id`. History accumulates and does not
 * block — order 3939 carries four finished parcels and a fifth is allowed.
 */
export function ParcelsSection({
  orderId,
  shipments,
  failed,
  providers,
  wilayas,
  canWrite,
  locale,
}: {
  orderId: number;
  shipments: SafeShipment[];
  failed: boolean;
  providers: ShippingProvider[];
  wilayas: Wilaya[];
  canWrite: boolean;
  locale: string;
}) {
  const t = useTranslations("shipping");
  const tStatus = useTranslations("shipmentStatus");
  const router = useRouter();
  const toast = useToast();

  const [creating, setCreating] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const cancel = useMutation({
    mutationFn: async (id: number) => acWrite("POST", `/shipments/${id}/cancel`),
    onSuccess: () => {
      toast.show(t("cancelled"));
      setRefusal(null);
      router.refresh();
    },
    onError: (error: unknown) =>
      setRefusal(error instanceof BrowserApiError ? error.message : t("cancelled")),
  });

  const gate = createShipmentGate(shipments);

  return (
    <>
      <ListGroup title={t("parcelsForOrder")} footnote={t("parcelSeparate")}>
        {failed ? (
          <ListRow>
            <SectionError>{t("noParcelsForOrder")}</SectionError>
          </ListRow>
        ) : shipments.length === 0 ? (
          <ListRow>
            <span className="text-body text-label-secondary">{t("noParcelsForOrder")}</span>
          </ListRow>
        ) : (
          shipments.map((parcel) => {
            const wilayaId = parcel.metadata.wilaya_id;
            const wilaya =
              typeof wilayaId === "number"
                ? wilayas.find((entry) => entry.id === wilayaId)
                : undefined;
            const place =
              wilaya === undefined
                ? null
                : locale === "ar" && wilaya.name_ar !== ""
                  ? wilaya.name_ar
                  : wilaya.name;

            return (
              <ListRow key={parcel.id}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <StatusBadge
                      tone={SHIPMENT_STATUS_TONE[parcel.status as ShipmentStatus] ?? "neutral"}
                    >
                      {tStatus.has(parcel.status as "pending")
                        ? tStatus(parcel.status as "pending")
                        : parcel.status}
                    </StatusBadge>
                    <Ltr className="truncate text-body text-label">
                      {parcel.tracking_number}
                    </Ltr>
                  </span>
                  <span className="truncate text-footnote text-label-secondary" dir="auto">
                    {providerLabel(parcel.provider, providers)}
                    {place ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        {place}
                      </>
                    ) : null}
                    <span aria-hidden="true"> · </span>
                    <Isolate>{formatWhen(parcel.created_at, locale)}</Isolate>
                  </span>
                </span>
                {parcel.is_live && canWrite ? (
                  <Button
                    variant="plain"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(parcel.id)}
                    className="shrink-0"
                  >
                    {t("cancelShort")}
                  </Button>
                ) : null}
              </ListRow>
            );
          })
        )}

        {refusal ? (
          <ListRow className="tone-warning">
            <span className="flex items-start gap-2">
              <Icon name="alert" className="tonal-fg mt-0.5 size-4 shrink-0" />
              <span className="text-subhead text-label">{refusal}</span>
            </span>
          </ListRow>
        ) : null}

        {canWrite ? (
          <ListRow>
            {gate.allowed ? (
              <Button variant="tinted" fullWidth onClick={() => setCreating(true)}>
                {t("createParcel")}
              </Button>
            ) : (
              // Absent with the reason, and the reason names the parcel that is
              // blocking — which the 409 supplies as `details.shipment_id`.
              <span className="text-footnote text-label-secondary">
                <Isolate>
                  {t("createBlocked", { tracking: gate.blockedBy.tracking_number })}
                </Isolate>
              </span>
            )}
          </ListRow>
        ) : null}
      </ListGroup>

      <CreateParcelSheet
        key={creating ? "open" : "closed"}
        open={creating}
        orderId={orderId}
        providers={providers}
        wilayas={wilayas}
        locale={locale}
        onClose={() => setCreating(false)}
      />
    </>
  );
}
