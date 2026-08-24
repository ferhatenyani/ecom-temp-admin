"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { InventoryItem } from "@/lib/api/schemas/inventory";
import { displayQuantity, isDelegated, itemLabel } from "@/lib/inventory";
import { STOCK_TONE, type StockStatus } from "@/lib/product-status";
import { Badge, Dot } from "@/components/ui/Badge";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import type { Column } from "@/components/ui/DataTable";

/**
 * The Inventory column definition — one source, two presentations.
 *
 * ## `displayQuantity()` is the only way to the number, and that is the screen
 *
 * **A cell reading `item.stock_quantity` directly is the defect this file exists
 * to make impossible.** `lib/inventory.ts` returns a discriminated union rather
 * than `number | null` precisely "so a caller cannot reach the number without
 * having said which case they are in", and the measurement behind it is that 8
 * of the 28 top-level rows are `null` — untracked. A list printing `0` down a
 * third of its rows tells someone in a stockroom they are out of eight things on
 * the shelf behind them.
 *
 * Three states reach this cell, not two, and the third is the one nothing had
 * rendered honestly:
 *
 *   tracked      the figure, and a `Faible` badge when the row is under its own
 *                threshold — never the colour alone (§1.2)
 *   untracked    a word. `managing_stock` is false and no quantity exists
 *   delegated    a word naming *where* the quantity lives. `managing_stock` is
 *                false here too — so `displayQuantity()` says untracked, which
 *                is true of this row — but `stock_managed_by_id` is somebody
 *                else's id, and "not counted" and "counted on the parent's
 *                shelf" are different facts to a person deciding whether to
 *                reorder. Fixture 9032 is that row.
 *
 * `low_stock_amount` is **per product** — measured 2 on 27 rows and 5 on "Miel
 * de jujubier" — so the threshold is a column of its own beside the quantity it
 * judges, and there is no shop-wide figure to put in a legend anywhere.
 *
 * ## The identifying cell is a real `<a href>`, and there is no peek
 *
 * A peek drawer would be *free* here — `lib/api/schemas/inventory.ts:8-13`
 * measures that `/inventory`, `/inventory/{id}`, `/inventory/low-stock` and
 * `/inventory/lookup` all return the same item, so a preview costs no request,
 * which is the condition orders and products ship one on. It is still wrong: the
 * reason to open an inventory row is to **adjust** it, and a preview that cannot
 * adjust is a stop on the way to the screen that can. So the row navigates, and
 * because it navigates the name is an anchor rather than a span inside a
 * clickable row — that is the keyboard path, the middle click and "open in new
 * tab", none of which a `<div onClick>` has.
 *
 * The anchor is deliberately only in the **table**. `RecordList` navigates
 * through the stretched overlay button `DataTable` already gives it, so a row is
 * one anchor and not two — both presentations are in the DOM at every width, and
 * a link in each would double every `a[href*="/inventory/"]` the suite counts.
 *
 * ## No sortable columns
 *
 * `orderby` and `order` are accepted on `/inventory` and **nothing measured says
 * either does anything** — `scripts/mock-api.mjs:4056-4058` names them among the
 * five parameters this route takes and ignores, on purpose, so a sort cannot be
 * "verified" against the harness and shipped broken. No column carries a
 * `sortKey` and the list passes no `onSortChange`, which is also what keeps
 * `aria-sort` off the headers: the primitive gates the attribute on a handler
 * existing, precisely so a table cannot announce itself sortable by columns
 * nothing on screen can sort.
 *
 * ## No row-actions `Menu`
 *
 * It would hold one item. The only write on a stock row is the adjustment, which
 * needs the current quantity, the three modes and the projection line to be
 * usable at all — that is a screen, not a menu item — and `POST /inventory/bulk`
 * is deliberately unreachable (`lib/api/allowlist.ts:75-77`). A trailing 40px
 * column would exist to repeat what clicking the row already does.
 */

