import { acRead } from "@/lib/api/browser";
import type { Order } from "@/lib/api/schemas/order";

/**
 * Filter state lives in the URL: a support agent shares a link to the orders they
 * are looking at, a refresh does not lose the filter, and the back button works.
 * It is also what makes the RSC/Query split coherent — the server reads the same
 * search params the client writes.
 *
 * `per_page` caps at 100. 20 is the API's default and the right size for a phone.
 */
export const PER_PAGE = 20;

export type OrdersQuery = {
  /**
   * One status, never a list. Measured 2026-08-18:
   * `?status=processing,pending` answers 400 — `status is not one of pending,
   * processing, on-hold, completed, cancelled, refunded, failed`. So the
   * segmented control is single-select because the API is.
   */
  status: string;
  search: string;
  page: number;
};

/** The query key mirrors the URL, so the two can never disagree. */
export function ordersKey(query: OrdersQuery) {
  return ["orders", { status: query.status, search: query.search, page: query.page }] as const;
}

export type OrdersPage = { orders: Order[]; total: number };

/**
 * Reads go through the proxy, which attaches the credential server-side. The
 * browser never sees one.
 *
 * `acRead` rather than a hand-rolled reader. This module carried its own from the
 * orders branch until the analytics branch swept it, and the copy had drifted in
 * one measurable way: it read `body.error.message` and nothing else, so
 * `?per_page=500` put *"Invalid parameter(s): per_page"* on screen while the API
 * had actually said *"per_page must be between 1 (inclusive) and 100
 * (inclusive)"* under `details.params`. The list rendered the half that names the
 * parameter and dropped the half that says what to do about it.
 *
 * It also threw a bare `Error` with `status` and `code` glued on by
 * `Object.assign`, which type-checked and told a caller nothing —
 * `BrowserApiError` keeps `status`, `code`, `details` and `fields` as real
 * properties.
 */
export async function fetchOrders(query: OrdersQuery): Promise<OrdersPage> {
  const params = new URLSearchParams({
    per_page: String(PER_PAGE),
    page: String(query.page),
  });
  if (query.status) params.set("status", query.status);
  if (query.search) params.set("search", query.search);

  const { data, total } = await acRead<Order[]>(`/orders?${params}`);
  return { orders: data, total };
}
