"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { DELIVERY_TYPES } from "@/lib/shipment-status";
import { providerLabel } from "@/lib/shipping";
import type { ShippingProvider } from "@/lib/api/schemas/shipping";
import type { Wilaya } from "@/lib/api/schemas/order";
import { Drawer } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Section, Select } from "@/components/ui/Form";
import { useToast } from "@/components/primitives/Toast";
import { useOrderScreen } from "./OrderScreen";

type Commune = { id: number; name: string; name_ar: string };

/**
 * Create a parcel against an order.
 *
 * **A `Drawer`, not a `Modal`.** §3.1: a Drawer is context beside the page,
 * including "a create form long enough to need room". This one is four selects
 * and a dependent fetch, and the person filling it is reading the order's address
 * off the aside while they do — a centred modal over the page would cover the
 * thing they are copying from.
 *
 * **`POST /orders/{id}/shipments` requires `wilaya_id` and `commune_id` in the
 * body — it does not read them off the order.** Measured: `POST {}` answers 400
 * with `details.fields` naming both, and so does a body carrying only a provider,
 * because the destination is validated before anything else. So this form has to
 * ask, even though the order already has an address — which is the same fact
 * analytics rests on, that a wilaya comes off the shipment and never off the
 * address.
 *
 * The drawer says so in one line, in the shopkeeper's terms rather than the
 * API's: *the courier needs an explicit destination, it is not taken from the
 * order's address*. The 400, the field names and the validation order are this
 * comment's business, not a shipping form's.
 *
 * Note the error shape: **`details.fields` here, an object of messages**, while
 * `/shipping/rates` reports its missing parameters as `details.params` — an array
 * of *names*. Two shapes for the same problem on one subject, which is why
 * `lib/api/browser.ts` falls through to the generic message for the array form
 * and this form binds the object form per control.
 *
 * ## The section headings are `--text-subheading`, and that is §3.4's amendment
 *
 * `OverlayFrame` gives this Drawer's own title `--text-heading`. A `Section`
 * whose heading were also `--text-heading` would render at exactly the size and
 * weight of the title six pixels above it and flatten the hierarchy the section
 * exists to create. `Form.tsx`'s `Section` already drops to `--text-subheading`
 * for that reason and DESIGN.md §3.4 carries the note; this is the first form to
 * hit it in a Drawer this short.
 */
export function CreateParcelDrawer({
  open,
  orderId,
  providers,
  wilayas,
  locale,
  onClose,
}: {
  open: boolean;
  orderId: number;
  providers: ShippingProvider[];
  wilayas: Wilaya[];
  locale: string;
  onClose: () => void;
}) {
  const t = useTranslations("shipping");
  const tDelivery = useTranslations("deliveryType");
  const tProvider = useTranslations("shippingProvider");
  const tUi = useTranslations("ui");
  const router = useRouter();
  const toast = useToast();
  const { refuse } = useOrderScreen();

  /* Seeded at mount; the parent remounts this with a `key` rather than
     synchronising state from props in an effect. */
  const [wilayaId, setWilayaId] = useState("");
  const [communeId, setCommuneId] = useState("");
  const [deliveryType, setDeliveryType] = useState<string>("home");
  const [provider, setProvider] = useState(
    providers.find((entry) => entry.is_default)?.name ??
      providers[0]?.name ??
      "",
  );
  const [fields, setFields] = useState<Record<string, string>>({});

  const communes = useQuery({
    queryKey: ["communes", wilayaId],
    enabled: open && wilayaId !== "",
    queryFn: () =>
      acRead<Commune[]>(`/locations/wilayas/${wilayaId}/communes?per_page=100`),
  });

  const create = useMutation({
    mutationFn: async () =>
      acWrite("POST", `/orders/${orderId}/shipments`, {
        provider,
        wilaya_id: Number(wilayaId),
        commune_id: Number(communeId),
        delivery_type: deliveryType,
      }),
    onSuccess: () => {
      refuse(null);
      toast.show(t("created"));
      onClose();
      router.refresh();
    },
    onError: (error: unknown) => {
      if (error instanceof BrowserApiError && error.fields) {
        setFields(error.fields);
        return;
      }
      /*
       * The one-live-shipment 409, which carries `shipment_id` rather than a
       * field list. No control on this form is what is wrong, so it goes to the
       * screen's shared refusal region — and the drawer closes, because leaving
       * a form open over an alert nobody can see is how a person retries the
       * same refusal three times.
       */
      onClose();
      refuse(
        <p className="text-ui-subheading">
          {error instanceof Error ? error.message : t("noParcelsForOrder")}
        </p>,
      );
    },
  });

  const wilayaName = (w: Wilaya) =>
    locale === "ar" && w.name_ar !== "" ? w.name_ar : w.name;
  const ready = wilayaId !== "" && communeId !== "";

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("createParcelTitle")}
      description={t("destinationNote")}
      size="sm"
      footer={
        <>
          {/* Cancel first in DOM order: first tab stop, and `flex-col-reverse`
              puts the confirming button on top on a phone, away from the thumb. */}
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={create.isPending}
          >
            {tUi("cancel")}
          </Button>
          <Button
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!ready}
            title={ready ? undefined : t("pickDestinationFirst")}
          >
            {t("createParcel")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* A wrapper for the field gap: `Section` spaces *rows* at 4px, which is
            right for a column of checkboxes and far too tight for a label,
            control and hint stacked three deep. */}
        <Section title={t("destination")}>
          <div className="flex flex-col gap-3">
            <Select
              label={t("pickWilaya")}
              value={wilayaId}
              onChange={(value) => {
                setWilayaId(value);
                setCommuneId("");
              }}
              error={fields.wilaya_id}
              options={[
                { value: "", label: "—" },
                ...wilayas.map((w) => ({
                  value: String(w.id),
                  label: wilayaName(w),
                })),
              ]}
            />
            <Select
              label={t("pickCommune")}
              value={communeId}
              onChange={setCommuneId}
              disabled={wilayaId === "" || communes.isPending}
              hint={wilayaId === "" ? t("pickCommuneFirst") : undefined}
              error={fields.commune_id}
              options={[
                { value: "", label: "—" },
                ...(communes.data?.data ?? []).map((c) => ({
                  value: String(c.id),
                  label:
                    locale === "ar" && c.name_ar !== "" ? c.name_ar : c.name,
                })),
              ]}
            />
          </div>
        </Section>

        <Section title={t("carriage")}>
          <div className="flex flex-col gap-3">
            <Select
              label={t("deliveryTypeLabel")}
              value={deliveryType}
              onChange={setDeliveryType}
              error={fields.delivery_type}
              options={DELIVERY_TYPES.map((type) => ({
                value: type,
                label: tDelivery(type),
              }))}
            />
            <Select
              label={t("providerLabel")}
              value={provider}
              onChange={setProvider}
              error={fields.provider}
              /* Message key → API `label` → raw slug: the API calls `manual`
                 "In-house delivery", which is English in both localised panels.
                 See `providerLabel`. */
              options={providers.map((p) => ({
                value: p.name,
                label: providerLabel(p.name, providers, (key) =>
                  tProvider.has(key as "manual") ? tProvider(key as "manual") : null,
                ),
              }))}
            />
          </div>
        </Section>
      </div>
    </Drawer>
  );
}
