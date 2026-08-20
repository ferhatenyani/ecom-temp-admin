import type { CodStatistics } from "@/lib/api/schemas/payment";

/**
 * The COD statistics report, with every figure carrying its own scope.
 *
 * Types only from the schema module, so this file stays importable from a client
 * component without dragging Zod along.
 */

/**
 * A figure that cannot be printed without saying what it counts.
 *
 * This is `lib/customers.ts`'s `StatFigure` applied to the same failure in a new
 * place, and the failure is worth restating because this payload is the clearest
 * example of it in the whole API:
 *
 * **`by_status.confirmed` is 74 and `confirmed_orders` is 111, in one response.**
 * Measured 2026-08-20. Both are correct and they answer different questions —
 * `by_status` sums exactly to `total_orders` (192 + 74 + 37 + 0 + 224 = 527) and
 * describes the shop *now*, while `confirmed_orders` is what `rates.confirmation`
 * divides by 527 to reach `0.2106`, so it counts every order that was **ever**
 * confirmed, including the 224 later cancelled.
 *
 * Put 74 and 111 next to each other unlabelled and the reader concludes one is
 * broken. So `scope` is not optional and there is no constructor that omits it.
 */
export type CodFigure = {
  key:
    | "total_orders"
    | "current_confirmed"
    | "ever_confirmed"
    | "delivered_orders"
    | "returned_orders";
  /**
   * `now` is the shop's current state and sums to `total_orders`.
   * `ever` counts orders that reached a state at any point and does not.
   */
  scope: "all" | "now" | "ever";
  value: number;
};

export function codFigures(statistics: CodStatistics): CodFigure[] {
  return [
    { key: "total_orders", scope: "all", value: statistics.total_orders },
    {
      key: "current_confirmed",
      scope: "now",
      value: statistics.by_status.confirmed ?? 0,
    },
    { key: "ever_confirmed", scope: "ever", value: statistics.confirmed_orders },
    { key: "delivered_orders", scope: "ever", value: statistics.delivered_orders },
    { key: "returned_orders", scope: "ever", value: statistics.returned_orders },
  ];
}

/**
 * The status breakdown, zeros dropped, in the shop's own order.
 *
 * Same treatment as the customer report's `by_status`: the sum is the property
 * worth keeping and it survives dropping the zeros. Measured on this shop,
 * `unreachable` is 0 while the other four are not, so one row goes.
 *
 * The sum is what explains the gap between the two confirmed counts, which is why
 * it is on the screen rather than behind a tap.
 */
export type CodStatusCount = { status: string; count: number };

export function codByStatus(statistics: CodStatistics): CodStatusCount[] {
  const order = ["pending", "confirmed", "rejected", "unreachable", "cancelled"];
  const entries = Object.entries(statistics.by_status);

  return entries
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
    })
    .map(([status, count]) => ({ status, count }));
}

/** Whether `by_status` accounts for every order, which is what makes it explanatory. */
export function byStatusSumsToTotal(statistics: CodStatistics): boolean {
  const sum = Object.values(statistics.by_status).reduce((total, n) => total + n, 0);
  return sum === statistics.total_orders;
}

/**
 * A rate, as a percentage string ready for `Intl`.
 *
 * The API sends `"0.2106"` — a decimal string, like money, and parsed here only
 * because a percentage is displayed and never summed. A rate that does not parse
 * returns null rather than `NaN`, which would render as "NaN %".
 */
export function ratePercent(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * What each published rate divides by, so the card can say so.
 *
 * All five divide by `total_orders` — verified against `confirmation`:
 * 111 / 527 = 0.2106. Naming the denominator is the same discipline as
 * `CodFigure.scope`; a rate whose base is unstated is a rate someone will quote
 * against the wrong population.
 */
export const RATE_KEYS = [
  "confirmation",
  "rejection",
  "cancellation",
  "delivery",
  "return",
] as const;
export type RateKey = (typeof RATE_KEYS)[number];
