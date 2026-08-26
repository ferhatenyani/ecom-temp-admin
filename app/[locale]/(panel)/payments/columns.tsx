"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Payment } from "@/lib/api/schemas/payment";
import { PAYMENT_STATUS_TONE, type PaymentStatus } from "@/lib/payment-status";
import { formatWhen } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Badge } from "@/components/ui/Badge";
import type { Column } from "@/components/ui/DataTable";

/**
 * The ledger's column definition — one source, two presentations.
 *
 * `DataTable` renders these as a real table at `md`+ and `RecordList` renders the
 * three-line form below it, so a phone and a monitor cannot drift apart about
 * which fields identify a transaction. It replaces the single `ListGroup` of iOS
 * inset rows the old screen drew at every width.
 *
 * ## No `sortKey` on any column, and that is the finding rather than an omission
 *
 * Eleven `orderby` values × two directions returned an id sequence byte-identical
 * to the bare listing and to `?bogus_param=1`, and **`?orderby=zzz` is a 200** —
 * the parameter never reaches a validator, so it cannot be reaching a sort.
 * `query.ts` carries the measurement and the tie-fixture exclusion (45 rows, 45
 * distinct ids, 45 distinct stamps). `DataTable` gates `aria-sort` on
 * `sortKey && onSortChange`, so with neither present every header honestly
 * announces nothing.
 *
 * ## The id cell opens the drawer; only the order cell is a link
 *
 * **A payment has no detail route.** `GET /payments/{id}` is value-identical to
 * the list row — measured 2026-08-26, all eleven keys — so the drawer costs no
 * request and is the record's only surface; there is nowhere else to send
 * someone. The one thing on the row worth leaving for is the **order**, which is
 * a real anchor in its own cell and stops propagation so a click does not also
 * open the drawer.
 *
 * The opener is a real `<button>` rather than `onRowClick` alone, because
 * `DataTable` hangs `onRowClick` off the `<tr>` and a `<tr>` is not focusable —
 * which shipped a mouse-only screen at `md`+ for four branches. It sits on the
 * identifying cell rather than being stretched over the row, because the row
 * already contains the order anchor and two interactive elements must not nest.
 *
 * ## The amount is formatted with the payment's own `currency`
 *
 * Never with `SHOP_CURRENCY`. A transaction carries one, like an order and unlike
 * a product, and an install holding pre-`DZD` orders would have every row
 * re-denominated into dinars — silently wrong arithmetic on a screen about money.
 */

export type PaymentColumnContext = {
  locale: string;
  /**
   * The method in the reader's language: message key → API `label` → raw name.
   *
   * Built once by the screen rather than per cell, because `useTranslations` is a
   * hook and a column definition is a plain function. See `lib/payments.ts`.
   */
  providerName: (name: string) => string;
  /** Opens the drawer. See the `id` column. */
  onOpen: (payment: Payment) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  tStatus: (status: string) => string;
};

/**
 * The DOM id of a row's opener, in one place because two files need it: the cell
 * that renders the button and the drawer that hands focus back to it on close.
 */
export function paymentOpenerId(id: number): string {
  return `payment-opener-${id}`;
}

/** The badge, which every presentation of a payment opens with. */
export function PaymentStatusBadge({
  status,
  tStatus,
}: {
  status: string;
  tStatus: (status: string) => string;
}) {
  return (
    <Badge tone={PAYMENT_STATUS_TONE[status as PaymentStatus] ?? "neutral"}>
      {tStatus(status)}
    </Badge>
  );
}

