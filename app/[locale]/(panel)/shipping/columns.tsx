"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { SafeShipment } from "@/lib/shipping";
import { shipmentCodAmount, shipmentWilayaId } from "@/lib/shipping";
import { SHIPMENT_STATUS_TONE, type ShipmentStatus } from "@/lib/shipment-status";
import type { ShippingProvider } from "@/lib/api/schemas/shipping";
import { formatWhen } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Badge } from "@/components/ui/Badge";
import { rowOpenerId, type Column } from "@/components/ui/DataTable";

/**
 * The parcels column definition — one source, two presentations.
 *
 * `DataTable` renders these as a real table at `md`+ and `RecordList` renders the
 * three-line form below it, so a phone and a monitor cannot drift apart about
 * which fields identify a parcel. It replaces `ShipmentRow.tsx`, which drew one
 * iOS inset row at every width.
 *
 * ## No `sortKey` on any column, and that is the finding rather than an omission
 *
 * Nine `orderby` values × two directions returned an id sequence byte-identical
 * to `?bogus_param=1`, and **`?orderby=zzz` is a 200** — the parameter never
 * reaches a validator, so it cannot be reaching a sort. `query.ts` carries the
 * measurement and the tie-fixture exclusion. `DataTable` gates `aria-sort` on
 * `sortKey && onSortChange`, so with neither present every header honestly
 * announces nothing, which is DECISIONS.md §2's defect avoided rather than
 * repeated.
 *
 * ## The row opens a drawer; only the order cell is a link
 *
 * **A parcel has no detail route.** `GET /shipments/{id}` is key-identical to the
 * list row — measured, all ten keys — so the drawer costs no request and is the
 * record's only surface; there is nowhere else to send someone. The one thing on
 * the row worth leaving for is the **order**, which is a real anchor in its own
 * cell and stops propagation so a click does not also open the drawer.
 *
 * ## `is_live` is not rendered
 *
 * It equals `!isTerminalShipmentStatus(status)` on 129 of 129 rows, zero
 * disagreements — the status badge already carries it, and a second marker
 * beside it would be the same fact spelled twice. This is the §3.5 defect at the
 * old `ShipmentRow.tsx:83-85` (a status rendered as caption text beside a badge)
 * deleted rather than promoted to a badge of its own.
 */

export type ParcelColumnContext = {
  locale: string;
  currency: string;
  providers: ShippingProvider[];
  /**
   * The provider in the reader's language: message key → API `label` → raw slug.
   *
   * Built once by the screen rather than per cell, because `useTranslations` is a
   * hook and a column definition is a plain function. See `providerLabel`.
   */
  providerName: (name: string) => string;
  /** id → display name, resolved once for the page rather than per row. */
  wilayaName: (id: number | null) => string | null;
  t: (key: string, values?: Record<string, string | number>) => string;
  tStatus: (status: string) => string;
  tDelivery: (type: string) => string;
  hasDelivery: (type: string) => boolean;
};

/**
 * The DOM id of a row's opener, in one place because two files need it: the list
 * that hands it to `DataTable`, and the drawer that hands focus back to it on
 * close. The pattern itself lives in `DataTable`.
 */
export function parcelOpenerId(id: number): string {
  return rowOpenerId("parcel", id);
}

/** The badge, which every presentation of a parcel opens with. */
export function StatusBadge({
  status,
  tStatus,
}: {
  status: string;
  tStatus: (status: string) => string;
}) {
  return (
    <Badge tone={SHIPMENT_STATUS_TONE[status as ShipmentStatus] ?? "neutral"}>
      {tStatus(status)}
    </Badge>
  );
}

/** The destination in words, never an id — a wilaya key rendered at a person. */
function destination(parcel: SafeShipment, ctx: ParcelColumnContext): ReactNode {
  const place = ctx.wilayaName(shipmentWilayaId(parcel));
  return place === null ? (
    <span className="text-ui-subtle">{ctx.t("noDestination")}</span>
  ) : (
    <span dir="auto" className="block max-w-48 truncate">
      {place}
    </span>
  );
}

function deliveryText(parcel: SafeShipment, ctx: ParcelColumnContext): ReactNode {
  const raw = parcel.metadata.delivery_type;
  if (typeof raw !== "string" || raw === "") return null;
  return ctx.hasDelivery(raw) ? ctx.tDelivery(raw) : raw;
}

