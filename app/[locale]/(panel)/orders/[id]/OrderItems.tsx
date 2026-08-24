import { getTranslations } from "next-intl/server";
import type { Order } from "@/lib/api/schemas/order";
import { formatMoney } from "@/lib/format/money";
import { Ltr } from "@/components/primitives/Ltr";
import { Card } from "@/components/ui/Card";

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
 * ## No line-item editor, and no sentence about it either
 *
 * `is_editable` is real and `ADMIN_PANEL.md:1473` specifies the behaviour, but
 * the `PATCH /orders/{id}` line-items contract has never been measured against
 * the live API. Unverified is treated as not working: shipping an editor whose
 * write shape is a guess would put the shop's order book at risk to save a
 * support agent a phone call. **That reasoning lives here and nowhere on
 * screen.** A footnote explaining that a write contract was never measured is
 * engineering rationale in front of a shopkeeper, who has no idea what one is.
 *
 * So the footnote renders only when `is_editable` is false, and says only the
 * part that is a fact about *their* order: the stock has moved, so the lines are
 * fixed. When it is true there is no disabled affordance to explain and nothing
 * worth saying — "the items are still editable" beside no editor is worse than
 * silence.
 */
export async function OrderItems({
  order,
  locale,
}: {
  order: Order;
  locale: string;
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

  if (order.line_items.length === 0) {
    return (
      <Card title={t("items")} footnote={footnote}>
        <p className="text-ui-body text-ui-muted">{t("noItems")}</p>
      </Card>
    );
  }

  const head =
    "border-b border-ui-line-strong bg-ui-surface-2 px-4 py-2 text-ui-overline text-ui-muted uppercase";
  const cell = "border-b border-ui-line px-4 py-3 align-top text-ui-compact";

  return (
    <Card title={t("items")} footnote={footnote} flush>
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
