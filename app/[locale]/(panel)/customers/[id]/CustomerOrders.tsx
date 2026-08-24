"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Order } from "@/lib/api/schemas/order";
import { acRead } from "@/lib/api/browser";
import { STATUS_TONE } from "@/lib/order-status";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/Button";
import { SectionError } from "@/components/ui/States";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { ORDERS_PER_PAGE, customerOrdersKey, customerOrdersParams } from "../query";

/**
 * This customer's orders, in the main column.
 *
 * ## No longer behind a tab, and page one arrives with the document
 *
 * The screen this replaces put these behind a `Segmented` control and fetched
 * them when someone selected it. `Segmented` is retired and nothing replaces it:
 * tabs would hide content behind a click on a screen that is **empty for 11 of
 * the 16 customers**, which is the shape where a tab costs a click to discover
 * there was nothing there.
 *
 * The request is not spent for nothing either. The parent skips it entirely when
 * `statistics.total_orders` is 0 and renders the zero state below instead — the
 * statistics block already answers "has this person bought anything" without a
 * second request against a 600/min budget shared across every tab this person has
 * open.
 *
 * ## Why this is a client component at all
 *
 * Only for the pager. Page one is fetched server-side and handed in as
 * `initialData`, so first paint carries rows and nothing waterfalls; the query
 * only ever runs when somebody asks for page two.
 *
 * `GET /customers/{id}/orders` returns **the identical shape** to `GET /orders` —
 * verified by deep key-set equality on every nested object — so
 * `lib/api/schemas/order.ts` serves it unchanged and there is no second order
 * type in this panel.
 */
export function CustomerOrders({
  locale,
  customerId,
  currency,
  initialOrders,
  initialTotal,
}: {
  locale: string;
  customerId: number;
  currency: string;
  /** `null` when the request failed. `[]` is a page with nothing on it. */
  initialOrders: Order[] | null;
  initialTotal: number;
}) {
  const t = useTranslations("customers");
  const tOrder = useTranslations("status");
  const tTable = useTranslations("ui.table");
  const [page, setPage] = useState(1);

  const { data, isError, error } = useQuery({
    queryKey: customerOrdersKey(customerId, "", page),
    queryFn: async () => {
      const { data, total } = await acRead<Order[]>(
        `/customers/${customerId}/orders?${customerOrdersParams("", page)}`,
      );
      return { orders: data, total };
    },
    initialData:
      page === 1 && initialOrders !== null
        ? { orders: initialOrders, total: initialTotal }
        : undefined,
    /* Keeps the page on screen while the next one loads, so the card never
       collapses to a skeleton over rows that are still valid. */
    placeholderData: keepPreviousData,
    enabled: initialOrders !== null,
  });

  /* The section failed while the rest of the screen loaded. `null` (this could
     not load) is a different answer from `[]` (there is nothing here), and only
     one of them is worth an error box. */
  if (initialOrders === null || isError) {
    return (
      <Card title={t("orders.section")}>
        <SectionError>
          {isError ? (error as Error).message : t("orders.failed")}
        </SectionError>
      </Card>
    );
  }

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ORDERS_PER_PAGE));

  return (
    <Card
      title={t("orders.section")}
      description={t("orders.count", { total })}
      actions={
        total > ORDERS_PER_PAGE ? (
          <div className="flex items-center gap-1">
            <IconButton
              label={tTable("previousPage")}
              icon="back"
              flipInRtl
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            />
            <span className="px-1 text-ui-label text-ui-muted" data-numeric="">
              {tTable("pageOf", { page, pages })}
            </span>
            <IconButton
              label={tTable("nextPage")}
              icon="chevron"
              flipInRtl
              variant="secondary"
              size="sm"
              disabled={page >= pages}
              onClick={() => setPage((current) => current + 1)}
            />
          </div>
        ) : null
      }
    >
      {orders.length === 0 ? (
        /* Reachable only by paging past the end — the parent renders the
           never-ordered state instead when the report says zero. */
        <p className="text-ui-body text-ui-muted">{t("orders.none")}</p>
      ) : (
        <ul className="flex flex-col">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-ui-line py-2.5 last:border-b-0"
            >
              {/* An order number is assigned by the shop — `Ltr`. */}
              <Link
                href={`/${locale}/orders/${order.id}`}
                className="ui-ring rounded-ui-md text-ui-accent hover:underline"
              >
                <Ltr>#{order.number}</Ltr>
              </Link>
              <Badge tone={STATUS_TONE[order.status] ?? "neutral"}>
                {tOrder(order.status)}
              </Badge>
              {/* `Intl` formatted, so `Isolate` and never `Ltr`. Absolute rather
                  than relative: a customer can place an order minutes ago, and
                  `formatWhen` would render one sentence on the server and
                  another on the client — a hydration mismatch React repairs by
                  regenerating the tree. `NotificationRow` carries the account. */}
              <Isolate className="text-ui-label text-ui-muted">
                {formatDate(order.date_created, locale, false)}
              </Isolate>
              {/*
                Not gated on `canSeeMoney`, and the scope of that gate is the
                point rather than an oversight. It exists because
                `statistics.total_revenue` is a figure the API publishes to a
                Support Agent and **nothing else in the panel can corroborate**.
                A line total sits on the row of the order that produced it, which
                is its own corroboration, and this sub-resource is 200 for every
                role that can open this screen.
              */}
              <Ltr className="ms-auto text-ui-compact text-ui-fg">
                {formatMoney(order.total, order.currency || currency, locale)}
              </Ltr>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
