import type { Product } from "@/lib/api/schemas/product";
import { effectivePrice, stockQuantity } from "@/lib/products";
import { csvCell as cell, csvDocument } from "@/lib/csv";
import type { ProductColumnContext } from "./columns";

/**
 * Export the selected rows, client-side.
 *
 * The quoting, the CRLF and the download live in `lib/csv.ts`, which also carries
 * the argument for building this in the browser rather than through
 * `/api/export/products`. What is here is the part that is editorial: which
 * columns a product exports, and in what form.
 *
 * **This is the only bulk operation on the screen, and that is a measurement
 * rather than a gap.** `POST /products/bulk` does not exist in any verifiable
 * form — one word in one shorthand list in `docs/ADMIN_PANEL.md`, with no verb,
 * no body, no response shape and nothing measured against the live router — and
 * both `lib/api/allowlist.ts` and `tests/boundary.test.ts` assert it must stay
 * unreachable. A bulk *write* built on that would be a guess with a confirm
 * dialog in front of it.
 */
export function toCsv(
  products: Product[],
  ctx: ProductColumnContext,
  headers: { name: string; status: string; stock: string; price: string },
): string {
  const columns = [
    "id",
    headers.name,
    "sku",
    headers.status,
    "type",
    headers.stock,
    "stock_status",
    headers.price,
    "regular_price",
    "sale_price",
    "currency",
    "created",
  ];

  return csvDocument([
    columns.map(cell),
    ...products.map((product) => [
      cell(product.id),
      cell(product.name),
      cell(product.sku),
      cell(product.status),
      cell(product.type),
      /* Empty rather than 0 when the product does not manage stock — 8 of 28 do
         not, and a zero here is a claim the shop never made. */
      cell(stockQuantity(product)),
      cell(product.stock_status),
      /* The raw decimal, not the formatted string. A French locale renders
         4 200,00 with a comma that a spreadsheet then reads as a delimiter, and
         the point of an export is that something else can parse it. */
      cell(effectivePrice(product)),
      cell(product.regular_price),
      cell(product.sale_price),
      cell(ctx.currency),
      cell(product.date_created),
    ]),
  ]);
}
