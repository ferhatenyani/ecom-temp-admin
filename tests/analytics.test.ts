/**
 * @vitest-environment node
 *
 * The analytics vocabulary, the range, and the money gate.
 *
 * Every fixture here is a real payload, trimmed — measured 2026-08-21 against the
 * live install with a Super Admin and, for the gated shapes, with a credential
 * holding `ac_view_analytics` **without** `ac_manage_orders`. Nothing is
 * hand-written to match the code.
 */
import { describe, expect, it } from "vitest";
import {
  analyticsParams,
  awaitingFulfilment,
  barShare,
  COUNTED_STATUSES,
  countedReconciliation,
  customRangeProblem,
  dashboardCards,
  DEFAULT_PRESET,
  hasRankingSignal,
  MAX_CUSTOM_DAYS,
  rangeFromParams,
  rangeToParams,
  rateFraction,
  revenueFigures,
  statusCounts,
  unavailableLines,
  wilayaSlices,
} from "@/lib/analytics";
import {
  codReport,
  overviewReport,
  productsReport,
  revenueReport,
  shippingReport,
} from "@/lib/api/schemas/analytics";
import { formatDay } from "@/lib/format/date";
import { formatCount, formatPercent, formatRate } from "@/lib/format/money";
import { orderStatuses } from "@/lib/order-status";
import { CAPABILITIES } from "@/lib/capabilities";
import { SHIPMENT_STATUSES } from "@/lib/shipment-status";

const RANGE = {
  preset: "30d",
  from: "2026-07-23",
  to: "2026-08-21",
  days: 30,
  timezone: "+00:00",
};

/**
 * The same window as the panel's own URL state, which is a different type: the
 * one above is `data.range` off the response, this one is what a picker holds
 * and what `dashboardCards` writes into a report link.
 */
const WINDOW = { preset: "30d", from: "", to: "" } as const;

/** A Super Admin — every capability the panel knows about. */
const EVERYTHING = CAPABILITIES;

/**
 * The Support Agent, measured 2026-08-26: **403 on `/orders` and `/inventory`**,
 * 200 on `/customers` and on all six analytics reports. The delta from a Super
 * Admin is exactly the two refusals that were seen and no more — nothing is
 * inferred from the role's name.
 */
const SUPPORT_AGENT = CAPABILITIES.filter(
  (capability) => capability !== "ac_manage_orders" && capability !== "ac_manage_inventory",
);

const UNAVAILABLE = {
  shipping_cost:
    "What a courier charges the shop is not recorded. ac_shipments deliberately has no cost column, and shipping_revenue above is the separate figure of what the customer was charged.",
  payment_fees:
    "Gateway fees are not summable across providers. ac_payment_transactions has no fee column by design; Chargily reports fees in per-transaction metadata, and a second gateway would shape them differently.",
  margin:
    "No cost of goods exists. WooCommerce has no cost field, and PLAN §28 says to calculate profit only where reliable cost data exists.",
};

const REVENUE = {
  range: RANGE,
  currency: "DZD",
  order_total: "2187600.00",
  orders_placed: 844,
  orders_counted: 289,
  gross: "820400.00",
  discounts: "0.00",
  shipping_revenue: "0.00",
  tax: "0.00",
  refunds: "100700.00",
  net: "719700.00",
  collected: "145150.00",
  average_order_value: "2838.75",
  unavailable: UNAVAILABLE,
  refund_count: 83,
  refunded_orders: 83,
};

const BY_STATUS = {
  pending: 197,
  processing: 160,
  "on-hold": 1,
  completed: 45,
  cancelled: 357,
  refunded: 83,
  failed: 1,
};

const ORDERS_BLOCK = {
  placed: 844,
  by_status: BY_STATUS,
  cancelled: 357,
  completed: 45,
  refunded: 83,
  guest_orders: 389,
  counted_as_revenue: 289,
};

const CUSTOMERS_BLOCK = {
  customers: 9,
  new: 9,
  returning: 0,
  guest_orders: 185,
  rates: { new: "1.0000", returning: "0.0000" },
};

