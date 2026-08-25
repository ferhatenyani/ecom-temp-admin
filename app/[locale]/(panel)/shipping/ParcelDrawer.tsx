"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import {
  providerStatus,
  shipmentCodAmount,
  shipmentCommuneId,
  shipmentWilayaId,
  type SafeShipment,
} from "@/lib/shipping";
import { nextShipmentStatuses, isTerminalShipmentStatus, type ShipmentStatus } from "@/lib/shipment-status";
import { SHOP_CURRENCY, formatMoney } from "@/lib/format/money";
import { formatWhen } from "@/lib/format/date";
import { Drawer } from "@/components/ui/Overlay";
import { DataList, DataRow } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { Menu, type MenuAction } from "@/components/ui/Menu";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/States";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { StatusBadge, parcelOpenerId } from "./columns";

type Commune = { id: number; name: string; name_ar: string };

/**
 * One parcel, and everything that can be done to it.
 *
 * ## A `Drawer`, and it is the record's only surface
 *
 * **A parcel has no detail route**, and `GET /shipments/{id}` is key-identical to
 * the list row — measured, all ten keys, no extra block. So this is not a *peek*
 * that previews a page somewhere else: there is no page. It costs no request for
 * everything except the commune name, and it holds the writes, which is why the
 * whole row opens it and there is no trailing `Menu` in the list repeating "open".
 *
 * ## Two writes, both gated on `is_live`, and a third that is not rendered at all
 *
 * **Status.** `PATCH /shipments/{id}` accepts `status` and refuses every other
 * key by name — `{"provider":"acfake"}` answers `"Unknown field."`, so this
 * subject does *not* follow the coupons/products "drop read-only in silence"
 * rule and the body is `{status}` because the API requires it to be, not out of
 * caution. A live parcel moves anywhere including backwards (`in_transit` →
 * `pending` is a 200), so the picker offers every *other* status.
 *
 * **Cancel.** `POST /shipments/{id}/cancel`, 200 on a live parcel and a 409
 * *"This shipment has already finished."* on one that is not. It is kept beside
 * the picker even though the picker can also reach `cancelled`, because the two
 * are different endpoints: one records a status, the other is the shop's own
 * cancel path and is the one the API documents for it.
 *
 * **Sync is not rendered.** Measured on all three states it can be in: on a live
 * `manual` parcel it is a 409 `sync_unsupported` — *"In-house delivery reports no
 * status of its own; update this shipment directly."* — and on a terminal one it
 * is a **200 that changes nothing**, because the terminal check short-circuits
 * before the provider is asked. `manual` is the only provider
 * `/shipping/providers` enumerates. There is no state in which the button acts,
 * and §3.3's rule is that a control that cannot act is not rendered.
 *
 * ## A terminal parcel has no write controls and one line saying why
 *
 * Not a disabled control: a disabled button a person can never enable is a dead
 * end, and here it is *every* row — 129 of 129 parcels in this shop are
 * `delivered` or `cancelled`. The line is the explanation the disabled state
 * could not carry, and the 409 the buttons would have produced carries **no
 * `allowed` list** to render, unlike an order's, which is the one place this
 * panel cannot show what the server would have said.
 *
 * ## `is_live` is not rendered as a marker
 *
 * It equals `!isTerminalShipmentStatus(status)` on 129 of 129 rows. The status
 * badge is the same fact, and the terminal note below reads off the status for
 * the same reason.
 */
