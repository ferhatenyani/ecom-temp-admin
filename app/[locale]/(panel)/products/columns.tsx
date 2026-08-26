import type { ReactNode } from "react";
import type { Product } from "@/lib/api/schemas/product";
import {
  PRODUCT_STATUS_TONE,
  STOCK_TONE,
  type ReadableStatus,
  type StockStatus,
} from "@/lib/product-status";
import { effectivePrice, isDiscounted, stockQuantity } from "@/lib/products";
import { formatMoney } from "@/lib/format/money";
import { formatWhen } from "@/lib/format/date";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Badge, Dot } from "@/components/ui/Badge";
import { rowOpenerId, type Column } from "@/components/ui/DataTable";

/**
 * The Products column definition — one source, two presentations.
 *
 * `DataTable` renders these as a real table at `md` and up and `RecordList`
 * renders the three-line form below it, so the fields a person sees on a phone
 * and the fields they see on a monitor cannot drift apart.
 *
 * ## What is *not* a column, and why
 *
 * **No thumbnail.** All 28 products carry `image_id: 0`, `image: null` and an
 * empty gallery — the media library holds 30 fixtures and not one is attached to
 * a product. A thumbnail column would be 28 placeholder squares down the panel's
 * second-most-used screen, and a column of placeholders is worse than no column:
 * it reads as a catalogue whose photography failed to load rather than as one
 * that has none. When products start carrying images this file gains a leading
 * image column; until then the space belongs to the name.
 *
 * ## Why `created` is on by default, when the brief put it behind the picker
 *
 * Because the list is **already sorted by it**. `date desc` is the resting order
 * — `SORTS[0]`, what `toApiParams` sends when nothing else is asked for — and
 * with the column hidden that order had nothing on screen to explain it: rows in
 * a sequence with no visible key, on the one screen in the run where sorting is
 * real.
 *
 * The deciding half is not aesthetic, though. `aria-sort` lives on the header,
 * so a hidden column means no header carries it, and a screen-reader user
 * arrowing the header row at first paint hears **"none" on every column** while
 * the panel has explicitly asked the API for `orderby=date&order=desc`. That is
 * not a missing affordance, it is the table stating something untrue about its
 * own state, and DESIGN.md §5 requires the opposite. Showing the column makes the
 * claim both true and visible, and puts the default at six columns — the same
 * number the orders list carries at the same widths.
 *
 * A stored column preference from before this change is left alone rather than
 * migrated: `useTablePreferences` unions only the *required* columns into a saved
 * set, so someone who has chosen their own columns keeps them, which is the
 * right way round.
 *
 * ## The sort keys, which are the measured half of this file
 *
 * `sortKey` is the API's `orderby`, and `sortDirections` is how far the evidence
 * goes. `lib/product-status.ts` records the measurement, re-taken 2026-08-25:
 * **six values sort, both directions.** Five of them have a column here:
 *
 *   name       both  — `sortDirections: ["asc"]` was here for two branches,
 *                      because `title desc` was recorded as never measured. It
 *                      sorts, and had been sorting the whole time. The cycle is
 *                      the full `none → asc → desc → none` again.
 *   created    both  — `date desc` is the resting order, so `["desc", "asc"]`
 *                      keeps the first click the one that changes something.
 *   price      both
 *   sku        both  — was recorded as silently not sorting. It sorts.
 *   id         both  — same. The column is `optional`, so the control arrives
 *                      with it.
 *
 * ## `popularity` sorts and still gets no header, which is not a taste call
 *
 * The API orders by `total_sales` and **does not emit it** — it is on no product
 * response, measured. So there is nothing to put in a cell, and a sortable header
 * over an empty column is not a design choice, it is impossible. It stays in
 * `SORTS`, so a URL carrying `?sort=popularity-desc` is honoured rather than
 * rewritten — the arrangement `customers/query.ts` already uses for the two
 * `orderby` values the API accepts and that screen does not offer.
 *
 * `menu_order` and `rating` are absent for a different reason again: every
 * product in this shop carries 0 for both, so those sorts return the catalogue
 * untouched and the control could not act. See `SORTS` for why those two are not
 * the same case as each other either.
 */

