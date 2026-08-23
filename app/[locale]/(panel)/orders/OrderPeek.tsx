"use client";

import { useTranslations } from "next-intl";
import type { Order } from "@/lib/api/schemas/order";
import { STATUS_TONE } from "@/lib/order-status";
import { orderPlace } from "@/lib/orders";
import { formatMoney } from "@/lib/format/money";
import { formatDate } from "@/lib/format/date";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Drawer } from "@/components/ui/Overlay";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { displayName, type OrderColumnContext } from "./columns";

/**
 * The order preview drawer.
 *
 * **It costs no request.** ADMIN_PANEL.md records the measurement:
 * `GET /orders/{id}` returns the same object as the list row, key for key. So
 * everything below comes from data the list already holds, and opening a preview
 * is instant and does not spend against the 600/min read budget.
 *
 * It is a *preview*, not a second detail screen — deliberately the fields needed
 * to triage, with a link to the full page for anything else. Duplicating the
 * detail layout here is how two screens start drifting.
 */
export function OrderPeek({
  order,
  ctx,
  onOpenChange,
}: {
  order: Order | null;
  ctx: OrderColumnContext;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("orders");
  const tDetail = useTranslations("orders.detail");
  const tStatus = useTranslations("status");
  const { locale, wilayasByCode } = ctx;

  return (
    <Drawer
      open={order !== null}
      onOpenChange={onOpenChange}
      title={order ? `#${order.number}` : ""}
      size="sm"
      headerExtra={
        order ? (
          <ButtonLink
            href={`/${locale}/orders/${order.id}`}
            variant="secondary"
            size="sm"
            iconEnd="external"
          >
            {t("openFull")}
          </ButtonLink>
        ) : null
      }
    >
      {order ? (
        <dl className="flex flex-col">
          <Row label={tDetail("summary")}>
            <Badge tone={STATUS_TONE[order.status]}>{tStatus(order.status)}</Badge>
          </Row>
          <Row label={tDetail("customer")}>
            <span dir="auto">{displayName(order, ctx)}</span>
          </Row>
          {orderPlace(order, wilayasByCode, locale) ? (
            <Row label={tDetail("wilaya")}>
              <span dir="auto">{orderPlace(order, wilayasByCode, locale)}</span>
            </Row>
          ) : null}
          <Row label={tDetail("paymentMethod")}>
            <span dir="auto">
              {order.payment_method_title || order.payment_method}
            </span>
          </Row>
          <Row label={tDetail("created")}>
            <Isolate>{formatDate(order.date_created, locale)}</Isolate>
          </Row>
          <Row label={tDetail("items")}>
            <Ltr>{order.line_items.length}</Ltr>
          </Row>
          <Row label={tDetail("subtotal")}>
            <Ltr>{formatMoney(order.subtotal, order.currency, locale)}</Ltr>
          </Row>
          {order.shipping_total !== "0.00" ? (
            <Row label={tDetail("shipping")}>
              <Ltr>{formatMoney(order.shipping_total, order.currency, locale)}</Ltr>
            </Row>
          ) : null}
          {order.discount_total !== "0.00" ? (
            <Row label={tDetail("discount")}>
              <Ltr>{formatMoney(order.discount_total, order.currency, locale)}</Ltr>
            </Row>
          ) : null}
          <Row label={tDetail("total")} strong>
            <Ltr className="text-ui-subheading text-ui-fg">
              {formatMoney(order.total, order.currency, locale)}
            </Ltr>
          </Row>

          {order.customer_note.trim() !== "" ? (
            <div className="mt-4 rounded-ui-lg border border-ui-line bg-ui-surface-2 p-3">
              <p className="text-ui-overline text-ui-muted uppercase">
                {tDetail("note")}
              </p>
              <p dir="auto" className="mt-1 text-ui-compact text-ui-fg">
                {order.customer_note}
              </p>
            </div>
          ) : null}
        </dl>
      ) : null}
    </Drawer>
  );
}

function Row({
  label,
  children,
  strong = false,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-2 ${
        strong ? "border-t border-ui-line-strong pt-3" : "border-b border-ui-line"
      }`}
    >
      <dt className="shrink-0 text-ui-label text-ui-muted">{label}</dt>
      <dd className="min-w-0 text-end text-ui-compact text-ui-fg">{children}</dd>
    </div>
  );
}