export type InventoryColumnContext = {
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  tStock: (key: string) => string;
  /**
   * The API's own word — `simple`, `variable`, `variation` — localised, falling
   * back to the stored value for a type this panel has no word for. Resolved by
   * the caller rather than here because `t.has()` is on next-intl's translator
   * and `t` arrives narrowed to a call signature; a missing key resolved by
   * calling `t` would log a console error, which the capture harness fails on.
   */
  typeLabel: (type: string) => string;
};

/**
 * The quantity, in whichever of its three states this row is in.
 *
 * Shared by the table cell and the record's meta line so a phone and a monitor
 * cannot disagree about whether a shelf is empty or uncounted.
 */
function quantityValue(item: InventoryItem, ctx: InventoryColumnContext): ReactNode {
  const quantity = displayQuantity(item);

  if (!quantity.tracked) {
    return (
      <span className="min-w-0 truncate text-ui-subtle">
        {isDelegated(item) ? ctx.t("delegatedShort") : ctx.t("untracked")}
      </span>
    );
  }

  return (
    <>
      {/* The word beside the colour, never the colour alone — §1.2. It leads in
          an end-aligned cell so the figures still line up on the column's edge. */}
      {quantity.low ? <Badge tone="danger">{ctx.t("low")}</Badge> : null}
      <Ltr className={quantity.low ? "text-ui-danger-fg" : "text-ui-fg"}>
        {quantity.value}
      </Ltr>
    </>
  );
}

/** The stock state: a dot and the word it stands for, never the dot alone. */
function statusValue(item: InventoryItem, ctx: InventoryColumnContext): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Dot tone={STOCK_TONE[item.stock_status as StockStatus] ?? "neutral"} />
      <span className="truncate">{ctx.tStock(item.stock_status)}</span>
    </span>
  );
}

/** A SKU, or the fact that this row has none. Two variations carry `""`. */
function skuValue(item: InventoryItem, ctx: InventoryColumnContext): ReactNode {
  return item.sku === "" ? (
    <span className="text-ui-subtle">{ctx.t("noSku")}</span>
  ) : (
    /* An identifier: `Ltr`, or the bidi algorithm reorders it inside Arabic text
       and the person reads back a code that does not exist. */
    <Ltr numeric={false} className="block max-w-48 truncate">
      {item.sku}
    </Ltr>
  );
}

