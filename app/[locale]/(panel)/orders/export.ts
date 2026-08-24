import type { Order } from "@/lib/api/schemas/order";
import { orderPlace } from "@/lib/orders";
import { csvCell as cell, csvDocument } from "@/lib/csv";
import { displayName, type OrderColumnContext } from "./columns";

/**
 * Export the selected rows, client-side.
 *
 * The quoting, the CRLF and the download live in `lib/csv.ts` — they are
 * mechanical, they are identical on every list screen, and the products branch
 * was the second caller. What stays here is the part that is *not* mechanical:
 * which columns an order exports and in what form, which mirrors this screen's
 * own column definition and belongs beside it.
 *
 * `lib/csv.ts` carries the argument for building this in the browser at all
 * rather than through `/api/export/orders`.
 */

export function toCsv(
  orders: Order[],
  ctx: OrderColumnContext,
  headers: { name: string; status: string },
): string {
  const { locale, wilayasByCode } = ctx;

  const columns = [
    "number",
    headers.name,
    "place",
    "items",
    "payment",
    "created",
    "total",
    "currency",
    headers.status,
  ];

  return csvDocument([
    columns.map(cell),
    ...orders.map((order) => [
      cell(order.number),
      cell(displayName(order, ctx)),
      cell(orderPlace(order, wilayasByCode, locale) ?? ""),
      cell(order.line_items.length),
      cell(order.payment_method_title || order.payment_method),
      cell(order.date_created),
      /* The raw decimal, not the formatted string. A French locale renders
         4 200,00 with a comma that a spreadsheet then reads as a delimiter,
         and the point of an export is that something else can parse it. */
      cell(order.total),
      cell(order.currency),
      cell(order.status),
    ]),
  ]);
}
