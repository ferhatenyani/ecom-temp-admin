"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Customer } from "@/lib/api/schemas/customer";
import { consentRecord, customerName } from "@/lib/customers";
import { formatDate } from "@/lib/format/date";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Badge } from "@/components/ui/Badge";
import type { Column } from "@/components/ui/DataTable";

/**
 * The Customers column definition — one source, two presentations.
 *
 * `DataTable` renders these as a real table at `md` and up and `RecordList`
 * renders the three-line form below it, so a phone and a monitor cannot drift
 * apart about which fields identify a customer.
 *
 * ## The identifying cell is a real `<a href>`, and that is the whole navigation
 *
 * **There is no peek drawer on this screen**, which is the first departure from
 * the two lists before it. Orders and products preview for free —
 * `GET /{id}` returns the same object as the list row, so a drawer costs no
 * request. `lib/api/schemas/customer.ts:7-13` measures that customers is the
 * first collection where that is false: the detail is the row **plus
 * `statistics`**, and that report is precisely what a person opens a preview
 * *for*. A free peek would show nothing the row does not already carry, and a
 * useful one would spend a request per open against a 600/min budget shared
 * across every tab the person has open.
 *
 * So the row navigates — and because it navigates, the name is an anchor rather
 * than a span inside a clickable row. That is the keyboard path (Tab, Enter) and
 * middle-click and "open in new tab", none of which a `<div onClick>` has, and
 * it is what `e2e/customers.spec.ts` resolves a customer's detail URL through.
 * It stops propagation so a click on the link does not *also* fire the row's own
 * navigation to the same place.
 *
 * The anchor is deliberately only in the **table**. `RecordList` navigates
 * through the stretched overlay button `DataTable` already gives it, so a row is
 * one anchor and not two — both presentations are in the DOM at every width, and
 * a link in each would double every `a[href*="/customers/"]` the suite counts.
 *
 * ## No row-actions `Menu`
 *
 * It would hold one item. No write ships on this screen — `PATCH /customers/{id}`
 * is allowlisted and specified and has never been built — and there is no delete
 * route at all, so the trailing 40px column would exist to repeat what clicking
 * the row already does.
 *
 * ## `is_paying_customer` is a badge on the name, not a column of its own
 *
 * 4 of the 16 rows carry it and **there is no way to ask the API for them** —
 * `/customers` takes `search`, `orderby` and `order`, and an unknown parameter
 * answers 200 with the full set, so a filter would be indistinguishable from one
 * that works. A column would then be a sparse one nobody can sort or filter by,
 * and under a header an empty cell reads as missing data rather than as the
 * common case. Beside the name it reads as what it is: something known about
 * this person.
 *
 * ## No sortable columns, and this screen is Orders' situation rather than
 * Products'
 *
 * `DataTable` supports sorting and `/customers` accepts `orderby` and `order` —
 * a bad *value* is even refused properly (`?orderby=zzz` and `?order=sideways`
 * are both 400). None of that is evidence that either one reorders anything.
 * **Nothing anywhere records a positive control on this collection**: no
 * measurement showing that `orderby=user_email` or `orderby=registered` returns
 * a different id sequence from the unparameterised request.
 *
 * `query.ts` reads as though it does, and it does not. What it records is that
 * `display_name` and `user_email` returned *byte-identical sequences to each
 * other*, with a genuine data explanation — every `display_name` here is the
 * username and every username is the local part of the e-mail. Two values
 * agreeing with each other says nothing about whether either agrees with the
 * default order.
 *
 * Products ships sortable headers because `lib/product-status.ts` records five
 * combinations re-measured against the live router after a backend repair.
 * Orders declares `sortKey` on three columns and deliberately passes no
 * `onSortChange`, because this API has a measured history of accepting `orderby`
 * and silently ignoring it. Customers has the same evidence Orders has — none —
 * and `scripts/mock-api.mjs:3512-3534` reproduces exactly that, validating
 * `orderby` and then ignoring it so a sort cannot be "verified" against the
 * harness and shipped broken.
 *
 * So no column carries a `sortKey` and the list passes no `onSortChange`. A
 * control that quietly does nothing is worse than no control, and the primitive
 * is ready the moment somebody measures one.
 *
 * `registered` stays in the default set on its own merits — a registration date
 * is worth seeing, and the list is already in that order — not as a sort
 * affordance.
 */

