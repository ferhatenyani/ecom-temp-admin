import { z } from "zod";
import { ALL_REASONS } from "@/lib/movement-reason";
import { STOCK_STATUSES } from "@/lib/product-status";

/**
 * Shapes measured against the live API on 2026-08-18, not remembered.
 *
 * `GET /inventory`, `/inventory/{id}`, `/inventory/low-stock` and
 * `/inventory/lookup` all return the **same** item — verified by comparing the
 * key sets across all 33 rows of `?include_variations=true` and against both
 * single-item routes. One schema serves all four, as it did for orders and for
 * products.
 */

/**
 * `backorders` is not in docs/ADMIN_PANEL.md's description of a row and is on
 * every one of them. It decides whether an adjustment may drive stock negative,
 * which is the difference between a 200 and a 409, so the panel reads it.
 */
export const BACKORDERS = ["no", "notify", "yes"] as const;
export type Backorders = (typeof BACKORDERS)[number];

/**
 * An inventory row.
 *
 * **Three stock flags that disagree on purpose**, and the disagreement is the
 * information:
 *
 *   manage_stock         WooCommerce's raw value. `true`, `false` — or the
 *                        *string* `"parent"` for a variation inheriting its
 *                        parent's stock. Hence `z.union`, not `z.boolean()`.
 *   managing_stock       the plain yes/no, which also folds in the store-wide
 *                        switch. This is the one that decides whether a quantity
 *                        exists at all.
 *   stock_managed_by_id  whose shelf actually moves. See `adjustTarget()`.
 *
 * Measured across all 33 rows today: `manage_stock` is boolean everywhere and
 * `stock_managed_by_id` equals `id` everywhere, because no variation in this shop
 * currently inherits. The union and the indirection are still both here, because
 * `InventoryPresenter` emits the string form and `StockLedger::stockManagedId()`
 * is what the backend writes movements against — a shop one settings toggle away
 * from producing rows this schema would otherwise reject at the boundary.
 */
export const inventoryItem = z.looseObject({
  id: z.number(),
  /** `0` for a top-level product; the parent's id for a variation. */
  parent_id: z.number(),
  type: z.string(),
  name: z.string(),
  /** `""` is possible — a product need not carry a SKU. */
  sku: z.string(),
  manage_stock: z.union([z.boolean(), z.literal("parent")]),
  managing_stock: z.boolean(),
  stock_managed_by_id: z.number(),
  /**
   * **`null` is not zero.** Measured: 8 of the 28 top-level rows are `null` —
   * untracked — and rendering both as `0` is what gets someone to reorder
   * something they already have. Every consumer goes through
   * `displayQuantity()`, which keeps the two apart by type.
   */
  stock_quantity: z.number().nullable(),
  stock_status: z.enum(STOCK_STATUSES),
  backorders: z.enum(BACKORDERS),
  /**
   * **Per product, not global.** Measured 2 on 27 rows and 5 on "Miel de
   * jujubier" — so there is no shop-wide threshold to display anywhere, and a
   * row's own figure is the only honest one to put beside it.
   */
  low_stock_amount: z.number(),
  low_stock: z.boolean(),
});
export type InventoryItem = z.infer<typeof inventoryItem>;

export const inventoryList = z.array(inventoryItem);

/**
 * One ledger row.
 *
 * `quantity_before + delta === quantity_after` is an invariant the backend
 * enforces at construction, which is why the row can be rendered as an arrow
 * between two numbers rather than as a delta the reader has to apply.
 *
 * `created_at` has **no UTC offset** — `"2026-08-18 10:29:37"` — exactly like
 * `notes[].created_at` on an order and unlike `order.date_created`. `new Date()`
 * reads that as local time and shifts it silently; `parseApiDate()` in
 * lib/format/date.ts is the only thing that may touch it.
 */
export const movement = z.looseObject({
  id: z.number(),
  /**
   * The id whose shelf moved — `stock_managed_by_id`, not necessarily the row a
   * person tapped. **It is not necessarily a product that still exists**:
   * measured, the ledger names 155 distinct product ids and only 23 of them
   * appear in `/inventory` at all, the rest being fixtures the backend's own
   * suites have since deleted. A ledger is an archive and a catalogue is not, so
   * the row renders its id and never assumes a name can be found for it.
   */
  product_id: z.number(),
  delta: z.number(),
  quantity_before: z.number(),
  quantity_after: z.number(),
  /** Nine possible values; only six of them can have come from a person. */
  reason: z.enum(ALL_REASONS),
  note: z.string(),
  /** `0` when no order caused this. 692 of 1154 rows carry a real one. */
  order_id: z.number(),
  /**
   * **A bare integer, and for most roles it stays one.** `GET /users/{id}`
   * resolves it to a name for a Super Admin and answers **403** to an Admin, a
   * Manager and a Product Manager — measured, all four roles. So the ledger
   * cannot show a name, and `movementActor()` in lib/inventory.ts is what the row
   * renders instead. Rendering the integer itself is not an answer.
   */
  actor_id: z.number(),
  created_at: z.string(),
});
export type Movement = z.infer<typeof movement>;

export const movementList = z.array(movement);

/**
 * `GET /inventory/movements/summary` — an object keyed by reason, **not** a list,
 * and it omits every reason with no rows. Two of the six choosable reasons are
 * absent today for exactly that reason, which is why the legend is built from
 * `ALL_REASONS` and this only supplies the numbers.
 */
export const movementSummary = z.record(
  z.string(),
  z.looseObject({ net: z.number(), movements: z.number() }),
);
export type MovementSummary = z.infer<typeof movementSummary>;

/**
 * `POST /inventory/{id}/adjust` answers with the item *and* the movement it
 * wrote, so the screen never has to re-read to show the result.
 *
 * The movement here is `InventoryMovement::toArray()`, which omits `id` — the
 * ledger's own rows carry one and this does not. Hence `.omit`, rather than
 * pretending the two are the same shape.
 */
export const adjustResult = z.looseObject({
  item: inventoryItem,
  movement: movement.omit({ id: true }),
});
export type AdjustResult = z.infer<typeof adjustResult>;
