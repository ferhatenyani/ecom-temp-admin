import { describe, expect, it } from "vitest";
import {
  LABEL_METADATA_KEYS,
  applicableRules,
  byNarrowestFirst,
  createShipmentGate,
  providerLabel,
  providerStatus,
  ruleScope,
  shipmentCodAmount,
  shipmentWilayaId,
  stripLabelUrls,
  stripLabelUrlsFrom,
} from "@/lib/shipping";
import { codAttemptGate, orderRefusesCodAttempt } from "@/lib/cod-status";
import { byStatusSumsToTotal, codByStatus, codFigures, ratePercent } from "@/lib/cod";
import { isTerminalShipmentStatus, nextShipmentStatuses } from "@/lib/shipment-status";
import type { Shipment, ShippingRule } from "@/lib/api/schemas/shipping";
import type { CodStatistics } from "@/lib/api/schemas/payment";

/* --------------------------------------------------------- fixtures --- */

/** Shipment 215, verbatim from the live API on 2026-08-20. */
const manualShipment: Shipment = {
  id: 215,
  order_id: 3939,
  provider: "manual",
  provider_shipment_id: "MAN-3939-2",
  tracking_number: "MAN-3939-2",
  status: "cancelled",
  is_live: false,
  metadata: {
    delivery_type: "home",
    wilaya_id: 1,
    commune_id: 1,
    cod_amount: "4200.00",
  },
  created_at: "2026-08-19T01:10:25+00:00",
  updated_at: "2026-08-19T01:10:25+00:00",
};

/**
 * A shipment as a courier adapter would return one.
 *
 * No shipment in this shop carries a label — the only configured provider is
 * `manual` and in-house delivery issues none — so this is synthesised, and the
 * URL is the one the backend's own `LoggerTest` uses as its worked example of the
 * thing that must never be logged.
 */
const courierShipment: Shipment = {
  ...manualShipment,
  id: 999,
  provider: "yalidine",
  is_live: true,
  status: "in_transit",
  metadata: {
    wilaya_id: 16,
    commune_id: 484,
    label: "https://api.yalidine.app/labels/abc?token=live-token",
    labels: ["https://api.yalidine.app/labels/abc?token=live-token"],
    signature_url: "https://api.yalidine.app/sig/abc?token=live-token",
    provider_status: "EN COURS",
    provider_status_label: "En cours de livraison",
    desk_id: 42,
  },
};

const rules: ShippingRule[] = [
  {
    id: 162,
    provider: "manual",
    wilaya_id: 0,
    commune_id: 0,
    delivery_type: "home",
    amount: "800.00",
    free_over: null,
    estimated_days: 5,
    is_active: true,
    specificity: 3,
    created_at: "2026-08-20T06:34:07+00:00",
    updated_at: "2026-08-20T06:34:07+00:00",
  },
  {
    id: 163,
    provider: "manual",
    wilaya_id: 16,
    commune_id: 0,
    delivery_type: "home",
    amount: "500.00",
    free_over: "10000.00",
    estimated_days: 2,
    is_active: true,
    specificity: 7,
    created_at: "2026-08-20T06:34:07+00:00",
    updated_at: "2026-08-20T06:34:07+00:00",
  },
  {
    id: 164,
    provider: "manual",
    wilaya_id: 16,
    commune_id: 484,
    delivery_type: "home",
    amount: "350.00",
    free_over: null,
    estimated_days: 1,
    is_active: true,
    specificity: 15,
    created_at: "2026-08-20T06:34:07+00:00",
    updated_at: "2026-08-20T06:34:07+00:00",
  },
];

/* ------------------------------------------------------ label URLs --- */

