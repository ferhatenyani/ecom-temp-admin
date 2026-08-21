import type {
  OrdersReport,
  OverviewReport,
  RevenueBody,
  ShippingReport,
  WilayaRow,
} from "@/lib/api/schemas/analytics";

/**
 * What the seven reports mean, in one place.
 *
 * The vocabulary / row-helper split `lib/shipping.ts` made, for the same measured
 * reason: **Zod costs 60 KB gzipped in the browser**, and a client component that
 * imports a *value* from a schema module drags it in, because a value import is
 * not erased the way `import type` is. Everything here is types-only from the
 * schemas, so an analytics view can import it freely.
 *
 * Nothing here talks to the API. Everything here is something the API told us,
 * measured 2026-08-21 against the live install.
 */

/* --------------------------------------------------------- the range --- */

/**
 * Six presets, and the parameter is `range` — **not the pair the specification
 * describes**.
 *
 * Measured, with `?bogus=1` as the control for "silently ignored":
 *
 * | Sent | Answer |
 * |---|---|
 * | `range=today` … `range=90d` | 200, `data.range.preset` echoing it back |
 * | `range=custom` alone | **400** `details.fields.date_from` — required |
 * | `range=custom` + a 10-day window | 200, `preset=custom days=11` |
 * | `range=custom` + 966 days | **400** — at most 366 |
 * | `range=custom`, `date_from > date_to` | **400** — must not be later |
 * | `range=zzz` / `range=400d` | **400** `details.params.range`, naming all six |
 * | `date_from`+`date_to`, **no `range`** | **200 — ignored**, the 30-day default |
 *
 * The last row is the trap and it is silent. A date picker that sends only the
 * two dates shows the operator the window they chose above thirty days of data
 * that does not describe it, and nothing anywhere errors. Two consequences, both
 * enforced below: `analyticsParams()` **always** sends `range`, and every screen
 * renders `data.range` rather than what the picker holds.
 *
 * Note also the two error shapes on one endpoint — a bad `range` is
 * `details.params`, a bad date is `details.fields`. `BrowserApiError` keeps both.
 */
