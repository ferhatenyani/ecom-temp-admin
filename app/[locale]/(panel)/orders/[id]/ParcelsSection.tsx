"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import {
  manualParcelOffered,
  providerLabel,
  readFailure,
  type SafeShipment,
  type ShipmentFailure,
} from "@/lib/shipping";
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
import { ParcelFailure } from "./ParcelFailure";
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
 *
 * ## What this card is now for — step 2's admin sub-tasks 4 and 5
 *
 * Confirmation creates the parcel by itself: `Shipping\ShipmentSubscriber` hooks
 * `woocommerce_order_status_processing` and calls the courier. So this card
 * stopped being *the* way a parcel comes into existence and became the place a
 * parcel is **read** — and, when there is none, the place that says why. That is
 * one addition and one demotion.
 *
 * ### The addition: `ParcelFailure`, above the list
 *
 * `order.shipping_provider_error`, rendered by the component beside this one.
 * Above the list rather than below it, because on the order it is about there
 * *is* no list — a refused parcel leaves no shipment row at all
 * (`ShippingService::createClaimed()` calls the provider before it writes
 * anything), so the failure and the empty state are the same screen and the
 * failure is the half that explains the other.
 *
 * It is in this card and not in `OrderNotices` at the top of the page, even
 * though that region exists for exactly this kind of geometry. Two reasons and
 * the second is the real one. §3.1: that region is `role="alert"`, one at a
 * time, cleared, and it is for **a refusal of something the operator just did**
 * — this is stored data that predates the page. And a reader looking for "where
 * is the parcel" comes to the card titled *parcels for this order*; putting the
 * answer 400px above it would separate the question from the answer to save a
 * scroll that at this card's position does not exist.
 *
 * ### The demotion: the manual drawer is a fallback now
 *
 * `POST /orders/{id}/shipments` stays, and `ShippingService::create()`'s
 * docblock gives five reasons it has to — the order a courier refused, the shop
 * that ships from a status which fires no transition, the re-send after a failed
 * delivery, the destination the order does not carry, and everything an order
 * cannot say (a desk collection, a different recipient, the neighbour's phone
 * number). What changed is that none of those is the *normal* case any more.
 *
 * So the control moved from the card's primary slot to a `ghost` beside a
 * sentence that says when to reach for it, and the sentence is those five
 * reasons compressed rather than a new claim. **The test for offering it at all
 * is unchanged and is the API's own**: `is_live` on any row —
 * `manualParcelOffered`, which is `createShipmentGate` under a name that says
 * what the branch now means. Disabled with the reason rather than hidden (§3.3),
 * and the reason names the parcel in the way because the 409 supplies it.
 */