export function buildColumns(ctx: InventoryColumnContext): Column<InventoryItem>[] {
  const { locale, t } = ctx;

  return [
    {
      key: "name",
      header: t("columns.name"),
      required: true,
      cell: (item) => {
        const { product, variant } = itemLabel(item);
        return (
          <span className="flex min-w-0 items-center gap-2">
            <Link
              href={`/${locale}/inventory/${item.id}`}
              /* The row navigates too. Without this the anchor's click bubbles
                 and the same push happens twice. */
              onClick={(event) => event.stopPropagation()}
              className="ui-ring min-w-0 rounded-ui-md hover:underline"
            >
              {/*
                `dir="auto"` so the ellipsis lands at the *name's* own end.
                Measured in Arabic: "Plateau en bois d'olivier, 40 cm" is an LTR
                run inside an RTL paragraph, so `text-overflow` clips at the
                paragraph's end — the left — and the row read
                "…eau en bois d'olivier, 40 cm". A catalogue is scanned by the
                beginnings of its names.

                Capped for the reason the customers list measured: `.ui-td` is
                `white-space: nowrap` and an auto-layout table sizes a column to
                its widest cell, so an uncapped name sets the table's width.
              */}
              <span dir="auto" className="block max-w-64 truncate">
                {product}
              </span>
            </Link>
            {/* `itemLabel()` has already undone the API's doubled
                "Burnous en laine - L — L"; showing the value as its own token is
                what stops it reading as a stutter in the first place. */}
            {variant ? (
              <Badge tone="neutral" className="max-w-24 truncate">
                {variant}
              </Badge>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "sku",
      header: t("columns.sku"),
      cell: (item) => skuValue(item, ctx),
    },
    {
      key: "status",
      header: t("columns.status"),
      cell: (item) => statusValue(item, ctx),
    },
    {
      key: "quantity",
      header: t("columns.quantity"),
      align: "end",
      cell: (item) => quantityValue(item, ctx),
    },
    {
      key: "threshold",
      header: t("columns.threshold"),
      align: "end",
      /* Rendered only for a row the threshold actually judges. On an untracked
         row the API still reports a number — it is the effective store-wide
         default — and printing it beside "Non suivi" would state a rule that
         nothing on that row can break. */
      cell: (item) =>
        displayQuantity(item).tracked ? (
          <Ltr className="text-ui-muted">{item.low_stock_amount}</Ltr>
        ) : null,
    },
    {
      key: "type",
      header: t("columns.type"),
      optional: true,
      /* `simple`, `variable`, `variation` is a developer's vocabulary and it
         rendered raw on the screen this replaces. Localised, and falling back to
         the stored value for a type the panel has no word for. */
      cell: (item) => (
        <span className="min-w-0 truncate">{ctx.typeLabel(item.type)}</span>
      ),
    },
    {
      key: "backorders",
      header: t("columns.backorders"),
      optional: true,
      /*
       * On every row and absent from ADMIN_PANEL.md's description of one. It
       * decides whether an adjustment may drive stock negative, which is the
       * difference between a 200 and a 409 on the screen this list opens — so it
       * is offered, and off by default because it is the same value on nearly
       * every row.
       */
      cell: (item) => (
        <span className="min-w-0 truncate">{t(`backorders.${item.backorders}`)}</span>
      ),
    },
    {
      key: "id",
      header: t("columns.id"),
      align: "end",
      optional: true,
      /*
       * Off by default, unlike the customers list. A SKU is the handle on this
       * screen — it is what the lookup field takes, what is printed on the shelf
       * label, and what `e2e/inventory.spec.ts` resolves every product by,
       * because the backend's own suites delete and recreate ids. The id is still
       * offered: the ledger names a `product_id` and nothing else, so
       * cross-referencing a movement against this list needs it.
       */
      cell: (item) => <Ltr className="text-ui-subtle">{item.id}</Ltr>,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * Which three is an editorial choice rather than "the first three columns". On a
 * phone in a stockroom a person is identifying the thing in their hand (the name
 * and its variation), confirming it against the label (the SKU) and reading the
 * one number they crossed the room for (the quantity, with the threshold it is
 * judged against beside it).
 */
export function inventoryRecord(
  item: InventoryItem,
  ctx: InventoryColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { product, variant } = itemLabel(item);
  const quantity = displayQuantity(item);

  return {
    primary: (
      <>
        <span
          dir="auto"
          className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg"
        >
          {product}
        </span>
        {variant ? (
          <Badge tone="neutral" className="max-w-24 truncate">
            {variant}
          </Badge>
        ) : null}
      </>
    ),
    secondary: (
      <>
        {skuValue(item, ctx)}
        <span className="ms-auto shrink-0">{statusValue(item, ctx)}</span>
      </>
    ),
    meta: (
      <>
        {quantity.tracked ? (
          /* `Isolate`, not `Ltr`: "Seuil 5" is a translated sentence with a
             number in it — neither an identifier nor a formatted value — and
             forcing LTR lays the Arabic out from the left. See
             primitives/Ltr.tsx, which records that rule burning sixteen call
             sites. */
          <Isolate className="min-w-0 truncate">
            {ctx.t("threshold", { threshold: item.low_stock_amount })}
          </Isolate>
        ) : null}
        {/* `--text-compact` on the trailing figure, and it is a measurement
            rather than emphasis: `RecordListSkeleton` draws its third line at
            1.25rem because the migrated screens put a compact-sized value there,
            and the taller child wins the line box. */}
        <span className="ms-auto flex shrink-0 items-center gap-1.5 text-ui-compact">
          {quantityValue(item, ctx)}
        </span>
      </>
    ),
  };
}