const OVERVIEW = {
  range: RANGE,
  orders: ORDERS_BLOCK,
  customers: CUSTOMERS_BLOCK,
  cod: {
    total_orders: 569,
    confirmed_orders: 120,
    confirmation_rate: "0.2109",
    delivery_rate: "0.0738",
  },
  shipping: { shipments: 123, delivered: 81, live: 0, delivery_rate: "0.6585" },
  inventory: { low_stock: 3 },
  revenue: {
    currency: "DZD",
    order_total: "2187600.00",
    orders_placed: 844,
    orders_counted: 289,
    gross: "820400.00",
    discounts: "0.00",
    shipping_revenue: "0.00",
    tax: "0.00",
    refunds: "100700.00",
    net: "719700.00",
    collected: "145150.00",
    average_order_value: "2838.75",
    unavailable: UNAVAILABLE,
    refund_count: 83,
    refunded_orders: 83,
  },
};

/** The same payload as a caller without `ac_manage_orders` receives it. */
const OVERVIEW_NO_MONEY = {
  range: RANGE,
  orders: ORDERS_BLOCK,
  customers: CUSTOMERS_BLOCK,
  cod: {
    total_orders: 569,
    confirmed_orders: 120,
    confirmation_rate: "0.2109",
    delivery_rate: "0.0738",
  },
  shipping: { shipments: 123, delivered: 81, live: 0, delivery_rate: "0.6585" },
  inventory: { low_stock: 3 },
};

const SHIPPING = {
  range: RANGE,
  shipments: {
    total: 123,
    by_status: {
      pending: 0,
      created: 0,
      picked_up: 0,
      in_transit: 0,
      out_for_delivery: 0,
      delivered: 81,
      returning: 0,
      returned: 0,
      cancelled: 42,
      failed: 0,
    },
    live: 0,
  },
  rates: { delivery: "0.6585", return: "0.0000" },
  providers: [
    {
      provider: "manual",
      shipments: 83,
      delivered: 41,
      returned: 0,
      cancelled: 42,
      failed: 0,
      live: 0,
      rates: { delivery: "0.4940", return: "0.0000" },
    },
  ],
  unavailable: { shipping_cost: UNAVAILABLE.shipping_cost },
  by_wilaya: [
    { wilaya_id: 1, code: "01", name: "Adrar", name_ar: "أدرار", orders: 39, revenue: "163800.00" },
    {
      wilaya_id: 16,
      code: "16",
      name: "Algiers",
      name_ar: "الجزائر",
      orders: 1,
      revenue: "4200.00",
    },
  ],
  unattributed: {
    orders: 249,
    revenue: "652400.00",
    reason:
      "Orders with no shipment carry no canonical wilaya; an order address stores it as free text, which is never guessed at.",
  },
  shipping_revenue: "0.00",
  currency: "DZD",
};

/* --------------------------------------------------------------- the range --- */