export function buildColumns(ctx: PaymentColumnContext): Column<Payment>[] {
  const { locale, providerName, t, tStatus } = ctx;

  return [
    {
      key: "id",
      header: t("columns.id"),
      required: true,
      /*
       * The row's identity, and **a real `<button>` — which is the keyboard path
       * to the drawer.**
       *
       * `DataTable`'s `onRowClick` hangs off the `<tr>`, and a `<tr>` is not
       * focusable. Below `md` that is invisible because `RecordList` draws a
       * stretched overlay button carrying `rowLabel`; at `md`+ there would be no
       * opener at all, and the only focusable in the row is the anchor to
       * `/orders/{order_id}` — which goes somewhere else entirely. DECISIONS.md
       * carries the measurement from the shipping branch.
       *
       * It stops propagation so one click does not open the drawer twice, and it
       * carries a stable `id` so the drawer can hand focus back to it — Radix
       * restores to whatever had focus when the overlay opened, which for a click
       * on the `<tr>`'s background is `<body>`.
       *
       * `Ltr` because a transaction number is an identifier the shop assigned and
       * a bidi reordering of it is a *different* number.
       */
      cell: (payment) => (
        <button
          type="button"
          id={paymentOpenerId(payment.id)}
          onClick={(event) => {
            event.stopPropagation();
            ctx.onOpen(payment);
          }}
          className="ui-ring block cursor-pointer rounded-ui-md text-start"
        >
          <Ltr>{`#${payment.id}`}</Ltr>
        </button>
      ),
    },
    {
      key: "order",
      header: t("columns.order"),
      /* The one link out of this screen. `Ltr` and not `Isolate`: an order number
         is an identifier, not a formatted string. */
      cell: (payment) => (
        <Link
          href={`/${locale}/orders/${payment.order_id}`}
          onClick={(event) => event.stopPropagation()}
          className="ui-ring rounded-ui-md hover:underline"
        >
          <Ltr>{`#${payment.order_id}`}</Ltr>
        </Link>
      ),
    },
    {
      key: "provider",
      header: t("columns.provider"),
      /* A lookup with a fallback to the raw name, never an index into the methods
         array: a provider the shop configures later, or one a webhook registered,
         renders as itself rather than blanking the column on exactly the rows
         worth looking at. */
      cell: (payment) => (
        <span dir="auto" className="block max-w-48 truncate">
          {providerName(payment.provider)}
        </span>
      ),
    },
    {
      key: "amount",
      header: t("columns.amount"),
      align: "end",
      /* The payment's own currency. See the file docblock. */
      cell: (payment) => (
        <Ltr>{formatMoney(payment.amount, payment.currency, locale)}</Ltr>
      ),
    },
    {
      key: "status",
      header: t("columns.status"),
      cell: (payment) => <PaymentStatusBadge status={payment.status} tStatus={tStatus} />,
    },
    {
      key: "created",
      header: t("columns.created"),
      /* `Isolate`, never `Ltr`: `Intl` puts U+200F marks inside an Arabic date on
         purpose and forcing a direction over them renders the parts out of
         order. */
      cell: (payment) => <Isolate>{formatWhen(payment.created_at, locale)}</Isolate>,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * Which three is editorial rather than "the first three columns": on a phone a
 * person is identifying the transaction (its number and its status), reading what
 * it is worth and how it was taken (the amount and the method), and placing it
 * against the order it belongs to in time.
 */
export function paymentRecord(
  payment: Payment,
  ctx: PaymentColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { locale, providerName, t, tStatus } = ctx;

  return {
    primary: (
      <>
        <PaymentStatusBadge status={payment.status} tStatus={tStatus} />
        <Ltr className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg">
          {`#${payment.id}`}
        </Ltr>
      </>
    ),
    secondary: (
      <>
        <Ltr className="shrink-0 text-ui-compact text-ui-fg">
          {formatMoney(payment.amount, payment.currency, locale)}
        </Ltr>
        <span dir="auto" className="ms-auto min-w-0 truncate text-end">
          {providerName(payment.provider)}
        </span>
      </>
    ),
    meta: (
      <>
        {/* Not an anchor here. `RecordList` navigates through the stretched
            overlay button `DataTable` gives it, and a link inside that overlay is
            unreachable — both presentations are in the DOM at every width, so the
            order is a link in the table and a plain figure on the card. */}
        <span className="min-w-0 truncate">
          <Isolate>{t("orderLink", { number: payment.order_id })}</Isolate>
        </span>
        <span className="ms-auto shrink-0 text-ui-compact text-ui-fg">
          <Isolate>{formatWhen(payment.created_at, locale)}</Isolate>
        </span>
      </>
    ),
  };
}
