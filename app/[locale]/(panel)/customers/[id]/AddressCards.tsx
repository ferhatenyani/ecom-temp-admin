import { getTranslations } from "next-intl/server";
import type { Address, CustomerDetail } from "@/lib/api/schemas/customer";
import { addressLines, hasAddress } from "@/lib/customers";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Ltr } from "@/components/primitives/Ltr";

/**
 * Where this customer is, when the shop knows.
 *
 * **Rendered only when there is something in them.** Every address field is a
 * string and an unset address is eleven empty ones, never `null` — so a card
 * gated on `billing !== null` is eleven blank rows, and `shipping` is empty on
 * all but one customer in this shop. `hasAddress()` is the guard, and it
 * deliberately does not count the billing e-mail: every customer has one on the
 * account, and counting it would render an address card whose only row is not
 * part of any address.
 */
export async function AddressCards({ customer }: { customer: CustomerDetail }) {
  const t = await getTranslations("customers");

  const billing = hasAddress(customer.billing);
  const shipping = hasAddress(customer.shipping);

  if (!billing && !shipping) {
    return (
      <Card title={t("section.addresses")}>
        <p className="text-ui-body text-ui-muted">{t("noAddress")}</p>
      </Card>
    );
  }

  return (
    <>
      {billing ? (
        <AddressCard title={t("section.billing")} address={customer.billing} t={t} />
      ) : null}
      {shipping ? (
        <AddressCard title={t("section.shipping")} address={customer.shipping} t={t} />
      ) : null}
    </>
  );
}

function AddressCard({
  title,
  address,
  t,
}: {
  title: string;
  address: Address;
  /* Passed rather than re-awaited: this is a private helper of the component
     above, and two `getTranslations` calls for one namespace on one card is a
     round trip nobody asked for. */
  t: (key: string) => string;
}) {
  const lines = addressLines(address);
  const who = [address.first_name, address.last_name]
    .filter((part) => part.trim() !== "")
    .join(" ");

  return (
    <Card title={title}>
      <DataList>
        {who !== "" ? (
          <DataRow label={t("field.name")}>
            <span dir="auto">{who}</span>
          </DataRow>
        ) : null}

        {address.company !== "" ? (
          <DataRow label={t("field.company")}>
            <span dir="auto">{address.company}</span>
          </DataRow>
        ) : null}

        {lines.length > 0 ? (
          /* `stacked`, because an address is prose that runs to three or four
             lines and a side-by-side value pushes its own label off the baseline
             every other row on the card shares. */
          <DataRow label={t("field.address")} stacked>
            {/* An address is user content in whichever language it was typed —
                `dir="auto"` per line, so a French street in the Arabic UI is not
                laid out backwards. The orders branch measured this one. */}
            <span className="flex min-w-0 flex-col">
              {lines.map((line) => (
                <span dir="auto" key={line}>
                  {line}
                </span>
              ))}
            </span>
          </DataRow>
        ) : null}

        {address.country !== "" ? (
          /* A two-letter country code is an identifier, not prose. */
          <DataRow label={t("field.country")}>
            <Ltr>{address.country}</Ltr>
          </DataRow>
        ) : null}

        {address.phone !== "" ? (
          <DataRow label={t("field.phone")}>
            <Ltr>{address.phone}</Ltr>
          </DataRow>
        ) : null}
      </DataList>
    </Card>
  );
}
