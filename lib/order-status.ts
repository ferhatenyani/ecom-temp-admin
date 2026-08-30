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
 * The five states an order may be **created** in.
 *
 * Not a transition — a creation, which is why this is a list and the table below
 * deliberately is not. `cancelled` and `refunded` are terminal states and the
 * API answers **409** to a create that names either, not a 400: they are real
 * statuses, they are simply not places an order can begin. `docs/API.md` →
 * Orders says so, `OrderStatus::CREATABLE` is the authority, and
 * `tests/Api/orders.php` asserts both refusals by name.
 *
 * The panel offers the five rather than offering seven and surfacing the 409,
 * which is the opposite of what `candidateMoves` below does for a *move*. The
 * asymmetry is deliberate and it is about who knows the answer: which moves are
 * legal depends on the order's current status and on rules this client would
 * have to mirror to predict, so it asks. Which statuses are creatable depends on
 * nothing at all — it is the same five every time — so a picker that offered
 * `cancelled` would be offering a choice that is always wrong.
 */
export const CREATABLE_STATUSES = [
  "pending",
  "processing",
  "on-hold",
  "completed",
  "failed",
] as const satisfies readonly OrderStatus[];

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
