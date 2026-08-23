import type { Order } from "@/lib/api/schemas/order";
import { orderPlace } from "@/lib/orders";
import { displayName, type OrderColumnContext } from "./columns";

/**
 * Export the selected rows, client-side.
 *
 * **Why not `/api/export/orders`.** That route exists and is the right thing for
 * "export everything" — the browser navigates to it, the server attaches the
 * Application Password, and the credential never enters the document. But it
 * forwards **only** `limit` and drops every other query parameter, deliberately:
 * its docblock records that the export routes sit off the proxy allowlist and
 * that forwarding an arbitrary query string would make the route a wider surface
 * than the screen it serves. There is no way to ask it for a specific set of ids,
 * and widening a deliberately narrow security boundary to save a convenience is
 * the wrong trade.
 *
 * So a selection export is built here, from rows already in memory. It costs no
 * request, it cannot leak a credential, and the data is exactly what the person
 * is looking at. The whole-catalogue export button in the page header still goes
 * through the server route, where it belongs.
 */

/**
 * RFC 4180 quoting. Every field is quoted unconditionally rather than
 * conditionally — conditional quoting is where CSV writers get it wrong, and an
 * always-quoted field is valid for every value including empty ones.
 *
 * The doubled quote is the escape: `He said "hi"` becomes `"He said ""hi"""`.
 */
function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

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

  const lines = [
    columns.map(cell).join(","),
    ...orders.map((order) =>
      [
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
      ].join(","),
    ),
  ];

  /*
   * CRLF, because RFC 4180 says so and because Excel on Windows is the
   * overwhelmingly likely consumer here.
   */
  return lines.join("\r\n");
}

/**
 * Hand the file to the browser.
 *
 * The BOM is not decoration: without it Excel reads a UTF-8 CSV as the system
 * codepage, and every Arabic name and every accented French one arrives as
 * mojibake. The server export route prepends the same bytes for the same reason.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  /* Revoked on the next frame rather than synchronously — Safari has been
     observed to cancel an in-flight download when the object URL is released
     in the same tick as the click. */
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
