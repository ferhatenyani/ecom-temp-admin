import type { Address, Order, Wilaya } from "@/lib/api/schemas/order";

/**
 * The status vocabulary and the tone map live in `lib/order-status.ts`, which has
 * no dependencies — a client component importing them must not drag Zod in with
 * them. Re-exported here so a caller that already imports this module for
 * `customerName` does not need a second import.
 */
export {
  orderStatuses,
  SEGMENT_STATUSES,
  STATUS_TONE,
  candidateMoves,
  type OrderStatus,
} from "@/lib/order-status";

/**
 * Pure order logic. No JSX, no fetching — a component that knows what an order is
 * lives beside the route that renders it; the rules it needs live here so the unit
 * suite can reach them.
 */

/**
 * A person's name, from whichever block has one.
 *
 * Measured across all 633 orders: `billing.first_name` is filled on 403 and
 * `billing.last_name` on only 71, so the two are not a pair that arrives
 * together — joining them blindly yields a trailing space on 332 orders. Shipping
 * carries a name on 101 where billing sometimes does not.
 */
export function customerName(order: Order): string | null {
  for (const block of [order.billing, order.shipping] as Address[]) {
    const name = [block.first_name, block.last_name].filter((p) => p.trim() !== "").join(" ").trim();
    if (name !== "") return name;
  }
  return null;
}

/**
 * Where the order is going, when that is known at all.
 *
 * `state` holds a two-digit wilaya code when it is set — measured on 41 billing
 * and 11 shipping blocks out of 633, so ~92 % of orders have none. `city` is
 * filled on 172. When neither exists the row shows no place at all rather than an
 * em dash: a placeholder in 93 % of rows is a column of dashes, not information.
 *
 * The wilaya name comes from `/locations/wilayas`, which carries both scripts on
 * every row, so an Arabic reader gets `الجزائر` and a French reader `Alger`.
 */
export function orderPlace(
  order: Order,
  wilayasByCode: Map<string, Wilaya>,
  locale: string,
): string | null {
  for (const block of [order.shipping, order.billing] as Address[]) {
    const code = block.state.trim();
    if (code !== "") {
      const found = wilayasByCode.get(code.padStart(2, "0"));
      if (found) {
        /**
         * The preferred script first, then the other one — never an empty string.
         *
         * Measured 2026-08-18: 2 of the 69 rows carry an empty `name_ar`, and
         * they are **Algiers (16) and Oran (31)**, the two highest-traffic
         * wilayas in the country. Returning `name_ar` unconditionally therefore
         * blanked the place on exactly the orders most likely to have one. The
         * remaining 67 rows carry both, which is the control that makes this a
         * data gap rather than a wrong field name.
         */
        const preferred = locale === "ar" ? found.name_ar : found.name;
        const fallback = locale === "ar" ? found.name : found.name_ar;
        if (preferred.trim() !== "") return preferred;
        if (fallback.trim() !== "") return fallback;
      }
      // A code the geography table does not know is still better than nothing,
      // but it is not a name — fall through to the city rather than print a
      // number where a place belongs.
    }
  }
  for (const block of [order.shipping, order.billing] as Address[]) {
    if (block.city.trim() !== "") return block.city.trim();
  }
  return null;
}

/** A phone number, for the detail screen's call action. */
export function customerPhone(order: Order): string | null {
  for (const block of [order.billing, order.shipping] as Address[]) {
    if (block.phone.trim() !== "") return block.phone.trim();
  }
  return null;
}

export function itemCount(order: Order): number {
  return order.line_items.reduce((sum, item) => sum + item.quantity, 0);
}

