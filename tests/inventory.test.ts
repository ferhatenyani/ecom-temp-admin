/**
 * @vitest-environment node
 *
 * The inventory logic that carries a measurement. Every case here corresponds to
 * something observed against the live API on 2026-08-18, and the comments name
 * which observation.
 */
import { describe, expect, it } from "vitest";
import {
  ALL_REASONS,
  ADJUST_MODES,
  MANUAL_REASONS,
  SYSTEM_REASONS,
  isKnownReason,
  isManualReason,
  projectQuantity,
  quantityProblem,
} from "@/lib/movement-reason";
import {
  adjustTarget,
  canAdjust,
  displayQuantity,
  isDelegated,
  itemLabel,
  movementActor,
} from "@/lib/inventory";
import type { InventoryItem, Movement } from "@/lib/api/schemas/inventory";

/** A row with the shape the API actually sends, overridable per case. */
function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 20,
    parent_id: 0,
    type: "simple",
    name: "Miel de jujubier, 500 g",
    sku: "AC-EPI-009",
    manage_stock: true,
    managing_stock: true,
    stock_managed_by_id: 20,
    stock_quantity: 3,
    stock_status: "instock",
    backorders: "no",
    low_stock_amount: 5,
    low_stock: true,
    ...overrides,
  };
}

function movement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 1153,
    product_id: 20,
    delta: 2,
    quantity_before: 3,
    quantity_after: 5,
    reason: "restock",
    note: "",
    order_id: 0,
    actor_id: 514,
    created_at: "2026-08-18 11:06:12",
    ...overrides,
  };
}

describe("the reason vocabulary", () => {
  /**
   * The measurement this module exists for. `POST /adjust` accepts six;
   * `/movements/summary` returned seven; the two sets are neither equal nor
   * nested, and the union is nine.
   */
  it("is the union of two endpoints, neither of which is complete", () => {
    expect(MANUAL_REASONS).toHaveLength(6);
    expect(SYSTEM_REASONS).toHaveLength(3);
    expect(ALL_REASONS).toHaveLength(9);

    // The three the summary reports that a person may never send.
    for (const reason of ["order_reduced", "order_restored", "product_edit"]) {
      expect(isKnownReason(reason)).toBe(true);
      expect(isManualReason(reason)).toBe(false);
    }

    // The two a person may send that the summary omits, because this shop has no
    // movements carrying them — a picker built from the summary loses both.
    for (const reason of ["customer_return", "other"]) {
      expect(isManualReason(reason)).toBe(true);
    }

    // Positive control: a reason that is in neither set is in neither predicate.
    expect(isKnownReason("stocktake")).toBe(false);
    expect(isManualReason("stocktake")).toBe(false);
  });
});

describe("the adjustment arithmetic", () => {
  it("projects the same shelf figure whichever mode states it", () => {
    // 3 on the shelf. All three modes reach 5, and none of them asks the person
    // to work out how.
    expect(projectQuantity("set", 5, 3)).toBe(5);
    expect(projectQuantity("increase", 2, 3)).toBe(5);
    expect(projectQuantity("decrease", 2, 3)).toBe(1);
    expect(ADJUST_MODES).toEqual(["set", "increase", "decrease"]);
  });

  it("refuses the values the API refuses, and only those", () => {
    // Measured 400s, each one reproduced here so the field can say it first.
    expect(quantityProblem("set", "")).toBe("required");
    expect(quantityProblem("set", "2.5")).toBe("whole");
    expect(quantityProblem("set", "-1")).toBe("negative");
    // "Must be greater than zero for increase." — a zero-magnitude relative move
    // is a no-op that would still write a ledger row.
    expect(quantityProblem("increase", "0")).toBe("positive");
    expect(quantityProblem("decrease", "0")).toBe("positive");

    // Setting a shelf to zero is a real thing to record, and the API allows it.
    expect(quantityProblem("set", "0")).toBeNull();
    expect(quantityProblem("increase", "1")).toBeNull();
    expect(quantityProblem("decrease", "99")).toBeNull();
  });
});

describe("the adjustment target", () => {
  it("is the id that manages the stock, not the row that was tapped", () => {
    // Every row in this shop today reports the two as equal, which is why this
    // is a function rather than an assumption — a variation delegating to its
    // parent is one settings toggle away.
    expect(adjustTarget(item())).toBe(20);
    expect(isDelegated(item())).toBe(false);

    const delegated = item({ id: 15, parent_id: 12, type: "variation", stock_managed_by_id: 12 });
    expect(adjustTarget(delegated)).toBe(12);
    expect(isDelegated(delegated)).toBe(true);
  });

  it("falls back to the row's own id when the API reports no manager", () => {
    expect(adjustTarget(item({ stock_managed_by_id: 0 }))).toBe(20);
  });

  it("reads `managing_stock` and not `manage_stock` to decide adjustability", () => {
    // The one case where the raw value and the truth disagree: WooCommerce
    // reports an inheriting variation as the *string* "parent".
    expect(canAdjust(item({ manage_stock: "parent", managing_stock: true }))).toBe(true);
    // Measured on product 12, a variable parent: adjusting it is a 409.
    expect(canAdjust(item({ manage_stock: false, managing_stock: false }))).toBe(false);
  });
});

