"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CustomerDetail as Detail } from "@/lib/api/schemas/customer";
import type { Order } from "@/lib/api/schemas/order";
import { acRead } from "@/lib/api/browser";
import {
  addressLines,
  consentRecord,
  customerName,
  hasAddress,
  hasNoOrders,
  statFigures,
  statusBreakdown,
} from "@/lib/customers";
import { STATUS_TONE } from "@/lib/order-status";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState, SectionError } from "@/components/patterns/States";
import {
  ListGroup,
  ListLinkRow,
  ListRow,
  ListValueRow,
} from "@/components/primitives/GroupedList";
import { ReadOnlyField } from "@/components/primitives/Field";
import { Dot, StatusBadge } from "@/components/primitives/StatusBadge";
import { Segmented } from "@/components/primitives/Segmented";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { ORDERS_PER_PAGE, customerOrdersKey, customerOrdersParams } from "../query";

/**
 * One customer: who they are, what they have bought, and what they agreed to.
 *
 * **The detail is not the list row.** `GET /customers/{id}` carries a
 * `statistics` block that `GET /customers` omits — the first collection in this
 * panel where the two routes disagree, and the reason `CustomerDetail` is its own
 * type rather than the row with an optional field.
 *
 * The orders live behind their own segment rather than on the page. They are a
 * second request against a 600/min budget shared across every tab this person has
 * open, 11 of the 16 customers have never ordered at all, and the statistics
 * block already answers "has this person bought anything" without them.
 */
