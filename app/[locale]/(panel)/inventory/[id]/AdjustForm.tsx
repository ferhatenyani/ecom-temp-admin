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
import { Segmented } from "@/components/primitives/Segmented";
import { SelectField, TextAreaField } from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { useOnline } from "@/lib/use-online";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * The adjustment.
 *
 * **Three mental operations, one control, and no arithmetic in anyone's head.**
 * `set` states where the shelf ends up; `increase` and `decrease` state how far
 * it moves, and the API applies those as relative SQL so two concurrent
 * decrements compose correctly where two concurrent `set`s are last-writer-wins.
 * A stocktake wants the first, a warehouse thumb wants the second, and the wrong
 * one is silently wrong rather than refused.
 *
 * What makes them one control is the line under the field: **`3 → 5`**, recomputed
 * on every keystroke and every tap, identical in all three modes. Whichever mode
 * is selected, the person reads the number the shelf will hold. Without it,
 * `decrease` is a subtraction they have to do themselves against a figure that
 * scrolled off the top of the screen — which is how a stocktake ends up with the
 * delta typed into a `set` field.
 *
 * The stepper exists for the same scene. `− 1 +` at 44px is the fastest possible
 * "one broke" on a phone held in one hand, and it drives the same field the
 * keyboard does rather than being a second, competing control.
 */
