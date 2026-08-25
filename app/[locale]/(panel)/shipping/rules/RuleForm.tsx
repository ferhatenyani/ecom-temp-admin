"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { DELIVERY_TYPES, type DeliveryType } from "@/lib/shipment-status";
import { providerLabel } from "@/lib/shipping";
import type { ShippingProvider, ShippingRule } from "@/lib/api/schemas/shipping";
import type { Wilaya } from "@/lib/api/schemas/order";
import { Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import {
  ErrorSummary,
  NumberField,
  Select,
  Switch,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { useToast } from "@/components/primitives/Toast";

type Commune = { id: number; name: string; name_ar: string };

/**
 * Create or edit one tariff row.
 *
 * ## A `Modal`, not a `Drawer`
 *
 * §3.1 gives a Drawer to "a create form long enough to need room" and a Modal to
 * "a task that must be finished or abandoned". Eight controls with no dependent
 * reading elsewhere on the page is the second: nothing behind this form is being
 * copied from while it is filled in, which is the whole reason
 * `CreateParcelDrawer` is a drawer — there the order's address is on the page
 * behind it. `md` (560) rather than `sm`, because the wilaya and commune selects
 * carry long place names.
 *
 * No `Section` inside it. `Form.tsx`'s `Section` is a bordered group at 12px
 * padding whose children sit at `gap-1`, sized for stacked check rows; eight
 * labelled fields in one 560px column need no internal border and would only get
 * a cramped one. (Were one used, its heading would drop to `--text-subheading` —
 * §3.4's amendment — because `OverlayFrame` already gives the modal's own title
 * `--text-heading`.)
 *
 * ## What the API requires, and what it merely accepts
 *
 * **`amount` is the only required field**, measured: `POST {"wilaya_id":16}`
 * answers 400 with `details.fields.amount: "Required."` and nothing else.
 * Everything else has a server-side default — including the destination, which is
 * why a rule with no wilaya and no commune is the **national fallback** rather
 * than an incomplete row. That is the single most confusing thing about this
 * form, so the destination pickers say so rather than leaving two empty selects
 * to be interpreted.
 *
 * **`provider` is writable and validated**, and the select is what keeps the
 * refusal unreachable. Measured 2026-08-25: `{"provider":"acfake"}` answers 400
 * `details.fields.provider = 'Unknown provider "acfake".'` — the only refusal on
 * this subject that quotes the offending value back instead of listing the legal
 * set in the sentence. The legal set arrives beside it as `details.available`,
 * a **sibling of `fields`**, and **nothing in `lib/api/` reads it**: `ApiError`
 * exposes `fields` and `params` and stops. That is deliberate and stays that
 * way — the picker is fed by `GET /shipping/providers`, which is the same array
 * the server validates against, so every value this form can send is one the
 * server accepts and the refusal has no path to the screen. A reader for
 * `available` would be code that can only ever run if this select breaks.
 *
 * Money stays a **string** end to end. Parsing `"350.00"` into a float is how a
 * price a shop typed correctly gets stored 0.000001 away from itself.
 */
export function RuleForm({
  open,
  rule,
  providers,
  wilayas,
  locale,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** `null` is the create form. The parent remounts on a `key`, so state seeds once. */
  rule: ShippingRule | null;
  providers: ShippingProvider[];
  wilayas: Wilaya[];
  locale: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("shipping");
  const tUi = useTranslations("ui");
  const tDelivery = useTranslations("deliveryType");
  const tProvider = useTranslations("shippingProvider");
  const router = useRouter();
  const toast = useToast();

  /*
   * Seeded at mount from the rule, and never synchronised afterwards.
   *
   * The obvious version copies props into state inside an effect, and it is the
   * one React tells you not to write: it cascades a second render on every open
   * and leaves a paint of the previous rule's values behind. The parent gives
   * this component a `key` derived from the rule id instead, so opening a
   * different row remounts it and these initialisers run once with the right
   * values. A form that kept the previous row's numbers would write them onto
   * this one.
   */
  const [amount, setAmount] = useState(rule?.amount ?? "");
  const [wilayaId, setWilayaId] = useState(String(rule?.wilaya_id ?? 0));
  const [communeId, setCommuneId] = useState(String(rule?.commune_id ?? 0));
  const [deliveryType, setDeliveryType] = useState<DeliveryType>(
    (DELIVERY_TYPES as readonly string[]).includes(rule?.delivery_type ?? "")
      ? (rule?.delivery_type as DeliveryType)
      : "home",
  );
  const [provider, setProvider] = useState(rule?.provider ?? "");
  const [freeOver, setFreeOver] = useState(rule?.free_over ?? "");
  const [estimatedDays, setEstimatedDays] = useState(
    rule?.estimated_days === null || rule?.estimated_days === undefined
      ? ""
      : String(rule.estimated_days),
  );
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [fields, setFields] = useState<Record<string, string>>({});

  const communes = useQuery({
    queryKey: ["communes", wilayaId],
    enabled: open && wilayaId !== "0",
    queryFn: () => acRead<Commune[]>(`/locations/wilayas/${wilayaId}/communes?per_page=100`),
  });

  const save = useMutation({
    mutationFn: async () => {
      /*
       * A named subset, never "the object minus what looks read-only". This
       * collection does drop its four server-owned keys in silence — `id`,
       * `specificity` and the two timestamps — but a body left with nothing
       * supported answers 400 `"No supported fields were provided."` with **no
       * `details` at all**, and a form binding errors per control has nothing to
       * bind. Naming the eight is caution rather than the API's requirement, and
       * the comment says which.
       */
      const payload: Record<string, unknown> = {
        provider,
        wilaya_id: Number(wilayaId),
        commune_id: Number(communeId),
        delivery_type: deliveryType,
        amount,
        // Both clear expressibly: the API folds "", null and 0 to null.
        free_over: freeOver.trim() === "" ? null : freeOver.trim(),
        estimated_days: estimatedDays.trim() === "" ? null : Number(estimatedDays),
        is_active: isActive,
      };

      return rule === null
        ? acWrite("POST", "/shipping/rules", payload)
        : acWrite("PATCH", `/shipping/rules/${rule.id}`, payload);
    },
    onSuccess: () => {
      toast.show(t("ruleSaved"));
      onSaved();
      router.refresh();
    },
    onError: (error: unknown) => {
      /* A 400 lists every bad field at once and each one binds to its own
         control; a toast with the first message throws the rest away. */
      if (error instanceof BrowserApiError && error.fields) {
        setFields(error.fields);
        return;
      }
      toast.show(error instanceof Error ? error.message : t("ruleSaved"), "danger");
    },
  });

  const wilayaName = (w: Wilaya) => (locale === "ar" && w.name_ar !== "" ? w.name_ar : w.name);

  /*
   * The summary, and the reason every control above names its own `id`.
   *
   * A 400 can name a field this form does not render — a key the API grew, or one
   * a future release adds — and an orphan still has to be readable or a person
   * sees a refusal with no cause anywhere on screen. Those render as **text**
   * rather than as a link, per §3.4: there is nowhere to send them, and a link
   * that goes nowhere is worse than a line that does not claim to.
   */
  const LABELLED: Record<string, { id: string; label: string }> = {
    amount: { id: "rule-amount", label: t("amountLabel") },
    wilaya_id: { id: "rule-wilaya", label: t("pickWilaya") },
    commune_id: { id: "rule-commune", label: t("pickCommune") },
    delivery_type: { id: "rule-delivery", label: t("deliveryTypeLabel") },
    provider: { id: "rule-provider", label: t("providerLabel") },
    free_over: { id: "rule-free-over", label: t("freeOverLabel") },
    estimated_days: { id: "rule-days", label: t("estimatedDaysLabel") },
    is_active: { id: "rule-active", label: t("activeLabel") },
  };

  const failures: FormFailure[] = Object.entries(fields).map(([key, message]) => {
    const known = LABELLED[key];
    return known === undefined
      ? { message }
      : { id: known.id, label: known.label, message };
  });

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={rule === null ? t("newRule") : t("editRule")}
      size="md"
      footer={
        <>
          {/* Cancel first in DOM order: first tab stop, and `flex-col-reverse`
              puts the primary on top on a phone where the thumb is not. */}
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {tUi("cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            {t("save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ErrorSummary failures={failures} />

        <NumberField
          id="rule-amount"
          label={t("amountLabel")}
          value={amount}
          onChange={setAmount}
          error={fields.amount}
        />

        <Select
          id="rule-wilaya"
          label={t("pickWilaya")}
          value={wilayaId}
          onChange={(value) => {
            setWilayaId(value);
            /* A commune belongs to a wilaya; keeping the old id would send a
               destination that does not exist. */
            setCommuneId("0");
          }}
          error={fields.wilaya_id}
          /* A rule with no wilaya is the national fallback, not an unfinished
             row — the option says so rather than leaving a blank to interpret. */
          hint={wilayaId === "0" ? t("destinationHint") : undefined}
          options={[
            { value: "0", label: t("nationalOption") },
            ...wilayas.map((w) => ({ value: String(w.id), label: wilayaName(w) })),
          ]}
        />

        <Select
          id="rule-commune"
          label={t("pickCommune")}
          value={communeId}
          onChange={setCommuneId}
          disabled={wilayaId === "0"}
          error={fields.commune_id}
          hint={wilayaId === "0" ? t("pickCommuneFirst") : undefined}
          options={[
            { value: "0", label: t("anyCommune") },
            ...(communes.data?.data ?? []).map((c) => ({
              value: String(c.id),
              label: locale === "ar" && c.name_ar !== "" ? c.name_ar : c.name,
            })),
          ]}
        />

        <Select<DeliveryType>
          id="rule-delivery"
          label={t("deliveryTypeLabel")}
          value={deliveryType}
          onChange={setDeliveryType}
          error={fields.delivery_type}
          options={DELIVERY_TYPES.map((type) => ({ value: type, label: tDelivery(type) }))}
        />

        <Select
          id="rule-provider"
          label={t("providerLabel")}
          value={provider}
          onChange={setProvider}
          error={fields.provider}
          /* `""` is a real stored value meaning *any*, not an unfinished field:
             a rule saved without a provider comes back with `provider: ""` and
             the rate then resolves to the configured default. */
          options={[
            { value: "", label: t("providerAny") },
            /* The same three-step fallback the rows use, so the picker and the
               row it writes cannot disagree about what a provider is called. */
            ...providers.map((p) => ({
              value: p.name,
              label: providerLabel(p.name, providers, (key) =>
                tProvider.has(key as "manual") ? tProvider(key as "manual") : null,
              ),
            })),
          ]}
        />

        <NumberField
          id="rule-free-over"
          label={t("freeOverLabel")}
          value={freeOver}
          onChange={setFreeOver}
          hint={t("freeOverHint")}
          error={fields.free_over}
        />

        <TextField
          id="rule-days"
          label={t("estimatedDaysLabel")}
          value={estimatedDays}
          onChange={setEstimatedDays}
          inputMode="numeric"
          isolate
          error={fields.estimated_days}
        />

        <Switch
          id="rule-active"
          label={t("activeLabel")}
          checked={isActive}
          onChange={setIsActive}
          hint={t("activeHint")}
          error={fields.is_active}
        />
      </div>
    </Modal>
  );
}