describe("shipment label URLs", () => {
  /**
   * The whole reason the stripper exists. `Shipment::toArray()` emits `metadata`
   * verbatim — measured — so a courier's label URL reaches the panel's JSON the
   * moment an adapter is switched on, and Part III forbids it ever reaching a
   * client component.
   */
  it("removes every credential key a courier puts in metadata", () => {
    const safe = stripLabelUrls(courierShipment);

    expect(safe.metadata).not.toHaveProperty("label");
    expect(safe.metadata).not.toHaveProperty("labels");
    expect(safe.metadata).not.toHaveProperty("signature_url");

    // And the token appears nowhere in what survives, under any key.
    expect(JSON.stringify(safe)).not.toContain("live-token");
    expect(JSON.stringify(safe)).not.toContain("yalidine.app/labels");
  });

  /**
   * The positive control. A stripper that returned an empty object would pass
   * every assertion above and destroy the screen.
   */
  it("keeps everything that is not a credential", () => {
    const safe = stripLabelUrls(courierShipment);

    expect(safe.metadata.wilaya_id).toBe(16);
    expect(safe.metadata.commune_id).toBe(484);
    expect(safe.metadata.desk_id).toBe(42);
    expect(safe.metadata.provider_status).toBe("EN COURS");
    expect(safe.id).toBe(999);
    expect(safe.tracking_number).toBe("MAN-3939-2");
  });

  /**
   * `provider_status_label` is ZR Express's wording for a parcel state and is not
   * a URL. The backend masks by **exact** key match for exactly this reason, and
   * a substring rule here would blank a status the operator needs.
   */
  it("matches by exact key, so a status label survives", () => {
    const safe = stripLabelUrls(courierShipment);
    expect(safe.metadata.provider_status_label).toBe("En cours de livraison");
  });

  /**
   * The panel has to know a label *exists* to offer the button, and must not
   * receive the URL to do it.
   */
  it("reports which credential keys were present, by name and never by value", () => {
    const safe = stripLabelUrls(courierShipment);

    expect(safe.labelKeys.sort()).toEqual(["label", "labels", "signature_url"]);
    expect(safe.labelKeys.join()).not.toContain("http");
  });

  it("reports no keys for a shipment that carries none, which is all 111 of them today", () => {
    const safe = stripLabelUrls(manualShipment);

    expect(safe.labelKeys).toEqual([]);
    expect(safe.metadata).toEqual(manualShipment.metadata);
  });

  it("strips a whole list", () => {
    const safe = stripLabelUrlsFrom([manualShipment, courierShipment]);

    expect(JSON.stringify(safe)).not.toContain("live-token");
    expect(safe).toHaveLength(2);
  });

  /** The list matches the backend's `Logger::SENSITIVE_EXACT` exactly. */
  it("names the same three keys the backend masks", () => {
    expect([...LABEL_METADATA_KEYS]).toEqual(["label", "labels", "signature_url"]);
  });
});

/* ------------------------------------------------------- the rules --- */

describe("the shipping rules resolver", () => {
  /**
   * The assertion the whole editor exists for, against the three fixtures created
   * on the live API — which answered 350 / 500 / 800 for these same destinations.
   */
  it("resolves commune over wilaya over national", () => {
    expect(applicableRules(rules, 16, 484)[0].amount).toBe("350.00");
    expect(applicableRules(rules, 16, 483)[0].amount).toBe("500.00");
    expect(applicableRules(rules, 1, 1)[0].amount).toBe("800.00");
  });

  /**
   * The losers are the point. "Why is this destination 350 DA" is answered by the
   * rules it beat, so the editor shows them rather than only the winner.
   */
  it("returns every rule that could apply, narrowest first", () => {
    const applicable = applicableRules(rules, 16, 484);

    expect(applicable.map((rule) => rule.id)).toEqual([164, 163, 162]);
    expect(applicable.map(ruleScope)).toEqual(["commune", "wilaya", "national"]);
  });

  it("never adds rules together — one wins and the rest are context", () => {
    const applicable = applicableRules(rules, 16, 484);
    const total = applicable.reduce((sum, rule) => sum + Number(rule.amount), 0);

    // 350 + 500 + 800. The winner is not the sum, and nothing anywhere computes one.
    expect(total).toBe(1650);
    expect(applicable[0].amount).toBe("350.00");
  });

  it("skips an inactive rule, falling through to the next widest", () => {
    const withCommuneOff = rules.map((rule) =>
      rule.id === 164 ? { ...rule, is_active: false } : rule,
    );

    expect(applicableRules(withCommuneOff, 16, 484)[0].amount).toBe("500.00");
  });

  it("sorts by the server's specificity, never by a ranking of its own", () => {
    expect(byNarrowestFirst(rules).map((rule) => rule.specificity)).toEqual([15, 7, 3]);
  });

  it("names a scope from the ids, since a rank is not a label", () => {
    expect(ruleScope(rules[0])).toBe("national");
    expect(ruleScope(rules[1])).toBe("wilaya");
    expect(ruleScope(rules[2])).toBe("commune");
  });

  it("resolves nothing when no rule covers the destination", () => {
    const wilayaOnly = [rules[1]];
    expect(applicableRules(wilayaOnly, 31, 900)).toEqual([]);
  });
});