export type ProductColumnContext = {
  locale: string;
  /**
   * The shop's currency, from `meta.facets.price.currency`. A product carries no
   * currency of its own — unlike an order, which does — so it is threaded down
   * from the one place the API states it rather than guessed at each call site.
   */
  currency: string;
  /** Term id → name, for the category column. Ids are what `?category=` takes. */
  categoryName: Map<string, string>;
  t: (key: string) => string;
  tStatus: (key: string) => string;
  tStock: (key: string) => string;
  /**
   * `t("inStock", { count })` and `t("type.…")`, pre-bound by the caller.
   *
   * The context stays a map of plain string lookups the way the orders one does;
   * a pluralised message and a lookup that has to fall back for an unknown value
   * are the two that cannot be, so they arrive already applied.
   */
  inStock: (count: number) => string;
  typeLabel: (type: string) => string;
};

/** The stock cell and the record's meta line, which say the same thing. */
function stockLine(product: Product, ctx: ProductColumnContext): ReactNode {
  const quantity = stockQuantity(product);
  const stock = product.stock_status as StockStatus;

  return (
    <>
      {/* The dot repeats what the word beside it already says. It is never the
          only signal — DESIGN.md §1.2, and a warehouse phone in daylight
          flattens red and green anyway. */}
      <Dot tone={STOCK_TONE[stock] ?? "warning"} />
      {quantity !== null ? (
        /* The quantity when the product manages stock, the status word when it
           does not — 8 of 28 do not, and "—" on a third of the list says
           nothing. `Isolate` rather than `Ltr`: "12 en stock" is a translated
           sentence, not an identifier, so forcing it LTR would lay the Arabic
           form out from the wrong end. */
        <Isolate className="min-w-0 truncate">{ctx.inStock(quantity)}</Isolate>
      ) : (
        <span className="min-w-0 truncate">{ctx.tStock(stock)}</span>
      )}
    </>
  );
}

/** The price, struck-through regular included. `null` is named, never zero. */
function priceLine(product: Product, ctx: ProductColumnContext): ReactNode {
  const price = effectivePrice(product);

  if (price === null) {
    /* A published product with no price at all — measured on AC-SEO-NOPRICE.
       Named, never rendered as 0,00 DA: a price of nothing and no price are
       different problems and only one of them is free. */
    return <span className="text-ui-subtle">{ctx.t("noPrice")}</span>;
  }

  return (
    <span className="inline-flex items-baseline gap-1.5">
      {isDiscounted(product) ? (
        <Ltr className="text-ui-caption text-ui-subtle line-through">
          {formatMoney(product.regular_price, ctx.currency, ctx.locale)}
        </Ltr>
      ) : null}
      <Ltr className="font-medium text-ui-fg">
        {formatMoney(price, ctx.currency, ctx.locale)}
      </Ltr>
    </span>
  );
}

/**
 * The DOM id of a row's peek opener, in one place because two files need it: the
 * list that hands it to `DataTable`, and `ProductPeek`, which hands focus back to
 * it on close. The pattern itself lives in `DataTable`.
 */
export function productOpenerId(id: number): string {
  return rowOpenerId("product", id);
}

