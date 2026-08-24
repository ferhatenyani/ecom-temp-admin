import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { CustomerStatistics, StatisticsOrder } from "@/lib/api/schemas/customer";
import { hasNoOrders, statFigures, statusBreakdown } from "@/lib/customers";
import { STATUS_TONE } from "@/lib/order-status";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Ltr, Isolate } from "@/components/primitives/Ltr";

/**
 * The statistics report — the block `GET /customers` does not send, and the
 * reason `CustomerDetail` is its own type rather than the row with an optional
 * field.
 *
 * ## Scope-labelled rows, and deliberately not a 4-up stat row
 *
 * **Two of these numbers do not divide into each other, and the card must not
 * let a reader think they do.** On customer 24: `total_orders: 5` sits beside
 * `total_revenue: "2100.00"`, and 2100 ÷ 5 = 420 is the arithmetic a person
 * performs when two figures sit side by side without saying what each counts.
 * The API's own arithmetic is 2100 ÷ 2 — revenue is the sum of the *completed*
 * orders and the average is over the same two — so every figure is internally
 * consistent and only labelling can make that visible.
 *
 * That is why `StatFigure.scope` is not optional, why each label states its own
 * scope, and why the footnote states the relationship the labels imply. It is
 * also why this is a list of labelled rows rather than DESIGN.md §3.2's
 * `StatGroup`: **a 4-up row of bare numbers under short labels is the single
 * layout most likely to invite the mistake**, because it puts the two figures at
 * the same size, on the same line, with the least room for a label of any length.
 *
 * `StatGroup`/`Stat` are specified and do not exist, and they are not built here.
 * Their real consumers are the six analytics screens; inventing a primitive on
 * the one screen that has just been told not to use it would be speculative, and
 * the analytics iteration owns it.
 *
 * ## The money gate is the panel's own decision, not the API's
 *
 * Measured 2026-08-19: a Support Agent reads `total_revenue: "2100.00"` from this
 * endpoint with a 200. `canSeeMoney()` needs `ac_view_analytics` **and**
 * `ac_manage_orders`, and of the roles that can read a customer only the Support
 * Agent lacks the second — so a lifetime-revenue figure would be the only money
 * in the panel they can see and the only one they cannot check.
 * `ADMIN_PANEL.md:1879-1882` records that both live tiers now hold both
 * capabilities, so the gate passes for every real account; it stays because it is
 * the correct rule and a third tier would make it bite again.
 *
 * The counts, the breakdown and the order links stay, so the card degrades to a
 * narrower report rather than to an empty box.
 */
