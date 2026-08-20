"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { DELIVERY_TYPES } from "@/lib/shipment-status";
import type { ShippingProvider, ShippingRule } from "@/lib/api/schemas/shipping";
import type { Wilaya } from "@/lib/api/schemas/order";
import { Sheet } from "@/components/primitives/Sheet";
import { ActionSheet } from "@/components/primitives/ActionSheet";
import { Button } from "@/components/primitives/Button";
import { DecimalField, SelectField, SwitchField, TextField } from "@/components/primitives/Field";
import { useToast } from "@/components/primitives/Toast";

type Commune = { id: number; name: string; name_ar: string };

/**
 * Create or edit one tariff row.
 *
 * **`amount` is the only required field**, measured: `POST {}` answers 400 with
 * `details.fields.amount: "Required."` and nothing else. Everything else has a
 * server-side default, including the destination — which is why a rule with no
 * wilaya and no commune is the *national* fallback rather than an incomplete row.
 * That is the single most confusing thing about this form, so the destination
 * pickers say so rather than leaving two empty selects to be interpreted.
 *
 * Money stays a string end to end. `9999999.99` is the ceiling — nine million
 * dinars of delivery is a typo, not a tariff — and the API says so by name.
 */
export function RuleSheet({
  open,
  rule,
  providers,
  wilayas,
  locale,
  onClose,
  onSaved,
}: {
  open: boolean;
  rule: ShippingRule | null;
  providers: ShippingProvider[];
  wilayas: Wilaya[];
  locale: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("shipping");
  const tDelivery = useTranslations("deliveryType");
  const router = useRouter();
  const toast = useToast();

  /*
   * Seeded at mount from the rule, and never synchronised afterwards.
   *
   * The obvious version copies the props into state inside an effect, and it is
   * the one React tells you not to write: it cascades a second render on every
   * open, and it leaves a paint of the previous rule's values behind. The parent
   * gives this component a `key` derived from the rule id instead, so opening a
   * different row remounts it and the initialisers below run once with the right
   * values. A form that kept the previous row's numbers would write them onto
   * this one.
   */
  const [amount, setAmount] = useState(rule?.amount ?? "");
  const [wilayaId, setWilayaId] = useState(String(rule?.wilaya_id ?? 0));
  const [communeId, setCommuneId] = useState(String(rule?.commune_id ?? 0));
  const [deliveryType, setDeliveryType] = useState<string>(rule?.delivery_type ?? "home");
  const [provider, setProvider] = useState(
    rule?.provider ?? providers.find((entry) => entry.is_default)?.name ?? "",
  );
  const [freeOver, setFreeOver] = useState(rule?.free_over ?? "");
  const [estimatedDays, setEstimatedDays] = useState(
    rule?.estimated_days === null || rule?.estimated_days === undefined
      ? ""
      : String(rule.estimated_days),
  );
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const communes = useQuery({
    queryKey: ["communes", wilayaId],
    enabled: open && wilayaId !== "0",
    queryFn: () => acRead<Commune[]>(`/locations/wilayas/${wilayaId}/communes?per_page=100`),
  });

  const save = useMutation({
    mutationFn: async () => {
      /*
       * A named subset, never "the object minus what looks read-only". The
       * products branch measured what that costs: a PATCH whose every key is
       * read-only answers 400 `"No supported fields were provided."` with no
       * `details` at all, and a form binding errors per control has nothing to
       * bind.
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
      // A 400 lists every bad field at once and each one binds to its own
      // control; a toast with the first message throws the rest away.
      if (error instanceof BrowserApiError && error.fields) {
        setFields(error.fields);
        return;
      }
      toast.show(error instanceof Error ? error.message : t("ruleSaved"), "danger");
    },
  });

  const remove = useMutation({
    mutationFn: async () => acWrite("DELETE", `/shipping/rules/${rule?.id}`),
    onSuccess: () => {
      toast.show(t("ruleDeleted"));
      onSaved();
      router.refresh();
    },
    onError: (error: unknown) => {
      toast.show(error instanceof Error ? error.message : t("ruleDeleted"), "danger");
    },
  });

  const wilayaName = (w: Wilaya) => (locale === "ar" && w.name_ar !== "" ? w.name_ar : w.name);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={rule === null ? t("newRule") : t("editRule")}
    >
      <div className="flex flex-col gap-6 pb-4">
        <div className="overflow-hidden rounded-lg bg-surface">
          <DecimalField
            label={t("amountLabel")}
            value={amount}
            onChange={setAmount}
            error={fields.amount}
          />
          <SelectField
            label={t("pickWilaya")}
            value={wilayaId}
            onChange={(value) => {
              setWilayaId(value);
              setCommuneId("0");
            }}
            error={fields.wilaya_id}
            // A rule with no wilaya is the national fallback, not an unfinished
            // row — the option says so rather than leaving a blank to interpret.
            hint={wilayaId === "0" ? t("destinationHint") : undefined}
            options={[
              { value: "0", label: t("nationalOption") },
              ...wilayas.map((w) => ({ value: String(w.id), label: wilayaName(w) })),
            ]}
          />
          <SelectField
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
          <SelectField
            label={t("deliveryTypeLabel")}
            value={deliveryType}
            onChange={setDeliveryType}
            error={fields.delivery_type}
            options={DELIVERY_TYPES.map((type) => ({
              value: type,
              label: tDelivery(type),
            }))}
          />
          <SelectField
            label={t("providerLabel")}
            value={provider}
            onChange={setProvider}
            error={fields.provider}
            options={providers.map((p) => ({ value: p.name, label: p.label }))}
          />
          <DecimalField
            label={t("freeOverLabel")}
            value={freeOver}
            onChange={setFreeOver}
            hint={t("freeOverHint")}
            error={fields.free_over}
          />
          <TextField
            label={t("estimatedDaysLabel")}
            value={estimatedDays}
            onChange={setEstimatedDays}
            inputMode="numeric"
            isolate
            error={fields.estimated_days}
          />
          <SwitchField
            label={t("activeLabel")}
            checked={isActive}
            onChange={setIsActive}
            hint={t("activeHint")}
            error={fields.is_active}
          />
        </div>

        <div className="flex flex-col gap-3">
          <Button
            variant="filled"
            fullWidth
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t("save")}
          </Button>
          {rule !== null ? (
            <Button
              variant="destructive"
              fullWidth
              disabled={remove.isPending}
              onClick={() => setConfirmingDelete(true)}
            >
              {t("deleteRule")}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Destructive choices go to an action sheet, never to a browser
          `confirm()` — Part III is explicit, and a native dialog is the one
          surface in this panel nothing can style or translate. */}
      <ActionSheet
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t("deleteRule")}
        description={t("deleteRuleConfirm")}
        actions={[
          {
            label: t("deleteRule"),
            tone: "destructive",
            onSelect: () => {
              setConfirmingDelete(false);
              remove.mutate();
            },
          },
        ]}
      />
    </Sheet>
  );
}
