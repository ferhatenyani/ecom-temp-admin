/**
 * The one request this screen makes that is not the item itself.
 *
 * It lives in its own module — rather than as a constant exported from
 * `ItemDetail.tsx` — because that file is `"use client"`, and **every export of a
 * client module is a client *reference*, not a value.** A Server Component
 * importing a number from one gets an opaque proxy: it interpolated into the
 * request as `[object Object]`, the API read an unparseable `per_page` and fell
 * back to its own default, and the item's ledger card quietly rendered nine rows
 * where the screen asks for five. Nothing errored, and the client query that would
 * have corrected it never ran — `QueryProvider` sets `staleTime: 15_000`, so
 * seeded data is fresh on mount.
 *
 * Both sides import from here, so the seed and the refetch cannot disagree about
 * which shelf or how many rows.
 */

/**
 * Five, and it is a *card* rather than a page: the whole ledger for this shelf is
 * one link away in the header. Enough to see the last few things that happened
 * without turning the detail screen into the ledger screen.
 */
export const ITEM_LEDGER_ROWS = 5;

/**
 * **`target` is `adjustTarget(item)`, never the id in the URL.**
 *
 * `lib/inventory.ts:24-27`: `stock_managed_by_id` is the id the backend writes the
 * movement against — `StockLedger::stockManagedId()` — "so a ledger filtered by
 * the tapped id would come back empty while the stock demonstrably moved". Taking
 * the target as the argument rather than the item is what makes that impossible to
 * get wrong from either side.
 */
export function itemMovementsPath(target: number): string {
  return `/inventory/movements?product_id=${target}&per_page=${ITEM_LEDGER_ROWS}`;
}