export function buildColumns(ctx: ProductColumnContext): Column<Product>[] {
  const { locale, categoryName, t, tStatus, typeLabel } = ctx;

  return [
    {
      key: "name",
      header: t("columns.name"),
      required: true,
      sortKey: "title",
      cell: (product) => (
        /* `dir="auto"` so a French product name in the Arabic list is clipped at
           its own end rather than the paragraph's. This is the exact string the
           inventory branch measured reading "…eau en bois d'olivier, 40 cm" —
           eaten from the front, which is unscannable, because a catalogue is
           scanned by the beginnings of its names. */
        <span dir="auto" className="block max-w-64 truncate">
          {product.name}
        </span>
      ),
    },
    {
      key: "sku",
      header: t("columns.sku"),
      sortKey: "sku",
      cell: (product) =>
        product.sku ? (
          /* `Ltr`, because a SKU is exactly the identifier the bidi algorithm
             reorders inside Arabic text — `AC-BIJ-002` is a different SKU once
             its segments move, and nothing errors. Capped and truncated: there
             is a 60-character SKU on page one, and the full value is one click
             away in the preview. */
          <Ltr className="block max-w-40 truncate">{product.sku}</Ltr>
        ) : (
          /* Prose, so *not* `Ltr` — forcing "Sans SKU" left-to-right inside the
             Arabic list would lay the phrase out from the wrong end. */
          <span className="text-ui-subtle">{t("noSku")}</span>
        ),
    },
    {
      key: "category",
      header: t("columns.category"),
      optional: true,
      cell: (product) => {
        const names = product.category_ids.map(
          (id) => categoryName.get(String(id)) ?? String(id),
        );
        if (names.length === 0) return null;
        return (
          <span dir="auto" className="block max-w-40 truncate">
            {names.join(", ")}
          </span>
        );
      },
    },
    {
      key: "type",
      header: t("columns.type"),
      optional: true,
      cell: (product) => typeLabel(product.type),
    },
    {
      key: "created",
      header: t("columns.created"),
      sortKey: "date",
      sortDirections: ["desc", "asc"],
      cell: (product) => (
        /* `Isolate`, not `Ltr`: a formatted date is not an identifier. ICU puts
           RTL marks inside the Arabic form on purpose, and forcing dir="ltr"
           over them renders the date wrong. */
        <Isolate>{formatWhen(product.date_created, locale)}</Isolate>
      ),
    },
    {
      key: "modified",
      header: t("columns.modified"),
      optional: true,
      cell: (product) => <Isolate>{formatWhen(product.date_modified, locale)}</Isolate>,
    },
    {
      key: "stock",
      header: t("columns.stock"),
      align: "end",
      cell: (product) => (
        <span className="inline-flex min-w-0 items-center justify-end gap-1.5">
          {stockLine(product, ctx)}
        </span>
      ),
    },
    {
      key: "price",
      header: t("columns.price"),
      align: "end",
      sortKey: "price",
      cell: (product) => priceLine(product, ctx),
    },
    {
      key: "status",
      header: t("columns.status"),
      align: "end",
      cell: (product) => (
        /* Every row carries a badge here, including `publish` — unlike the old
           row, which hid it because 27 of 28 are published and a badge on every
           row marks nothing. Under a column headed "Statut" the reverse is true:
           an empty cell reads as missing data rather than as the common case.
           `publish` is toned neutral precisely so a column of them is quiet. */
        <Badge tone={PRODUCT_STATUS_TONE[product.status as ReadableStatus]}>
          {tStatus(product.status)}
        </Badge>
      ),
    },
    {
      key: "featured",
      header: t("columns.featured"),
      optional: true,
      align: "end",
      /* A word, not a tick: a check glyph alone would be an icon carrying the
         only meaning in the cell, and its absence would be indistinguishable
         from a cell that failed to render. */
      cell: (product) => (product.featured ? t("featuredYes") : null),
    },
    {
      key: "id",
      header: t("columns.id"),
      align: "end",
      optional: true,
      sortKey: "id",
      cell: (product) => <Ltr className="text-ui-subtle">{product.id}</Ltr>,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * Which three is an explicit editorial choice, not "the first three columns": a
 * person on a phone is deciding whether this is the product they meant (name),
 * confirming it against the label in their hand (SKU), and checking the two
 * numbers a shop floor actually acts on (stock · price). Category, type, dates
 * and the internal id are detail-screen concerns.
 */
export function productRecord(
  product: Product,
  ctx: ProductColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { t, tStatus } = ctx;

  return {
    primary: (
      <>
        <span
          dir="auto"
          className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg"
        >
          {product.name}
        </span>
        <Badge tone={PRODUCT_STATUS_TONE[product.status as ReadableStatus]}>
          {tStatus(product.status)}
        </Badge>
      </>
    ),
    secondary: product.sku ? (
      <Ltr className="min-w-0 flex-1 truncate">{product.sku}</Ltr>
    ) : (
      <span className="min-w-0 flex-1 truncate text-ui-subtle">{t("noSku")}</span>
    ),
    meta: (
      <>
        {stockLine(product, ctx)}
        <span className="ms-auto shrink-0 text-ui-compact text-ui-fg">
          {priceLine(product, ctx)}
        </span>
      </>
    ),
  };
}