export function buildColumns(ctx: ParcelColumnContext): Column<SafeShipment>[] {
  const { locale, currency, providerName, t, tStatus } = ctx;

  return [
    {
      key: "tracking",
      header: t("columns.tracking"),
      required: true,
      /*
       * The row's identity, and the cell `DataTable` wraps in the drawer's
       * opener — the list passes `rowOpenerId`, so the `<button>`, its
       * `stopPropagation` and its stable DOM id are the primitive's now.
       * DECISIONS.md §10 carries the measurement that put it there.
       *
       * Capped because `.ui-td` is `white-space: nowrap` and an auto-layout table
       * sizes a column to its widest cell; the fixture carries a deliberately
       * long tracking number. The cap is on the truncating element rather than on
       * the button, because the button is no longer written here. `Ltr` because a
       * tracking number reordered by the bidi algorithm is a *different* tracking
       * number.
       */
      cell: (parcel) =>
        parcel.tracking_number === "" ? (
          <span className="text-ui-subtle">{t("noTracking")}</span>
        ) : (
          <Ltr numeric={false} className="block max-w-56 truncate">
            {parcel.tracking_number}
          </Ltr>
        ),
    },
    {
      key: "status",
      header: t("columns.status"),
      cell: (parcel) => <StatusBadge status={parcel.status} tStatus={tStatus} />,
    },
    {
      key: "order",
      header: t("columns.order"),
      /* The one link out of this screen. `Ltr` and not `Isolate`: an order number
         is an identifier, and `orderLink` supplies the word beside it so the cell
         is not a bare figure a person has to guess the meaning of. */
      cell: (parcel) => (
        <Link
          href={`/${locale}/orders/${parcel.order_id}`}
          onClick={(event) => event.stopPropagation()}
          className="ui-ring rounded-ui-md hover:underline"
        >
          <Ltr>{parcel.order_id}</Ltr>
        </Link>
      ),
    },
    {
      key: "destination",
      header: t("columns.destination"),
      /* Off `metadata`, never off the order's address — the parcel carries its
         own wilaya and that is where analytics gets its geography. */
      cell: (parcel) => destination(parcel, ctx),
    },
    {
      key: "provider",
      header: t("columns.provider"),
      /* A lookup with a fallback to the raw slug, never an index into the
         providers array: 42 of the 129 rows carry `acfake`, which
         `/shipping/providers` does not list — and which stays `acfake` rather
         than being given a translation nobody wrote for it. */
      cell: (parcel) => (
        <span dir="auto" className="block max-w-40 truncate">
          {providerName(parcel.provider)}
        </span>
      ),
    },
    {
      key: "delivery",
      header: t("columns.delivery"),
      optional: true,
      cell: (parcel) => deliveryText(parcel, ctx),
    },
    {
      key: "cod",
      header: t("columns.cod"),
      align: "end",
      optional: true,
      /* A decimal string, kept as one. `acfake` parcels carry no `cod_amount` at
         all, so an empty cell here is a real absence rather than a zero. */
      cell: (parcel) => {
        const cod = shipmentCodAmount(parcel);
        return cod === null ? null : <Ltr>{formatMoney(cod, currency, locale)}</Ltr>;
      },
    },
    {
      key: "created",
      header: t("columns.created"),
      /* `Isolate`, never `Ltr`: `Intl` puts U+200F marks inside an Arabic date on
         purpose and forcing a direction over them renders the parts out of
         order. */
      cell: (parcel) => <Isolate>{formatWhen(parcel.created_at, locale)}</Isolate>,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * Which three is editorial rather than "the first three columns": on a phone a
 * person is identifying the parcel (its status and its tracking number), working
 * out where it went (the destination, falling back to the courier when the
 * metadata carries no wilaya), and placing it in time against the order it
 * belongs to.
 */
export function parcelRecord(
  parcel: SafeShipment,
  ctx: ParcelColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { locale, providerName, t, tStatus } = ctx;
  const place = ctx.wilayaName(shipmentWilayaId(parcel));

  return {
    primary: (
      <>
        <StatusBadge status={parcel.status} tStatus={tStatus} />
        <Ltr
          numeric={false}
          className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg"
        >
          {parcel.tracking_number || t("noTracking")}
        </Ltr>
      </>
    ),
    secondary: (
      <span dir="auto" className="min-w-0 flex-1 truncate">
        {place ?? providerName(parcel.provider)}
      </span>
    ),
    meta: (
      <>
        {/* Not an anchor here. `RecordList` navigates through the stretched
            overlay button `DataTable` gives it, and a link inside that overlay
            is unreachable — both presentations are in the DOM at every width, so
            the order is a link in the table and a plain figure on the card. */}
        <span className="min-w-0 truncate">
          <Isolate>{t("orderLink", { number: parcel.order_id })}</Isolate>
        </span>
        <span className="ms-auto shrink-0 text-ui-compact text-ui-fg">
          <Isolate>{formatWhen(parcel.created_at, locale)}</Isolate>
        </span>
      </>
    ),
  };
}
