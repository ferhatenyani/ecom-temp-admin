import type { ReactNode } from "react";
import type { Order, Wilaya } from "@/lib/api/schemas/order";
import { STATUS_TONE } from "@/lib/order-status";
import { customerName, orderPlace } from "@/lib/orders";
import { formatMoney } from "@/lib/format/money";
import { formatWhen } from "@/lib/format/date";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Icon } from "@/components/primitives/Icon";
import { Badge, Dot } from "@/components/ui/Badge";
import type { Column } from "@/components/ui/DataTable";

/**
 * The Orders column definition — one source, two presentations.
 *
 * `DataTable` renders these as a real table at `md` and up and `RecordList`
 * renders the three-line form below it, so the fields a person sees on a phone
 * and the fields they see on a monitor cannot drift apart.
 *
 * Six columns are on by default and four more are behind the column picker.
 * That split follows the data rather than taste: `place` is filled on only about
 * 8% of orders by wilaya and 27% by city, and `payment_method_title` is a long
 * string ("Paiement à la livraison") that costs a column of width to say the
 * same thing on nearly every row — so it is optional, and place is not, because
 * a dispatcher scans for it.
 */

export type OrderColumnContext = {
  locale: string;
  wilayasByCode: Map<string, Wilaya>;
  t: (key: string) => string;
  tStatus: (key: string) => string;
};

/** The customer's name, or what stands in for it. Never an empty cell. */
export function displayName(order: Order, ctx: OrderColumnContext): string {
  return (
    customerName(order) ??
    (order.customer_id === 0 ? ctx.t("guest") : ctx.t("noName"))
  );
}

export function buildColumns(ctx: OrderColumnContext): Column<Order>[] {
  const { locale, wilayasByCode, tStatus, t } = ctx;

  return [
    {
      key: "number",
      header: t("columns.order"),
      required: true,
      sortKey: "id",
      cell: (order) => <Ltr>#{order.number}</Ltr>,
    },
    {
      key: "customer",
      header: t("columns.customer"),
      cell: (order) => (
        /* `dir="auto"` so the ellipsis lands at the name's own end. A French
           name inside the Arabic list is an LTR run in an RTL paragraph, and
           `text-overflow` clips at the paragraph's end — which without this
           renders "…dia Haddad". */
        <span dir="auto" className="block max-w-48 truncate">
          {displayName(order, ctx)}
        </span>
      ),
    },
    {
      key: "place",
      header: t("columns.place"),
      cell: (order) => {
        const place = orderPlace(order, wilayasByCode, locale);
        /* Omitted rather than dashed. Roughly 92% of orders carry no wilaya, so
           a placeholder would be a column of dashes rather than information. */
        if (!place) return null;
        return (
          <span dir="auto" className="block max-w-36 truncate">
            {place}
          </span>
        );
      },
    },
    {
      key: "items",
      header: t("columns.items"),
      align: "end",
      optional: true,
      cell: (order) => (
        <Ltr>{order.line_items.length}</Ltr>
      ),
    },
    {
      key: "payment",
      header: t("columns.payment"),
      optional: true,
      cell: (order) => (
        <span dir="auto" className="block max-w-40 truncate">
          {order.payment_method_title || order.payment_method}
        </span>
      ),
    },
    {
      key: "created",
      header: t("columns.date"),
      sortKey: "date",
      cell: (order) => (
        /* `Isolate`, not `Ltr`: a formatted date is not an identifier. ICU puts
           RTL marks inside the Arabic form on purpose, and forcing dir="ltr"
           over them renders the date wrong. */
        <Isolate>{formatWhen(order.date_created, locale)}</Isolate>
      ),
    },
    {
      key: "modified",
      header: t("columns.modified"),
      optional: true,
      cell: (order) => <Isolate>{formatWhen(order.date_modified, locale)}</Isolate>,
    },
    {
      key: "total",
      header: t("columns.total"),
      align: "end",
      sortKey: "total",
      cell: (order) => (
        <Ltr className="font-medium text-ui-fg">
          {formatMoney(order.total, order.currency, locale)}
        </Ltr>
      ),
    },
    {
      key: "status",
      header: t("columns.status"),
      align: "end",
      cell: (order) => (
        <Badge tone={STATUS_TONE[order.status]}>{tStatus(order.status)}</Badge>
      ),
    },
    {
      key: "id",
      header: t("columns.id"),
      align: "end",
      optional: true,
      cell: (order) => <Ltr className="text-ui-subtle">{order.id}</Ltr>,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * Which three is an explicit editorial choice, not "the first three columns":
 * a person on a phone is triaging, so they need to identify the order (number),
 * know who and where it is going (name · place), and see what it is worth and
 * how urgent it is (total · date). Items, payment and the internal id are
 * detail-screen concerns.
 */
export function orderRecord(
  order: Order,
  ctx: OrderColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { locale, wilayasByCode, tStatus } = ctx;
  const place = orderPlace(order, wilayasByCode, locale);

  return {
    primary: (
      <>
        <Ltr className="text-ui-subheading text-ui-fg">#{order.number}</Ltr>
        <Badge tone={STATUS_TONE[order.status]} className="ms-auto">
          {tStatus(order.status)}
        </Badge>
      </>
    ),
    secondary: (
      <>
        <span dir="auto" className="min-w-0 flex-1 truncate">
          {displayName(order, ctx)}
        </span>
        {place ? (
          <span className="flex min-w-0 max-w-32 shrink items-center gap-0.5">
            <Icon name="pin" className="size-3 shrink-0" />
            <span dir="auto" className="truncate">
              {place}
            </span>
          </span>
        ) : null}
      </>
    ),
    meta: (
      <>
        {/* The dot repeats the status the badge above already carries — it is
            decorative here and never the only signal. */}
        <Dot tone={STATUS_TONE[order.status]} />
        <Isolate>{formatWhen(order.date_created, locale)}</Isolate>
        <Ltr className="ms-auto shrink-0 text-ui-compact text-ui-fg">
          {formatMoney(order.total, order.currency, locale)}
        </Ltr>
      </>
    ),
  };
}