/* --------------------------------------------------- shipment rows --- */

describe("shipment rows", () => {
  it("falls back to the raw provider name for one that is not registered", () => {
    const providers = [{ name: "manual", label: "In-house delivery", is_default: true }];

    expect(providerLabel("manual", providers)).toBe("In-house delivery");
    // Shipment 213 really carries this, while /shipping/providers reports only manual.
    expect(providerLabel("acfake", providers)).toBe("acfake");
  });

  it("reads the wilaya off the shipment, and treats the national wildcard as absent", () => {
    expect(shipmentWilayaId(stripLabelUrls(manualShipment))).toBe(1);

    const noWilaya = stripLabelUrls({ ...manualShipment, metadata: { wilaya_id: 0 } });
    expect(shipmentWilayaId(noWilaya)).toBeNull();
  });

  it("keeps a COD amount as the decimal string it arrived as", () => {
    expect(shipmentCodAmount(stripLabelUrls(manualShipment))).toBe("4200.00");
    expect(shipmentCodAmount(stripLabelUrls({ ...manualShipment, metadata: {} }))).toBeNull();
  });

  it("surfaces the provider's own spelling, which is where a mis-mapping shows", () => {
    const fake = stripLabelUrls({
      ...manualShipment,
      provider: "acfake",
      metadata: { provider_status: "RAW_DELIVERED" },
    });

    expect(providerStatus(fake)).toBe("RAW_DELIVERED");
    expect(providerStatus(stripLabelUrls(manualShipment))).toBeNull();
  });
});

describe("the one-live-shipment rule", () => {
  it("blocks a create while one is live, and names the parcel blocking it", () => {
    const live = stripLabelUrls({ ...manualShipment, id: 220, is_live: true, status: "created" });
    const gate = createShipmentGate([stripLabelUrls(manualShipment), live]);

    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.blockedBy.id).toBe(220);
  });

  /**
   * History accumulates and does not block — order 3939 carries four finished
   * shipments and a fifth is allowed. The constraint is on live ones.
   */
  it("allows a create when every shipment is finished", () => {
    const dead = [
      stripLabelUrls(manualShipment),
      stripLabelUrls({ ...manualShipment, id: 214, status: "delivered" }),
    ];

    expect(createShipmentGate(dead).allowed).toBe(true);
    expect(createShipmentGate([]).allowed).toBe(true);
  });
});

describe("shipment status moves", () => {
  /**
   * Measured: a live shipment moves anywhere, including backwards
   * (`in_transit` → `pending` answered 200). A terminal one moves nowhere, and
   * its 409 carries no `allowed` list — which is the one place this branch cannot
   * follow the panel's usual "render what the 409 says" rule.
   */
  it("offers every other status while the parcel is live", () => {
    const next = nextShipmentStatuses("in_transit", true);

    expect(next).toContain("pending");
    expect(next).toContain("delivered");
    expect(next).not.toContain("in_transit");
    expect(next).toHaveLength(9);
  });

  it("offers nothing once the parcel has finished", () => {
    expect(nextShipmentStatuses("delivered", false)).toEqual([]);
    expect(isTerminalShipmentStatus("delivered")).toBe(true);
    expect(isTerminalShipmentStatus("in_transit")).toBe(false);
  });
});

/* ----------------------------------------------------------- COD --- */