export const RANGE_PRESETS = ["today", "yesterday", "7d", "30d", "90d", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** What the API falls back to, so the panel's default is not a second opinion. */
export const DEFAULT_PRESET: RangePreset = "30d";

/** The API's cap, mirrored here so the picker can refuse before the round trip. */
export const MAX_CUSTOM_DAYS = 366;

export type RangeQuery = {
  preset: RangePreset;
  /** `Y-m-d`, and meaningful only when `preset` is `custom`. */
  from: string;
  to: string;
};

/** `Y-m-d` and nothing else — the format the API writes and reads. */
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function rangeFromParams(params: URLSearchParams): RangeQuery {
  const preset = params.get("range") ?? "";
  const from = params.get("date_from") ?? "";
  const to = params.get("date_to") ?? "";

  return {
    preset: (RANGE_PRESETS as readonly string[]).includes(preset)
      ? (preset as RangePreset)
      : DEFAULT_PRESET,
    from: YMD.test(from) ? from : "",
    to: YMD.test(to) ? to : "",
  };
}

/**
 * The panel's own URL. The default is omitted so a shared link carries only what
 * was chosen, and the dates are carried only where they mean anything — a URL
 * holding `date_from` beside `range=7d` would describe a request the API ignores.
 */
export function rangeToParams(range: RangeQuery, into = new URLSearchParams()): URLSearchParams {
  if (range.preset !== DEFAULT_PRESET) into.set("range", range.preset);
  if (range.preset === "custom") {
    if (range.from !== "") into.set("date_from", range.from);
    if (range.to !== "") into.set("date_to", range.to);
  }
  return into;
}

/**
 * What the API is actually sent.
 *
 * `range` is unconditional — including for the default — because omitting it is
 * indistinguishable from sending it and the one thing that must never happen on
 * this endpoint is a request whose window is implied rather than stated.
 */
export function analyticsParams(range: RangeQuery): Record<string, string> {
  const query: Record<string, string> = { range: range.preset };
  if (range.preset === "custom") {
    if (range.from !== "") query.date_from = range.from;
    if (range.to !== "") query.date_to = range.to;
  }
  return query;
}

/**
 * The API's three refusals on a custom window, as a pure predicate.
 *
 * Mirrored locally so the picker can say what is wrong while the operator is
 * still typing, rather than after a round trip that renders as a failed screen.
 * The API stays the authority — it is asked anyway, and its own message is what
 * renders if it refuses for a reason this does not know about.
 *
 * Inclusive day counting, matching the server: `2026-08-11` → `2026-08-21` is the
 * eleven days it reported, not ten.
 */
export type CustomRangeProblem = "missing" | "reversed" | "too-long" | null;

export function customRangeProblem(from: string, to: string): CustomRangeProblem {
  if (!YMD.test(from) || !YMD.test(to)) return "missing";

  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "missing";
  if (start > end) return "reversed";

  const days = Math.round((end - start) / 86_400_000) + 1;
  return days > MAX_CUSTOM_DAYS ? "too-long" : null;
}

/* -------------------------------------------------- what cannot be known --- */

/**
 * The three lines reported as unavailable rather than zero, and the one key
 * `/analytics/shipping` carries alone.
 *
 * **`unavailable` is an object of reasons, in English** — the specification calls
 * it a list of names. Each value is a full sentence: *"Gateway fees are not
 * summable across providers. `ac_payment_transactions` has no fee column by
 * design…"*. Rendering that raw puts an English paragraph at the foot of an
 * Arabic sheet, which is the facet `scope_note` problem arriving in a second
 * place.
 *
 * So a key the panel has wording for renders the panel's own localised line, and
 * a key it does not renders the API's sentence — visibly the API's, rather than
 * passed off as the panel's own copy. `known` is what the screen switches on.
 */
export const UNAVAILABLE_KEYS = ["shipping_cost", "payment_fees", "margin"] as const;
export type UnavailableKey = (typeof UNAVAILABLE_KEYS)[number];

export type UnavailableLine = { key: string; known: boolean; note: string };

export function unavailableLines(reasons: Record<string, string>): UnavailableLine[] {
  return Object.entries(reasons).map(([key, note]) => ({
    key,
    known: (UNAVAILABLE_KEYS as readonly string[]).includes(key),
    note,
  }));
}

/* ------------------------------------------------------ the money report --- */

/**
 * A revenue figure, carrying the population it describes.
 *
 * This is `CodFigure` and `StatFigure` a third time, and this payload is the
 * strongest case for it in the API: **two pairs on one screen do not divide.**
 *
 *   `orders_placed` 844 vs `orders_counted` 289 — only some statuses are revenue
 *   `net` 719 700 vs `collected` 145 150     — booked versus actually taken
 *
 * Three populations, so three scopes, and `scope` is not optional — there is no
 * constructor that omits it:
 *
 *   all        every order in the window, whatever its status
 *   counted    the four statuses that are revenue; see COUNTED_STATUSES
 *   completed  the narrower figure a cash-on-delivery shop has actually taken
 *
 * `group` exists because eleven figures in one list is a wall. The screen renders
 * three grouped lists, headline first, which is the order a shop reads them in.
 */
export type RevenueFigure = {
  key:
    | "net"
    | "collected"
    | "gross"
    | "average_order_value"
    | "order_total"
    | "orders_placed"
    | "orders_counted"
    | "discounts"
    | "shipping_revenue"
    | "tax"
    | "refunds";
  group: "headline" | "volume" | "deductions";
  scope: "all" | "counted" | "completed";
  money: boolean;
  value: string;
};

export function revenueFigures(report: RevenueBody): RevenueFigure[] {
  return [
    { key: "net", group: "headline", scope: "counted", money: true, value: report.net },
    {
      key: "collected",
      group: "headline",
      scope: "completed",
      money: true,
      value: report.collected,
    },
    { key: "gross", group: "headline", scope: "counted", money: true, value: report.gross },
    {
      key: "average_order_value",
      group: "headline",
      scope: "counted",
      money: true,
      value: report.average_order_value,
    },

    {
      key: "order_total",
      group: "volume",
      scope: "all",
      money: true,
      value: report.order_total,
    },
    {
      key: "orders_placed",
      group: "volume",
      scope: "all",
      money: false,
      value: String(report.orders_placed),
    },
    {
      key: "orders_counted",
      group: "volume",
      scope: "counted",
      money: false,
      value: String(report.orders_counted),
    },

    {
      key: "discounts",
      group: "deductions",
      scope: "counted",
      money: true,
      value: report.discounts,
    },
    {
      key: "shipping_revenue",
      group: "deductions",
      scope: "counted",
      money: true,
      value: report.shipping_revenue,
    },
    { key: "tax", group: "deductions", scope: "counted", money: true, value: report.tax },
    {
      key: "refunds",
      group: "deductions",
      scope: "counted",
      money: true,
      value: report.refunds,
    },
  ];
}

/* --------------------------------------------- 844 against 289, explained --- */

/**
 * The four statuses whose orders are revenue.
 *
 * Read out of `RevenueReport::COUNTED_STATUSES` in the backend and then
 * **verified against the payload rather than trusted**: 160 processing + 1
 * on-hold + 45 completed + 83 refunded = 289, which is exactly
 * `counted_as_revenue`. The excluded 555 are pending 197, cancelled 357 and
 * failed 1 — nothing was paid, nothing was committed, or it was called off.
 *
 * `refunded` being *included* is the subtle one, and the backend explains it: a
 * fully refunded order made a sale and gave it back, so it belongs in gross with
 * its refund subtracted, netting to zero. Excluding the order while still
 * counting the refund nets to minus the sale.
 *
 * **The specification points at `excluded_currencies` to explain this gap and it
 * is the wrong field.** That one names orders priced in another currency, was
 * absent from every response measured here, and would explain a different gap:
 * the revenue report's own `orders_placed` is already currency-scoped, so it is
 * `/analytics/orders`'s `placed` that it would reconcile against.
 */
export const COUNTED_STATUSES = ["processing", "on-hold", "completed", "refunded"] as const;

export type StatusCount = { status: string; count: number };

/**
 * The reconciliation, with its own positive control.
 *
 * `proves` is the floor: it is true only when the included statuses actually sum
 * to `counted_as_revenue` on *this* payload. A screen may state the explanation
 * only when it holds — if the backend's definition changes under us, the panel
 * reports the gap and stops claiming to know the cause, rather than printing a
 * confident sentence that has quietly become false.
 */
export type Reconciliation = {
  placed: number;
  counted: number;
  included: StatusCount[];
  excluded: StatusCount[];
  proves: boolean;
};

export function countedReconciliation(report: {
  placed: number;
  by_status: Record<string, number>;
  counted_as_revenue: number;
}): Reconciliation {
  const entries = Object.entries(report.by_status).filter(([, count]) => count > 0);
  const isCounted = ([status]: [string, number]) =>
    (COUNTED_STATUSES as readonly string[]).includes(status);

  const included = entries.filter(isCounted).map(([status, count]) => ({ status, count }));
  const excluded = entries
    .filter((entry) => !isCounted(entry))
    .map(([status, count]) => ({ status, count }));

  const sum = included.reduce((total, row) => total + row.count, 0);

  return {
    placed: report.placed,
    counted: report.counted_as_revenue,
    included,
    excluded,
    proves: sum === report.counted_as_revenue,
  };
}

/* ---------------------------------------------------------- the bar rows --- */

/**
 * A status breakdown in a stated vocabulary order, zeros dropped.
 *
 * The zeros are worth dropping and the sum is worth keeping: `/analytics/shipping`
 * reports all ten shipment statuses and eight of them are 0 on this shop, which
 * at 390px is eight rows of nothing beside two real ones. Dropping them does not
 * disturb the sum, which is the property the breakdown is on screen for.
 *
 * A status outside the vocabulary sorts last rather than being dropped —
 * `/analytics/orders` counts one into `placed` if a plugin registers it, and a
 * breakdown that silently omits it would stop summing.
 *
 * `lib/cod.ts`'s `codByStatus()` is this operation with the COD vocabulary baked
 * in. It is left alone: it is tested, it is called from a shipped screen, and
 * this branch's sweep is the envelope reader, not every near-duplicate in `lib/`.
 */
export function statusCounts(
  byStatus: Record<string, number>,
  order: readonly string[],
): StatusCount[] {
  return Object.entries(byStatus)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
    })
    .map(([status, count]) => ({ status, count }));
}