export async function StatisticsCard({
  statistics,
  currency,
  locale,
  canSeeMoney,
}: {
  statistics: CustomerStatistics;
  currency: string;
  locale: string;
  canSeeMoney: boolean;
}) {
  const t = await getTranslations("customers");
  const tOrder = await getTranslations("status");

  /**
   * **11 of the 16 customers have never ordered, so this is the common case.**
   * It gets a sentence rather than a card of zeros: four figures reading 0 and a
   * breakdown with nothing in it is a report about nothing, and a reader has to
   * work out that it means "no orders" rather than "the report failed".
   */
  if (hasNoOrders(statistics)) {
    return (
      <Card title={t("section.statistics")} footnote={t("stats.neverOrderedNote")}>
        <p className="text-ui-body text-ui-muted">{t("stats.neverOrdered")}</p>
      </Card>
    );
  }

  const figures = statFigures(statistics).filter((figure) => canSeeMoney || !figure.money);
  const breakdown = statusBreakdown(statistics);
  const { first_order: first, last_order: last } = statistics;

  return (
    <Card
      title={t("section.statistics")}
      footnote={canSeeMoney ? t("stats.scopeNote") : undefined}
    >
      <DataList>
        {figures.map((figure) => (
          <DataRow key={figure.key} label={t(`stats.${figure.key}`)}>
            {/* Both branches are bare figures the shop assigned, so `Ltr` —
                money and counts render identically under it in both locales,
                measured by glyph position. */}
            <Ltr>
              {figure.money
                ? formatMoney(figure.value, currency, locale)
                : figure.value}
            </Ltr>
          </DataRow>
        ))}
      </DataList>

      {/*
        The breakdown, with the zeros dropped.

        `by_status` reports all seven statuses and sums exactly to
        `total_orders` — 0+1+0+2+1+1+0 = 5 on customer 24 — so this is the block
        that explains why revenue counts fewer orders than the customer placed,
        which is the whole reason it is on the screen rather than behind a tap.
        Five zeros beside two real numbers at 340px would bury it.

        A bordered section with a heading rather than a second card: DESIGN.md
        §1.6 forbids a card inside a card, and this belongs to the report above
        it rather than standing on its own.
      */}
      {breakdown.length > 0 ? (
        <>
          <h3 className="mt-4 text-ui-subheading text-ui-fg">{t("section.byStatus")}</h3>
          <ul className="flex flex-col">
            {breakdown.map(({ status, count }) => (
              <li
                key={status}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ui-line py-2 last:border-b-0"
              >
                {/* Colour never carries the meaning alone — the badge holds the
                    status word, per §3.5. */}
                <Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "neutral"}>
                  {tOrder.has(status) ? tOrder(status) : status}
                </Badge>
                <Ltr className="ms-auto text-ui-compact text-ui-fg">{count}</Ltr>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {first && last ? (
        <>
          <h3 className="mt-4 text-ui-subheading text-ui-fg">{t("section.span")}</h3>
          <DataList>
            {/*
              **One row when they are the same order**, which is the common case
              among customers who have ordered at all: a customer with a single
              order had it rendered twice, once as "première" and once as
              "dernière", with the same number and the same date. A span of one is
              not a span, and the label says so.
            */}
            {first.id === last.id ? (
              <DataRow label={t("stats.onlyOrder")}>
                <OrderSummary order={first} locale={locale} tOrder={tOrder} />
              </DataRow>
            ) : (
              <>
                <DataRow label={t("stats.firstOrder")}>
                  <OrderSummary order={first} locale={locale} tOrder={tOrder} />
                </DataRow>
                <DataRow label={t("stats.lastOrder")}>
                  <OrderSummary order={last} locale={locale} tOrder={tOrder} />
                </DataRow>
              </>
            )}
          </DataList>
        </>
      ) : null}
    </Card>
  );
}

/**
 * One order, as the statistics block summarises it: four fields, and reaching for
 * the rest would be a request the panel has not made.
 *
 * The number is the link and the badge sits outside it, so the anchor's
 * accessible name is the order it opens rather than the order plus its status.
 */
function OrderSummary({
  order,
  locale,
  tOrder,
}: {
  order: StatisticsOrder;
  locale: string;
  tOrder: { (key: string): string; has: (key: string) => boolean };
}) {
  return (
    <span className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5">
      <Link
        href={`/${locale}/orders/${order.id}`}
        className="ui-ring rounded-ui-md text-ui-accent hover:underline"
      >
        {/* An order number is assigned by the shop — `Ltr`. */}
        <Ltr>#{order.id}</Ltr>
      </Link>
      {/* `Intl` formatted, so `Isolate`. */}
      <Isolate className="text-ui-label text-ui-muted">
        {formatDate(order.date, locale, false)}
      </Isolate>
      {/*
        `status` is `z.string()` on this nested shape rather than the enum the
        parent's `by_status` uses, so an unlabelled value renders as itself: a
        vocabulary copied from the other side of the wire must degrade, not blank
        the page.
      */}
      <Badge tone={STATUS_TONE[order.status as keyof typeof STATUS_TONE] ?? "neutral"}>
        {tOrder.has(order.status) ? tOrder(order.status) : order.status}
      </Badge>
    </span>
  );
}
