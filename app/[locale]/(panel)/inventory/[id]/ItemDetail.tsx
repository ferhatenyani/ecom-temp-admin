"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import type { AdjustResult, InventoryItem, Movement } from "@/lib/api/schemas/inventory";
import { BACKORDERS } from "@/lib/api/schemas/inventory";
import { STOCK_STATUSES, STOCK_TONE, type StockStatus } from "@/lib/product-status";
import { displayQuantity, isDelegated, itemLabel } from "@/lib/inventory";
import { Scaffold } from "@/components/patterns/Scaffold";
import { SectionError } from "@/components/patterns/States";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { SelectField, SwitchField, TextField } from "@/components/primitives/Field";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Button } from "@/components/primitives/Button";
import { Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { AdjustForm } from "./AdjustForm";
import { MovementRow } from "../MovementRow";

/**
 * One item's stock: what it holds, how to change it, how it got there.
 *
 * The order is the order of the work. The quantity is what someone came to see,
 * the adjustment is what they came to do, the settings are what they reach for
 * when the adjustment is refused, and the ledger is the proof underneath. A
 * settings card above the adjustment would put configuration in front of the
 * task on every visit for the sake of the visits where it is needed.
 */

/** The four fields `PATCH /inventory/{id}` accepts, and nothing else. */
type Settings = {
  manage_stock: boolean;
  stock_status: string;
  backorders: string;
  /**
   * A string so an empty field can mean "clear it", which the API takes as
   * `null` — the per-product threshold goes away and the store-wide setting
   * applies. Note that it never reads back empty: `wc_get_low_stock_amount()`
   * resolves to the global default, so clearing it and saving shows the default
   * in the field rather than a blank. That is the effective threshold and it is
   * what the row beside the quantity judges against, so it is the honest thing
   * to show; the hint under the field says what an empty value does.
   */
  low_stock_amount: string;
};

function settingsOf(item: InventoryItem): Settings {
  return {
    /*
     * `managing_stock`, not `manage_stock` — the switch has to show the truth,
     * and the raw value is the *string* `"parent"` for a variation inheriting
     * its parent's stock.
     *
     * Which is exactly why `saveSettings()` sends only the fields that changed.
     * Sending the whole object would translate `"parent"` into `true` on any
     * save — someone edits the backorder policy and silently detaches the
     * variation's stock from its parent, with nothing on screen to say so.
     */
    manage_stock: item.managing_stock,
    stock_status: item.stock_status,
    backorders: item.backorders,
    low_stock_amount: String(item.low_stock_amount),
  };
}

export function ItemDetail({
  locale,
  initialItem,
  initialMovements,
  meId,
}: {
  locale: string;
  initialItem: InventoryItem;
  initialMovements: Movement[] | null;
  meId: number | null;
}) {
  const t = useTranslations("inventory");
  const tDetail = useTranslations("inventory.detail");
  const tStock = useTranslations("stockStatus");
  const router = useRouter();
  const toast = useToast();

  const [item, setItem] = useState(initialItem);
  const [settings, setSettings] = useState<Settings>(settingsOf(initialItem));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { product, variant } = itemLabel(item);
  const quantity = displayQuantity(item);
  const dirty = JSON.stringify(settings) !== JSON.stringify(settingsOf(item));

  /**
   * This item's own ledger, five rows.
   *
   * Seeded from the server's fetch and refetched after an adjustment, because the
   * adjustment has just written a row that has to appear here or the screen is
   * telling two different stories about the same shelf.
   */
  const movements = useQuery({
    queryKey: ["inventory", "item-moves", item.id],
    queryFn: async () => {
      const response = await fetch(
        `/api/ac/inventory/movements?product_id=${item.id}&per_page=5`,
        { headers: { Accept: "application/json" } },
      );
      const body = (await response.json()) as { data?: Movement[] };
      return body.data ?? [];
    },
    initialData: initialMovements ?? undefined,
  });

  function onAdjusted(result: AdjustResult) {
    setItem(result.item);
    setSettings(settingsOf(result.item));
    void movements.refetch();
    // The lists behind this screen now hold a stale quantity for this row.
    router.refresh();
  }

  async function saveSettings() {
    setSaving(true);
    setErrors({});
    setTopError(null);

    /*
     * **Only what changed**, and that is not tidiness.
     *
     * `manage_stock` reads back as the string `"parent"` for a variation that
     * inherits its parent's stock, and the switch necessarily shows that as on.
     * Sending the whole object would then post `manage_stock: true` on every
     * save and quietly detach the variation from its parent — a destructive edit
     * nobody asked for, arriving as a side effect of changing the backorder
     * policy. A named subset is also what the products branch learned to send:
     * a PATCH of only read-only fields is a 400 with no `details` at all.
     *
     * `low_stock_amount` empty means "clear the per-product threshold and fall
     * back to the store-wide setting", which the API takes as `null`. Empty and
     * zero are different and both are legal — measured, the field accepts
     * `null`, `""` and any whole number of zero or more.
     */
    const original = settingsOf(item);
    const body: Record<string, unknown> = {};
    if (settings.manage_stock !== original.manage_stock) {
      body.manage_stock = settings.manage_stock;
    }
    if (settings.stock_status !== original.stock_status) {
      body.stock_status = settings.stock_status;
    }
    if (settings.backorders !== original.backorders) {
      body.backorders = settings.backorders;
    }
    if (settings.low_stock_amount !== original.low_stock_amount) {
      const raw = settings.low_stock_amount.trim();
      body.low_stock_amount = raw === "" ? null : Number(raw);
    }

    const response = await fetch(`/api/ac/inventory/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as {
      success?: boolean;
      data?: InventoryItem;
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    };

    setSaving(false);

    if (response.ok && payload.success !== false && payload.data) {
      setItem(payload.data);
      setSettings(settingsOf(payload.data));
      toast.show(tDetail("saved"));
      router.refresh();
      return;
    }

    const fields = payload.error?.details?.fields as Record<string, string> | undefined;
    if (fields && Object.keys(fields).length > 0) {
      setErrors(fields);
      // A refused field this form does not render still has to be reachable, or
      // the person reads a refusal with no cause anywhere on screen. The one that
      // reaches here is `stock_quantity`, whose message names the adjust endpoint.
      const orphans = Object.entries(fields).filter(([key]) => !(key in settings));
      if (orphans.length > 0) {
        setTopError(orphans.map(([key, message]) => `${key}: ${message}`).join(" · "));
      }
      return;
    }

    setTopError(payload.error?.message ?? `Request failed (${response.status})`);
  }

  return (
    <Scaffold
      title={product}
      back={{ href: `/${locale}/inventory`, label: t("title") }}
    >
      <div className="mx-auto max-w-3xl px-4">
        {/* --- what it holds ------------------------------------------- */}
        {/* No product name here: `Scaffold` already renders it as the large
            title directly above, and printing it twice in 100px cost the card
            a line and told the reader nothing. This is the identity *beside*
            the name — SKU, variation, type, stock state. */}
        <section className="mb-8 rounded-lg bg-surface px-4 py-5">
          <div className="flex flex-wrap items-center gap-2 text-footnote text-label-secondary">
            {item.sku !== "" ? <Ltr>{item.sku}</Ltr> : <span>{t("noSku")}</span>}
            {variant ? <StatusBadge tone="neutral">{variant}</StatusBadge> : null}
            <StatusBadge tone={STOCK_TONE[item.stock_status as StockStatus] ?? "neutral"}>
              {tStock(item.stock_status)}
            </StatusBadge>
            {/* The API's own word — `simple`, `variable`, `variation` — is a
                developer's vocabulary, and it was rendering raw. Localised, and
                falling back to the raw value for a type the panel has no word
                for, because an unlabelled type is a missing translation rather
                than a reason to show nothing. */}
            <StatusBadge tone="neutral">
              {t.has(`type.${item.type}`) ? t(`type.${item.type}`) : item.type}
            </StatusBadge>
          </div>

          <div className="mt-4 flex items-baseline gap-3">
            {quantity.tracked ? (
              <>
                {/*
                  The quantity at `--text-large-title`. This is the number
                  someone crossed a stockroom to read, and PRODUCT.md's scene is
                  a phone held at arm's length in bad light.
                */}
                <Ltr
                  className={`text-large-title ${
                    quantity.low ? "tonal-fg tone-danger" : "text-label"
                  }`}
                >
                  {quantity.value}
                </Ltr>
                <span className="text-footnote text-label-secondary">
                  <Ltr numeric>{t("threshold", { threshold: quantity.threshold })}</Ltr>
                </span>
              </>
            ) : (
              /* Untracked is a sentence, never a zero. The difference between
                 "we do not count this" and "there are none" is the difference
                 between reordering and not. */
              <div className="flex flex-col gap-1">
                <span className="text-title-2 text-label-tertiary">{t("untracked")}</span>
                <span className="text-footnote text-label-secondary">
                  {t("untrackedHint")}
                </span>
              </div>
            )}
          </div>

          {isDelegated(item) ? (
            <p className="mt-3 text-footnote text-label-secondary">
              <Ltr numeric>{t("delegated", { id: item.stock_managed_by_id })}</Ltr>
            </p>
          ) : null}

          {/* A variation's parent, as a link rather than as a printed id in a
              reference table nobody scrolls to. */}
          {item.parent_id > 0 ? (
            <Link
              href={`/${locale}/inventory/${item.parent_id}`}
              className="press mt-3 inline-flex min-h-11 items-center text-footnote text-accent"
            >
              {tDetail("parent")}
            </Link>
          ) : null}
        </section>

        {/* --- what to do about it -------------------------------------- */}
        <AdjustForm item={item} onAdjusted={onAdjusted} />

        {/* --- how it is configured ------------------------------------- */}
        <ListGroup title={tDetail("settings")} footnote={tDetail("settingsFootnote")}>
          <SwitchField
            label={tDetail("manageStock")}
            hint={tDetail("manageStockHint")}
            checked={settings.manage_stock}
            onChange={(checked) => setSettings({ ...settings, manage_stock: checked })}
            error={errors.manage_stock}
          />
          <SelectField
            label={tDetail("stockStatus")}
            value={settings.stock_status}
            onChange={(value) => setSettings({ ...settings, stock_status: value })}
            options={STOCK_STATUSES.map((value) => ({ value, label: tStock(value) }))}
            error={errors.stock_status}
          />
          <SelectField
            label={tDetail("backorders")}
            hint={tDetail("backordersHint")}
            value={settings.backorders}
            onChange={(value) => setSettings({ ...settings, backorders: value })}
            options={BACKORDERS.map((value) => ({ value, label: t(`backorders.${value}`) }))}
            error={errors.backorders}
          />
          <TextField
            label={tDetail("lowStockAmount")}
            hint={tDetail("lowStockAmountHint")}
            value={settings.low_stock_amount}
            onChange={(value) => setSettings({ ...settings, low_stock_amount: value })}
            error={errors.low_stock_amount}
            inputMode="numeric"
            isolate
          />
        </ListGroup>

        {topError !== null ? (
          <p role="alert" className="tone-danger tonal mb-8 rounded-lg px-4 py-3 text-footnote">
            {topError}
          </p>
        ) : null}

        {/* --- how it got here ----------------------------------------- */}
        <ListGroup title={tDetail("movements")}>
          {movements.isError ? (
            <SectionError>{tDetail("noMovements")}</SectionError>
          ) : (movements.data ?? []).length === 0 ? (
            <SectionError>{tDetail("noMovements")}</SectionError>
          ) : (
            (movements.data ?? []).map((movement) => (
              <ListRow key={movement.id}>
                <MovementRow
                  movement={movement}
                  locale={locale}
                  meId={meId}
                  showProduct={false}
                />
              </ListRow>
            ))
          )}
          {/* The whole ledger for this product, which is the same screen with
              `?product_id=` set — verified to filter, 1154 → 4 on this item. */}
          <Link
            href={`/${locale}/inventory?view=moves&product_id=${item.id}`}
            className="list-row press-row flex min-h-11 items-center px-4 py-3 text-body text-accent"
          >
            {tDetail("allMovements")}
          </Link>
        </ListGroup>

      </div>

      {dirty ? (
        <div className="save-bar material-bar hairline-t fixed inset-x-0 z-20">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
            <Button
              variant="plain"
              onClick={() => {
                setSettings(settingsOf(item));
                setErrors({});
                setTopError(null);
              }}
            >
              {tDetail("discard")}
            </Button>
            <Button onClick={() => void saveSettings()} loading={saving} fullWidth className="flex-1">
              {tDetail("save")}
            </Button>
          </div>
        </div>
      ) : null}
    </Scaffold>
  );
}