describe("the reporting range", () => {
  it("always sends `range`, including for the default", () => {
    /*
     * The measurement this whole control exists for: `date_from`/`date_to`
     * without `range=custom` are **silently ignored** — four spellings tried,
     * including a valid ten-day window, every one answering 200 with the
     * thirty-day default. So a request that omits `range` is a request whose
     * window is implied, and there must be no way to build one.
     */
    expect(analyticsParams({ preset: "30d", from: "", to: "" })).toEqual({ range: "30d" });
    expect(analyticsParams({ preset: "today", from: "", to: "" })).toEqual({ range: "today" });
  });

  it("sends the dates only with `custom`, because they do nothing without it", () => {
    expect(
      analyticsParams({ preset: "custom", from: "2026-08-11", to: "2026-08-21" }),
    ).toEqual({ range: "custom", date_from: "2026-08-11", date_to: "2026-08-21" });

    // Dates left over from a previous custom window must not ride along on a
    // preset — they would be accepted, ignored, and never reported.
    expect(analyticsParams({ preset: "7d", from: "2026-08-11", to: "2026-08-21" })).toEqual({
      range: "7d",
    });
  });

  it("round-trips through the URL and omits the default", () => {
    const params = rangeToParams({ preset: "custom", from: "2026-08-11", to: "2026-08-21" });
    expect(params.toString()).toBe("range=custom&date_from=2026-08-11&date_to=2026-08-21");
    expect(rangeFromParams(params)).toEqual({
      preset: "custom",
      from: "2026-08-11",
      to: "2026-08-21",
    });

    expect(rangeToParams({ preset: DEFAULT_PRESET, from: "", to: "" }).toString()).toBe("");
  });

  it("falls back to the API's own default rather than inventing a second one", () => {
    expect(rangeFromParams(new URLSearchParams("range=zzz")).preset).toBe(DEFAULT_PRESET);
    expect(rangeFromParams(new URLSearchParams("range=400d")).preset).toBe(DEFAULT_PRESET);
    expect(rangeFromParams(new URLSearchParams()).preset).toBe(DEFAULT_PRESET);
    // A malformed date is dropped rather than forwarded to be refused.
    expect(rangeFromParams(new URLSearchParams("date_from=31/12/2026")).from).toBe("");
  });

  it("mirrors each of the API's three refusals on a custom window", () => {
    expect(customRangeProblem("", "")).toBe("missing");
    expect(customRangeProblem("2026-08-11", "")).toBe("missing");
    expect(customRangeProblem("2026-08-21", "2026-08-11")).toBe("reversed");
    expect(customRangeProblem("2024-01-01", "2026-08-21")).toBe("too-long");

    // The positive control: the ten-day window the API answered 200 for, and
    // which it reported back as eleven days — inclusive counting, matching the
    // server rather than an off-by-one of our own.
    expect(customRangeProblem("2026-08-11", "2026-08-21")).toBeNull();
  });

  it("puts the cap exactly where the API puts it", () => {
    // 366 days inclusive is the last accepted window; 367 is the first refusal.
    expect(customRangeProblem("2026-01-01", "2026-12-31")).toBeNull();
    expect(customRangeProblem("2026-01-01", "2027-01-01")).toBeNull();
    expect(customRangeProblem("2026-01-01", "2027-01-02")).toBe("too-long");
    expect(MAX_CUSTOM_DAYS).toBe(366);
  });

  it("formats a range boundary as a day in UTC, not in the shop's timezone", () => {
    /*
     * The boundaries are days drawn by the server in `+00:00`, which is not
     * Africa/Algiers. Reading them back in the shop's zone would render a
     * boundary the report does not have.
     */
    expect(formatDay("2026-07-23", "fr")).toBe("23 juil. 2026");
    expect(formatDay("2026-07-23", "ar")).toContain("2026");
    expect(formatDay("", "fr")).toBe("—");
    expect(formatDay(null, "fr")).toBe("—");
  });
});

/* ------------------------------------------------- 844 against 289, proved --- */

describe("what counts as revenue", () => {
  it("adds the four counted statuses up to `counted_as_revenue`", () => {
    const reconciliation = countedReconciliation(ORDERS_BLOCK);

    // 160 processing + 1 on-hold + 45 completed + 83 refunded = 289.
    expect(reconciliation.counted).toBe(289);
    expect(reconciliation.proves).toBe(true);
    expect(reconciliation.included.map((row) => row.status).sort()).toEqual(
      [...COUNTED_STATUSES].sort(),
    );
    expect(reconciliation.included.reduce((sum, row) => sum + row.count, 0)).toBe(289);
  });

  it("names the excluded statuses and accounts for every order", () => {
    const reconciliation = countedReconciliation(ORDERS_BLOCK);
    const excluded = reconciliation.excluded.reduce((sum, row) => sum + row.count, 0);

    // pending 197 + cancelled 357 + failed 1 = 555, and 289 + 555 = 844.
    expect(excluded).toBe(555);
    expect(reconciliation.counted + excluded).toBe(reconciliation.placed);
    expect(reconciliation.excluded.map((row) => row.status).sort()).toEqual([
      "cancelled",
      "failed",
      "pending",
    ]);
  });

  it("refuses to claim the explanation when the arithmetic stops holding", () => {
    /*
     * The floor on the claim. If the backend's definition changes, the screen
     * must report the gap and stop explaining it — a sweep that cannot fail is a
     * sweep that reports success.
     */
    const drifted = countedReconciliation({ ...ORDERS_BLOCK, counted_as_revenue: 300 });
    expect(drifted.proves).toBe(false);
  });

  it("scopes every revenue figure, and never emits one without a population", () => {
    const figures = revenueFigures(REVENUE);

    // The two pairs that do not divide, each carrying a different scope.
    const by = Object.fromEntries(figures.map((f) => [f.key, f]));
    expect(by.orders_placed.scope).toBe("all");
    expect(by.orders_counted.scope).toBe("counted");
    expect(by.net.scope).toBe("counted");
    expect(by.collected.scope).toBe("completed");

    for (const figure of figures) {
      expect(figure.scope).toBeTruthy();
      expect(["headline", "volume", "deductions"]).toContain(figure.group);
    }
  });
});