export function AdjustForm({
  item,
  onAdjusted,
}: {
  item: InventoryItem;
  onAdjusted: (result: AdjustResult) => void;
}) {
  const t = useTranslations("inventory.adjust");
  const tReason = useTranslations("movementReason");
  const toast = useToast();
  const online = useOnline();
  const hydrated = useHydrated();

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
  const adjustable = canAdjust(item);

  const parsed = Number.parseInt(quantity.trim(), 10);
  const valid = quantityProblem(mode, quantity) === null;
  const projected = valid ? projectQuantity(mode, parsed, current) : null;

  /**
   * The local check exists to keep a person from spending a round trip on a
   * value the API has already told us it refuses — its messages are still the
   * ones that land after a submit, and they win.
   */
  const localProblem = quantityProblem(mode, quantity);
  const quantityError =
    errors.quantity ?? (localProblem !== null && quantity !== "" ? t(`invalid.${localProblem}`) : undefined);

  function bump(by: number) {
    const base = Number.isFinite(parsed) ? parsed : 0;
    setQuantity(String(Math.max(0, base + by)));
    clearErrors("quantity");
    setConflict(null);
  }

  async function submit() {
    if (busy || !valid) return;
    setBusy(true);
    setErrors({});
    setConflict(null);

    /*
     * **The adjustment goes to the id that manages the stock, not the id of the
     * row that was tapped.** For a variation inheriting its parent's stock those
     * differ, and sending the tapped id either 409s or moves the wrong shelf.
     * It is also the id the backend records the movement against, so a ledger
     * filtered by the tapped id would come back empty while the stock moved.
     */
    const target = adjustTarget(item);

    const response = await fetch(`/api/ac/inventory/${target}/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        mode,
        quantity: parsed,
        reason,
        // Sent only when written. `note: ""` is accepted, but an unknown *field*
        // is a 400 — the endpoint refuses anything outside mode/quantity/reason/note
        // by name — so the payload stays exactly the four it knows.
        ...(note.trim() !== "" ? { note: note.trim() } : {}),
      }),
    });

    const payload = (await response.json()) as {
      success?: boolean;
      data?: AdjustResult;
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    };

    setBusy(false);

    if (response.ok && payload.success !== false && payload.data) {
      const { movement } = payload.data;
      onAdjusted(payload.data);
      setQuantity("1");
      setNote("");
      toast.show(
        t("done", {
          delta: movement.delta > 0 ? `+${movement.delta}` : `−${Math.abs(movement.delta)}`,
          before: movement.quantity_before,
          after: movement.quantity_after,
        }),
      );
      return;
    }

    const details = payload.error?.details ?? {};

    /**
     * A 400 here is a **well-formed field list** and the whole reason `Field`
     * binds its own error — measured, three fields came back from a single empty
     * body. Each message lands on the control it names rather than collapsing
     * into one line at the top.
     */
    const fields = details.fields as Record<string, string> | undefined;
    if (fields && Object.keys(fields).length > 0) {
      setErrors(fields);
      return;
    }

    /**
     * Two distinct 409s, both structured, both worth reading rather than
     * flattening into "conflict":
     *
     *   `{stock_quantity, projected, backorders}` — the adjustment would drive
     *   stock below zero on a product that does not take backorders. `projected`
     *   is the number to show, because it is the thing the person has to change.
     *
     *   `{id, manage_stock}` — the product is not tracking stock at all. That is
     *   fixable one card down, on this same screen.
     */
    if (response.status === 409) {
      if (typeof details.projected === "number") {
        setConflict(t("belowZero", { projected: details.projected }));
        return;
      }
      setConflict(payload.error?.message ?? t("notManaging"));
      return;
    }

    setConflict(payload.error?.message ?? `Request failed (${response.status})`);
  }

  /*
   * A product that does not manage stock cannot be adjusted, and the API says so
   * with a 409 naming the fix. There is no reason to let someone fill in a form
   * to be told that, so the card renders the reason and points at the settings
   * below — which is the control that resolves it, on this screen, one card down.
   */
  if (!adjustable) {
    return (
      <section className="mb-8">
        <h2 className="mb-2 px-4 text-title-3 text-label">{t("title")}</h2>
        <div className="rounded-lg bg-surface px-4 py-6">
          <p className="tone-warning tonal-fg flex items-start gap-2 text-body">
            <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
            <span className="min-w-0">{t("notManaging")}</span>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <h2 className="mb-2 px-4 text-title-3 text-label">{t("title")}</h2>

      <div className="overflow-hidden rounded-lg bg-surface">
        <div className="list-row flex flex-col gap-2 px-4 py-3">
          <Segmented<AdjustMode>
            segments={ADJUST_MODES.map((value) => ({ value, label: t(`mode.${value}`) }))}
            value={mode}
            onChange={(next) => {
              setMode(next);
              clearErrors("mode", "quantity");
              setConflict(null);
            }}
            label={t("modeLabel")}
          />
          {/* Each mode says what it means in the shop's own terms — "réception",
              "inventaire", "sortie" — because "set / increase / decrease" is the
              API's vocabulary and not a stockkeeper's. */}
          <p className="text-footnote text-label-secondary">{t(`modeHint.${mode}`)}</p>
          {errors.mode ? (
            <p className="tonal-fg tone-danger text-footnote">{errors.mode}</p>
          ) : null}
        </div>

        {/* --- the quantity, as a stepper around a real field ------------- */}
        <div
          className={`list-row flex flex-col gap-2 px-4 py-3 ${
            quantityError ? "tone-danger tonal" : ""
          }`}
        >
          <span className="text-footnote text-label-secondary" id="adjust-quantity-label">
            {mode === "set" ? t("quantitySet") : t("quantity")}
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => bump(-1)}
              disabled={!hydrated || busy}
              aria-label={t("minus")}
              className="press flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-title-3 text-accent disabled:opacity-40"
            >
              {/* U+2212 MINUS SIGN, which sits at digit height; a hyphen does not. */}
              <span aria-hidden="true">−</span>
            </button>

            <input
              type="text"
              inputMode="numeric"
              value={quantity}
              disabled={!hydrated || busy}
              aria-busy={!hydrated || undefined}
              aria-labelledby="adjust-quantity-label"
              aria-invalid={quantityError ? true : undefined}
              aria-describedby={quantityError ? "adjust-quantity-error" : "adjust-preview"}
              onChange={(event) => {
                setQuantity(event.target.value);
                clearErrors("quantity");
                setConflict(null);
              }}
              /* `type="text"` with a numeric inputMode, not `type="number"`: a
                 number input silently drops what it cannot parse, and "Must be a
                 whole number." is a message the API sends and this panel exists
                 to surface. Swallowing the bad character means the person never
                 learns which one it was. */
              dir="ltr"
              data-numeric=""
              style={{ unicodeBidi: "isolate" }}
              className="min-h-13 min-w-0 flex-1 bg-transparent text-center text-title-1 text-label outline-none disabled:opacity-40"
            />

            <button
              type="button"
              onClick={() => bump(1)}
              disabled={!hydrated || busy}
              aria-label={t("plus")}
              className="press flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-title-3 text-accent disabled:opacity-40"
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>

          {quantityError ? (
            <p
              id="adjust-quantity-error"
              className="tonal-fg tone-danger flex items-start gap-1.5 text-footnote"
            >
              <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0">{quantityError}</span>
            </p>
          ) : null}
        </div>

        {/* --- the preview: the line that makes three modes one control --- */}
        <div className="list-row flex items-center gap-3 px-4 py-3">
          <span className="shrink-0 text-body text-label-secondary">{t("previewLabel")}</span>
          <span id="adjust-preview" aria-live="polite" className="ms-auto text-end">
            {projected === null ? (
              <span className="text-body text-label-tertiary">—</span>
            ) : projected === current ? (
              <span className="text-body text-label-tertiary">{t("unchanged")}</span>
            ) : (
              /* The arrow does not flip in RTL: it points from an earlier value
                 to a later one, which is a fact about time and not about reading
                 direction. Both numbers travel inside one `Ltr` with it. */
              <Ltr
                className={`text-title-2 ${
                  projected < 0
                    ? "tonal-fg tone-danger"
                    : projected <= item.low_stock_amount
                      ? "tonal-fg tone-warning"
                      : "text-label"
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
        <SelectField
          label={t("reason")}
          value={reason}
          onChange={setReason}
          error={errors.reason}
          options={MANUAL_REASONS.map((value) => ({ value, label: tReason(value) }))}
          disabled={busy}
        />

        <TextAreaField
          label={t("note")}
          hint={t("noteHint")}
          value={note}
          onChange={setNote}
          error={errors.note}
          rows={2}
          disabled={busy}
        />
      </div>

      {/* The target, stated whenever it is not the row on screen. Silence here
          would mean an adjustment quietly landing on a different product. */}
      {isDelegated(item) ? (
        <p className="mt-2 px-4 text-footnote text-label-secondary">
          <Ltr numeric>{t("target", { id: adjustTarget(item) })}</Ltr>
        </p>
      ) : null}

      {conflict !== null ? (
        <p
          role="alert"
          data-testid="adjust-conflict"
          className="tone-danger tonal mt-2 flex items-start gap-2 rounded-lg px-4 py-3 text-footnote"
        >
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{conflict}</span>
        </p>
      ) : null}

      {!online ? (
        <p className="tone-warning tonal mt-2 rounded-lg px-4 py-2 text-footnote">
          {t("offline")}
        </p>
      ) : null}

      <div className="mt-3 px-4">
        <Button
          fullWidth
          loading={busy}
          disabled={!valid || !online}
          onClick={() => void submit()}
        >
          {t("submit")}
        </Button>
      </div>
    </section>
  );
}
