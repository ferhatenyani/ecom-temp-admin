import { getTranslations } from "next-intl/server";
import type { Order } from "@/lib/api/schemas/order";
import { formatMoney } from "@/lib/format/money";
import { Ltr } from "@/components/primitives/Ltr";
import { Card } from "@/components/ui/Card";
import { OrderLinesDrawer } from "./OrderLinesDrawer";

/**
 * The line items and the totals that follow from them.
 *
 * ## A plain `<table>`, deliberately not `DataTable`
 *
 * `DataTable`'s machinery — row selection, the column picker, density, a
 * pagination footer, sorting, a per-row action menu — is all unwanted for a list
 * that is one to three rows long and never grows while someone is looking at it.
 * §3.2's contract is written for list *screens*, where those controls earn their
 * complexity. Here they would be seven affordances that do nothing.
 *
 * What is kept from §3.2 and §5 is the part that matters: real table semantics.
 * A `<thead>` with `<th scope="col">`, the item name as `<th scope="row">` so a
 * screen reader announces "row 2, Tapis berbère" rather than three unlabelled
 * cells, and the totals in a real `<tfoot>` — which is what they are, and which
 * is why they are not a second card underneath.
 *
 * If a second detail screen in this run needs the same shape, *that* is when it
 * becomes a primitive. One caller is not a pattern.
 *
 * ## Below `sm` it restructures rather than scrolling
 *
 * §2.1: the page never scrolls inline, and a table that must scroll does so in
 * its own container. Three columns at 340px could scroll — but the whole content
 * of a row is a name, a quantity and an amount, which stack into three lines
 * with room to spare. Scrolling to reach a two-character quantity would be a
 * worse answer than restructuring, and the totals block has no columns at all.
 *
 * ## The editor, and the footnote that used to stand in for it
 *
 * This card said, for eleven branches, that there was **no** line-item editor —
 * because the `PATCH /orders/{id}` line-items contract had never been measured
 * and unverified is treated as not working. That reason has expired: the whole
 * write shape is now **measured in-process via `rest_do_request()`** against the
 * plugin's own suite, replace-the-set semantics and every refusal included, and
 * `OrderLinesDrawer` is built on it. Read that phrase strictly — it is not
 * "measured against the live API", which `BLOCKED.md` says is a sentence no
 * finding on this route may use.
 *
 * The trigger goes in `Card`'s `actions` slot rather than the page header, and
 * the reason is this footnote. §3.3 allows one primary action per view and the
 * header already carries the status menu and the edit drawer; more usefully,
 * **the disabled reason is already printed here**. The button is disabled for
 * exactly the condition the footnote explains, and both read
 * `orders.detail.editableNo`, so the tooltip and the paragraph under it cannot
 * drift into saying two different things about one rule.
 *
 * The footnote still renders only when `is_editable` is false, and still says
 * only the part that is a fact about *their* order: the stock has moved, so the
 * lines are fixed. When it is true there is a live control and nothing to
 * explain — "the items are still editable" beside a working button is worse than
 * silence.
 */