/* ---------------------------------------------------------- the money gate --- */

describe("the money gate", () => {
  it("parses the payload a caller without `ac_manage_orders` actually receives", () => {
    /*
     * Money is omitted **field by field**, not nulled and not zeroed. A schema
     * that required any of these would turn a Support Agent's dashboard into a
     * `schema_mismatch` at the boundary rather than a working screen.
     */
    const parsed = overviewReport.parse(OVERVIEW_NO_MONEY);
    expect(parsed.revenue).toBeUndefined();
    expect(parsed.orders.placed).toBe(844);

    const orders = productsReport.parse({
      range: RANGE,
      best_sellers: [{ product_id: 119, name: "Shipping test AC-SHIP-BOX", units: 80, orders: 80 }],
      best_sellers_limit: 10,
      low_stock: { products: 3 },
    });
    expect(orders.best_sellers[0].revenue).toBeUndefined();

    const shipping = shippingReport.parse({
      ...SHIPPING,
      by_wilaya: SHIPPING.by_wilaya.map(({ revenue: _revenue, ...rest }) => rest),
      unattributed: { orders: 249, reason: SHIPPING.unattributed.reason },
      shipping_revenue: undefined,
      currency: undefined,
    });
    expect(shipping.by_wilaya[0].revenue).toBeUndefined();
    expect(shipping.unattributed.revenue).toBeUndefined();
  });

  it("still parses the full payload, so the gate is not one-directional", () => {
    const parsed = overviewReport.parse(OVERVIEW);
    expect(parsed.revenue?.net).toBe("719700.00");
    expect(revenueReport.parse(REVENUE).collected).toBe("145150.00");
  });

  it("returns a complete card set for a reader who cannot see money", () => {
    /*
     * ADMIN_PANEL.md: the screen must be complete without it, **not a layout
     * with holes**. So the two sets are compared as sets rather than the second
     * being checked for absences.
     */
    const withMoney = dashboardCards(overviewReport.parse(OVERVIEW), {
      money: true,
      capabilities: EVERYTHING,
      range: WINDOW,
    });
    const without = dashboardCards(overviewReport.parse(OVERVIEW_NO_MONEY), {
      money: false,
      capabilities: SUPPORT_AGENT,
      range: WINDOW,
    });

    expect(withMoney).toHaveLength(without.length);
    expect(without.some((card) => card.kind === "money")).toBe(false);
    expect(withMoney.some((card) => card.kind === "money")).toBe(true);

    // Exactly one hero in each, and it is the first card.
    for (const set of [withMoney, without]) {
      expect(set.filter((card) => card.hero)).toHaveLength(1);
      expect(set[0].hero).toBe(true);
      /*
       * A number that cannot be drilled into is decoration — but the remedy for
       * a figure with no honest destination is to render it **unlinked**, not to
       * point it somewhere wrong. So the guarantee is scoped: a card that *has*
       * a link points into the panel.
       */
      for (const card of set) {
        if (card.href !== undefined) expect(card.href).toMatch(/^\//);
      }
    }
  });

  it("gives `awaiting` no link, because no filtered list is that number", () => {
    /*
     * It counts `pending + processing`; `?status=processing,pending` is a
     * measured 400 and `?status=processing` is roughly half of it. A card
     * reading 375 that lands on a list of 177 is worse than a card that does not
     * claim to lead anywhere.
     *
     * It carries no `requires` either, which is what separates it from a card
     * this reader is merely refused: nothing in the panel could link it.
     */
    for (const capabilities of [EVERYTHING, SUPPORT_AGENT]) {
      const cards = dashboardCards(overviewReport.parse(OVERVIEW), {
        money: false,
        capabilities,
        range: WINDOW,
      });
      const awaiting = cards.find((card) => card.key === "awaiting");
      expect(awaiting?.href).toBeUndefined();
      expect(awaiting?.requires).toBeUndefined();
    }
  });

  it("drops the link on the four lists a Support Agent is refused, and keeps the figure", () => {
    /*
     * Measured 2026-08-26 with that credential: **403 on `/orders` and
     * `/inventory`, 200 on `/customers`.** Four of the seven cards in the
     * moneyless set lead into those two collections.
     */
    const cards = dashboardCards(overviewReport.parse(OVERVIEW_NO_MONEY), {
      money: false,
      capabilities: SUPPORT_AGENT,
      range: WINDOW,
    });

    expect(cards).toHaveLength(7);
    const linkless = cards.filter((card) => card.href === undefined).map((card) => card.key);
    expect(linkless.sort()).toEqual(["awaiting", "completed", "low_stock", "orders_placed"]);

    // The figures are all still there — a refused destination is not a refused
    // number, and the value is what the reader came for.
    for (const card of cards) expect(card.value).not.toBe("");

    // `/customers` is the one this credential is 200 on, which is why there is
    // no gate on it however plausible one would look.
    expect(cards.find((card) => card.key === "customers")?.href).toBe("/customers");
  });

  it("carries the window into a report link and never into a list link", () => {
    /*
     * `/analytics` reads `range` off its own URL. `/orders`, `/customers` and
     * `/inventory` have no date parameter at all, so appending one would be the
     * panel writing a filter the API ignores.
     */
    const cards = dashboardCards(overviewReport.parse(OVERVIEW_NO_MONEY), {
      money: false,
      capabilities: EVERYTHING,
      range: { preset: "7d", from: "", to: "" },
    });

    expect(cards.find((card) => card.key === "cod_confirmation")?.href).toBe(
      "/analytics?view=cod&range=7d",
    );
    expect(cards.find((card) => card.key === "orders_placed")?.href).toBe("/orders");

    // The default preset is omitted, so a link over the default window is
    // `/analytics?view=cod` rather than `…&range=30d` — the same rule
    // `rangeToParams` follows everywhere else.
    const atDefault = dashboardCards(overviewReport.parse(OVERVIEW_NO_MONEY), {
      money: false,
      capabilities: EVERYTHING,
      range: WINDOW,
    });
    expect(atDefault.find((card) => card.key === "shipping_delivery")?.href).toBe(
      "/analytics?view=shipping",
    );
  });

  it("falls to the safe side when the panel and the API disagree", () => {
    // `canSeeMoney()` says yes, the payload carries no `revenue` block. The
    // money cards cannot be built from nothing, so the set without them is what
    // renders — never an `undefined` formatted as a currency.
    const cards = dashboardCards(overviewReport.parse(OVERVIEW_NO_MONEY), {
      money: true,
      capabilities: EVERYTHING,
      range: WINDOW,
    });
    expect(cards.some((card) => card.kind === "money")).toBe(false);
    expect(cards[0].key).toBe("orders_placed");
  });
});

/* ----------------------------------------------------------- what is known --- */

describe("what cannot be known", () => {
  it("marks the three keys the panel has wording for, and passes the rest through", () => {
    const lines = unavailableLines(UNAVAILABLE);
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.known)).toBe(true);

    // A fourth key added later must still reach the screen — with the API's own
    // sentence, which is better than nothing and visibly not the panel's copy.
    const withNew = unavailableLines({ ...UNAVAILABLE, cost_of_goods: "Not recorded anywhere." });
    const added = withNew.find((line) => line.key === "cost_of_goods");
    expect(added?.known).toBe(false);
    expect(added?.note).toBe("Not recorded anywhere.");
  });

  it("carries the shipping report's single key", () => {
    const lines = unavailableLines(SHIPPING.unavailable);
    expect(lines).toHaveLength(1);
    expect(lines[0].key).toBe("shipping_cost");
    expect(lines[0].known).toBe(true);
  });
});

