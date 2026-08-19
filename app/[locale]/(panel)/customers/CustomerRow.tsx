"use client";

import { useTranslations } from "next-intl";
import type { Customer } from "@/lib/api/schemas/customer";
import { customerName } from "@/lib/customers";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Ltr } from "@/components/primitives/Ltr";

/**
 * One customer.
 *
 * **The name is not reliably a name.** 12 of the 16 customers here have neither a
 * first nor a last name, so `customerName()` falls back to the username and then
 * to the email, and the row *styles* the fallback differently — a login rendered
 * at the same weight as a person's name reads as somebody called ac_cus_shopper.
 * The identifying line underneath is therefore the email, which every customer
 * has and which the API refuses to let anyone clear.
 *
 * Geometry matches `StockRow` and `MovementRow` — a 24px first line, a 4px gap, an
 * 18px second line, `py-3` — so `RowSkeleton` is honest here too and lists do not
 * resize under a reader's thumb when they navigate between sections.
 */
export function CustomerRow({ customer }: { customer: Customer }) {
  const t = useTranslations("customers");
  const name = customerName(customer);

  return (
    <div className="flex w-full items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-6 items-center gap-2">
          {name.kind === "name" ? (
            /*
              `dir="auto"` so the ellipsis lands at the *name's* own end. A French
              name in the Arabic list is an LTR run inside an RTL paragraph, and
              `text-overflow` clips at the paragraph's end — the left — which ate
              the front of product names on the inventory branch. A list of people
              is scanned by the beginnings of their names, so losing that end is
              losing the row.
            */
            <span dir="auto" className="truncate text-body text-label">
              {name.text}
            </span>
          ) : (
            /*
              A username or an email standing in for a name. Rendered as an
              identifier, because that is what it is: `Ltr` keeps it from
              reordering inside Arabic text, and the lighter weight says the shop
              does not know this person's name rather than asserting it is this.
            */
            <Ltr numeric={false} className="truncate text-body text-label-secondary">
              {name.text}
            </Ltr>
          )}

          {/*
            `is_paying_customer` is WooCommerce's own flag, set on the first paid
            order — 4 of the 16 here. It is a badge and not a filter, because
            **there is no filter for it**: `/customers` takes `search`, `orderby`
            and `order`, and nothing else. Marking the rows is the most the list
            can honestly do with it.
          */}
          {customer.is_paying_customer ? (
            <StatusBadge tone="success" className="shrink-0">
              {t("paying")}
            </StatusBadge>
          ) : null}
        </div>

        <div className="flex items-center gap-2 text-footnote text-label-secondary">
          {/* An email is an identifier and reorders inside Arabic text without
              isolation — the same silent failure a SKU has. */}
          <Ltr numeric={false} className="truncate">
            {customer.email}
          </Ltr>
        </div>
      </div>

      {/*
        The trailing figure is the customer's id, and it is here because it is the
        only thing on the row that is stable, short and searchable — the list can
        be sorted by registration or by email and neither is visible on the row
        otherwise. It is deliberately tertiary: it identifies, it does not rank.
      */}
      <Ltr className="shrink-0 text-footnote text-label-tertiary">#{customer.id}</Ltr>
    </div>
  );
}