export function ParcelsSection({
  orderId,
  shipments,
  shippingProviderError,
  failed,
  providers,
  wilayas,
  canWrite,
  canEditOrder,
  locale,
}: {
  orderId: number;
  shipments: SafeShipment[];
  /** `order.shipping_provider_error`. Read on the server, passed down whole. */
  shippingProviderError: ShipmentFailure | null;
  failed: boolean;
  providers: ShippingProvider[];
  wilayas: Wilaya[];
  /** `ac_manage_shipping` — this whole card, and the manual parcel route. */
  canWrite: boolean;
  /** `ac_manage_orders` — the *other* remedy, which is a `PATCH /orders/{id}`.
      Two capabilities meet on this card; `ParcelFailure` argues the split. */
  canEditOrder: boolean;
  locale: string;
}) {
  const t = useTranslations("shipping");
  const tStatus = useTranslations("shipmentStatus");
  const tProvider = useTranslations("shippingProvider");
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

  /*
   * The one test, asked once. `manualParcelOffered` is `createShipmentGate`
   * under the name the branch now means — see `lib/shipping.ts` — and the
   * blocking parcel is read back out for the reason rather than by a second
   * search, so the two cannot disagree about which parcel is in the way.
   */
  const live = shipments.find((shipment) => shipment.is_live);
  const offered = manualParcelOffered(shipments);

  /* Disabled with the reason, never hidden. The reason names the parcel in the
     way, because the 409 supplies it as `details.shipment_id`. */
  const cannotCreate = !canWrite
    ? tOrders("readOnly")
    : (writesBlocked ??
      (offered || live === undefined
        ? null
        : t("createBlocked", {
            tracking: live.tracking_number || t("noTracking"),
          })));

  const failure = readFailure(shippingProviderError, shipments);

  return (
    <>
      <Card title={t("parcelsForOrder")} footnote={t("parcelSeparate")}>
        {/*
          Above everything, because on the order this is about there is nothing
          else in the card: a refused parcel leaves no row, so the failure and
          the empty state arrive together and this is the half that explains the
          other. It carries its own remedy, which is why the header no longer
          needs an action of its own.
        */}
        <ParcelFailure
          reading={failure}
          providers={providers}
          locale={locale}
          onCreateParcel={() => setCreating(true)}
          createBlocked={cannotCreate}
          canEditOrder={canEditOrder}
        />

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
                      {providerLabel(parcel.provider, providers, (key) =>
                        tProvider.has(key as "manual") ? tProvider(key as "manual") : null,
                      )}
                      {place ? (
                        <>
                          <span aria-hidden="true"> · </span>
                          {place}
                        </>
                      ) : null}
                      <span aria-hidden="true"> · </span>
                      <Isolate>{formatWhen(parcel.created_at, locale)}</Isolate>
                    </span>
                    {/*
                      The label, which is the second half of sub-task 4 and the
                      one an operator actually prints.

                      **The fact that a label exists crosses the boundary; the
                      URL does not.** `stripLabelUrlsFrom` runs server-side in
                      `page.tsx` — before these become props, because an RSC
                      payload is in the document — and leaves the key *names*
                      behind in `labelKeys`. So the link can exist without the
                      token ever reaching the browser: `/api/label/[id]` re-reads
                      the shipment with the sealed credential. `ParcelDrawer` on
                      the shipping screen draws it from the same two facts and
                      this is that arrangement, not a second one.

                      Absent rather than disabled when there is none, which is
                      the opposite of every write control on this screen and is
                      right for the same reason they are not: a link to nothing
                      is not an act somebody is being refused. The manual
                      provider issues no labels at all — measured across all 111
                      shipments, no `metadata.label` on any of them — so on this
                      shop this is the ordinary state and a permanently greyed
                      link on every row would be noise on every row.
                    */}
                    {parcel.labelKeys.length > 0 ? (
                      <a
                        href={`/api/label/${parcel.id}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="ui-ring self-start rounded-ui-md text-ui-label text-ui-accent hover:underline"
                      >
                        {t("openLabel")}
                      </a>
                    ) : null}
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

        {/*
          ── the fallback, and it reads as one ──────────────────────────────

          Last in the card, `ghost` rather than `secondary`, and under a
          sentence rather than in the header's action slot. Confirmation is the
          normal path now; this is the way in for the cases it cannot reach, and
          the wording is `ShippingService::create()`'s own five reasons
          compressed rather than a claim invented here:

            - the order a courier refused (no row is written, so it may be sent
              again);
            - the shop that dispatches from a status which fires no transition;
            - the re-send after a delivery that failed;
            - the order that carries no destination for a confirmation to use;
            - everything an order cannot say — a desk collection on an order
              quoted for home delivery, a different recipient, the neighbour's
              phone number. All are fields on that route and none is on an
              order.

          Rendered for anyone who may write, including while it is refused, so
          the reason for the refusal has somewhere to be printed. `manualNote`
          is those five reasons in one sentence a shopkeeper can act on.
        */}
        {canWrite ? (
          <div className="mt-4 flex min-w-0 flex-col gap-2 border-t border-ui-line pt-4">
            <p className="text-ui-label text-ui-subtle">{t("manualNote")}</p>
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              className="self-start"
              onClick={() => setCreating(true)}
              disabled={cannotCreate !== null}
              title={cannotCreate ?? undefined}
            >
              {t("createParcel")}
            </Button>
          </div>
        ) : null}
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
