"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AdjustResult, InventoryItem } from "@/lib/api/schemas/inventory";
import {
  ADJUST_MODES,
  MANUAL_REASONS,
  projectQuantity,
  quantityProblem,
  type AdjustMode,
} from "@/lib/movement-reason";
import { adjustTarget, canAdjust, displayQuantity, isDelegated } from "@/lib/inventory";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup, Select, Stepper, TextArea } from "@/components/ui/Form";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/**
 * The adjustment — an inline card, and that is a decision rather than a default.
 *
 * The screen this replaces put it here too; what changed is that the redesign's
 * overlay layer made "open it in a Modal" a real option, and it is the wrong one.
 * One of the two 409s this form can receive says **"This product does not manage
 * stock"**, and the control that resolves it is the settings card one section
 * below on this same screen. An overlay puts that fix behind a dismiss: the
 * person reads a refusal, closes the thing they were doing, changes a setting,
 * and re-opens. Inline, the refusal and its remedy are both on screen at once.
 *
 * ## Three mental operations, one control, and no arithmetic in anyone's head
 *
 * `set` states where the shelf ends up; `increase` and `decrease` state how far it
 * moves, and the API applies those as **relative SQL** so two concurrent
 * decrements compose correctly where two concurrent `set`s are last-writer-wins.
 * A stocktake wants the first, a warehouse thumb wants the second, and the wrong
 * one is silently wrong rather than refused.
 *
 * What makes them one control is the line under the field: **`3 → 5`**, recomputed
 * on every keystroke and every tap, identical in all three modes. Whichever mode
 * is selected, the person reads the number the shelf will hold. Without it,
 * `decrease` is a subtraction they have to do themselves against a figure that
 * scrolled off the top of the screen — which is how a stocktake ends up with the
 * delta typed into a `set` field. It is a **preview, not a promise**: the API
 * records the before and after WooCommerce actually wrote, because a concurrent
 * adjustment can land in between.
 *
 * The mode picker is a `ChoiceGroup` where the retired `Segmented` used to be. A
 * real radio group is what gives it arrow keys, a roving tab order and one tab
 * stop for the whole set — none of which a row of buttons has — and each option
 * says what it means in the shop's own terms underneath, because
 * "set / increase / decrease" is the API's vocabulary and not a stockkeeper's.
 */