/* ------------------------------------------------------------- the bar rows --- */

describe("the bar rows", () => {
  it("drops the zeros and keeps the vocabulary's order", () => {
    const rows = statusCounts(SHIPPING.shipments.by_status, SHIPMENT_STATUSES);
    // Eight of the ten shipment statuses are 0 on this shop; at 390px that is
    // eight rows of nothing beside two real ones.
    expect(rows.map((row) => row.status)).toEqual(["delivered", "cancelled"]);
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(SHIPPING.shipments.total);

    const orders = statusCounts(BY_STATUS, orderStatuses);
    expect(orders.map((row) => row.status)).toEqual([
      "pending",
      "processing",
      "on-hold",
      "completed",
      "cancelled",
      "refunded",
      "failed",
    ]);
  });

  it("sorts a status outside the vocabulary last rather than dropping it", () => {
    // A plugin-registered status still counts toward `placed`, so a breakdown
    // that omitted it would stop summing.
    const rows = statusCounts({ completed: 2, "some-plugin-status": 5 }, orderStatuses);
    expect(rows.map((row) => row.status)).toEqual(["completed", "some-plugin-status"]);
  });

  it("scales to the maximum and never produces an invalid width", () => {
    expect(barShare(50, 100)).toBe(0.5);
    expect(barShare(100, 100)).toBe(1);
    // A zero maximum must not reach the DOM as NaN, which renders full-length.
    expect(barShare(0, 0)).toBe(0);
    expect(barShare(5, 0)).toBe(0);
    expect(barShare(Number.NaN, 100)).toBe(0);
    expect(barShare(150, 100)).toBe(1);
  });

  it("draws a ranking only when there is one", () => {
    // The measured thirty-day spread.
    expect(hasRankingSignal([80, 70, 41, 40, 22, 12, 11, 9, 5, 3])).toBe(true);
    // A two-order day: two identical bars would imply a ranking that is not there.
    expect(hasRankingSignal([1, 1])).toBe(false);
    expect(hasRankingSignal([])).toBe(false);
    expect(hasRankingSignal([7])).toBe(false);
  });
});

