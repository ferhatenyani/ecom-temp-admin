"use client";

import { useTranslations } from "next-intl";
import type { InventoryItem } from "@/lib/api/schemas/inventory";
import { displayQuantity, isDelegated, itemLabel } from "@/lib/inventory";
import { STOCK_TONE, type StockStatus } from "@/lib/product-status";
import { Dot, StatusBadge } from "@/components/primitives/StatusBadge";
import { Ltr, Isolate } from "@/components/primitives/Ltr";

/**
 * One row of stock.
 *
 * **The quantity is the reason the screen exists**, so it sits alone at the
 * trailing edge at `--text-title-3` — legible at arm's length in bad light, which
 * is the scene PRODUCT.md names. Everything else is the identity of the thing it
 * counts.
 *
 * The row is deliberately the *same geometry* as `MovementRow`: a 24px first
 * line, a 4px gap, an 18px second line, `py-3`. One skeleton is therefore honest
 * for both lists, and switching segments does not resize the rows under the
 * reader's thumb. The 24px floor on the first line comes from the badge, so a row
 * carrying a variation badge is exactly as tall as one that does not — the
 * products branch shipped an 81px row against a 72px skeleton for want of that
 * floor, and paid 9px of shift per row.
 */
export function StockRow({ item }: { item: InventoryItem }) {
  const t = useTranslations("inventory");
  const tStock = useTranslations("stockStatus");
  const { product, variant } = itemLabel(item);
  const quantity = displayQuantity(item);

  return (
    <div className="flex w-full items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-6 items-center gap-2">
          {/*
            `dir="auto"` so the ellipsis lands at the *name's* own end.
            Measured in Arabic: "Plateau en bois d'olivier, 40 cm" is an LTR run
            inside an RTL paragraph, so `text-overflow` clips at the paragraph's
            end — the left — and the row read "…eau en bois d'olivier, 40 cm".
            A name eaten from the front is unscannable, and a catalogue is scanned
            by the beginnings of its names.

            Safe in both directions and for either language: when the name fits,
            the span is content-sized and flex still places it at the row's
            leading edge, so nothing moves; when it overflows, the span fills the
            line and the ellipsis follows the string's own direction.
          */}
          <span dir="auto" className="truncate text-body text-label">
            {product}
          </span>
          {/* The variation, as its own token rather than glued to the name.
              `itemLabel()` has already undone the API's doubled
              "Burnous en laine - L — L"; showing the value separately is what
              stops it reading as a stutter in the first place. */}
          {variant ? (
            <StatusBadge tone="neutral" className="max-w-24 truncate">
              {variant}
            </StatusBadge>
          ) : null}
        </div>

        {/* No height floor here: `--text-footnote--line-height` is already the
            18px this line is measured at, and every child sits on it. */}
        <div className="flex items-center gap-2 text-footnote text-label-secondary">
          {/* A SKU is an identifier: `Ltr` or the bidi algorithm reorders it
              inside Arabic text and the person reads back a code that does not
              exist. */}
          {item.sku !== "" ? (
            <Ltr className="truncate">{item.sku}</Ltr>
          ) : (
            <span className="truncate">{t("noSku")}</span>
          )}
          <span aria-hidden="true">·</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <Dot tone={STOCK_TONE[item.stock_status as StockStatus] ?? "neutral"} />
            <span className="whitespace-nowrap">{tStock(item.stock_status)}</span>
          </span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5 text-end">
        {quantity.tracked ? (
          <>
            <Ltr
              className={`text-title-3 ${quantity.low ? "tonal-fg tone-danger" : "text-label"}`}
            >
              {quantity.value}
            </Ltr>
            {/* The threshold is **per product** — measured 2 on 27 rows and 5 on
                one — so there is no shop-wide number to put in a legend, and the
                only place it means anything is beside the quantity it judges. */}
            {quantity.low ? (
              <span className="text-caption text-label-secondary">
                <Isolate numeric>{t("threshold", { threshold: quantity.threshold })}</Isolate>
              </span>
            ) : (
              <span className="text-caption text-label-tertiary">
                {isDelegated(item) ? t("delegatedShort") : ""}
              </span>
            )}
          </>
        ) : (
          <>
            {/*
              **Untracked is not zero.** 8 of the 28 top-level rows have
              `stock_quantity: null`, and printing `0` for them tells someone in a
              stockroom they are out of eight things sitting on the shelf behind
              them. It renders as a word, in tertiary weight, so it cannot be
              mistaken for a count at a glance.
            */}
            <span className="text-subhead text-label-tertiary">{t("untracked")}</span>
            <span className="text-caption text-label-tertiary">
              {isDelegated(item) ? t("delegatedShort") : ""}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