describe("the COD attempt gate", () => {
  const pending = { enabled: true, allowed_outcomes: ["confirmed", "rejected", "unreachable"] };

  it("offers exactly what the server says is allowed", () => {
    const gate = codAttemptGate(pending, "processing");

    expect(gate.allowed).toBe(true);
    if (gate.allowed) expect(gate.outcomes).toEqual(["confirmed", "rejected", "unreachable"]);
  });

  it("refuses when COD is switched off for the order", () => {
    const gate = codAttemptGate({ ...pending, enabled: false }, "processing");

    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.reason).toBe("disabled");
  });

  /**
   * The trap. Order 3879 carries `allowed_outcomes: []` *and* a cancelled order,
   * and the 409 blamed the order — that check runs first. So a record can report
   * outcomes the order will refuse anyway, and this gate has to run in the
   * server's order or the reason on screen is the wrong one.
   */
  it("refuses on the order's own status before it looks at the outcomes", () => {
    const gate = codAttemptGate(pending, "cancelled");

    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.reason).toBe("order_closed");

    expect(orderRefusesCodAttempt("refunded")).toBe(true);
    expect(orderRefusesCodAttempt("processing")).toBe(false);
  });

  it("refuses a finished COD record, which is what an empty allowed list means", () => {
    const gate = codAttemptGate({ enabled: true, allowed_outcomes: [] }, "processing");

    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.reason).toBe("finished");
  });

  /** A confirmed order may be re-confirmed and nothing else — measured. */
  it("carries a single-outcome list through unchanged", () => {
    const gate = codAttemptGate({ enabled: true, allowed_outcomes: ["confirmed"] }, "processing");

    expect(gate.allowed).toBe(true);
    if (gate.allowed) expect(gate.outcomes).toEqual(["confirmed"]);
  });
});

describe("the COD statistics report", () => {
  /** Verbatim from the live API on 2026-08-20. */
  const statistics: CodStatistics = {
    total_orders: 527,
    by_status: { pending: 192, confirmed: 74, rejected: 37, unreachable: 0, cancelled: 224 },
    confirmed_orders: 111,
    delivered_orders: 39,
    returned_orders: 38,
    rates: {
      confirmation: "0.2106",
      rejection: "0.0702",
      cancellation: "0.4250",
      delivery: "0.0740",
      return: "0.0721",
    },
  };

  /**
   * The whole reason this module exists: two different "confirmed" counts in one
   * payload, and no way to print either without saying what it counts.
   */
  it("gives the two confirmed counts different scopes", () => {
    const figures = codFigures(statistics);
    const current = figures.find((figure) => figure.key === "current_confirmed");
    const ever = figures.find((figure) => figure.key === "ever_confirmed");

    expect(current).toEqual({ key: "current_confirmed", scope: "now", value: 74 });
    expect(ever).toEqual({ key: "ever_confirmed", scope: "ever", value: 111 });
  });

  it("has no figure without a scope", () => {
    for (const figure of codFigures(statistics)) {
      expect(figure.scope).toBeTruthy();
    }
  });

  /** `by_status` accounts for every order, which is what makes it explanatory. */
  it("sums by_status to total_orders", () => {
    expect(byStatusSumsToTotal(statistics)).toBe(true);
    // The control: a payload that does not sum is detected rather than assumed.
    expect(byStatusSumsToTotal({ ...statistics, total_orders: 500 })).toBe(false);
  });

  it("drops the zero rows and keeps the shop's own order", () => {
    expect(codByStatus(statistics)).toEqual([
      { status: "pending", count: 192 },
      { status: "confirmed", count: 74 },
      { status: "rejected", count: 37 },
      { status: "cancelled", count: 224 },
    ]);
  });

  /** `confirmation` really is `confirmed_orders / total_orders`. */
  it("parses a rate, and the published one divides by the count it claims", () => {
    expect(ratePercent("0.2106")).toBeCloseTo(0.2106);
    expect(ratePercent(statistics.rates.confirmation)).toBeCloseTo(
      statistics.confirmed_orders / statistics.total_orders,
      4,
    );
  });

  it("returns null rather than NaN for a rate it cannot parse", () => {
    expect(ratePercent("")).toBeNull();
    expect(ratePercent(undefined)).toBeNull();
    expect(ratePercent("n/a")).toBeNull();
  });
});