/* -------------------------------------------------------------- the wilayas --- */

describe("the wilaya report", () => {
  it("ranks the unattributed orders as a named row, not as a remainder", () => {
    const slices = wilayaSlices(shippingReport.parse(SHIPPING));

    // 249 against 39 and 1 — larger than every attributed wilaya combined, so it
    // sorts first. A chart that hid it behind "other" would show a shop that
    // sells almost entirely in Adrar.
    expect(slices[0].kind).toBe("unattributed");
    expect(slices[0].orders).toBe(249);
    expect(slices[0].reason).toContain("free text");

    expect(slices.map((slice) => slice.orders)).toEqual([249, 39, 1]);
  });

  it("computes shares against the whole set, so they sum to one", () => {
    const slices = wilayaSlices(shippingReport.parse(SHIPPING));
    const total = slices.reduce((sum, slice) => sum + slice.share, 0);
    expect(total).toBeCloseTo(1, 10);
    // 249 / 289.
    expect(slices[0].share).toBeCloseTo(249 / 289, 10);
  });

  it("keeps both wilaya names, including the exonym the French locale is stuck with", () => {
    const slices = wilayaSlices(shippingReport.parse(SHIPPING));
    const algiers = slices.find((slice) => slice.wilayaId === 16);
    // ISO 3166-2 via WooCommerce's DZ state list; a French display name would be
    // a new column, not an edit. README carries the reason.
    expect(algiers?.name).toBe("Algiers");
    expect(algiers?.nameAr).toBe("الجزائر");
  });

  it("drops an empty set rather than rendering a zero-length bar", () => {
    const empty = wilayaSlices(
      shippingReport.parse({
        ...SHIPPING,
        by_wilaya: [],
        unattributed: { orders: 0, revenue: "0.00", reason: SHIPPING.unattributed.reason },
      }),
    );
    expect(empty).toEqual([]);
  });
});

