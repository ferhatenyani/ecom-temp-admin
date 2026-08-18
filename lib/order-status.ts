/**
 * The order status vocabulary, with no dependencies at all — and that emptiness is
 * the point.
 *
 * This tuple used to live in `lib/api/schemas/order.ts` beside the Zod schema that
 * validates it. `StatusAction` is a client component and needs the *values* to
 * offer the moves, so importing them from there pulled Zod's entire runtime into
 * the orders route: measured 63 KB gzipped, on a 180 KB budget, to ship a list of
 * seven strings.
 *
 * The schema imports these; nothing imports the schema to get them.
 */

export const orderStatuses = [
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

/**
 * The semantic role each status plays. Colour is never the only signal, so every
 * consumer pairs this with a translated word.
 */
export const STATUS_TONE: Record<
  OrderStatus,
  "neutral" | "info" | "warning" | "success" | "danger"
> = {
  pending: "warning",
  processing: "info",
  "on-hold": "warning",
  completed: "success",
  cancelled: "neutral",
  refunded: "neutral",
  failed: "danger",
};

/**
 * The statuses worth a segment, measured against the live order book: pending 204,
 * processing 63, completed 35, cancelled 266, refunded 63, failed 1, on-hold 1.
 * `failed` and `on-hold` are one row each, so they belong in the filter sheet
 * rather than spending a quarter of the control's width.
 *
 * `?status=` takes exactly one value — a comma list is a 400 — so this drives a
 * single-select control.
 */
export const SEGMENT_STATUSES = ["pending", "processing", "completed"] as const;

/**
 * The transition table is deliberately **not** here: the API is the authority and
 * it tells you. The panel offers every other status and renders the 409's
 * `details.allowed` when one is refused.
 */
export function candidateMoves(
  current: OrderStatus,
  all: readonly OrderStatus[] = orderStatuses,
): OrderStatus[] {
  return all.filter((s) => s !== current);
}
