import type { InventoryItem, Movement } from "@/lib/api/schemas/inventory";
import { SYSTEM_REASONS } from "@/lib/movement-reason";

/**
 * What a stock row and a ledger row need to know, in one place.
 *
 * Types only from the schema module — `import type` is erased, so this file stays
 * importable from a client component without dragging Zod along, the same
 * arrangement `lib/products.ts` uses.
 */

/* ------------------------------------------------------ what to adjust --- */

/**
 * The id an adjustment must be sent to.
 *
 * **Not the id of the row that was tapped.** A variation can have its stock
 * managed by its parent — WooCommerce reports that as `manage_stock: "parent"`
 * and decrements the parent's shelf — and `stock_managed_by_id` names whoever
 * actually holds the quantity. `POST /inventory/{variation}/adjust` in that state
 * answers **409** (`This product does not manage stock`) or, worse on a shop
 * where both track, moves the wrong shelf.
 *
 * It is also the id the backend writes the *movement* against —
 * `StockLedger::stockManagedId()` — so a ledger filtered by the tapped id would
 * come back empty while the stock demonstrably moved.
 *
 * Measured 2026-08-18: every one of the 33 rows in this shop reports
 * `stock_managed_by_id === id`, so the indirection is invisible today and would
 * be invisible right up until someone sets a variable product to track stock at
 * the parent. That is precisely why it is a function and not an assumption.
 */
export function adjustTarget(item: InventoryItem): number {
  return item.stock_managed_by_id > 0 ? item.stock_managed_by_id : item.id;
}

/** True when the row's own quantity lives somewhere else. */
export function isDelegated(item: InventoryItem): boolean {
  return adjustTarget(item) !== item.id;
}

/**
 * Whether this row can be adjusted at all, and why not when it cannot.
 *
 * `managing_stock` is the flag that decides it — not `manage_stock`, which is
 * `"parent"` in the one case where the raw value and the truth disagree. A
 * variable parent that delegates to its variations reports `false` here and
 * answers 409 to an adjustment, which is the state 8 of the 28 top-level rows are
 * in right now.
 */
export function canAdjust(item: InventoryItem): boolean {
  return item.managing_stock;
}

/* --------------------------------------------------------- the quantity --- */

/**
 * A quantity, or the fact that there isn't one.
 *
 * **`null` and `0` are different facts** — "not tracked" and "none left" — and
 * collapsing them is the defect this type exists to make impossible. Measured: 8
 * of 28 rows are `null`. A list that prints `0` down a third of its rows is
 * telling a person in a stockroom that they are out of eight things they have on
 * the shelf behind them.
 *
 * Returned as a discriminated union rather than `number | null` so a caller
 * cannot reach the number without having said which case they are in.
 */
export type Quantity =
  | { tracked: false }
  | { tracked: true; value: number; low: boolean; threshold: number };

export function displayQuantity(item: InventoryItem): Quantity {
  if (!item.managing_stock || item.stock_quantity === null) return { tracked: false };
  return {
    tracked: true,
    value: item.stock_quantity,
    low: item.low_stock,
    threshold: item.low_stock_amount,
  };
}

/* -------------------------------------------------------------- the name --- */

/**
 * A row's name, split into the product and the variation it identifies.
 *
 * **Variations arrive with a doubled name**: `"Burnous en laine - L — L"`.
 * WooCommerce's own `get_name()` already formats a variation as
 * `"Parent - value"`, and `InventoryPresenter::name()` then appends
 * `" — " + combination` so a stock list of a variable product does not read as
 * the same row four times. Both halves are right on their own; together they
 * stutter.
 *
 * Products solved the equivalent problem with `variationLabel()`, which resolves
 * a variation's stored attribute values against its parent's option list. That is
 * not available here: an inventory row carries no attributes and no parent
 * object, only the composed string. So this undoes the composition instead —
 * split at the last `" — "`, and drop the `" - value"` tail from the left half
 * when it repeats the right one.
 *
 * Gated on `type === "variation"` rather than applied to every name, because a
 * simple product is perfectly entitled to an em-dash in its title and splitting
 * one would invent a variant that does not exist.
 */