/* --------------------------------------------------------------- the rates --- */

describe("rates and counts", () => {
  it("reads a rate as the fraction it is", () => {
    expect(rateFraction("0.2109")).toBeCloseTo(0.2109);
    expect(rateFraction("")).toBeNull();
    expect(rateFraction(undefined)).toBeNull();
    expect(rateFraction("n/a")).toBeNull();
  });

  it("keeps the analytics rate and the coupon percentage apart", () => {
    /*
     * The trap, and it is a factor of a hundred. `/analytics/cod` sends
     * `"0.2109"` meaning twenty-one percent; a coupon sends `"10.00"` meaning
     * ten. Feeding an analytics rate to `formatPercent` renders **0,21 %** — a
     * plausible number on a screen about conversion, wrong by two orders of
     * magnitude, and it would never look like a bug.
     */
    const asRate = formatRate(0.2109, "fr");
    const asCoupon = formatPercent("0.2109", "fr");
    const value = (rendered: string) => Number.parseFloat(rendered.replace(",", "."));

    expect(value(asRate)).toBeCloseTo(21.1, 1);
    expect(value(asCoupon)).toBeCloseTo(0.21, 2);
    expect(asRate).not.toBe(asCoupon);

    // And the coupon formatter still reads a coupon correctly, which is why it
    // cannot simply be changed to take a fraction.
    expect(value(formatPercent("10.00", "fr"))).toBeCloseTo(10, 5);

    expect(formatRate(null, "fr")).toBe("—");
    expect(formatRate(Number.NaN, "fr")).toBe("—");
  });

  it("groups a count the way its locale groups, in Western digits either way", () => {
    // Algeria writes 0123456789 in Arabic text; Eastern Arabic numerals would be
    // wrong here and unreadable to the staff using this.
    expect(formatCount(2187600, "fr")).toMatch(/2.187.600/);
    expect(formatCount(844, "ar")).toBe("844");
    expect(formatCount(Number.NaN, "fr")).toBe("—");
  });
});

/* ------------------------------------------------------------ the dashboard --- */

describe("the dashboard's figures", () => {
  it("counts what a stockroom acts on, off `by_status`", () => {
    // pending 197 + processing 160. Read off the breakdown rather than derived
    // from `placed` minus the terminal statuses, which would silently absorb any
    // status the vocabulary does not know.
    expect(awaitingFulfilment(ORDERS_BLOCK)).toBe(357);
    expect(awaitingFulfilment({ by_status: {} })).toBe(0);
  });

  it("reuses the COD reader, because the payload is the same shape plus a range", () => {
    const parsed = codReport.parse({
      range: RANGE,
      total_orders: 569,
      by_status: { pending: 207, confirmed: 80, rejected: 40, unreachable: 0, cancelled: 242 },
      confirmed_orders: 120,
      delivered_orders: 42,
      returned_orders: 41,
      rates: {
        confirmation: "0.2109",
        rejection: "0.0703",
        cancellation: "0.4253",
        delivery: "0.0738",
        return: "0.0721",
      },
    });

    // The two confirmed counts, in one payload, both correct: 80 is the shop
    // now, 120 counts every order ever confirmed including the 242 since
    // cancelled. `codFigures()` is what stops either being printed unscoped.
    expect(parsed.by_status.confirmed).toBe(80);
    expect(parsed.confirmed_orders).toBe(120);
    expect(parsed.range.preset).toBe("30d");
  });
});
