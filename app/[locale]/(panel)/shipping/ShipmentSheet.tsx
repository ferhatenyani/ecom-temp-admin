"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import {
  providerLabel,
  providerStatus,
  shipmentCodAmount,
  shipmentWilayaId,
  type SafeShipment,
} from "@/lib/shipping";
import {
  SHIPMENT_STATUS_TONE,
  nextShipmentStatuses,
  type ShipmentStatus,
} from "@/lib/shipment-status";
import { SHOP_CURRENCY, formatMoney } from "@/lib/format/money";
import { formatWhen } from "@/lib/format/date";
import type { ShippingProvider } from "@/lib/api/schemas/shipping";
import type { Wilaya } from "@/lib/api/schemas/order";
import { Sheet } from "@/components/primitives/Sheet";
import { ActionSheet, type SheetAction } from "@/components/primitives/ActionSheet";
import { ListValueRow, ListRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/**
 * One parcel, and everything that can be done to it.
 *
 * Three writes, each with a measured shape behind it:
 *
 * **Status.** `PATCH /shipments/{id}` accepts `status` and nothing else — a
 * `tracking_number` is refused as `"Unknown field."` and an empty `{}` is a 400
 * asking for a status. A live parcel moves anywhere including backwards; a
 * finished one moves nowhere and its 409 carries **no `allowed` list**, unlike an
 * order's. So the picker is hidden rather than offered-and-refused, which is the
 * one place this panel cannot render what the server would have said.
 *
 * **Cancel.** 200 on a live parcel, and a 409 `"This shipment has already
 * finished."` with `details.status` on one that has not.
 *
 * **Sync.** The confusing one, and it is confusing on the server's side rather
 * than here: on a *live* manual shipment it is a **409 `sync_unsupported`** —
 * *"In-house delivery reports no status of its own; update this shipment
 * directly."* — while on a *finished* one it answers **200 unchanged**, because
 * the terminal check short-circuits before the provider is asked. `manual` is the
 * only configured provider in this shop, so sync has no useful outcome here at
 * all; the button renders with the API's own sentence when it refuses, because
 * that sentence is the explanation and it is better than any the panel could
 * invent.
 */
export function ShipmentSheet({
  shipment,
  providers,
  wilayas,
  locale,
  onClose,
}: {
  shipment: SafeShipment | null;
  providers: ShippingProvider[];
  wilayas: Wilaya[];
  locale: string;
  onClose: () => void;
}) {
  const t = useTranslations("shipping");
  const tStatus = useTranslations("shipmentStatus");
  const tDelivery = useTranslations("deliveryType");
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [picking, setPicking] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const done = () => {
    setRefusal(null);
    queryClient.invalidateQueries({ queryKey: ["shipments"] });
    router.refresh();
  };

  const move = useMutation({
    mutationFn: async (status: ShipmentStatus) =>
      acWrite("PATCH", `/shipments/${shipment?.id}`, { status }),
    onSuccess: () => {
      toast.show(t("statusMoved"));
      done();
      onClose();
    },
    onError: (error: unknown) => setRefusal(messageOf(error)),
  });

  const cancel = useMutation({
    mutationFn: async () => acWrite("POST", `/shipments/${shipment?.id}/cancel`),
    onSuccess: () => {
      toast.show(t("cancelled"));
      done();
      onClose();
    },
    onError: (error: unknown) => setRefusal(messageOf(error)),
  });

  const sync = useMutation({
    mutationFn: async () => acWrite("POST", `/shipments/${shipment?.id}/sync`),
    onSuccess: () => {
      done();
      onClose();
    },
    // `sync_unsupported` is a refusal with a real sentence in it. It stays on the
    // screen rather than in a toast, because it explains a permanent property of
    // this provider rather than reporting a transient failure.
    onError: (error: unknown) => setRefusal(messageOf(error)),
  });

  if (shipment === null) return null;

  const wilayaId = shipmentWilayaId(shipment);
  const wilaya = wilayaId === null ? null : wilayas.find((w) => w.id === wilayaId);
  const place =
    wilaya == null ? null : locale === "ar" && wilaya.name_ar !== "" ? wilaya.name_ar : wilaya.name;

  const cod = shipmentCodAmount(shipment);
  const raw = providerStatus(shipment);
  const deliveryType = shipment.metadata.delivery_type;
  const moves = nextShipmentStatuses(shipment.status, shipment.is_live);
  const busy = move.isPending || cancel.isPending || sync.isPending;

  const actions: SheetAction[] = moves.map((status) => ({
    label: tStatus(status),
    tone: status === "cancelled" || status === "failed" ? "destructive" : "default",
    onSelect: () => move.mutate(status),
  }));

  return (
    <>
      <Sheet
        open
        onOpenChange={(next) => {
          if (!next) {
            setRefusal(null);
            onClose();
          }
        }}
        title={shipment.tracking_number}
      >
        <div className="flex flex-col gap-6 pb-4">
          <div className="overflow-hidden rounded-lg bg-surface">
            <ListRow>
              <span className="text-body text-label-secondary">{t("statusLabel")}</span>
              <span className="ms-auto">
                <StatusBadge
                  tone={SHIPMENT_STATUS_TONE[shipment.status as ShipmentStatus] ?? "neutral"}
                >
                  {tStatus.has(shipment.status as "pending")
                    ? tStatus(shipment.status as "pending")
                    : shipment.status}
                </StatusBadge>
              </span>
            </ListRow>
            <ListValueRow
              label={t("tracking")}
              value={<Ltr>{shipment.tracking_number}</Ltr>}
            />
            <ListValueRow
              label={t("provider")}
              value={providerLabel(shipment.provider, providers)}
            />
            {/* The provider's own word, beside the mapped one. A mis-mapping is
                invisible without it — a plausible status with the wrong term
                underneath is the only thing that shows an adapter got it wrong. */}
            {raw ? <ListValueRow label={t("providerStatus")} value={<Ltr>{raw}</Ltr>} /> : null}
            {place ? <ListValueRow label={t("pickWilaya")} value={place} /> : null}
            {typeof deliveryType === "string" && tDelivery.has(deliveryType as "home") ? (
              <ListValueRow
                label={t("deliveryTypeLabel")}
                value={tDelivery(deliveryType as "home")}
              />
            ) : null}
            {cod ? (
              <ListValueRow
                label={t("codAmount")}
                value={<Ltr>{formatMoney(cod, SHOP_CURRENCY, locale)}</Ltr>}
              />
            ) : null}
            <ListValueRow
              label={t("createdAt")}
              value={<Isolate>{formatWhen(shipment.created_at, locale)}</Isolate>}
            />
            <ListValueRow
              label={t("updatedAt")}
              value={<Isolate>{formatWhen(shipment.updated_at, locale)}</Isolate>}
            />
            <ListValueRow
              label={t("order")}
              value={<Ltr>{`#${shipment.order_id}`}</Ltr>}
            />
          </div>

          {/* ------------------------------------------------ the label --- */}
          <div className="overflow-hidden rounded-lg bg-surface">
            {shipment.labelKeys.length > 0 ? (
              <ListRow>
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <a
                    href={`/api/label/${shipment.id}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex min-h-11 items-center gap-2 text-headline text-accent"
                  >
                    <Icon name="note" className="size-5 shrink-0" />
                    {t("openLabel")}
                  </a>
                  <span className="text-footnote text-label-secondary">{t("labelNote")}</span>
                </span>
              </ListRow>
            ) : (
              <ListRow>
                <span className="text-body text-label-secondary">{t("noLabel")}</span>
              </ListRow>
            )}
          </div>

          {refusal ? (
            <div className="overflow-hidden rounded-lg bg-surface">
              <ListRow className="tone-warning">
                <span className="flex items-start gap-2">
                  <Icon name="alert" className="tonal-fg mt-0.5 size-4 shrink-0" />
                  <span className="text-subhead text-label">{refusal}</span>
                </span>
              </ListRow>
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            {shipment.is_live ? (
              <>
                <Button
                  variant="tinted"
                  fullWidth
                  disabled={busy}
                  loading={move.isPending}
                  onClick={() => setPicking(true)}
                >
                  {t("changeStatus")}
                </Button>
                <Button
                  variant="destructive"
                  fullWidth
                  disabled={busy}
                  loading={cancel.isPending}
                  onClick={() => setConfirmingCancel(true)}
                >
                  {t("cancelParcel")}
                </Button>
              </>
            ) : null}
            <Button
              variant="plain"
              fullWidth
              disabled={busy}
              loading={sync.isPending}
              onClick={() => sync.mutate()}
            >
              {t("syncNow")}
            </Button>
          </div>
        </div>
      </Sheet>

      <ActionSheet
        open={picking}
        onOpenChange={setPicking}
        title={t("changeStatusTitle")}
        actions={actions}
      />

      <ActionSheet
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        title={t("cancelParcel")}
        description={t("cancelConfirm")}
        actions={[
          {
            label: t("cancelParcel"),
            tone: "destructive",
            onSelect: () => {
              setConfirmingCancel(false);
              cancel.mutate();
            },
          },
        ]}
      />
    </>
  );
}

/** The API's own sentence where it has one, which for these routes it does. */
function messageOf(error: unknown): string {
  return error instanceof BrowserApiError || error instanceof Error
    ? error.message
    : String(error);
}