export function itemLabel(item: InventoryItem): { product: string; variant: string | null } {
  if (item.type !== "variation") return { product: item.name, variant: null };

  const at = item.name.lastIndexOf(" — ");
  if (at === -1) return { product: item.name, variant: null };

  const base = item.name.slice(0, at);
  const variant = item.name.slice(at + 3);

  // The stutter itself: "Burnous en laine - L" ending in the same "L".
  const tail = ` - ${variant}`;
  const stutters = base.toLowerCase().endsWith(tail.toLowerCase());

  return {
    product: stutters ? base.slice(0, base.length - tail.length) : base,
    variant,
  };
}

/* ---------------------------------------------------------------- who --- */

/**
 * Who moved the stock, as far as anything reachable can actually say.
 *
 * docs/ADMIN_PANEL.md says "the ledger shows who, when, how much and why". The
 * *who* is not buildable as a name, and this is the measurement that settles it
 * (2026-08-18, all four roles holding `ac_manage_inventory`):
 *
 *   GET /users/{id}   Super Admin 200 · Admin 403 · Manager 403 · Product Mgr 403
 *   GET /audit-logs   Super Admin 200 · Admin 200 · Manager 403 · Product Mgr 403
 *
 * A movement carries `actor_id: 475` and no name. `/users/{id}` is the only route
 * that resolves one and three of the four roles cannot call it. `/audit-logs`
 * carries `actor_login` and is reachable by one more role, but it holds no
 * movement id — joining would be a heuristic on product, before, after and a
 * timestamp — and it only records `inventory.adjusted` and
 * `inventory.settings_updated`: 13 rows against the ledger's 1154. Neither is a
 * general answer, and a ledger that reads differently depending on who opens it
 * is worse than one that reads the same for everyone.
 *
 * So the row says what it can prove, from the movement itself plus the signed-in
 * identity the panel already holds:
 *
 *   order       an order moved it, and the order number is a real referent the
 *               reader can open — 692 of 1154 rows
 *   you         `actor_id` matches `/auth/me`
 *   colleague   another staff account did it; the reason says what they did
 *   unknown     `actor_id` is 0, which is what the ledger stores when no user was
 *               signed in — a CLI import, for instance
 *
 * A bare numeric id is not among them. `?actor_id=` *does* filter the ledger
 * (verified: 1154 → 16), so identity survives as something you can pivot on even
 * though it cannot be printed, and the ledger offers "mine only" on that.
 */
export type Actor =
  | { kind: "order"; orderId: number }
  | { kind: "you" }
  | { kind: "colleague" }
  | { kind: "unknown" };

const ORDER_REASONS: readonly string[] = ["order_reduced", "order_restored"];

export function movementActor(movement: Movement, meId: number | null): Actor {
  // An order-driven movement is the shop working, not a person deciding, even
  // though `actor_id` holds whoever happened to be signed in when the status
  // changed — which for a storefront checkout is the customer.
  if (ORDER_REASONS.includes(movement.reason) && movement.order_id > 0) {
    return { kind: "order", orderId: movement.order_id };
  }
  if (movement.actor_id === 0) return { kind: "unknown" };
  if (meId !== null && movement.actor_id === meId) return { kind: "you" };
  return { kind: "colleague" };
}

/**
 * `product_edit` is deliberately **not** in `ORDER_REASONS` above.
 *
 * It is grouped with the system reasons at the API — a person may not choose it —
 * but it is still caused by a human, through the product form on another screen.
 * Attributing it to "the shop" would hide the fact that someone changed a
 * quantity outside the ledger's own front door, which is the single thing that
 * reason exists to reveal. It renders as you or a colleague, like any other
 * person's move.
 */
export const SYSTEM_WRITTEN: readonly string[] = SYSTEM_REASONS;