describe("the quantity", () => {
  /**
   * The one that matters most on screen. 8 of the 28 top-level rows carry
   * `null`, and rendering those as `0` tells someone in a stockroom they are out
   * of eight things they have.
   */
  it("keeps null and zero apart", () => {
    const untracked = displayQuantity(
      item({ managing_stock: false, manage_stock: false, stock_quantity: null }),
    );
    expect(untracked.tracked).toBe(false);

    // Measured on product 26, "Plateau en bois d'olivier": a genuine zero, and
    // it is on the low-stock report — so the report contains a 0 even though it
    // never contains a null.
    const none = displayQuantity(item({ stock_quantity: 0, low_stock: true }));
    expect(none).toEqual({ tracked: true, value: 0, low: true, threshold: 5 });
  });

  it("treats a quantity on a product that is not managing stock as untracked", () => {
    // A stale quantity can survive `manage_stock` being switched off. The flag
    // is the authority, not the number beside it.
    expect(displayQuantity(item({ managing_stock: false })).tracked).toBe(false);
  });

  it("carries the row's own threshold, because there is no global one", () => {
    // Measured: 2 on 27 rows and 5 on one. There is no shop-wide figure to show.
    const q = displayQuantity(item({ low_stock_amount: 2 }));
    expect(q.tracked && q.threshold).toBe(2);
  });
});

describe("the doubled variation name", () => {
  /** Measured verbatim: `GET /inventory/15` answers `"Burnous en laine - L — L"`. */
  it("undoes the API's own composition", () => {
    expect(
      itemLabel(item({ type: "variation", name: "Burnous en laine - L — L" })),
    ).toEqual({ product: "Burnous en laine", variant: "L" });
  });

  it("keeps a tail that is not a repetition", () => {
    // The presenter joins several attribute values with ", ". Only the half that
    // actually repeats is removed.
    expect(
      itemLabel(item({ type: "variation", name: "Fibule kabyle - Argent — Argent, Grand" })),
    ).toEqual({ product: "Fibule kabyle - Argent", variant: "Argent, Grand" });
  });

  it("leaves a simple product's em-dash alone", () => {
    // The gate that stops this inventing a variant. A simple product is entitled
    // to an em-dash in its own title.
    expect(itemLabel(item({ type: "simple", name: "Tapis — grand format" }))).toEqual({
      product: "Tapis — grand format",
      variant: null,
    });
  });

  it("handles a variation the presenter appended nothing to", () => {
    // Empty attribute values mean "any" and the presenter omits the suffix.
    expect(itemLabel(item({ type: "variation", name: "Burnous en laine" }))).toEqual({
      product: "Burnous en laine",
      variant: null,
    });
  });
});

describe("a movement's actor", () => {
  const ME = 514;

  it("names an order rather than the person who happened to be signed in", () => {
    // 692 of 1154 rows. `actor_id` on an order-driven movement is whoever was
    // signed in when the status changed — for a storefront checkout, the
    // customer — so attributing it to a person would be actively wrong.
    expect(movementActor(movement({ reason: "order_reduced", order_id: 2627, actor_id: 475 }), ME))
      .toEqual({ kind: "order", orderId: 2627 });
    expect(movementActor(movement({ reason: "order_restored", order_id: 91, actor_id: 1 }), ME))
      .toEqual({ kind: "order", orderId: 91 });
  });

  it("says `you` only for the signed-in id", () => {
    expect(movementActor(movement({ actor_id: ME }), ME)).toEqual({ kind: "you" });
    expect(movementActor(movement({ actor_id: 53 }), ME)).toEqual({ kind: "colleague" });
    // No identity in hand — everyone is a colleague, and nobody is "you".
    expect(movementActor(movement({ actor_id: ME }), null)).toEqual({ kind: "colleague" });
  });

  it("attributes product_edit to a person, not to the shop", () => {
    /*
     * `product_edit` is grouped with the system reasons at the API because a
     * person may not *choose* it — but a person still caused it, through the
     * product form. Calling it "the shop" would hide the one thing that reason
     * exists to reveal: a quantity changed outside the ledger's own front door.
     */
    expect(movementActor(movement({ reason: "product_edit", actor_id: 53 }), ME)).toEqual({
      kind: "colleague",
    });
    expect(movementActor(movement({ reason: "product_edit", actor_id: ME }), ME)).toEqual({
      kind: "you",
    });
  });

  it("does not claim an order when the reason says order but the id is absent", () => {
    expect(movementActor(movement({ reason: "order_reduced", order_id: 0, actor_id: 53 }), ME))
      .toEqual({ kind: "colleague" });
  });

  it("says unknown rather than inventing someone for actor 0", () => {
    // What the ledger stores when nobody was signed in — a CLI import, say.
    expect(movementActor(movement({ actor_id: 0 }), ME)).toEqual({ kind: "unknown" });
  });

  it("never produces a bare numeric id", () => {
    // The whole point. Whatever comes in, what comes out is one of four facts.
    const kinds = new Set(
      [0, 1, 53, ME, 999].map((actor_id) => movementActor(movement({ actor_id }), ME).kind),
    );
    for (const kind of kinds) {
      expect(["order", "you", "colleague", "unknown"]).toContain(kind);
    }
  });
});