/**
 * A bar's length as a fraction of the largest in its set, clamped to 0–1.
 *
 * Against the maximum rather than the total: these are magnitude comparisons —
 * which product sold most, which wilaya ordered most — and scaling to the total
 * would render the top bar of a flat set at 12 % and the whole chart as noise.
 * A share of the whole is a different question and is printed as a number where
 * it is asked.
 *
 * Zero max returns 0 rather than `NaN`, which would reach the DOM as an invalid
 * width and silently render full-length.
 */
export function barShare(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/* -------------------------------------------------------- the geography --- */

/**
 * The wilaya rows and the unattributed orders, as one ranked set.
 *
 * **The unattributed slice is larger than every attributed wilaya combined** —
 * 249 orders against 39 and 1 — and it is not a rounding remainder: a wilaya
 * comes off the *shipment*, and an order that was never shipped carries only the
 * free-text wilaya on its address, which the backend refuses to guess at. Its
 * `reason` says so in the payload.
 *
 * So it is returned as a labelled row in the same ranking, not as a wedge with
 * no name and not as "other". Sorted by orders, which puts it first here — and
 * that is the honest picture, because "we cannot attribute most of this" is the
 * report's actual headline.
 *
 * `share` is of the whole set including the unattributed orders, so the shares
 * sum to 1 and the reader is not invited to conclude that Adrar is 97 % of the
 * shop.
 */
export type WilayaSlice = {
  key: string;
  kind: "wilaya" | "unattributed";
  wilayaId: number | null;
  name: string;
  nameAr: string;
  reason: string | null;
  orders: number;
  revenue: string | null;
  share: number;
};

export function wilayaSlices(report: ShippingReport): WilayaSlice[] {
  const attributed: WilayaSlice[] = report.by_wilaya.map((row: WilayaRow) => ({
    key: `wilaya-${row.wilaya_id}`,
    kind: "wilaya" as const,
    wilayaId: row.wilaya_id,
    name: row.name,
    nameAr: row.name_ar,
    reason: null,
    orders: row.orders,
    revenue: row.revenue ?? null,
    share: 0,
  }));

  const rows: WilayaSlice[] = [
    ...attributed,
    {
      key: "unattributed",
      kind: "unattributed",
      wilayaId: null,
      name: "",
      nameAr: "",
      reason: report.unattributed.reason,
      orders: report.unattributed.orders,
      revenue: report.unattributed.revenue ?? null,
      share: 0,
    },
  ];

  const total = rows.reduce((sum, row) => sum + row.orders, 0);

  return rows
    .filter((row) => row.orders > 0)
    .map((row) => ({ ...row, share: total > 0 ? row.orders / total : 0 }))
    .sort((a, b) => b.orders - a.orders);
}

/* ------------------------------------------------------- what has signal --- */

/**
 * Whether a report's window holds anything at all.
 *
 * **`range=today` on a shop with no orders today answers 200 with every block
 * present and every figure zero** — measured on all seven routes: `best_sellers`
 * is `[]`, `providers` is `[]`, `by_wilaya` is `[]`, and every count and rate is
 * `0` or `"0.0000"`. Nothing is omitted, so there is no missing key to detect it
 * by.
 *
 * That matters because a screen of thirty zeros and a `0,0 %` delivery rate reads
 * as a broken report rather than as a quiet Tuesday. Each view asks this of its
 * own headline count and renders the empty state instead.
 */
export function isEmptyWindow(headline: number): boolean {
  return headline === 0;
}

/**
 * Whether a best-sellers set is worth drawing as bars.
 *
 * Measured on the 30-day window: 80, 70, 41, 40, 22, 12, 11, 9, 5, 3 units —
 * a genuine spread, so the bars carry information. On a narrow window it
 * collapses: `range=today` returns `[]`, and a shop with two orders returns two
 * rows of 1 unit each, where a bar chart draws two identical full-length bars and
 * implies a ranking that does not exist.
 *
 * So the chart is drawn only when the top row is more than the bottom row. Below
 * that the same rows render as a plain list of counts, which states what is known
 * without dressing it as a distribution.
 */
export function hasRankingSignal(values: readonly number[]): boolean {
  if (values.length < 2) return false;
  return Math.max(...values) > Math.min(...values);
}

/* -------------------------------------------------------------- rates --- */

/**
 * A rate string as a fraction, or null.
 *
 * The analytics rates are `"0.2109"` — a decimal fraction, unlike a coupon's
 * `"10.00"`, which `formatPercent` reads as ten percent. Feeding one to the other
 * renders 21 % as 0,2 %, so they do not share a formatter and this returns the
 * fraction `Intl`'s `style: "percent"` expects.
 *
 * `lib/cod.ts`'s `ratePercent()` is the same parse against the COD payload and is
 * left where it is; `formatRate()` in `lib/format/money.ts` is what both feed.
 */
export function rateFraction(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * The orders report's headline, for the dashboard's pending-fulfilment card.
 *
 * Pending plus processing: the orders that have been placed and not yet resolved
 * one way or the other, which is the number a stockroom actually acts on. Read
 * off `by_status` rather than derived from `placed` minus the terminal statuses,
 * because that subtraction silently absorbs any status the vocabulary does not
 * know.
 */
export function awaitingFulfilment(report: Pick<OrdersReport, "by_status">): number {
  return (report.by_status.pending ?? 0) + (report.by_status.processing ?? 0);
}

/* ---------------------------------------------------------- the dashboard --- */

/**
 * A dashboard card: one figure, and the screen it came from.
 *
 * `href` is not decoration and is not optional. ADMIN_PANEL.md's rule is that
 * **a dashboard number that cannot be drilled into is decoration**, so the type
 * makes a card without a destination unrepresentable.
 *
 * `value` stays in the API's own shape — a decimal string for money, a fraction
 * string for a rate, the number for a count — and `kind` says which formatter it
 * belongs to. Nothing here formats: this is the vocabulary module, and it is
 * imported by a client component.
 */
export type DashboardCard = {
  key: string;
  kind: "count" | "money" | "rate";
  value: string;
  /** Appended to `/{locale}`. */
  href: string;
  /** Exactly one card is the hero, and it is the first. */
  hero: boolean;
};

/**
 * The two card sets, and this function is the money gate.
 *
 * ADMIN_PANEL.md: *"the screen must be complete without it — not a layout with
 * holes. Two card sets, chosen by `canSeeMoney(me)`."* So this returns a
 * different **set**, not the same set with blanks in it, and the two sets are
 * each a whole dashboard:
 *
 *   with money     net revenue leads, collected sits beside it, and the
 *                  operational cards follow
 *   without money  orders placed leads and new customers takes the slot the
 *                  money cards had, so the grid has the same shape and the same
 *                  count rather than a visible gap where a card was removed
 *
 * **The state this branches on cannot be reached by a production role today.**
 * The two-tier collapse gave Manager both `ac_view_analytics` and
 * `ac_manage_orders`, so `canSeeMoney()` is true for both live tiers and
 * `meta.money_visible` is never false for one of them. It is still built, because
 * the API enforces the gate regardless and a third tier brings the state
 * straight back — and it is still *covered*, because a retired role is mintable
 * and reaches it exactly: measured 2026-08-21, a Support Agent gets a 403 from
 * `/analytics/revenue` and an overview with no `revenue` block at all.
 *
 * A pure function so the branch is a unit test rather than a screenshot.
 */
export function dashboardCards(report: OverviewReport, money: boolean): DashboardCard[] {
  const operational: DashboardCard[] = [
    {
      key: "awaiting",
      kind: "count",
      value: String(awaitingFulfilment(report.orders)),
      href: "/orders?status=processing",
      hero: false,
    },
    {
      key: "low_stock",
      kind: "count",
      value: String(report.inventory.low_stock),
      href: "/inventory",
      hero: false,
    },
    {
      key: "cod_confirmation",
      kind: "rate",
      value: report.cod.confirmation_rate,
      href: "/analytics?view=cod",
      hero: false,
    },
    {
      key: "shipping_delivery",
      kind: "rate",
      value: report.shipping.delivery_rate,
      href: "/analytics?view=shipping",
      hero: false,
    },
  ];

  /*
   * `report.revenue` is absent, not null, for a caller without
   * `ac_manage_orders`. `money` is the panel's own reading of the identity; the
   * field's presence is the API's. Both are required, so a disagreement between
   * them falls to the safe side rather than rendering an `undefined`.
   */
  if (money && report.revenue !== undefined) {
    const revenue = report.revenue;
    return [
      { key: "net", kind: "money", value: revenue.net, href: "/analytics?view=revenue", hero: true },
      {
        key: "collected",
        kind: "money",
        value: revenue.collected,
        href: "/analytics?view=revenue",
        hero: false,
      },
      {
        key: "orders_placed",
        kind: "count",
        value: String(report.orders.placed),
        href: "/orders",
        hero: false,
      },
      ...operational,
    ];
  }

  return [
    {
      key: "orders_placed",
      kind: "count",
      value: String(report.orders.placed),
      href: "/orders",
      hero: true,
    },
    /*
     * Two cards, because the money set has two — net and collected — and the
     * grids must come out the same length. This is the part that is easy to get
     * wrong and easy to not notice: an earlier draft of this function returned
     * seven cards with money and six without, which is precisely the "layout
     * with holes" the specification forbids, and the docblock above claimed
     * otherwise. The unit test compares the two sets by length rather than
     * checking the second for absences, which is what caught it.
     */
    {
      key: "completed",
      kind: "count",
      value: String(report.orders.completed),
      href: "/orders?status=completed",
      hero: false,
    },
    {
      key: "customers",
      kind: "count",
      value: String(report.customers.customers),
      href: "/customers",
      hero: false,
    },
    ...operational,
  ];
}