export function CustomerDetail({
  locale,
  customer,
  currency,
  canSeeMoney,
}: {
  locale: string;
  customer: Detail;
  currency: string;
  /**
   * **`total_revenue` is not gated by the API.** Measured: a Support Agent, who
   * fails `canSeeMoney()`, reads `2100.00` from this endpoint. The gate is the
   * panel's own, and it is applied deliberately rather than by omission — see
   * where this is used below.
   */
  canSeeMoney: boolean;
}) {
  const t = useTranslations("customers");
  const tOrder = useTranslations("status");
  const [tab, setTab] = useState<"profile" | "orders">("profile");

  const name = customerName(customer);
  const consent = consentRecord(customer);
  const statistics = customer.statistics;

  return (
    <Scaffold
      title={name.text}
      back={{ href: `/${locale}/customers`, label: t("title") }}
      toolbar={
        <Segmented<"profile" | "orders">
          segments={[
            { value: "profile", label: t("tab.profile") },
            { value: "orders", label: t("tab.orders") },
          ]}
          value={tab}
          onChange={setTab}
          label={t("tabLabel")}
        />
      }
    >
      <div className="mx-auto max-w-3xl px-4">
        {tab === "profile" ? (
          <>
            <IdentityCard customer={customer} />
            <StatisticsCard
              statistics={statistics}
              currency={currency}
              locale={locale}
              canSeeMoney={canSeeMoney}
            />
            <ConsentCard consent={consent} locale={locale} />
            <AddressCards customer={customer} />
          </>
        ) : (
          <OrdersTab
            locale={locale}
            customerId={customer.id}
            currency={currency}
            noOrders={hasNoOrders(statistics)}
          />
        )}
      </div>
    </Scaffold>
  );

  /* ------------------------------------------------------------ identity --- */

  function IdentityCard({ customer }: { customer: Detail }) {
    return (
      <ListGroup title={t("section.identity")}>
        {name.kind !== "name" ? (
          /*
            The shop does not know this person's name — true of 12 of the 16 — and
            the screen says so rather than leaving a row blank or repeating the
            login where a name belongs.
          */
          <ListValueRow
            label={t("field.name")}
            value={<span className="text-label-tertiary">{t("noName")}</span>}
          />
        ) : (
          <ListValueRow
            label={t("field.name")}
            value={<span dir="auto">{name.text}</span>}
          />
        )}
        {/* Identifiers, every one: they reorder inside Arabic text without
            isolation, and a phone number read back wrong is a call to a stranger. */}
        <ListValueRow
          label={t("field.email")}
          value={<Ltr numeric={false}>{customer.email}</Ltr>}
        />
        {/*
          Only when it says something the email did not. Every seeded shopper has
          `user_login === user_email`, so this row rendered the address a second
          time directly beneath itself on 6 of the 16 customers. The username is
          still worth a row when it differs — it is what `?search=` matches and
          what `orderby=display_name` sorts by — but repeating a string is worse
          than omitting it.
        */}
        {customer.username !== "" && customer.username !== customer.email ? (
          <ListValueRow
            label={t("field.username")}
            value={<Ltr numeric={false}>{customer.username}</Ltr>}
          />
        ) : null}
        <ListValueRow label={t("field.id")} value={<Ltr>{customer.id}</Ltr>} />
        {customer.billing.phone !== "" ? (
          <ListValueRow
            label={t("field.phone")}
            value={<Ltr>{customer.billing.phone}</Ltr>}
          />
        ) : null}
        {/* A date `Intl` formatted, so `Isolate` and never `Ltr` — forcing a
            direction over the RLMs `Intl` puts in an Arabic date renders
            `17ص 12:03 .2026/08/`. */}
        <ListValueRow
          label={t("field.registered")}
          value={<Isolate>{formatDate(customer.date_created, locale, false)}</Isolate>}
        />
      </ListGroup>
    );
  }

  /* ---------------------------------------------------------- statistics --- */

  function StatisticsCard({
    statistics,
    currency,
    locale,
    canSeeMoney,
  }: {
    statistics: Detail["statistics"];
    currency: string;
    locale: string;
    canSeeMoney: boolean;
  }) {
    const figures = statFigures(statistics).filter(
      (figure) => canSeeMoney || !figure.money,
    );
    const breakdown = statusBreakdown(statistics);

    if (hasNoOrders(statistics)) {
      return (
        <ListGroup title={t("section.statistics")} footnote={t("stats.neverOrderedNote")}>
          <ListRow>
            <span className="text-body text-label-secondary">{t("stats.neverOrdered")}</span>
          </ListRow>
        </ListGroup>
      );
    }

    return (
      <>
        <ListGroup
          title={t("section.statistics")}
          /*
            **The footnote is the whole reason this card is safe to render.**
            `total_orders` is 5 and `average_order_value` is 1050 against a
            `total_revenue` of 2100. 2100 ÷ 5 is 420, and that is the arithmetic a
            reader performs when the figures sit side by side. The API is
            self-consistent — revenue is the sum of the *completed* orders and the
            average is over those same two — so every figure carries its scope in
            its own label, and this line states the relationship the labels imply.
          */
          footnote={canSeeMoney ? t("stats.scopeNote") : undefined}
        >
          {figures.map((figure) => (
            <ListValueRow
              key={figure.key}
              label={t(`stats.${figure.key}`)}
              value={
                figure.money ? (
                  <Ltr>{formatMoney(figure.value, currency, locale)}</Ltr>
                ) : (
                  <Ltr>{figure.value}</Ltr>
                )
              }
            />
          ))}
        </ListGroup>

        {/*
          The breakdown, with the zeros dropped. `by_status` reports all seven and
          sums exactly to `total_orders` — 0+1+0+2+1+1+0 = 5 — so this is the block
          that explains why revenue counts fewer orders than the customer placed.
          Five zeros beside two real numbers on a 390px screen would bury it.
        */}
        {breakdown.length > 0 ? (
          <ListGroup title={t("section.byStatus")}>
            {breakdown.map(({ status, count }) => (
              <ListRow key={status}>
                <Dot tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "neutral"} />
                <span className="text-body text-label">{tOrder(status)}</span>
                <Ltr className="ms-auto text-body text-label-secondary">{count}</Ltr>
              </ListRow>
            ))}
          </ListGroup>
        ) : null}

        {statistics.first_order && statistics.last_order ? (
          <ListGroup title={t("section.span")}>
            {/*
              **One row when they are the same order**, which is the common case:
              a customer with a single order had it rendered twice, once as
              "première" and once as "dernière", with the same number and the same
              date. A span of one is not a span, and the label says so.
            */}
            {statistics.first_order.id === statistics.last_order.id ? (
              <ListLinkRow
                href={`/${locale}/orders/${statistics.first_order.id}`}
                ariaLabel={t("stats.onlyOrder")}
              >
                <OrderSummaryLine
                  label={t("stats.onlyOrder")}
                  order={statistics.first_order}
                />
              </ListLinkRow>
            ) : (
              <>
                <ListLinkRow
                  href={`/${locale}/orders/${statistics.first_order.id}`}
                  ariaLabel={t("stats.firstOrder")}
                >
                  <OrderSummaryLine
                    label={t("stats.firstOrder")}
                    order={statistics.first_order}
                  />
                </ListLinkRow>
                <ListLinkRow
                  href={`/${locale}/orders/${statistics.last_order.id}`}
                  ariaLabel={t("stats.lastOrder")}
                >
                  <OrderSummaryLine
                    label={t("stats.lastOrder")}
                    order={statistics.last_order}
                  />
                </ListLinkRow>
              </>
            )}
          </ListGroup>
        ) : null}
      </>
    );
  }

  function OrderSummaryLine({
    label,
    order,
  }: {
    label: string;
    order: NonNullable<Detail["statistics"]["first_order"]>;
  }) {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body text-label">{label}</span>
          <span className="text-footnote text-label-secondary">
            <Isolate>{formatDate(order.date, locale, false)}</Isolate>
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <Ltr className="text-body text-label">#{order.id}</Ltr>
          <span className="text-caption text-label-secondary">{tOrder(order.status)}</span>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------- consent --- */

  function ConsentCard({
    consent,
    locale,
  }: {
    consent: ReturnType<typeof consentRecord>;
    locale: string;
  }) {
    /*
     * **The row the specification could not have been built from.**
     *
     * docs/ADMIN_PANEL.md asked for a read-only row "with the date and the reason
     * it cannot be changed here". When this branch started there was no date: the
     * payload carried a bare `marketing_consent: false`, the refusal was the
     * generic `"Unknown field."`, and 0 of 16 customers had ever consented, so the
     * affirmative state could not be seen at all.
     *
     * All three were fixed in the API rather than worked around here, because the
     * question this row answers — *may I email this person?* — is one a shop can
     * be asked to evidence. `marketing_consent_at` turned out to be stored already
     * and never presented; the source was in the audit log, which stops at Admin
     * while a customer record is read by Support Agent.
     *
     * A value row, not a switch. A control that looks editable and is not gets
     * filed as a bug every few months, and the reason underneath is the part that
     * stops it. Rendered even when the answer is no, because "no" is the
     * operationally important state and hiding it makes a declined customer
     * indistinguishable from a screen that failed to load.
     */
    const value =
      consent.state === "granted"
        ? t("consent.granted")
        : consent.state === "withdrawn"
          ? t("consent.withdrawn")
          : t("consent.never");

    const detail =
      consent.state === "never"
        ? t("consent.neverDetail")
        : t("consent.on", {
            date: formatDate(consent.at, locale, false),
          });

    return (
      <ListGroup title={t("section.consent")}>
        <ReadOnlyField
          /*
            The row's label is the *question*, not the section's own title again.
            Rendered, the card read "Consentement marketing" as its heading and
            "Consentement marketing" again as the first row's label, an inch
            apart — the same defect the inventory branch found printing a product
            name twice in a hundred pixels, and invisible in the source because
            the two strings come from different keys.
          */
          label={t("consent.question")}
          value={
            <span className="flex flex-wrap items-center gap-2">
              <span>{value}</span>
              {consent.state !== "never" ? (
                <span className="text-footnote text-label-secondary">
                  <Isolate>{detail}</Isolate>
                </span>
              ) : null}
            </span>
          }
          /*
           * The reason names the route rather than saying "not editable". A staff
           * member who needs this changed has to tell the customer where to do it,
           * and "the customer changes it from their account" is that sentence.
           */
          reason={t("consent.reason")}
        />
        {consent.state !== "never" && consent.source !== null ? (
          <ListValueRow
            label={t("consent.sourceLabel")}
            value={t(`consent.source.${consent.source}`)}
          />
        ) : null}
        {consent.state === "never" ? (
          <ListRow>
            <span className="text-footnote text-label-secondary">{detail}</span>
          </ListRow>
        ) : null}
      </ListGroup>
    );
  }

  /* ----------------------------------------------------------- addresses --- */

  function AddressCards({ customer }: { customer: Detail }) {
    /*
     * Rendered only when there is something in them. Every address field is a
     * string and an unset address is eleven empty ones, never null — so a card
     * gated on `billing !== null` is eleven blank rows, and `shipping` is empty on
     * all but one customer in this shop.
     */
    const billing = hasAddress(customer.billing);
    const shipping = hasAddress(customer.shipping);

    if (!billing && !shipping) {
      return (
        <ListGroup title={t("section.addresses")}>
          <ListRow>
            <span className="text-body text-label-secondary">{t("noAddress")}</span>
          </ListRow>
        </ListGroup>
      );
    }

    return (
      <>
        {billing ? (
          <AddressCard title={t("section.billing")} address={customer.billing} />
        ) : null}
        {shipping ? (
          <AddressCard title={t("section.shipping")} address={customer.shipping} />
        ) : null}
      </>
    );
  }

  function AddressCard({
    title,
    address,
  }: {
    title: string;
    address: Detail["billing"];
  }) {
    const lines = addressLines(address);
    const who = [address.first_name, address.last_name]
      .filter((part) => part.trim() !== "")
      .join(" ");

    return (
      <ListGroup title={title}>
        {who !== "" ? (
          <ListValueRow label={t("field.name")} value={<span dir="auto">{who}</span>} />
        ) : null}
        {address.company !== "" ? (
          <ListValueRow
            label={t("field.company")}
            value={<span dir="auto">{address.company}</span>}
          />
        ) : null}
        {lines.length > 0 ? (
          <ListRow className="items-start">
            <span className="shrink-0 text-body text-label-secondary">
              {t("field.address")}
            </span>
            {/* An address is user content in whichever language it was typed —
                `dir="auto"` per line so a French street in the Arabic UI is not
                laid out backwards. The orders branch measured this one. */}
            <span className="ms-auto flex min-w-0 flex-col text-end text-body text-label">
              {lines.map((line) => (
                <span dir="auto" key={line}>
                  {line}
                </span>
              ))}
            </span>
          </ListRow>
        ) : null}
        {address.country !== "" ? (
          <ListValueRow label={t("field.country")} value={<Ltr>{address.country}</Ltr>} />
        ) : null}
        {address.phone !== "" ? (
          <ListValueRow label={t("field.phone")} value={<Ltr>{address.phone}</Ltr>} />
        ) : null}
      </ListGroup>
    );
  }

  /* -------------------------------------------------------------- orders --- */

  function OrdersTab({
    locale,
    customerId,
    currency,
    noOrders,
  }: {
    locale: string;
    customerId: number;
    currency: string;
    noOrders: boolean;
  }) {
    const [page, setPage] = useState(1);

    /*
     * `GET /customers/{id}/orders` returns **the identical shape** to `GET /orders`
     * — verified by deep key-set equality on every nested object — so
     * `lib/api/schemas/order.ts` serves it unchanged and there is no second order
     * type in this panel.
     *
     * Fetched on demand rather than with the page: 11 of the 16 customers have
     * never ordered, and the statistics block above already answers whether this
     * one has.
     */
    const { data, isPending, isError, error, refetch } = useQuery({
      queryKey: customerOrdersKey(customerId, "", page),
      queryFn: async () => {
        const { data, total } = await acRead<Order[]>(
          `/customers/${customerId}/orders?${customerOrdersParams("", page)}`,
        );
        return { orders: data, total };
      },
      enabled: !noOrders,
      placeholderData: keepPreviousData,
    });

    if (noOrders) {
      return <EmptyState message={t("orders.never")} />;
    }

    if (isPending) {
      return (
        <div
          role="status"
          aria-busy="true"
          className="mb-8 overflow-hidden rounded-lg bg-surface"
        >
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="list-row flex items-center gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-h-6 items-center gap-2">
                  <div className="skeleton h-5 w-24 rounded-sm" />
                </div>
                <div className="skeleton h-4.5 w-32 rounded-sm" />
              </div>
              <div className="skeleton h-6 w-20 shrink-0 rounded-sm" />
            </div>
          ))}
        </div>
      );
    }

    if (isError) {
      return <SectionError>{(error as Error).message}</SectionError>;
    }

    const orders = data?.orders ?? [];
    const total = data?.total ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / ORDERS_PER_PAGE));

    if (orders.length === 0) {
      return <ErrorState message={t("orders.none")} onRetry={() => void refetch()} />;
    }

    return (
      <>
        <p className="mb-2 px-1 text-footnote text-label-secondary" aria-live="polite">
          <Isolate numeric>{t("orders.count", { total })}</Isolate>
        </p>

        <ListGroup>
          {orders.map((order) => (
            <ListLinkRow
              key={order.id}
              href={`/${locale}/orders/${order.id}`}
              ariaLabel={`#${order.number}`}
            >
              <div className="flex w-full items-center gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex min-h-6 items-center gap-2">
                    {/* An order number is assigned by the shop — `Ltr`. */}
                    <Ltr className="truncate text-body text-label">#{order.number}</Ltr>
                    <StatusBadge tone={STATUS_TONE[order.status] ?? "neutral"}>
                      {tOrder(order.status)}
                    </StatusBadge>
                  </div>
                  <span className="text-footnote text-label-secondary">
                    {/* `Intl` formatted — `Isolate`. */}
                    <Isolate>{formatDate(order.date_created, locale, false)}</Isolate>
                  </span>
                </div>
                <Ltr className="shrink-0 text-body text-label">
                  {formatMoney(order.total, order.currency || currency, locale)}
                </Ltr>
              </div>
            </ListLinkRow>
          ))}
        </ListGroup>

        {total > ORDERS_PER_PAGE ? (
          <nav className="mb-8 flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label={t("previousPage")}
              className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
            >
              {t("orders.previous")}
            </button>
            <span className="text-footnote text-label-secondary">
              <Ltr numeric>
                {page} / {pageCount}
              </Ltr>
            </span>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
              aria-label={t("nextPage")}
              className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
            >
              {t("orders.next")}
            </button>
          </nav>
        ) : null}
      </>
    );
  }
}
