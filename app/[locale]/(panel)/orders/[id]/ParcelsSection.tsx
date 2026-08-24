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
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, useConfirm } from "@/components/ui/Confirm";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { SectionError } from "@/components/ui/States";
import { useToast } from "@/components/primitives/Toast";
import { CreateParcelDrawer } from "./CreateParcelDrawer";
import { useOrderScreen } from "./OrderScreen";

/**
 * The parcels for one order.
 *
 * **A parcel's status never moves the order**, and the two are shown side by side
 * without ever being merged — verified: moving shipment 220 to `delivered` left
 * order 3939 at `processing` with `date_modified` untouched.
 *
 * **One live shipment per order**, enforced by the database. The create button is
 * disabled with the reason while one is live, and the reason names the parcel
 * because the 409 does: `details.shipment_id`. History accumulates and does not
 * block — order 3939 carries four finished parcels and a fifth is allowed.
 *
 * In the **main** column rather than the aside, because this list grows: an order
 * can accumulate parcel after parcel and the aside is fixed-height reference
 * material.
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
  const tOrders = useTranslations("orders");
  const router = useRouter();
  const toast = useToast();
  const { refuse, writesBlocked } = useOrderScreen();

  const [creating, setCreating] = useState(false);
  const confirm = useConfirm<SafeShipment>();

  const cancel = useMutation({
    mutationFn: async (id: number) => acWrite("POST", `/shipments/${id}/cancel`),
    onSuccess: () => {
      confirm.close();
      refuse(null);
      toast.show(t("cancelled"));
      router.refresh();
    },
    onError: (error: unknown) => {
      confirm.close();
      refuse(
        <p className="text-ui-subheading">
          {error instanceof BrowserApiError || error instanceof Error
            ? error.message
            : t("cancelled")}
        </p>,
      );
    },
  });

  const gate = createShipmentGate(shipments);

  /* Disabled with the reason, never hidden. The gate's reason names the parcel
     in the way, because the 409 supplies it as `details.shipment_id`. */
  const cannotCreate = !canWrite
    ? tOrders("readOnly")
    : (writesBlocked ??
      (gate.allowed
        ? null
        : t("createBlocked", {
            tracking: gate.blockedBy.tracking_number || t("noTracking"),
          })));

  return (
    <>
      <Card
        title={t("parcelsForOrder")}
        footnote={t("parcelSeparate")}
        actions={
          canWrite ? (
            <Button
              variant="secondary"
              size="sm"
              icon="plus"
              onClick={() => setCreating(true)}
              disabled={cannotCreate !== null}
              title={cannotCreate ?? undefined}
            >
              {t("createParcel")}
            </Button>
          ) : null
        }
      >
        {failed ? (
          <SectionError>{t("noParcelsForOrder")}</SectionError>
        ) : shipments.length === 0 ? (
          <p className="text-ui-body text-ui-muted">{t("noParcelsForOrder")}</p>
        ) : (
          <ul className="flex flex-col">
            {shipments.map((parcel) => {
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
                <li
                  key={parcel.id}
                  className="flex min-w-0 items-start gap-3 border-b border-ui-line py-3 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          SHIPMENT_STATUS_TONE[parcel.status as ShipmentStatus] ?? "neutral"
                        }
                      >
                        {tStatus.has(parcel.status as "pending")
                          ? tStatus(parcel.status as "pending")
                          : parcel.status}
                      </Badge>
                      {/* Empty until the courier has the parcel — a real state,
                          and the row says so rather than rendering a blank. */}
                      <Ltr className="min-w-0 truncate text-ui-compact text-ui-fg">
                        {parcel.tracking_number || t("noTracking")}
                      </Ltr>
                    </div>
                    {/* Wraps rather than truncating: three facts share this
                        line and at 340px the date is the one that falls off the
                        end — the least guessable of the three. */}
                    <span
                      dir="auto"
                      className="min-w-0 break-words text-ui-label text-ui-subtle"
                    >
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
                  </div>

                  {parcel.is_live && canWrite ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      disabled={cancel.isPending || writesBlocked !== null}
                      title={writesBlocked ?? undefined}
                      onClick={() => confirm.ask(parcel)}
                    >
                      {t("cancelShort")}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <CreateParcelDrawer
        /* Remounted rather than synchronised: the form seeds its state at mount
           from props, so a `key` change is what resets it between openings. */
        key={creating ? "open" : "closed"}
        open={creating}
        orderId={orderId}
        providers={providers}
        wilayas={wilayas}
        locale={locale}
        onClose={() => setCreating(false)}
      />

      {/* Cancelling a parcel is irreversible — §8: every destructive action goes
          through ConfirmDialog, with a label that names the act. */}
      <ConfirmDialog
        open={confirm.open}
        onOpenChange={confirm.onOpenChange}
        title={t("cancelParcel")}
        body={t("cancelConfirm")}
        confirmLabel={t("cancelParcel")}
        loading={cancel.isPending}
        onConfirm={() => {
          if (confirm.target) cancel.mutate(confirm.target.id);
        }}
      />
    </>
  );
}