export async function OrderItems({
  order,
  locale,
  canWrite,
  canPickProducts,
}: {
  order: Order;
  locale: string;
  /** `ac_manage_orders`. The capability every write on this screen requires. */
  canWrite: boolean;
  /** `ac_manage_products`, for the editor's picker. Resolved on the server. */
  canPickProducts: boolean;
}) {
  const t = await getTranslations("orders.detail");
  const money = (value: string) => formatMoney(value, order.currency, locale);

  /**
   * Built once and rendered twice, so the two presentations cannot disagree
   * about which lines exist. A zero discount and a zero tax are omitted rather
   * than printed: `"0,00 DA"` on a row labelled "Remise" is a line a person has
   * to read before discovering it says nothing.
   */
  const totals: { key: string; label: string; value: string; strong?: boolean }[] = [
    { key: "subtotal", label: t("subtotal"), value: money(order.subtotal) },
    ...(order.discount_total !== "0.00"
      ? [
          {
            key: "discount",
            label: t("discount"),
            value: `−${money(order.discount_total)}`,
          },
        ]
      : []),
    { key: "shipping", label: t("shipping"), value: money(order.shipping_total) },
    ...(order.total_tax !== "0.00"
      ? [{ key: "tax", label: t("tax"), value: money(order.total_tax) }]
      : []),
    { key: "total", label: t("total"), value: money(order.total), strong: true },
  ];

  const footnote = order.is_editable ? undefined : t("editableNo");

  const edit = (
    <OrderLinesDrawer
      order={order}
      locale={locale}
      canWrite={canWrite}
      canPickProducts={canPickProducts}
    />
  );

  /*
   * An order with no lines still gets the editor, and that is the case it is
   * most needed on: 45 of the shop's 633 orders have none — measured — and
   * `{"line_items": []}` is the API's own first refusal, so the only way out of
   * an empty order is to put a line on it.
   */
  if (order.line_items.length === 0) {
    return (
      <Card title={t("items")} footnote={footnote} actions={edit}>
        <p className="text-ui-body text-ui-muted">{t("noItems")}</p>
      </Card>
    );
  }

  const head =
    "border-b border-ui-line-strong bg-ui-surface-2 px-4 py-2 text-ui-overline text-ui-muted uppercase";
  const cell = "border-b border-ui-line px-4 py-3 align-top text-ui-compact";

  return (
    <Card title={t("items")} footnote={footnote} actions={edit} flush>
      {/* ─────────────────────────────────────────── sm and up: a real table */}
      <table className="hidden w-full border-collapse sm:table">
        <thead>
          <tr>
            <th scope="col" className={`${head} text-start`}>
              {t("item")}
            </th>
            <th scope="col" className={`${head} text-end`}>
              {t("quantity")}
            </th>
            <th scope="col" className={`${head} text-end`}>
              {t("total")}
            </th>
          </tr>
        </thead>

        <tbody>
          {order.line_items.map((item) => (
            <tr key={item.id}>
              <th scope="row" className={`${cell} text-start font-medium text-ui-fg`}>
                {/* A product name is user content and may be in either script, so
                    the ellipsis has to follow the string rather than the page. */}
                <span dir="auto" className="block">
                  {item.name}
                </span>
                {item.sku ? (
                  <span className="mt-0.5 block text-ui-label font-normal text-ui-subtle">
                    {/* A SKU inside Arabic text needs its own direction. */}
                    {t("sku")} <Ltr className="break-all">{item.sku}</Ltr>
                  </span>
                ) : null}
                {/*
                  An override reads as an override.

                  `price` is `null` on a line the catalogue priced and a decimal
                  string on one somebody chose — `OrderPresenter::manualPrice()`
                  keeps the two distinguishable *even when the amounts agree*,
                  because the meta records the decision rather than the
                  difference. So this line says a person set this, and does not
                  claim to know what it was set against: the catalogue price is
                  on no route this screen calls, and inventing a comparison
                  would be worse than stating the fact alone.
                */}
                {item.price !== null ? (
                  <span className="mt-0.5 block text-ui-label font-normal text-ui-subtle">
                    {t("manualPrice")} <Ltr>{money(item.price)}</Ltr>
                  </span>
                ) : null}
              </th>
              <td className={`${cell} text-end text-ui-muted`}>
                <Ltr>{item.quantity}</Ltr>
              </td>
              <td className={`${cell} text-end text-ui-fg`}>
                <Ltr>{money(item.total)}</Ltr>
              </td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          {totals.map((line) => (
            <tr key={line.key}>
              <th
                scope="row"
                colSpan={2}
                className={`px-4 py-1.5 text-start font-normal ${
                  line.strong
                    ? "border-t border-ui-line-strong pt-2.5 text-ui-subheading text-ui-fg"
                    : "text-ui-compact text-ui-muted"
                }`}
              >
                {line.label}
              </th>
              <td
                className={`px-4 py-1.5 text-end ${
                  line.strong
                    ? "border-t border-ui-line-strong pt-2.5 text-ui-subheading text-ui-fg"
                    : "text-ui-compact text-ui-fg"
                }`}
              >
                <Ltr>{line.value}</Ltr>
              </td>
            </tr>
          ))}
        </tfoot>
      </table>

      {/* ──────────────────────────────────── below sm: the same rows, stacked */}
      <div className="sm:hidden">
        <ul className="flex flex-col">
          {order.line_items.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 flex-col gap-0.5 border-b border-ui-line px-4 py-3"
            >
              <span dir="auto" className="text-ui-compact font-medium text-ui-fg">
                {item.name}
              </span>
              {/*
                The SKU gets a line of its own and wraps into it.

                Sharing a line with the amount and truncating was the obvious
                layout and is wrong here: this catalogue has a 60-character SKU,
                so at 340px the line rendered "AC-XXXXXXXXXXXXX…" and the full
                value was reachable nowhere — §2.1 allows breaking or truncating
                *with the value still reachable*, and a phone has no hover.
              */}
              {item.sku ? (
                <span className="min-w-0 text-ui-label text-ui-subtle">
                  {t("sku")} <Ltr className="break-all">{item.sku}</Ltr>
                </span>
              ) : null}
              {/* The same override marker as the table above — see it there. */}
              {item.price !== null ? (
                <span className="min-w-0 text-ui-label text-ui-subtle">
                  {t("manualPrice")} <Ltr>{money(item.price)}</Ltr>
                </span>
              ) : null}
              <span className="flex min-w-0 items-baseline justify-between gap-2 text-ui-label text-ui-subtle">
                <Ltr>×{item.quantity}</Ltr>
                <Ltr className="shrink-0 text-ui-compact text-ui-fg">
                  {money(item.total)}
                </Ltr>
              </span>
            </li>
          ))}
        </ul>

        <dl className="flex flex-col px-4 pt-3">
          {totals.map((line) => (
            <div
              key={line.key}
              className={`flex items-baseline justify-between gap-4 py-1 ${
                line.strong ? "mt-1.5 border-t border-ui-line-strong pt-2.5" : ""
              }`}
            >
              <dt
                className={
                  line.strong
                    ? "text-ui-subheading text-ui-fg"
                    : "text-ui-label text-ui-muted"
                }
              >
                {line.label}
              </dt>
              <dd
                className={
                  line.strong
                    ? "text-ui-subheading text-ui-fg"
                    : "text-ui-compact text-ui-fg"
                }
              >
                <Ltr>{line.value}</Ltr>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}