export function ParcelDrawer({
  parcel,
  providerName,
  wilayaName,
  locale,
  online,
  onOpenChange,
}: {
  parcel: SafeShipment | null;
  /** Message key → API `label` → raw slug, built once by the screen. */
  providerName: (name: string) => string;
  wilayaName: (id: number | null) => string | null;
  locale: string;
  /** False only when the browser is certain — see `useOnline`. */
  online: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("shipping");
  const tStates = useTranslations("states");
  const tStatus = useTranslations("shipmentStatus");
  const tDelivery = useTranslations("deliveryType");
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  /* The status Menu's item is unmounted by Radix the moment it is selected, so
     the ConfirmDialog it opens has no live opener to hand focus back to. The
     trigger's own id is the answer — see `useOpenerFocus` in Overlay.tsx. */
  const triggerId = useId();

  const [confirming, setConfirming] = useState<ShipmentStatus | "cancel" | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  /*
   * **Which row focus goes back to, latched so it survives the close.**
   *
   * `<tr>` cannot take focus, so a pointer-opened drawer has no opener for
   * `useOpenerFocus` to record and Escape dropped a person on `<body>` with the
   * whole sidebar to tab past. The table's tracking button is a real element with
   * a stable id and is the honest target — measured, it fixes the pointer path
   * and leaves the keyboard path (where the recorded opener is already that same
   * button) unchanged.
   *
   * It has to be **latched** rather than read off `parcel`. Radix fires
   * `onCloseAutoFocus` *after* `onOpenChange`, so by the time focus is restored
   * the screen has already set `parcel` to null and a value derived from it is
   * `undefined` — which is exactly why the first attempt at this passed every
   * keyboard assertion and still failed on the mouse. Never cleared, because the
   * only thing it is read for is a close that has already happened.
   *
   * Adjusted during render against the previous value, not in an effect: an
   * effect runs after paint, and this has to be correct before the first Escape.
   */
  const [openerFor, setOpenerFor] = useState<number | null>(null);
  if (parcel !== null && parcel.id !== openerFor) setOpenerFor(parcel.id);

  const wilayaId = parcel === null ? null : shipmentWilayaId(parcel);

  /*
   * The commune name, and the only request this drawer makes.
   *
   * The parcel carries `metadata.commune_id` and nothing else — a database key,
   * which is not a place. One request per wilaya, cached by react-query across
   * every parcel that shares one, and a failure is silent on purpose: the
   * destination falls back to the wilaya alone, which is still a place.
   */
  const communes = useQuery({
    queryKey: ["communes", String(wilayaId ?? "")],
    enabled: wilayaId !== null,
    queryFn: () => acRead<Commune[]>(`/locations/wilayas/${wilayaId}/communes?per_page=100`),
  });

  const settled = () => {
    setRefusal(null);
    setConfirming(null);
    void queryClient.invalidateQueries({ queryKey: ["shipments"] });
    router.refresh();
  };

  const move = useMutation({
    mutationFn: async (status: ShipmentStatus) =>
      acWrite("PATCH", `/shipments/${parcel?.id}`, { status }),
    onSuccess: () => {
      toast.show(t("statusMoved"));
      settled();
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      setConfirming(null);
      setRefusal(messageOf(error));
    },
  });

  const cancel = useMutation({
    mutationFn: async () => acWrite("POST", `/shipments/${parcel?.id}/cancel`),
    onSuccess: () => {
      toast.show(t("cancelled"));
      settled();
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      setConfirming(null);
      setRefusal(messageOf(error));
    },
  });

  const busy = move.isPending || cancel.isPending;

  /* The fifth state's second half: when the browser is certain it is offline the
     rows on screen are as old as the last fetch, and every write control says so
     rather than failing on click. */
  const blocked = online ? null : tStates("offlineWrites");

  const live = parcel !== null && parcel.is_live;
  const moves = parcel === null ? [] : nextShipmentStatuses(parcel.status, parcel.is_live);

  /*
   * **Every terminal move is confirmed; only two of them are coloured danger.**
   *
   * The four terminal statuses are one-way doors — once there `is_live` is false,
   * the picker is gone and the 409 that follows carries no way back — so all four
   * go through `ConfirmDialog` and the body says what ends. But `destructive` on
   * a `Menu` item is a *colour* as well as a position, and an earlier draft
   * marked all four: it rendered **"Livré" in `--color-danger-fg`**, which is the
   * one outcome everybody wants, printed in the panel's colour for *something has
   * gone wrong*. §3.5's whole argument is that the semantic hue means what it
   * says.
   *
   * So the flag follows the *outcome*: `cancelled` and `failed` are the bad
   * endings and sit below the separator in danger; `delivered` and `returned`
   * stay in the progression where they belong and confirm with the neutral tone.
   */
  const endsBadly = (status: ShipmentStatus) => status === "cancelled" || status === "failed";

  const actions: MenuAction[] = moves.map((status) => ({
    key: status,
    label: tStatus(status),
    destructive: endsBadly(status),
    onSelect: () =>
      isTerminalShipmentStatus(status) ? setConfirming(status) : move.mutate(status),
  }));

  const place = wilayaName(wilayaId);
  const communeId = parcel === null ? null : shipmentCommuneId(parcel);
  const commune = communes.data?.data.find((entry) => entry.id === communeId);
  const communeName =
    commune === undefined
      ? null
      : locale === "ar" && commune.name_ar !== ""
        ? commune.name_ar
        : commune.name;
  const destination =
    place === null ? null : communeName === null ? place : `${place} · ${communeName}`;

  const cod = parcel === null ? null : shipmentCodAmount(parcel);
  const raw = parcel === null ? null : providerStatus(parcel);
  const deliveryType = parcel?.metadata.delivery_type;

  return (
    <>
      <Drawer
        open={parcel !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRefusal(null);
            setConfirming(null);
          }
          onOpenChange(next);
        }}
        title={parcel === null ? "" : parcel.tracking_number || t("noTracking")}
        size="md"
        /* Below `md` this button is `display: none` — both presentations are
           always in the DOM — and `useOpenerFocus` skips a named target that is
           not rendered, falling back to `RecordList`'s own overlay button. The
           guard is in the primitive rather than a width check here, because
           reading the viewport during render is a hydration mismatch. */
        returnFocusTo={openerFor === null ? undefined : parcelOpenerId(openerFor)}
        footer={
          /* Only for a live parcel. A terminal one gets the sentence in the body
             instead — see the docblock. */
          live ? (
            <>
              <Menu
                label={t("changeStatusTitle")}
                actions={actions}
                trigger={
                  <Button
                    id={triggerId}
                    variant="secondary"
                    disabled={busy || blocked !== null}
                    title={blocked ?? undefined}
                    loading={move.isPending}
                  >
                    {t("changeStatus")}
                  </Button>
                }
              />
              <Button
                variant="destructive"
                disabled={busy || blocked !== null}
                title={blocked ?? undefined}
                loading={cancel.isPending}
                onClick={() => setConfirming("cancel")}
              >
                {t("cancelParcel")}
              </Button>
            </>
          ) : null
        }
      >
        {parcel === null ? null : (
          <div className="flex flex-col gap-4">
            {/*
              A refusal stays on screen rather than in a toast: §3.1 — an error a
              person must act on is not a toast — and these sentences explain a
              permanent property of the parcel rather than reporting a transient
              failure. The API's own words, because they name the state precisely
              and a translated generic throws the actionable half away.
            */}
            {refusal ? (
              <Notice tone="warning" role="alert" title={tStates("errorTitle")}>
                <p className="text-ui-label">{refusal}</p>
              </Notice>
            ) : null}

            <DataList>
              <DataRow label={t("statusLabel")}>
                <StatusBadge status={parcel.status} tStatus={tStatus} />
              </DataRow>
              <DataRow label={t("tracking")}>
                {parcel.tracking_number === "" ? (
                  <span className="text-ui-subtle">{t("noTracking")}</span>
                ) : (
                  /* `break-all` rather than truncate: the whole point of opening
                     this is to read the value the table had to cut. */
                  <Ltr numeric={false} className="block break-all">
                    {parcel.tracking_number}
                  </Ltr>
                )}
              </DataRow>
              <DataRow label={t("order")}>
                <Link
                  href={`/${locale}/orders/${parcel.order_id}`}
                  className="ui-ring rounded-ui-md text-ui-accent hover:underline"
                >
                  <Isolate>{t("orderLink", { number: parcel.order_id })}</Isolate>
                </Link>
              </DataRow>
              <DataRow label={t("provider")}>
                <span dir="auto">{providerName(parcel.provider)}</span>
              </DataRow>
              {/* The provider's own word beside the mapped one. A mis-mapping is
                  invisible without it — a plausible status with the wrong term
                  underneath is the only thing that shows an adapter got it
                  wrong. Absent on a `manual` parcel, which reports none. */}
              {raw ? (
                <DataRow label={t("providerStatus")}>
                  <Ltr numeric={false}>{raw}</Ltr>
                </DataRow>
              ) : null}
              <DataRow label={t("destination")}>
                {destination === null ? (
                  <span className="text-ui-subtle">{t("noDestination")}</span>
                ) : (
                  <span dir="auto">{destination}</span>
                )}
              </DataRow>
              {typeof deliveryType === "string" && tDelivery.has(deliveryType as "home") ? (
                <DataRow label={t("deliveryTypeLabel")}>
                  {tDelivery(deliveryType as "home")}
                </DataRow>
              ) : null}
              {cod ? (
                <DataRow label={t("codAmount")}>
                  <Ltr>{formatMoney(cod, SHOP_CURRENCY, locale)}</Ltr>
                </DataRow>
              ) : null}
              <DataRow label={t("label")}>
                {/*
                  The fact that a label exists crosses the boundary; the URL does
                  not. `stripLabelUrls` removes the credential server-side and
                  leaves the key *names*, so the link can exist without the token
                  ever reaching the document — `/api/label/[id]` re-reads the
                  shipment with the sealed credential.
                */}
                {parcel.labelKeys.length > 0 ? (
                  <a
                    href={`/api/label/${parcel.id}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ui-ring rounded-ui-md text-ui-accent hover:underline"
                  >
                    {t("openLabel")}
                  </a>
                ) : (
                  <span className="text-ui-subtle">{t("noLabel")}</span>
                )}
              </DataRow>
              <DataRow label={t("createdAt")}>
                <Isolate>{formatWhen(parcel.created_at, locale)}</Isolate>
              </DataRow>
              <DataRow label={t("updatedAt")}>
                <Isolate>{formatWhen(parcel.updated_at, locale)}</Isolate>
              </DataRow>
            </DataList>

            {parcel.labelKeys.length > 0 ? (
              <p className="text-ui-label text-ui-subtle">{t("labelNote")}</p>
            ) : null}

            {/* The reason there is no footer, in the place the footer would have
                been. One line, not a disabled control. */}
            {live ? null : (
              <p className="text-ui-label text-ui-muted">
                <span className="text-ui-fg">{t("terminalTitle")}</span>
                <span aria-hidden="true"> · </span>
                {t("terminalNote")}
              </p>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        returnFocusTo={triggerId}
        /* Danger for the two endings that are failures, neutral for the two that
           are not — see `endsBadly`. The dialog still appears for all four. */
        tone={
          confirming === "cancel" || (confirming !== null && endsBadly(confirming))
            ? "destructive"
            : "primary"
        }
        loading={busy}
        title={confirming === "cancel" ? t("cancelParcel") : t("moveConfirmTitle")}
        body={
          confirming === "cancel"
            ? t("cancelConfirm")
            : t("moveConfirmBody", {
                status: confirming === null ? "" : tStatus(confirming),
              })
        }
        /* Names the act, never "OK". */
        confirmLabel={
          confirming === "cancel"
            ? t("cancelParcel")
            : t("moveConfirmAction", {
                status: confirming === null ? "" : tStatus(confirming),
              })
        }
        onConfirm={() => {
          if (confirming === null) return;
          if (confirming === "cancel") cancel.mutate();
          else move.mutate(confirming);
        }}
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
