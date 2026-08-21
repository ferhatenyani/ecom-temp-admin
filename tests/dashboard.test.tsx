/**
 * The dashboard's two card sets, rendered.
 *
 * The panel's first component test, and it exists for one reason: **the money
 * gate branches on a state no production role can reach.** The two-tier collapse
 * gave Manager both `ac_view_analytics` and `ac_manage_orders`, so
 * `canSeeMoney()` is true for both live tiers.
 *
 * It is covered three ways rather than one, because each catches something the
 * others cannot:
 *
 *   unit       `dashboardCards()` — the branch itself, both sets, by length
 *   component  this file — that both sets actually *render*, against a synthetic
 *              payload, with no holes and no `undefined` formatted as money
 *   e2e        `e2e/analytics.spec.ts` — against the live API with a real
 *              credential that reaches the state, which is a retired role and
 *              mintable; `AC_LIMITED_*` is already a Support Agent
 *
 * The component layer is the one that would catch a card set that computes
 * correctly and then renders `NaN`, or a translation key that exists in one
 * branch and not the other — neither of which a pure-function test can see.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { overviewReport } from "@/lib/api/schemas/analytics";
import { DashboardScreen } from "@/app/[locale]/(panel)/dashboard/DashboardScreen";

// The screen navigates on a range change; nothing here changes the range.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const RANGE = {
  preset: "30d",
  from: "2026-07-23",
  to: "2026-08-21",
  days: 30,
  timezone: "+00:00",
};

const BASE = {
  range: RANGE,
  orders: {
    placed: 844,
    by_status: {
      pending: 197,
      processing: 160,
      "on-hold": 1,
      completed: 45,
      cancelled: 357,
      refunded: 83,
      failed: 1,
    },
    cancelled: 357,
    completed: 45,
    refunded: 83,
    guest_orders: 389,
    counted_as_revenue: 289,
  },
  customers: {
    customers: 9,
    new: 9,
    returning: 0,
    guest_orders: 185,
    rates: { new: "1.0000", returning: "0.0000" },
  },
  cod: {
    total_orders: 569,
    confirmed_orders: 120,
    confirmation_rate: "0.2109",
    delivery_rate: "0.0738",
  },
  shipping: { shipments: 123, delivered: 81, live: 0, delivery_rate: "0.6585" },
  inventory: { low_stock: 3 },
};

/** What a Super Admin receives. */
const WITH_MONEY = {
  ...BASE,
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
    unavailable: { margin: "No cost of goods exists." },
    refund_count: 83,
    refunded_orders: 83,
  },
};

/** What a caller without `ac_manage_orders` receives: no `revenue` key at all. */
const WITHOUT_MONEY = BASE;

function mount(report: unknown, canMoney: boolean) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <DashboardScreen
        locale="fr"
        range={{ preset: "30d", from: "", to: "" }}
        report={overviewReport.parse(report)}
        canMoney={canMoney}
        generatedAt="2026-08-21T01:09:00+00:00"
      />
    </NextIntlClientProvider>,
  );
}

const cards = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-testid^='card-']"));

describe("the dashboard's two card sets", () => {
  it("renders a complete grid with money", () => {
    const { container } = mount(WITH_MONEY, true);
    const rendered = cards(container);

    expect(rendered).toHaveLength(7);
    expect(container.querySelector("[data-testid='card-net']")).not.toBeNull();
    expect(container.querySelector("[data-testid='card-collected']")).not.toBeNull();

    // 719 700,00 DA — formatted with the report's own currency, and grouped.
    expect(screen.getByTestId("card-net").textContent).toMatch(/719\D?700/);
  });

  it("renders a complete grid without money, and no holes where the money was", () => {
    const { container } = mount(WITHOUT_MONEY, false);
    const rendered = cards(container);

    // Same count as the money set. A grid that drops two cards and leaves the
    // gaps tells a Support Agent the screen is broken.
    expect(rendered).toHaveLength(7);
    expect(container.querySelector("[data-testid='card-net']")).toBeNull();
    expect(container.querySelector("[data-testid='card-collected']")).toBeNull();
    expect(container.querySelector("[data-testid='card-orders_placed']")).not.toBeNull();
    expect(container.querySelector("[data-testid='card-completed']")).not.toBeNull();
  });

  it("prints no currency, and no empty currency-shaped hole, without money", () => {
    const { container } = mount(WITHOUT_MONEY, false);
    const text = container.textContent ?? "";

    // The shop's currency renders as `DA` in French. None of it may appear —
    // neither a figure nor a stray symbol beside a blank.
    expect(text).not.toMatch(/\bDA\b/);
    expect(text).not.toMatch(/DZD/);
    // And nothing rendered as an unformatted value.
    expect(text).not.toMatch(/NaN|undefined|null/);
  });

  it("gives every card a destination in both sets", () => {
    for (const [report, canMoney] of [
      [WITH_MONEY, true],
      [WITHOUT_MONEY, false],
    ] as const) {
      const { container, unmount } = mount(report, canMoney);
      for (const card of cards(container)) {
        // A dashboard number that cannot be drilled into is decoration.
        expect(card.getAttribute("href")).toMatch(/^\/fr\//);
      }
      unmount();
    }
  });

  it("labels and scopes every card in both sets", () => {
    for (const [report, canMoney] of [
      [WITH_MONEY, true],
      [WITHOUT_MONEY, false],
    ] as const) {
      const { container, unmount } = mount(report, canMoney);
      for (const card of cards(container)) {
        const text = card.textContent ?? "";
        // A missing message renders as the key itself, which is how a
        // translation added to one branch and not the other would show up.
        expect(text).not.toMatch(/analytics\.card/);
        expect(text.trim().length).toBeGreaterThan(0);
      }
      unmount();
    }
  });

  it("says a window is quiet rather than showing seven zeros", () => {
    /*
     * `range=today` on a shop with no orders today answers 200 with every
     * figure zero — measured on all seven routes. Nothing is omitted, so there
     * is no missing key to detect it by and no error to render.
     */
    const quiet = {
      ...BASE,
      orders: { ...BASE.orders, placed: 0, completed: 0 },
    };
    const { container } = mount(quiet, false);
    expect(container.textContent).toContain("Aucune commande sur cette période");
  });
});
