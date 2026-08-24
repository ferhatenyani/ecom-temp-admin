import { getTranslations } from "next-intl/server";
import type { CustomerDetail } from "@/lib/api/schemas/customer";
import { customerName } from "@/lib/customers";
import { formatDate } from "@/lib/format/date";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Icon } from "@/components/primitives/Icon";

/**
 * Who this account is, in the aside.
 *
 * A label/value list is exactly what `DataList`/`DataRow` are for, and every row
 * here is conditional on saying something the row above it did not.
 */
export async function IdentityCard({
  customer,
  locale,
}: {
  customer: CustomerDetail;
  locale: string;
}) {
  const t = await getTranslations("customers");
  const name = customerName(customer);

  return (
    <Card title={t("section.identity")}>
      <DataList>
        <DataRow label={t("field.name")}>
          {name.kind === "name" ? (
            /* A user-supplied string in chrome resolves its own direction, or a
               French name in the Arabic panel is laid out backwards. */
            <span dir="auto">{name.text}</span>
          ) : (
            /* The shop does not know this person's name — true of 12 of the 16 —
               and the screen says so rather than leaving the row blank or
               repeating the login where a name belongs. */
            <span className="text-ui-subtle">{t("noName")}</span>
          )}
        </DataRow>

        <DataRow label={t("field.email")}>
          {/*
            `Ltr` isolates the address; the clipping is on the anchor, which
            inherits the *page's* direction — so in Arabic the ellipsis landed at
            the anchor's left and ate the start of the address. The container
            needs its own resolved direction too, or the isolation inside it is
            clipped from the wrong end. Measured on the order detail.
          */}
          <a
            href={`mailto:${customer.email}`}
            dir="auto"
            className="ui-ring block min-w-0 truncate rounded-ui-md text-ui-accent hover:underline"
          >
            <Ltr numeric={false}>{customer.email}</Ltr>
          </a>
        </DataRow>

        {/*
          Only when it says something the e-mail did not. Every seeded shopper
          has `user_login === user_email`, so this row rendered the address a
          second time directly beneath itself on 6 of the 16 customers. The
          username is still worth a row when it differs — it is what `?search=`
          matches and what `orderby=display_name` sorts by — but repeating a
          string is worse than omitting it.
        */}
        {customer.username !== "" && customer.username !== customer.email ? (
          <DataRow label={t("field.username")}>
            <Ltr numeric={false}>{customer.username}</Ltr>
          </DataRow>
        ) : null}

        {customer.billing.phone !== "" ? (
          <DataRow label={t("field.phone")}>
            {/* A phone number never mirrors, and one read back reordered is a
                call to a stranger. */}
            <a
              href={`tel:${customer.billing.phone}`}
              className="ui-ring inline-flex items-center gap-1.5 rounded-ui-md text-ui-accent hover:underline"
            >
              <Icon name="phone" className="size-3.5 shrink-0" />
              <Ltr>{customer.billing.phone}</Ltr>
            </a>
          </DataRow>
        ) : null}

        <DataRow label={t("field.id")}>
          <Ltr>{customer.id}</Ltr>
        </DataRow>

        {/* A date `Intl` formatted, so `Isolate` and never `Ltr` — forcing a
            direction over the RLMs `Intl` puts in an Arabic date renders
            `17ص 12:03 .2026/08/`. */}
        <DataRow label={t("field.registered")}>
          <Isolate>{formatDate(customer.date_created, locale, false)}</Isolate>
        </DataRow>

        {/* `null` on a customer nobody has edited since the account was created.
            `formatDate` renders that as an em dash rather than inventing one. */}
        <DataRow label={t("field.modified")}>
          <Isolate>{formatDate(customer.date_modified, locale, false)}</Isolate>
        </DataRow>
      </DataList>
    </Card>
  );
}