export type CustomerColumnContext = {
  locale: string;
  t: (key: string) => string;
};

/**
 * What a customer is called, styled by *which* fallback it is.
 *
 * **12 of the 16 customers in this shop have neither a first nor a last name**,
 * so `customerName()` falls back to the username and then to the email — and the
 * cell styles the fallback differently, because a login rendered at the same
 * weight as a person's name reads as somebody called ac_cus_shopper.
 *
 * A real name is `dir="auto"`: a French name in the Arabic list is an LTR run
 * inside an RTL paragraph, and `text-overflow` clips at the *paragraph's* end —
 * the left — which ate the front of product names on the inventory branch. A
 * list of people is scanned by the beginnings of their names.
 *
 * A username or an email is `Ltr`, because that is what it is: an identifier the
 * bidi algorithm reorders inside Arabic text. `numeric={false}` — it is not a
 * figure.
 */
function nameText(customer: Customer, className: string, muted: string): ReactNode {
  const name = customerName(customer);

  return name.kind === "name" ? (
    <span dir="auto" className={className}>
      {name.text}
    </span>
  ) : (
    <Ltr numeric={false} className={`${className} ${muted}`}>
      {name.text}
    </Ltr>
  );
}

export function buildColumns(ctx: CustomerColumnContext): Column<Customer>[] {
  const { locale, t } = ctx;

  return [
    {
      key: "name",
      header: t("columns.name"),
      required: true,
      cell: (customer) => (
        <span className="flex min-w-0 items-center gap-2">
          <Link
            href={`/${locale}/customers/${customer.id}`}
            /* The row navigates too. Without this the anchor's click bubbles and
               the same push happens twice. */
            onClick={(event) => event.stopPropagation()}
            className="ui-ring min-w-0 rounded-ui-md hover:underline"
          >
            {/*
              Capped, and the cap is measured rather than chosen. `.ui-td` is
              `white-space: nowrap` and an auto-layout table sizes a column to
              its widest cell, so a name with no cap sets the column's width:
              "Abdelkrim-Mohammed-El-Hadj Benyoucef-Bouchentouf-Belkacemi" is on
              page one here and took the table 425px past its own container at
              768 and 9px past it at 1440 — an inline scrollbar under a table
              that has room for its columns. The full name is one click away on
              the detail this cell links to.
            */}
            {nameText(customer, "block max-w-64 truncate", "text-ui-muted")}
          </Link>
          {customer.is_paying_customer ? (
            <Badge tone="success">{t("paying")}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "email",
      header: t("columns.email"),
      cell: (customer) => (
        <Ltr numeric={false} className="block max-w-64 truncate">
          {customer.email}
        </Ltr>
      ),
    },
    {
      key: "phone",
      header: t("columns.phone"),
      cell: (customer) =>
        /* `billing.phone`, the only phone a customer record carries — the
           shipping address holds one too and it is the same string. `Ltr`,
           because a phone number read back reordered is a call to a stranger.
           No cap and no truncation: a phone number is bounded, and half of one
           is not a number anybody can act on. */
        customer.billing.phone !== "" ? (
          <Ltr>{customer.billing.phone}</Ltr>
        ) : null,
    },
    {
      key: "city",
      header: t("columns.city"),
      optional: true,
      cell: (customer) =>
        customer.billing.city !== "" ? (
          /* A wilaya name, in whichever script it was stored. */
          <span dir="auto" className="block max-w-40 truncate">
            {customer.billing.city}
          </span>
        ) : null,
    },
    {
      key: "consent",
      header: t("columns.consent"),
      optional: true,
      /* The word only, with no tone. The three states are not a severity scale —
         "never asked" is not worse than "withdrawn", it is a different fact —
         and a coloured badge here would invite a reader to rank them. The
         detail's consent card is where the date, the source and the reason live. */
      cell: (customer) => t(`consent.${consentRecord(customer).state}`),
    },
    {
      key: "registered",
      header: t("columns.registered"),
      /* No `sortKey`: see the header of this file. It is the order the panel
         asks for at rest, and it is on by default so a reader can see that
         order — but nothing has measured that asking changes anything, so the
         header is not a control. */
      cell: (customer) => (
        /* `Isolate`, never `Ltr`: a formatted date is not an identifier. ICU puts
           RTL marks inside the Arabic form on purpose and forcing `dir="ltr"`
           over them renders the date wrong — see primitives/Ltr.tsx.

           Absolute rather than `formatWhen`'s relative form: a customer who
           registered in the last 24 hours would render "il y a une minute" on
           the server and a different sentence on the client a moment later,
           which React reports as a hydration mismatch and repairs by
           regenerating the tree. `NotificationRow` carries the full account. */
        <Isolate>{formatDate(customer.date_created, locale, false)}</Isolate>
      ),
    },
    {
      key: "modified",
      header: t("columns.modified"),
      optional: true,
      /* `null` on a customer nobody has edited since the account was created —
         a third of them — and `formatDate` renders that as an em dash rather
         than as an invented date. */
      cell: (customer) => (
        <Isolate>{formatDate(customer.date_modified, locale, false)}</Isolate>
      ),
    },
    {
      key: "id",
      header: t("columns.id"),
      align: "end",
      /*
       * On by default, which the products list does not do with its own id.
       *
       * It is the one thing on a customer row that is short, stable and
       * quotable: the list can be sorted by registration or by e-mail and
       * neither is a handle a support agent can read back down a phone. It is
       * the id in the URL of the screen the row opens.
       */
      cell: (customer) => <Ltr className="text-ui-subtle">{customer.id}</Ltr>,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * Which three is an editorial choice rather than "the first three columns": on a
 * phone a person is deciding whether this is the person they meant (the name),
 * confirming it against what they have in front of them (the e-mail — the one
 * field every customer has and the API refuses to let anyone clear), and placing
 * the account in time with a handle they can quote (registered · id).
 */
export function customerRecord(
  customer: Customer,
  ctx: CustomerColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { locale, t } = ctx;
  const name = customerName(customer);

  return {
    primary: (
      <>
        <span className="flex min-w-0 flex-1 text-ui-subheading text-ui-fg">
          {nameText(customer, "min-w-0 flex-1 truncate", "font-normal text-ui-muted")}
        </span>
        {customer.is_paying_customer ? (
          <Badge tone="success">{t("paying")}</Badge>
        ) : null}
      </>
    ),
    /*
     * The e-mail — unless it is already the line above it.
     *
     * `customerName()` falls back to the address only when the username is
     * empty too, and a row that printed the same string twice within twenty
     * pixels is the defect the old detail screen carried against the username
     * row. The phone stands in when there is one; nothing does when there is not.
     */
    secondary:
      name.kind === "email" ? (
        customer.billing.phone !== "" ? (
          <Ltr className="min-w-0 flex-1 truncate">{customer.billing.phone}</Ltr>
        ) : null
      ) : (
        <Ltr numeric={false} className="min-w-0 flex-1 truncate">
          {customer.email}
        </Ltr>
      ),
    meta: (
      <>
        <Isolate className="min-w-0 truncate">
          {formatDate(customer.date_created, locale, false)}
        </Isolate>
        {/* `--text-compact` on the trailing figure, and it is a measurement
            rather than emphasis: `RecordListSkeleton` draws its third line at
            1.25rem because both migrated screens put a compact-sized value
            there, and the taller child wins the line box. Left at the meta
            row's own `--text-label` this card measured 94px against the
            placeholder's 96 — 12px of shift across the six rows it draws. */}
        <Ltr className="ms-auto shrink-0 text-ui-compact">#{customer.id}</Ltr>
      </>
    ),
  };
}
