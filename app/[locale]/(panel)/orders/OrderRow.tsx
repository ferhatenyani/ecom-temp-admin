import { useTranslations } from "next-intl";
import type { Order, Wilaya } from "@/lib/api/schemas/order";
import { STATUS_TONE } from "@/lib/order-status";
import { customerName, orderPlace } from "@/lib/orders";
import { formatMoney } from "@/lib/format/money";
import { Ltr } from "@/components/primitives/Ltr";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Icon } from "@/components/primitives/Icon";

/**
 * One order, as a row.
 *
 * Primary line: order number and status badge. Secondary: who, where and how
 * much. The number and the total are `Ltr`-isolated and tabular — an order id
 * reordered by the bidi algorithm is a number that does not exist, and a
 * right-aligned money column with proportional figures is the tell of an
 * interface nobody tuned.
 *
 * The place is omitted rather than dashed when unknown. Measured: only 52 of 633
 * orders carry a wilaya and 172 a city, so a placeholder would be a column of
 * dashes down 93 % of the list.
 */
export function OrderRow({
  order,
  locale,
  wilayasByCode,
}: {
  order: Order;
  locale: string;
  wilayasByCode: Map<string, Wilaya>;
}) {
  const t = useTranslations("orders");
  const tStatus = useTranslations("status");

  const name = customerName(order) ?? (order.customer_id === 0 ? t("guest") : t("noName"));
  const place = orderPlace(order, wilayasByCode, locale);
  const statusLabel = tStatus(order.status);

  return (
    <span className="flex min-w-0 flex-col gap-1 py-1">
      <span className="flex min-w-0 items-center gap-2">
        {/* The row's own aria-label names the order in full; this is the visible
            form, and it stays in the accessibility tree so a screen-reader user
            scanning the list hears the same thing a sighted one reads. */}
        <span className="min-w-0 flex-1 text-headline text-label">
          <Ltr>#{order.number}</Ltr>
        </span>
        {/* The badge carries the word, so colour is never the only signal. */}
        <StatusBadge tone={STATUS_TONE[order.status]}>{statusLabel}</StatusBadge>
      </span>

      {/*
        Three pieces compete for one line at 390px, so the priority is explicit:
        the total never shrinks (it is why the row is being read), the place never
        shrinks (it is the dispatcher's scan target), and the name absorbs the
        squeeze.

        Truncating the whole "name · place" string as one unit was worse than it
        sounds — it cut inside the place and left rows reading "Nadia Haddad · …",
        a separator pointing at nothing.
      */}
      <span className="flex min-w-0 items-baseline gap-2">
        {/* `dir="auto"` so the ellipsis lands at the *name's* own end. A French
            name in the Arabic list is an LTR run inside an RTL paragraph, and
            `text-overflow` clips at the paragraph's end — the left — so the row
            read "…dia Haddad". Measured on the inventory branch and owed on every
            other truncate holding user content; this is one of them. It moves
            nothing when the text fits. */}
        <span dir="auto" className="min-w-0 flex-1 truncate text-subhead text-label-secondary">
          {name}
        </span>
        {place ? (
          /*
            Capped and truncating, rather than never shrinking. A long place with a
            long total ("Bir Mourad Raïs" beside "14 800,00 DA") squeezed the name
            down to "Nadia Ha…", and a name is the thing a person is looked up by.
            The cap gives the name at least half the line and only clips the place
            in the extreme.
          */
          <span className="place-cap flex min-w-0 items-center gap-0.5 text-subhead text-label-secondary">
            <Icon name="pin" className="size-3 shrink-0" />
            {/* A wilaya name, in whichever script the data carries — the same
                clipping rule as the customer name beside it. */}
            <span dir="auto" className="truncate">
              {place}
            </span>
          </span>
        ) : null}
        <Ltr className="shrink-0 text-subhead text-label">
          {formatMoney(order.total, order.currency, locale)}
        </Ltr>
      </span>
    </span>
  );
}