export function AdjustForm({
  item,
  onAdjusted,
  /** `null` when writes are permitted, otherwise the reason they are not. */
  writesBlocked,
}: {
  item: InventoryItem;
  onAdjusted: (result: AdjustResult) => void;
  writesBlocked: string | null;
}) {
  const t = useTranslations("inventory.adjust");
  const tReason = useTranslations("movementReason");
  const toast = useToast();

  const [mode, setMode] = useState<AdjustMode>("increase");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState<string>("correction");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  /** The API's own field messages, rendered verbatim on the field they name. */
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** A 409 — a state conflict rather than a bad payload. */
  const [conflict, setConflict] = useState<string | null>(null);

  /** Drop the API's message for a field the person has just changed. */
  const clearErrors = (...keys: string[]) =>
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key))),
    );

  const stock = displayQuantity(item);
  const current = stock.tracked ? stock.value : 0;

  const parsed = Number.parseInt(quantity.trim(), 10);
  const localProblem = quantityProblem(mode, quantity);
  const valid = localProblem === null;
  const projected = valid ? projectQuantity(mode, parsed, current) : null;

  /**
   * The local check exists to keep a person from spending a round trip on a value
   * the API has already told us it refuses — its messages are still the ones that
   * land after a submit, and they win. `Form.tsx` owns *when* the verdict may
   * appear: silent before the first blur, then live once the field has refused.
   */
  const quantityRule = (raw: string) => {
    const problem = quantityProblem(mode, raw);
    return problem === null ? undefined : t(`invalid.${problem}`);
  };

  async function submit() {
    if (busy || !valid) return;
    setBusy(true);
    setErrors({});
    setConflict(null);

    /*
     * **The adjustment goes to the id that manages the stock, not the id of the
     * row that was tapped.** For a variation inheriting its parent's stock those
     * differ, and sending the tapped id either 409s or moves the wrong shelf. It
     * is also the id the backend records the movement against, so a ledger
     * filtered by the tapped id would come back empty while the stock moved.
     */
    const target = adjustTarget(item);

    try {
      const result = await acWrite<AdjustResult>("POST", `/inventory/${target}/adjust`, {
        mode,
        quantity: parsed,
        reason,
        // Sent only when written. `note: ""` is accepted, but an unknown *field*
        // is a 400 — the endpoint refuses anything outside mode/quantity/reason/
        // note by name — so the payload stays exactly the four it knows.
        ...(note.trim() !== "" ? { note: note.trim() } : {}),
      });

      onAdjusted(result);
      setQuantity("1");
      setNote("");
      toast.show(
        t("done", {
          delta:
            result.movement.delta > 0
              ? `+${result.movement.delta}`
              : `−${Math.abs(result.movement.delta)}`,
          before: result.movement.quantity_before,
          after: result.movement.quantity_after,
        }),
      );
    } catch (error) {
      /* A network failure is not an envelope. Narrowed before anything reads
         `details`, or a dropped connection throws inside the error handler. */
      if (!(error instanceof BrowserApiError)) {
        setConflict(error instanceof Error ? error.message : String(error));
        return;
      }
      const failure = error;

      /**
       * A 400 here is a **well-formed field list**, and it is the whole reason
       * each control binds its own error — measured, three fields came back from
       * a single empty body. Each message lands on the control it names rather
       * than collapsing into one line at the top.
       */
      const fields = failure.fields;
      if (fields && Object.keys(fields).length > 0) {
        setErrors(fields);
        return;
      }

      /**
       * Two distinct 409s, both structured, both worth reading rather than
       * flattening into "conflict":
       *
       *   `{stock_quantity, projected, backorders}` — the adjustment would drive
       *   stock below zero on a product that does not take backorders.
       *   `projected` is the number to show, because it is the thing the person
       *   has to change, and a refusal that only said "too many" would leave them
       *   doing the subtraction the preview line exists to spare them.
       *
       *   `{id, manage_stock}` — the product is not tracking stock at all. That is
       *   fixable one card down, on this same screen. It is normally caught
       *   before the request — the form is not offered on such a row — so
       *   reaching it here means the setting changed under this tab.
       */
      if (failure.status === 409) {
        const projectedFigure = failure.details.projected;
        if (typeof projectedFigure === "number") {
          setConflict(t("belowZero", { projected: projectedFigure }));
          return;
        }
        setConflict(failure.message || t("notManaging"));
        return;
      }

      setConflict(failure.message);
    } finally {
      setBusy(false);
    }
  }

  /*
   * A product that does not manage stock cannot be adjusted, and the API says so
   * with a 409 naming the fix. There is no reason to let someone fill in a form to
   * be told that, so the card renders the reason and points at the settings below
   * — which is the control that resolves it, on this screen, one card down.
   *
   * The reason is rendered, never merely implied: §3.3's "a disabled control with
   * no reason is a dead end" is answered here by removing the control *and*
   * saying what would make it appear.
   */
  if (!canAdjust(item)) {
    return (
      <Card title={t("title")}>
        <Notice tone="warning" title={t("notManagingShort")}>
          <p className="text-ui-label">{t("notManaging")}</p>
        </Notice>
      </Card>
    );
  }

  return (
    <Card
      title={t("title")}
      /* The target, stated whenever it is not the row on screen. Silence here
         would mean an adjustment quietly landing on a different product. */
      footnote={
        isDelegated(item) ? (
          <Isolate>{t("target", { id: adjustTarget(item) })}</Isolate>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          {/* A visible label above the group — §3.4, and `aria-label` on the
              radiogroup is the same string so the two cannot drift. */}
          <span className="text-ui-label text-ui-fg">{t("modeLabel")}</span>
          <ChoiceGroup
            label={t("modeLabel")}
            value={mode}
            onChange={(next) => {
              setMode(next as AdjustMode);
              clearErrors("mode", "quantity");
              setConflict(null);
            }}
            options={ADJUST_MODES.map((value) => ({ value, label: t(`mode.${value}`) }))}
            disabled={busy}
          />
          <p className="text-ui-label text-ui-muted">{t(`modeHint.${mode}`)}</p>
          {errors.mode ? (
            <p role="alert" className="text-ui-label text-ui-danger-fg">
              {errors.mode}
            </p>
          ) : null}
        </div>

        <Stepper
          id="adjust-quantity"
          /* The label changes with the mode, because the field means a different
             thing in each: an absolute in `set`, a magnitude in the other two. */
          label={mode === "set" ? t("quantitySet") : t("quantity")}
          value={quantity}
          onChange={(next) => {
            setQuantity(next);
            clearErrors("quantity");
            setConflict(null);
          }}
          error={errors.quantity}
          validate={quantityRule}
          min={0}
          decrementLabel={t("minus")}
          incrementLabel={t("plus")}
          disabled={busy}
        />

        {/* --- the preview: the line that makes three modes one control --- */}
        <div className="flex items-center gap-3 rounded-ui-md border border-ui-line bg-ui-surface-2 px-3 py-2">
          <span className="min-w-0 text-ui-label text-ui-muted">{t("previewLabel")}</span>
          <span id="adjust-preview" aria-live="polite" className="ms-auto text-end">
            {projected === null ? (
              <span className="text-ui-compact text-ui-subtle">—</span>
            ) : projected === current ? (
              <span className="text-ui-compact text-ui-subtle">{t("unchanged")}</span>
            ) : (
              /* The arrow does not flip in RTL: it points from an earlier value
                 to a later one, which is a fact about time and not about reading
                 direction. Both numbers travel inside one `Ltr` with it. */
              <Ltr
                className={`text-ui-heading ${
                  projected < 0
                    ? "text-ui-danger-fg"
                    : projected <= item.low_stock_amount
                      ? "text-ui-warning-fg"
                      : "text-ui-fg"
                }`}
              >
                {t("preview", { before: current, after: projected })}
              </Ltr>
            )}
          </span>
        </div>

        {/*
          **Exactly the six reasons a person may write.** The summary endpoint
          reports seven and three of those are system-written: sending one is a
          400 with the same message as an unknown reason, deliberately, so a
          caller cannot probe which forgeries exist. `MANUAL_REASONS` is the
          authority here and `ALL_REASONS` is the authority in the ledger's
          filter; conflating them breaks one screen or the other.
        */}
        <Select
          label={t("reason")}
          value={reason}
          onChange={setReason}
          error={errors.reason}
          options={MANUAL_REASONS.map((value) => ({ value, label: tReason(value) }))}
          disabled={busy}
        />

        <TextArea
          label={t("note")}
          hint={t("noteHint")}
          value={note}
          onChange={setNote}
          error={errors.note}
          rows={2}
          disabled={busy}
        />

        {conflict !== null ? (
          <div data-testid="adjust-conflict">
            <Notice role="alert" tone="danger" title={t("refused")}>
              <p className="text-ui-label">{conflict}</p>
            </Notice>
          </div>
        ) : null}

        <div className="flex justify-end">
          {/* Disabled with the reason rather than hidden — §3.3. `title` carries
              it, which is what turns a dead end into a sentence. */}
          <Button
            loading={busy}
            disabled={!valid || writesBlocked !== null}
            title={writesBlocked ?? undefined}
            onClick={() => void submit()}
          >
            {t("submit")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
