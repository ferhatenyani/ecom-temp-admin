"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { DELIVERY_TYPES } from "@/lib/shipment-status";
import type { ShippingProvider } from "@/lib/api/schemas/shipping";
import type { Wilaya } from "@/lib/api/schemas/order";
import { Sheet } from "@/components/primitives/Sheet";
import { Button } from "@/components/primitives/Button";
import { SelectField } from "@/components/primitives/Field";
import { useToast } from "@/components/primitives/Toast";

type Commune = { id: number; name: string; name_ar: string };

/**
 * Create a parcel against an order.
 *
 * **`POST /orders/{id}/shipments` requires `wilaya_id` and `commune_id` in the
 * body — it does not read them off the order.** Measured: `POST {}` answers 400
 * with `details.fields` naming both, and so does a body carrying only a provider,
 * because the destination is validated before anything else. So this form has to
 * ask, even though the order already has an address — which is the same fact
 * analytics rests on, that a wilaya comes off the shipment and never off the
 * address.
 *
 * Note the error shape: **`details.fields` here, an object of messages**, while
 * `/shipping/rates` reports its missing parameters as `details.params` — an array
 * of *names*. Two shapes for the same problem on one subject, which is why
 * `lib/api/browser.ts` falls through to the generic message for the array form
 * and this form binds the object form per control.
 */
export function CreateParcelSheet({
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
  const router = useRouter();
  const toast = useToast();

  /* Seeded at mount; the parent remounts this with a `key` rather than
     synchronising state from props in an effect. See `RuleSheet` for why. */
  const [wilayaId, setWilayaId] = useState("");
  const [communeId, setCommuneId] = useState("");
  const [deliveryType, setDeliveryType] = useState<string>("home");
  const [provider, setProvider] = useState(
    providers.find((entry) => entry.is_default)?.name ?? providers[0]?.name ?? "",
  );
  const [fields, setFields] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<string | null>(null);

  const communes = useQuery({
    queryKey: ["communes", wilayaId],
    enabled: open && wilayaId !== "",
    queryFn: () => acRead<Commune[]>(`/locations/wilayas/${wilayaId}/communes?per_page=100`),
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
      toast.show(t("created"));
      onClose();
      router.refresh();
    },
    onError: (error: unknown) => {
      if (error instanceof BrowserApiError) {
        if (error.fields) {
          setFields(error.fields);
          return;
        }
        // The one-live-shipment 409, which carries `shipment_id` rather than a
        // field list. Rendered as a sentence rather than bound to a control,
        // because no control on this form is what is wrong.
        setRefusal(error.message);
        return;
      }
      setRefusal(t("noParcelsForOrder"));
    },
  });

  const wilayaName = (w: Wilaya) => (locale === "ar" && w.name_ar !== "" ? w.name_ar : w.name);
  const ready = wilayaId !== "" && communeId !== "";

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("createParcelTitle")}
    >
      <div className="flex flex-col gap-6 pb-4">
        <div className="overflow-hidden rounded-lg bg-surface">
          <SelectField
            label={t("pickWilaya")}
            value={wilayaId}
            onChange={(value) => {
              setWilayaId(value);
              setCommuneId("");
            }}
            error={fields.wilaya_id}
            options={[
              { value: "", label: "—" },
              ...wilayas.map((w) => ({ value: String(w.id), label: wilayaName(w) })),
            ]}
          />
          <SelectField
            label={t("pickCommune")}
            value={communeId}
            onChange={setCommuneId}
            disabled={wilayaId === ""}
            hint={wilayaId === "" ? t("pickCommuneFirst") : undefined}
            error={fields.commune_id}
            options={[
              { value: "", label: "—" },
              ...(communes.data?.data ?? []).map((c) => ({
                value: String(c.id),
                label: locale === "ar" && c.name_ar !== "" ? c.name_ar : c.name,
              })),
            ]}
          />
          <SelectField
            label={t("deliveryTypeLabel")}
            value={deliveryType}
            onChange={setDeliveryType}
            error={fields.delivery_type}
            options={DELIVERY_TYPES.map((type) => ({ value: type, label: tDelivery(type) }))}
          />
          <SelectField
            label={t("providerLabel")}
            value={provider}
            onChange={setProvider}
            error={fields.provider}
            options={providers.map((p) => ({ value: p.name, label: p.label }))}
          />
        </div>

        {refusal ? (
          <p className="rounded-lg bg-surface px-4 py-3 text-subhead text-label">{refusal}</p>
        ) : null}

        <Button
          variant="filled"
          fullWidth
          disabled={!ready}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          {t("createParcel")}
        </Button>
      </div>
    </Sheet>
  );
}
