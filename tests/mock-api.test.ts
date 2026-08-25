/**
 * @vitest-environment node
 *
 * The mock has to be wrong in the same ways the shop is, and right in every
 * other way. This is the half that checks "right".
 *
 * Every assertion below parses a mock response with the panel's **actual** Zod
 * schema through the panel's **actual** `unwrap()`. Not a hand-written copy of
 * the shape: a copy is a second contract that drifts, and a mock validated
 * against a drifted copy is a harness that renders screens from data the real
 * panel would reject at its own boundary. If a schema tightens, this suite goes
 * red before a single screenshot is taken.
 *
 * The node environment is deliberate — `respond()` is pure but the coverage
 * check below reads the schema directory off disk.
 */
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_PATH, resetState, respond, type MockResponse } from "@/scripts/mock-api.mjs";
import { unwrap, listMeta } from "@/lib/api/envelope";
import { ApiError } from "@/lib/api/errors";
import { decodeEntities } from "@/lib/format/html";
import { z } from "zod";

import {
  codRecord,
  identity,
  order,
  orderList,
  orderNotes,
  timeline,
  wilayas,
} from "@/lib/api/schemas/order";
import {
  shipment as shipmentSchema,
  shipments as shipmentsSchema,
  shippingProviders,
} from "@/lib/api/schemas/shipping";
import {
  paymentMethods,
  payments as paymentsSchema,
  verifyResult,
} from "@/lib/api/schemas/payment";
import {
  attributeTerms,
  deleteResult,
  facets as facetsSchema,
  globalAttributes,
  product,
  productCategories,
  productList,
  productListMeta,
  variationList,
} from "@/lib/api/schemas/product";
import {
  CATALOG_VISIBILITIES,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  STOCK_STATUSES,
} from "@/lib/product-status";
import { priceSpan, variationLabel } from "@/lib/products";
import { CONSENT_SOURCES, customerDetail, customerList } from "@/lib/api/schemas/customer";
import {
  consentRecord,
  hasNoOrders,
  looksLikeAName,
  statFigures,
  statusBreakdown,
} from "@/lib/customers";
import { notificationList } from "@/lib/api/schemas/notification";
import { QUEUE_STATES, stateCounts } from "@/lib/notifications";
import {
  adjustResult,
  inventoryItem,
  inventoryList,
  movementList,
  movementSummary,
} from "@/lib/api/schemas/inventory";
import { ALL_REASONS } from "@/lib/movement-reason";
import {
  coupon,
  couponDetail,
  couponList,
  eligibleCategoryList,
  eligibleProductList,
} from "@/lib/api/schemas/coupon";
import { COUPON_STATUSES, DISCOUNT_TYPES } from "@/lib/coupon-status";
import {
  expiryInputValue,
  missingRefs,
  normalizeCode,
  refLabel,
  threshold,
  usage,
} from "@/lib/coupons";

function get(path: string, query = ""): MockResponse {
  return respond("GET", `${BASE_PATH}${path}`, new URLSearchParams(query));
}

/**
 * The writes. A body is passed through exactly as the panel's `acWrite()` sends
 * it — `POST /payments/{id}/verify` sends none at all, which is why `body` is
 * optional here rather than defaulted to `{}`.
 */
function write(method: string, path: string, body?: unknown, query = ""): MockResponse {
  return respond(method, `${BASE_PATH}${path}`, new URLSearchParams(query), body ?? null);
}

/**
 * A write in one test must not be readable by the next. The mock's state is
 * rebuilt from its seeds rather than unwound, which is the same thing that
 * happens at every process start and is what keeps a capture run byte-stable.
 */
beforeEach(() => resetState());

/** The panel's own boundary, applied to the mock's own output. */
function parse<T>(schema: z.ZodType<T>, response: MockResponse) {
  return unwrap(schema, response.body, response.status);
}

/**
 * A list endpoint's `meta` is not optional decoration — pagination is the only
 * thing that tells a screen how many rows exist — so every list is checked for
 * it and not merely for its payload.
 */
function parseList<T>(schema: z.ZodType<T>, response: MockResponse) {
  const { data, meta } = parse(schema, response);
  expect(meta, "a list endpoint must carry meta").not.toBeNull();
  return { data, meta: listMeta.parse(meta) };
}

/**
 * The failure half of the boundary. A 400 that is only checked for its status is
 * a 400 whose body nobody has read, and the body is the whole point on this API:
 * a parameter error names the parameter, and the attributes filter names it
 * somewhere else entirely.
 */
function apiError(response: MockResponse): ApiError {
  try {
    parse(productList, response);
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  return expect.unreachable("the response did not throw");
}

describe("the envelope", () => {
  it("answers an unmocked path with a well-formed rest_no_route error", () => {
    const response = get("/analytics/overview");
    expect(response.status).toBe(404);

    // Loudly, and through the same code path a real 404 would take. A mock that
    // answered `{data: []}` here would let a screen calling an endpoint nobody
    // wrote render a convincing empty table.
    expect(() => parse(orderList, response)).toThrowError(ApiError);
    try {
      parse(orderList, response);
      expect.unreachable("the error envelope must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("rest_no_route");
      expect((error as ApiError).status).toBe(404);
    }
  });

  it("refuses a verb it has no handler for, rather than falling through", () => {
    expect(respond("POST", `${BASE_PATH}/orders`).status).toBe(404);
  });

  it("refuses a path outside the base", () => {
    expect(respond("GET", "/wp-json/wp/v2/users").status).toBe(404);
  });
});

describe("GET /auth/me", () => {
  it("parses as the identity the panel renders from", () => {
    const { data } = parse(identity, get("/auth/me"));
    expect(data.capabilities).toContain("ac_manage_orders");
    // A detail response carries no `meta`; only lists do.
    expect(parse(identity, get("/auth/me")).meta).toBeNull();
  });
});

describe("GET /locations/wilayas", () => {
  it("parses, and is bilingual on all 58 rows", () => {
    const { data } = parseList(wilayas, get("/locations/wilayas"));
    expect(data).toHaveLength(58);
    expect(data.every((row) => row.name !== "" && row.name_ar !== "")).toBe(true);
  });
});

describe("GET /orders", () => {
  it("parses the list and its pagination", () => {
    const { data, meta } = parseList(orderList, get("/orders", "per_page=20&page=1"));
    expect(data).toHaveLength(20);
    expect(meta.total).toBe(633);
    expect(meta.total_pages).toBe(32);
  });

  it("parses every one of the 633 rows, not only the first page", () => {
    // A fixture set is only as validated as its worst row, and the edge cases
    // here — no line items, a guest, an empty wilaya — are spread across pages.
    const rows = Array.from({ length: 7 }, (_, page) =>
      parseList(orderList, get("/orders", `per_page=100&page=${page + 1}`)).data,
    ).flat();
    expect(rows).toHaveLength(633);
    expect(rows.filter((row) => row.line_items.length === 0)).toHaveLength(45);
    expect(rows.filter((row) => row.customer_id === 0)).toHaveLength(288);
    expect(rows.filter((row) => row.billing.state === "")).toHaveLength(582);
  });

  it("parses a detail with the same schema the list uses", () => {
    const { data, meta } = parse(order, get("/orders/1000"));
    expect(data.id).toBe(1000);
    expect(meta).toBeNull();
  });

  it("404s an id that does not exist", () => {
    expect(get("/orders/999999").status).toBe(404);
  });
});

/**
 * The five routes the detail hangs off an order. Each one is parsed with the
 * schema the panel's own boundary uses, because a sub-resource the harness
 * serves in a shape the panel would reject is a screen that renders here and
 * throws in production.
 */
describe("the order detail's sub-resources", () => {
  it("serves notes whose created_at carries NO offset, unlike the order's", () => {
    const { data, meta } = parseList(orderNotes, get("/orders/1023/notes"));
    expect(data.length).toBeGreaterThan(0);
    expect(meta.total).toBe(data.length);

    // The asymmetry `lib/format/date.ts` exists to repair, in two assertions:
    // the note has no `T` and no offset, and the order beside it has both.
    // `new Date()` reads the first as *local* time and shifts it silently.
    for (const note of data) {
      expect(note.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
    expect(parse(order, get("/orders/1023")).data.date_created).toMatch(/T.+\+00:00$/);

    // And a note the customer wrote is distinguishable from one the shop wrote,
    // because the detail renders exactly that filter.
    expect(data.some((note) => note.customer_note)).toBe(true);
    expect(data.some((note) => !note.customer_note)).toBe(true);
    // Escaped the way WordPress escapes a note body.
    expect(data.some((note) => note.content.includes("&#039;"))).toBe(true);
  });

  it("serves an order with no notes as an empty list, not a 404", () => {
    const { data, meta } = parseList(orderNotes, get("/orders/1004/notes"));
    expect(data).toEqual([]);
    expect(meta.total).toBe(0);
  });

  it("serves a timeline with an empty actor and entities left undecoded", () => {
    const { data } = parseList(timeline, get("/orders/1023/timeline"));
    expect(data.length).toBeGreaterThan(0);

    // `""`, not null and not "system": a renderer that tested for truthiness and
    // one that tested for null behave differently and only one is right.
    const system = data.filter((entry) => entry.actor === "");
    expect(system.length).toBeGreaterThan(0);
    expect(data.every((entry) => typeof entry.actor === "string")).toBe(true);

    // The entity arrives raw and the panel's own decoder is what turns it into
    // an arrow. A fixture set of clean strings would let a screen stop calling
    // this and still look right against the harness.
    const stock = data.find((entry) => entry.summary.includes("&rarr;"));
    expect(stock, "a timeline must carry an entity to decode").toBeDefined();
    expect(decodeEntities(stock!.summary)).toContain("→");
    expect(decodeEntities(stock!.summary)).not.toContain("&rarr;");

    // The notes are already in it — measured — which is why the detail filters
    // the notes collection down to the customer's own rather than reprinting
    // every note a second time underneath.
    const notes = parseList(orderNotes, get("/orders/1023/notes")).data;
    for (const note of notes) {
      expect(data.some((entry) => entry.summary === note.content)).toBe(true);
    }
  });

  it("serves a COD record whose allowed_outcomes is the server's own answer", () => {
    const { data, meta } = parse(codRecord, get("/orders/1023/cod"));
    expect(meta).toBeNull();
    expect(data.status).toBe("confirmed");
    // Measured: a confirmed record allows only `confirmed`, because re-confirming
    // changes nothing but the attempt count while `confirmed → rejected` is a
    // different event entirely.
    expect(data.allowed_outcomes).toEqual(["confirmed"]);

    // The two records the refusals below are reachable from.
    expect(parse(codRecord, get("/orders/1004/cod")).data.enabled).toBe(false);
    expect(parse(codRecord, get("/orders/1006/cod")).data.allowed_outcomes).toEqual([]);
  });

  it("serves parcels, including a live one carrying a label credential", () => {
    const live = parseList(shipmentsSchema, get("/orders/1014/shipments")).data;
    expect(live).toHaveLength(1);
    expect(live[0].is_live).toBe(true);
    // `stripLabelUrls()` exists to keep this out of the RSC payload, so the
    // harness has to serve a parcel that actually has one or the strip is never
    // exercised by a capture.
    expect(live[0].metadata.label).toEqual(expect.any(String));

    const finished = parseList(shipmentsSchema, get("/orders/1023/shipments")).data;
    expect(finished[0].is_live).toBe(false);
    // A provider `/shipping/providers` does not list, exactly as shipment 213
    // measured — so a label lookup has to fall back to the raw name.
    const providers = parseList(shippingProviders, get("/shipping/providers")).data;
    expect(providers.some((p) => p.name === finished[0].provider)).toBe(false);

    expect(parseList(shipmentsSchema, get("/orders/1007/shipments")).data).toEqual([]);
  });

  it("serves payments, and a payment's stamp ends Z where a parcel's ends +00:00", () => {
    const { data } = parseList(paymentsSchema, get("/orders/1023/payments"));
    expect(data).toHaveLength(2);
    // Both notations in one branch, which is why `parseApiDate()` is the only
    // thing allowed to touch either.
    expect(data.every((row) => row.created_at.endsWith("Z"))).toBe(true);
    const parcel = parseList(shipmentsSchema, get("/orders/1023/shipments")).data[0];
    expect(parcel.created_at.endsWith("+00:00")).toBe(true);

    // A payment carries its own currency, like an order and unlike a product.
    expect(data.every((row) => row.currency !== "")).toBe(true);
    // And the amounts agree with the order they belong to, rather than being a
    // second set of figures on the same screen.
    const total = parse(order, get("/orders/1023")).data.total;
    expect(data.every((row) => row.amount === total)).toBe(true);
  });
});

describe("the detail's reference lists", () => {
  it("serves exactly one shipping provider, and it is the default", () => {
    const { data } = parseList(shippingProviders, get("/shipping/providers"));
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("manual");
    expect(data[0].is_default).toBe(true);
  });

  it("serves the two payment methods, chargily first", () => {
    const { data } = parseList(paymentMethods, get("/payments/methods"));
    expect(data.map((row) => row.name)).toEqual(["chargily", "cod"]);
    expect(data.filter((row) => row.is_default)).toHaveLength(1);
  });

  /**
   * **This is the one route in this suite with no real schema to parse against,
   * and it is written here rather than pretended away.** `CreateParcelSheet` and
   * `RulesView` both read `/locations/wilayas/{id}/communes` with an untyped
   * `acRead<Commune[]>` against a local `{id, name, name_ar}` — there is no Zod
   * boundary anywhere in `lib/api/schemas` for it — so this asserts exactly the
   * three keys those two components index into, and nothing more.
   */
  it("serves communes four segments deep, bilingual and paginated", () => {
    const commune = z.array(
      z.looseObject({ id: z.number(), name: z.string(), name_ar: z.string() }),
    );
    const { data, meta } = parseList(
      commune,
      get("/locations/wilayas/16/communes", "per_page=100"),
    );
    expect(data.length).toBeGreaterThan(0);
    expect(meta.total).toBe(data.length);
    expect(data.every((row) => row.name !== "" && row.name_ar !== "")).toBe(true);

    // Genuinely paginated, unlike `/locations/wilayas` — the picker asks for 100.
    expect(
      parseList(commune, get("/locations/wilayas/16/communes", "per_page=2")).data,
    ).toHaveLength(2);
    // And a wilaya that does not exist is a 404 rather than an empty list.
    expect(get("/locations/wilayas/999/communes").status).toBe(404);
  });
});

/**
 * The writes, and the one property that makes them worth having: a screen that
 * patches and refetches sees the new value. Nothing here is unwound afterwards —
 * `resetState()` in `beforeEach` rebuilds the whole thing from the seeds, which
 * is exactly what a second process does at load.
 */
describe("the writes", () => {
  it("patches a status and reads it back, with the derived flags recomputed", () => {
    expect(parse(order, get("/orders/1023")).data.status).toBe("completed");

    const patched = parse(order, write("PATCH", "/orders/1023", { status: "processing" })).data;
    expect(patched.status).toBe("processing");

    // The read after the write is the whole point.
    const reread = parse(order, get("/orders/1023")).data;
    expect(reread.status).toBe("processing");
    // And the list agrees with the detail, because a filter that disagreed with
    // the row it filtered would be a screen contradicting itself.
    expect(
      parseList(orderList, get("/orders", "status=processing&per_page=100")).data.some(
        (row) => row.id === 1023,
      ),
    ).toBe(true);

    // The timeline the transition wrote to is what `router.refresh()` fetches.
    const events = parseList(timeline, get("/orders/1023/timeline")).data;
    expect(events.some((entry) => entry.summary.includes("processing"))).toBe(true);
  });

  it("recomputes is_editable rather than leaving a finished order editable", () => {
    const editable = parse(order, write("PATCH", "/orders/1023", { status: "on-hold" })).data;
    expect(editable.is_editable).toBe(true);
    expect(editable.stock_reduced).toBe(false);

    const done = parse(order, write("PATCH", "/orders/1023", { status: "completed" })).data;
    expect(done.is_editable).toBe(false);
    expect(done.stock_reduced).toBe(true);
    expect(done.date_completed).not.toBeNull();
  });

  /**
   * `PATCH /orders/{id}/cod` takes `enabled` and **drops every other field
   * silently** — no 400, no mention in the response. That is why the panel can
   * PATCH the whole GET body back, and a mock that refused a stray key would
   * send someone off building a field filter nobody needs.
   */
  it("patches COD's enabled flag and ignores every other field without saying so", () => {
    const before = parse(codRecord, get("/orders/1023/cod")).data;

    const after = parse(
      codRecord,
      write("PATCH", "/orders/1023/cod", {
        ...before,
        enabled: false,
        status: "rejected",
        attempts: 99,
        allowed_outcomes: ["nonsense"],
      }),
    ).data;

    expect(after.enabled).toBe(false);
    expect(after.status).toBe(before.status);
    expect(after.attempts).toBe(before.attempts);
    expect(after.allowed_outcomes).toEqual(before.allowed_outcomes);
    expect(parse(codRecord, get("/orders/1023/cod")).data.enabled).toBe(false);
  });

  it("records a COD attempt and reads the new record back", () => {
    const before = parse(codRecord, get("/orders/1007/cod")).data;
    expect(before.status).toBe("pending");
    expect(before.attempts).toBe(0);

    const after = parse(
      codRecord,
      write("POST", "/orders/1007/cod/attempts", {
        outcome: "unreachable",
        reason: "Téléphone éteint.",
      }),
    ).data;
    expect(after.status).toBe("unreachable");
    expect(after.attempts).toBe(1);
    expect(after.reason).toBe("Téléphone éteint.");
    expect(after.last_attempt_at).not.toBeNull();

    expect(parse(codRecord, get("/orders/1007/cod")).data.attempts).toBe(1);
  });

  it("creates a parcel that then appears in the order's own list", () => {
    const created = parse(
      shipmentSchema,
      write("POST", "/orders/1007/shipments", {
        provider: "manual",
        wilaya_id: 16,
        commune_id: 484,
        delivery_type: "home",
      }),
    ).data;
    expect(created.is_live).toBe(true);
    expect(created.metadata.wilaya_id).toBe(16);
    // The destination comes off the body and never off the address, which is the
    // same fact analytics rests on.
    expect(created.metadata.commune_id).toBe(484);

    const list = parseList(shipmentsSchema, get("/orders/1007/shipments")).data;
    expect(list.map((row) => row.id)).toEqual([created.id]);
  });

  it("cancels a live parcel, and the order stops being blocked by it", () => {
    // One live parcel per order, so this is refused first.
    expect(
      write("POST", "/orders/1014/shipments", {
        provider: "manual",
        wilaya_id: 16,
        commune_id: 484,
        delivery_type: "home",
      }).status,
    ).toBe(409);

    const cancelled = parse(shipmentSchema, write("POST", "/shipments/7014/cancel")).data;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.is_live).toBe(false);
    expect(parseList(shipmentsSchema, get("/orders/1014/shipments")).data[0].is_live).toBe(false);

    // And with nothing live, the same create now succeeds — history accumulates
    // and does not block.
    expect(
      write("POST", "/orders/1014/shipments", {
        provider: "manual",
        wilaya_id: 16,
        commune_id: 484,
        delivery_type: "home",
      }).status,
    ).toBe(200);
  });

  /**
   * Verify answers something that is **not a payment**, and its report is not
   * safe to format as money: `amount` and `currency` came back as empty strings
   * on the `cod` transaction this was measured on. `transaction` is the
   * authority for every figure on screen.
   */
  it("verifies a payment and answers a report whose amount is an empty string", () => {
    const { data } = parse(verifyResult, write("POST", "/payments/5231/verify"));
    expect(data.report.amount).toBe("");
    expect(data.report.currency).toBe("");
    expect(data.report.provider_status).toBe("awaiting_delivery");
    // The stored record beside it carries the real figure.
    expect(data.transaction.amount).not.toBe("");
    expect(data.transaction.id).toBe(5231);

    // It writes nothing, so a second verify is the same answer.
    expect(write("POST", "/payments/5231/verify").body).toEqual(
      write("POST", "/payments/5231/verify").body,
    );
  });

  /**
   * **`POST /orders/{id}/payments` must stay a 404.** It is the one write on this
   * subject the API offers and `lib/api/allowlist.ts` refuses it deliberately: it
   * opens a checkout at the provider and hands back a real payment link for a
   * shopper. A fixture that answered it would be an invitation to build the
   * screen that must not exist.
   */
  it("refuses to mint a payment, at either spelling", () => {
    expect(write("POST", "/payments", { provider: "chargily" }).status).toBe(404);
    expect(write("POST", "/orders/1023/payments", { provider: "chargily" }).status).toBe(404);
    // And a verb nobody wrote on a route that exists is a 404, not a silent read.
    expect(write("DELETE", "/orders/1023").status).toBe(404);
    // `/products` writes now — `PATCH` and `DELETE` — and `POST` on it still
    // does not, which is the pair "the product writes" below is built on.
    expect(write("POST", "/products/101", { status: "draft" }).status).toBe(404);
    expect(write("POST", "/orders/1023/notes", { content: "x" }).status).toBe(404);
    expect(get("/orders/1023/cod/attempts").status).toBe(404);
  });
});

/**
 * **The 409s and the 400s, which are the point of all of the above.**
 *
 * Each is a distinct screen state the detail has to render, and a screen cannot
 * be verified against a state it can never reach. Each is asserted for its code
 * *and* for the shape of its `details`, because the body is what the screen
 * renders: a 409 that is only checked for its status is a 409 nobody has read.
 */
describe("the refusals, by fixture id", () => {
  const refusal = (response: MockResponse) => {
    const error = apiError(response);
    expect(error.status).toBe(409);
    expect(error.code).toBe("conflict");
    return error;
  };

  it("1000 — a terminal order refuses every move, with an empty allowed list", () => {
    const error = refusal(write("PATCH", "/orders/1000", { status: "processing" }));
    expect(error.conflict).toMatchObject({
      from: "cancelled",
      to: "processing",
      allowed: [],
    });
    // `[]` is a real answer meaning *finished*, and is not the field being
    // absent — `ApiError.conflict` keeps the difference and the screen renders
    // "this order is finished" rather than an empty chip row.
    expect(error.conflict?.allowed).toEqual([]);
  });

  it("1023 — a legal move is a 200, which is what makes the 409s mean anything", () => {
    expect(write("PATCH", "/orders/1023", { status: "processing" }).status).toBe(200);
  });

  it("1014 — an illegal move on a live order names the moves that are legal", () => {
    const error = refusal(write("PATCH", "/orders/1014", { status: "pending" }));
    // The measured list, in the vocabulary's own order.
    expect(error.conflict).toEqual({
      from: "processing",
      to: "pending",
      allowed: ["on-hold", "completed", "cancelled", "refunded", "failed"],
    });
  });

  it("1004 — COD switched off blames the order, by id", () => {
    const error = refusal(write("POST", "/orders/1004/cod/attempts", { outcome: "confirmed" }));
    expect(error.details).toEqual({ order_id: 1004 });
    expect(error.details.allowed).toBeUndefined();
  });

  /**
   * The measured trap: order 3879 carried `allowed_outcomes: []` **and** a
   * cancelled order, and the 409 blamed the order, because that gate runs first.
   * A record can therefore report outcomes the order will refuse anyway, which is
   * the whole reason `codAttemptGate()` exists.
   */
  it("1000 — a cancelled order refuses a call even though COD is on", () => {
    expect(parse(codRecord, get("/orders/1000/cod")).data.enabled).toBe(true);
    const error = refusal(write("POST", "/orders/1000/cod/attempts", { outcome: "confirmed" }));
    expect(error.details).toEqual({ order_status: "cancelled" });
  });

  it("1006 — outcomes exhausted refuses with the empty list that says so", () => {
    const error = refusal(write("POST", "/orders/1006/cod/attempts", { outcome: "confirmed" }));
    expect(error.details).toEqual({ from: "rejected", to: "confirmed", allowed: [] });
  });

  it("1007 — a legal outcome is a 200, and a bogus one is a 400 naming the field", () => {
    expect(write("POST", "/orders/1007/cod/attempts", { outcome: "confirmed" }).status).toBe(200);

    const bad = apiError(write("POST", "/orders/1007/cod/attempts", { outcome: "maybe" }));
    expect(bad.status).toBe(400);
    expect(bad.fields?.outcome).toEqual(expect.stringContaining("confirmed"));

    // A *missing* outcome gets a different sentence from an invalid one.
    const missing = apiError(write("POST", "/orders/1007/cod/attempts", {}));
    expect(missing.status).toBe(400);
    expect(missing.fields?.outcome).toEqual(expect.stringContaining("Required"));

    // `reason` is capped at 500 and reports under its own field.
    const long = apiError(
      write("POST", "/orders/1007/cod/attempts", {
        outcome: "confirmed",
        reason: "x".repeat(501),
      }),
    );
    expect(long.status).toBe(400);
    expect(long.fields?.reason).toEqual(expect.any(String));
    expect(
      write("POST", "/orders/1007/cod/attempts", {
        outcome: "confirmed",
        reason: "x".repeat(500),
      }).status,
    ).toBe(200);
  });

  it("1014 — a second live parcel is refused, and the 409 names the first", () => {
    const error = refusal(
      write("POST", "/orders/1014/shipments", {
        provider: "manual",
        wilaya_id: 16,
        commune_id: 484,
        delivery_type: "home",
      }),
    );
    expect(error.details).toMatchObject({ shipment_id: 7014, status: "created" });
    // No field list on this one — the form has nothing wrong with it, so the
    // refusal renders as a sentence rather than binding to a control.
    expect(error.fields).toBeNull();
  });

  it("1007 — a missing destination is a 400 naming both halves at once", () => {
    const error = apiError(write("POST", "/orders/1007/shipments", { provider: "manual" }));
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_request");
    // `details.fields`, an object of messages — not `details.params` — because
    // each one binds to its own control on the create-parcel form.
    expect(error.fields).toEqual({
      wilaya_id: expect.any(String),
      commune_id: expect.any(String),
    });
    expect(error.params).toBeNull();
    // The destination is validated before anything else, so a body carrying only
    // a provider fails the same way an empty one does.
    expect(apiError(write("POST", "/orders/1007/shipments", {})).fields).toEqual(
      error.fields,
    );
  });

  it("7023 — a finished parcel refuses cancellation, with no allowed list at all", () => {
    const error = refusal(write("POST", "/shipments/7023/cancel"));
    // An order's 409 carries `allowed` and a shipment's does not, which is the
    // one place this subject cannot follow the panel's usual rule.
    expect(error.details).toEqual({ from: "delivered", to: "cancelled", is_live: false });
    expect(error.conflict?.allowed).toBeUndefined();
  });

  it("refuses a status outside the vocabulary with a 400, not a 409", () => {
    const error = apiError(write("PATCH", "/orders/1023", { status: "nonsense" }));
    expect(error.status).toBe(400);
    expect(error.fields?.status).toEqual(expect.stringContaining("processing"));
  });
});

/**
 * **The second identity, and the state it exists to make reachable.**
 *
 * The harness identity holds all thirteen capabilities, which is what a harness
 * whose job is to render screens needs — and it is why no screen could be
 * captured in the forbidden state DESIGN.md §3.7 requires of every one of them.
 * `MOCK_IDENTITY` is read at module load, so this reloads the module rather than
 * flipping a switch at request time: a capture run is one identity throughout,
 * and `respond()` keeps answering from its arguments alone.
 */
describe("MOCK_IDENTITY", () => {
  const freshMock = async () => {
    vi.resetModules();
    return import("@/scripts/mock-api.mjs");
  };

  it("serves all thirteen capabilities by default", () => {
    const { data } = parse(identity, get("/auth/me"));
    expect(data.capabilities).toHaveLength(13);
    expect(data.capabilities).toContain("ac_manage_shipping");
    expect(data.capabilities).toContain("ac_manage_payments");
  });

  it("drops the two the order detail's gated sections need, when asked to", async () => {
    vi.stubEnv("MOCK_IDENTITY", "reduced");
    try {
      const mock = await freshMock();
      const { data } = unwrap(
        identity,
        mock.respond("GET", `${mock.BASE_PATH}/auth/me`).body,
        200,
      );
      expect(data.capabilities).not.toContain("ac_manage_shipping");
      expect(data.capabilities).not.toContain("ac_manage_payments");
      // And keeps the one the screen itself is gated on, or the capture would be
      // of the whole page refused rather than of two sections absent.
      expect(data.capabilities).toContain("ac_manage_orders");
      expect(data.capabilities).toHaveLength(11);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  /**
   * A value nobody recognises throws at load rather than falling back. A run that
   * quietly served the Super Admin after being asked for the reduced identity
   * would produce a green forbidden-state capture that is nothing of the kind.
   */
  it("refuses a value it does not recognise, rather than falling back", async () => {
    vi.stubEnv("MOCK_IDENTITY", "reduce");
    try {
      await expect(freshMock()).rejects.toThrow(/MOCK_IDENTITY/);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("GET /products", () => {
  it("parses the list, including the rows that carry an absence", () => {
    const { data, meta } = parseList(productList, get("/products", "per_page=100"));
    // 28 measured rows, 11 seeded ones, and the trashed one is in neither the
    // listing nor this count.
    expect(meta.total).toBe(38);
    expect(data.filter((row) => row.stock_quantity === null)).toHaveLength(8);
    expect(data.some((row) => row.status === "publish" && row.price === "")).toBe(true);
    expect(data.some((row) => row.status === "draft" && row.slug === "")).toBe(true);
    expect(
      data.some(
        (row) =>
          row.type === "variable" && row.variations.length > 0 && row.regular_price === "",
      ),
    ).toBe(true);
    // The 60-character SKU has to stay on page one or the harness's 340px
    // overflow assertion is watching a table that no longer contains the string
    // that breaks it.
    const firstPage = parseList(productList, get("/products", "per_page=20")).data;
    expect(firstPage.some((row) => row.sku.length > 50)).toBe(true);
  });

  it("parses a detail", () => {
    expect(parse(product, get("/products/101")).data.id).toBe(101);
  });

  /**
   * A trashed product is readable and unlistable, and both halves matter: the
   * schema accepts `trash` only because `GET /products/{id}` answers 200 with it
   * after a delete, and `?status=trash` is a 400 so there is no listing that can
   * reach it.
   */
  it("keeps a trashed product out of the listing and readable by id", () => {
    const trashed = parse(product, get("/products/211")).data;
    expect(trashed.status).toBe("trash");

    const listed = parseList(productList, get("/products", "per_page=100")).data;
    expect(listed.some((row) => row.id === 211)).toBe(false);
    expect(get("/products", "status=trash").status).toBe(400);
  });
});

/**
 * The one sub-resource a product has, and the reason the depth guard on
 * `/products` had to be relaxed properly rather than special-cased.
 *
 * Its shape disagrees with the parent's on purpose: `attributes` is an **object**
 * here where the parent's is an array, and the values are lowercased slugs of the
 * parent's options. A renderer that does not know which it is holding prints a
 * lowercase `s` at a shopkeeper, which is what `variationLabel()` repairs — so it
 * is the panel's own resolver, not a copy, that this asserts with.
 */
describe("GET /products/{id}/variations", () => {
  it("parses the five bodies, including the two that carry an absence", () => {
    const three = parseList(variationList, get("/products/104/variations", "per_page=100"));
    const two = parseList(variationList, get("/products/120/variations", "per_page=100"));
    expect(three.data).toHaveLength(3);
    expect(two.data).toHaveLength(2);
    expect(three.meta.total).toBe(3);

    const all = [...three.data, ...two.data];
    expect(all.every((row) => row.parent_id === 104 || row.parent_id === 120)).toBe(true);

    // `""` means it inherits the parent's, and the API reports what is stored —
    // so the row has to render without inventing a SKU.
    expect(all.filter((row) => row.sku === "").length).toBeGreaterThan(0);
    // And one manages no stock of its own, which is the other absence: null is
    // not zero, and a variation that reads `0` is out of stock rather than
    // uncounted.
    const inherited = all.filter((row) => row.stock_quantity === null);
    expect(inherited).toHaveLength(1);
    expect(inherited[0].manage_stock).toBe(false);
  });

  it("keys attributes by the parent's own vocabulary, lowercased", () => {
    const parent = parse(product, get("/products/104")).data;
    const variations = parseList(variationList, get("/products/104/variations")).data;

    for (const row of variations) {
      // An object, not an array — the asymmetry the schema is explicit about.
      expect(Array.isArray(row.attributes)).toBe(false);
      expect(Object.keys(row.attributes)).toEqual(["taille"]);
      // Stored lowercased, and resolvable back to the parent's own spelling by
      // the panel's resolver. A fixture whose keys did not line up would make
      // `variationLabel()` fall through to printing the raw slug and nothing
      // here would notice.
      const [label] = variationLabel(row, parent, new Map());
      expect(parent.attributes[0].options).toContain(label);
      expect(label).not.toBe(Object.values(row.attributes)[0]);
    }
  });

  /**
   * The variations are what a variable product's price *is* — its own
   * `regular_price` is `""` — and `priceSpan()` returns **null** when every price
   * is equal, so a fixture of one repeated figure would leave the detail's price
   * range unreachable and uncapturable.
   */
  it("prices them apart, so the detail's range has something to render", () => {
    const variations = parseList(variationList, get("/products/104/variations")).data;
    const span = priceSpan(variations.map((row) => row.price));
    expect(span).not.toBeNull();

    const parent = parse(product, get("/products/104")).data;
    expect(parent.regular_price).toBe("");
    // The parent's own `price` is the resolved floor, not a second opinion.
    expect(parent.price).toBe(span!.min);
  });

  it("answers a simple product with 200 and an empty list, not a 404", () => {
    // Measured. The detail skips the request on 26 of 28 products because it
    // would work and simply be waste — which is only true if it is not an error.
    const { data, meta } = parseList(variationList, get("/products/101/variations"));
    expect(data).toEqual([]);
    expect(meta.total).toBe(0);
  });

  it("serves nothing deeper, and nothing under another name", () => {
    expect(get("/products/101/variations/9030").status).toBe(404);
    expect(get("/products/101/nonsense").status).toBe(404);
    expect(get("/products/999999/variations").status).toBe(404);
    // The one variation route the panel never calls stays unreachable too.
    expect(write("PATCH", "/products/104/variations", { sku: "x" }).status).toBe(404);
  });
});

/**
 * **`PATCH /products/{id}`, and the split that makes it worth mocking.**
 *
 * A read-only key is dropped in silence and an unknown one is a 400 — two
 * different answers to what looks like the same mistake. A client that treated
 * them alike would either refuse a GET body it is supposed to be able to PATCH
 * back, or swallow a typo'd field name and report a save that never happened.
 */
describe("the product writes", () => {
  const SAVE = {
    name: "Burnous en laine, tissé main",
    slug: "burnous-en-laine-tisse-main",
    status: "draft",
    sku: "AC-CAT-0104-EDIT",
    featured: true,
    catalog_visibility: "hidden",
    short_description: "<p>Court</p>",
    description: "<p>Long</p>",
    weight: "1.2",
    category_ids: [12, 13],
  };

  it("writes every field it accepts, and the answer equals the next GET", () => {
    const saved = parse(product, write("PATCH", "/products/104", SAVE)).data;
    expect(saved).toMatchObject(SAVE);

    // The read after the write is the whole point, and the *identity* of the two
    // bodies is what a form that refetches depends on.
    const reread = parse(product, get("/products/104")).data;
    expect(reread).toEqual(saved);

    // And the listing agrees with the detail, because a list that still showed
    // the old name would be one screen contradicting another.
    const listed = parseList(productList, get("/products", "per_page=100")).data;
    expect(listed.find((row) => row.id === 104)?.name).toBe(SAVE.name);
  });

  /**
   * The read-only half, and it has to be **silent**: a 200, no mention in the
   * response, the field unchanged. This is what lets a client PATCH a GET body
   * back without diffing it first.
   */
  it("drops every read-only field without saying so", () => {
    const before = parse(product, get("/products/101")).data;

    const response = write("PATCH", "/products/101", {
      // One writable field, so the request is not refused for being empty.
      name: "Miel de jujubier, 500 g",
      price: "1.00",
      on_sale: true,
      permalink: "https://example.invalid/hijacked",
      image: { id: 9, url: "https://example.invalid/i.png" },
      gallery: [{ id: 10, url: "https://example.invalid/g.png" }],
      variations: [1, 2, 3],
      id: 999,
      date_created: "2020-01-01T00:00:00+00:00",
      date_modified: "2020-01-01T00:00:00+00:00",
      bundle: { items: [], available: 0 },
      options_problems: ["invented"],
    });

    expect(response.status).toBe(200);
    const after = parse(product, response).data;
    expect(after.id).toBe(101);
    expect(after.price).toBe(before.price);
    expect(after.on_sale).toBe(before.on_sale);
    expect(after.permalink).toBe(before.permalink);
    expect(after.image).toBeNull();
    expect(after.gallery).toEqual([]);
    expect(after.variations).toEqual(before.variations);
    expect(after.date_created).toBe(before.date_created);
    expect(after.date_modified).toBe(before.date_modified);
    // Absent, not written: the three §83 keys stay off a product that has no
    // option set, which is what makes them optional on the schema.
    expect("bundle" in after).toBe(false);
    expect("options_problems" in after).toBe(false);
  });

  /**
   * **An unknown field is not a read-only one.** Both are keys the API will not
   * write; only one of them is a mistake worth reporting, and the panel renders
   * the difference — a named field lands on its own control, and a field the form
   * does not render is surfaced at the top rather than swallowed.
   */
  it("answers a 400 for an unknown key and a 200 for a read-only one", () => {
    expect(write("PATCH", "/products/104", { price: "1.00" }).status).toBe(400);

    const error = apiError(write("PATCH", "/products/104", { name: "x", nonsense: 1 }));
    expect(error.status).toBe(400);
    expect(error.fields).toEqual({ nonsense: "Unknown field." });

    // And nothing was written by the refused request.
    expect(parse(product, get("/products/104")).data.name).not.toBe("x");
  });

  /**
   * The measured trap: a PATCH whose every key is read-only answers 400 **with no
   * `details` at all**, so "drop what is read-only" cannot be a client's only rule
   * — if it drops everything, the refusal names nothing and the panel's own 400
   * handling has no field list to render. That is why the form sends an explicit
   * named subset.
   */
  it("refuses a body of nothing but read-only keys, naming nothing", () => {
    const response = write("PATCH", "/products/104", {
      id: 104,
      price: "1.00",
      permalink: "https://example.invalid/x",
    });
    expect(response.status).toBe(400);

    // On the wire: the key is **absent**, not an empty object. A mock that
    // emitted `details: {}` would let a screen read `details.fields` without
    // checking and never find out.
    const body = response.body as { error: Record<string, unknown> };
    expect("details" in body.error).toBe(false);

    const error = apiError(response);
    expect(error.apiMessage).toBe("No supported fields were provided.");
    expect(error.fields).toBeNull();

    // An empty body is the same refusal, by the same route.
    expect(write("PATCH", "/products/104", {}).status).toBe(400);
  });

  /**
   * **A 200 that looks exactly like a save and is not.** `stock_quantity` is
   * ignored when the row manages no stock, which is why the panel's form deletes
   * the key from its own body rather than sending it and trusting the answer.
   */
  it("drops stock_quantity when the product manages no stock", () => {
    const before = parse(product, get("/products/103")).data;
    expect(before.manage_stock).toBe(false);
    expect(before.stock_quantity).toBeNull();

    const after = parse(product, write("PATCH", "/products/103", { stock_quantity: 99 })).data;
    expect(after.stock_quantity).toBeNull();
    expect(parse(product, get("/products/103")).data.stock_quantity).toBeNull();

    // Switching stock management off does the same thing on a row that had a
    // figure — `manage_stock: false` with a number beside it is a state the real
    // API never serves.
    const off = parse(
      product,
      write("PATCH", "/products/101", { manage_stock: false, stock_quantity: 99 }),
    ).data;
    expect(off.manage_stock).toBe(false);
    expect(off.stock_quantity).toBeNull();

    // And with management on, the same field is honoured.
    const on = parse(
      product,
      write("PATCH", "/products/101", { manage_stock: true, stock_quantity: 7 }),
    ).data;
    expect(on.stock_quantity).toBe(7);
  });

  /**
   * The silent repair the detail's warning banner is about: writing `options`
   * replaces the stored document, so the groups the API could not read are gone
   * and `options_problems` goes with them.
   */
  it("destroys options_problems the moment options is written", () => {
    const before = parse(product, get("/products/208")).data;
    expect(before.options_problems).toHaveLength(2);
    // The position, not an id — the broken group is absent from `options.groups`,
    // so nothing can link the warning to a row in an editor.
    expect(before.options_problems?.[0]).toMatch(/^Option group 4 was dropped:/);
    expect(before.options?.groups).toHaveLength(3);

    const after = parse(
      product,
      write("PATCH", "/products/208", { options: before.options }),
    ).data;
    expect("options_problems" in after).toBe(false);
    expect(parse(product, get("/products/208")).data.options_problems).toBeUndefined();

    // A PATCH that does not carry `options` leaves the broken document alone,
    // which is the state the banner is rendered from.
    resetState();
    const untouched = parse(product, write("PATCH", "/products/208", { featured: true })).data;
    expect(untouched.options_problems).toHaveLength(2);
  });

  /**
   * **The round trip the whole design rests on**: `GET` a product and `PATCH` the
   * entire body back. Measured against the live API on the one product carrying
   * an option set — all 32 keys, one 200 — which is what lets a form be built
   * around the whole object instead of a diff.
   */
  it("takes a whole GET body back, on the product with the most keys", () => {
    const whole = parse(product, get("/products/208")).data;
    expect(Object.keys(whole).length).toBeGreaterThanOrEqual(32);

    const response = write("PATCH", "/products/208", whole);
    expect(response.status).toBe(200);

    // Everything survives except the thing the round trip is measured to
    // destroy: the unreadable groups, and the warning that named them.
    const after = parse(product, response).data;
    expect(after.name).toBe(whole.name);
    expect(after.options).toEqual(whole.options);
    expect("options_problems" in after).toBe(false);
  });

  /**
   * A block is written whole or not at all. The three nested fields are the only
   * writable ones the panel parses structurally, so a mock that stored a partial
   * one would hand the next GET a body the panel's own boundary refuses — a
   * failure the real API cannot produce and the harness must not manufacture.
   */
  it("refuses a half-written seo, attributes or options block", () => {
    expect(apiError(write("PATCH", "/products/101", { seo: {} })).fields).toEqual({
      seo: "Must carry title, description, canonical, robots and overrides.",
    });
    // The nested half counts too: `robots` has three required keys of its own.
    const partialRobots = {
      ...parse(product, get("/products/101")).data.seo,
      robots: { index: true },
    };
    expect(write("PATCH", "/products/101", { seo: partialRobots }).status).toBe(400);

    expect(write("PATCH", "/products/101", { attributes: [{ name: "Taille" }] }).status).toBe(400);
    expect(write("PATCH", "/products/101", { options: {} }).status).toBe(400);
    expect(write("PATCH", "/products/101", { options: { groups: [{}] } }).status).toBe(400);

    // Null is a real request — it removes the option set — and is not the same
    // as `{groups: []}`.
    expect(write("PATCH", "/products/101", { options: null }).status).toBe(200);
    expect(write("PATCH", "/products/101", { options: { groups: [] } }).status).toBe(200);

    // And every seeded product's own block round-trips, which is the property
    // that makes the refusals above safe to make.
    for (const id of [101, 104, 201, 208, 211]) {
      const seeded = parse(product, get(`/products/${id}`)).data;
      expect(write("PATCH", `/products/${id}`, { seo: seeded.seo }).status).toBe(200);
      expect(
        write("PATCH", `/products/${id}`, { attributes: seeded.attributes }).status,
      ).toBe(200);
    }
  });

  /**
   * The split itself, one field at a time — which is how it was measured against
   * the live API, and the only way a list of names stays honest. A field that
   * quietly changed sides would otherwise show up as nothing at all: the form
   * would go on sending it and the panel would go on reporting a save.
   */
  it("accepts exactly the 22 measured writable fields", () => {
    const writable: Record<string, unknown> = {
      name: "Nom",
      slug: "nom",
      type: "simple",
      status: "draft",
      featured: true,
      catalog_visibility: "visible",
      // Empty rather than a string: every non-empty SKU in the shop is taken.
      sku: "",
      description: "<p>d</p>",
      short_description: "<p>s</p>",
      regular_price: "10.00",
      sale_price: "",
      manage_stock: true,
      stock_quantity: 1,
      stock_status: "instock",
      weight: "0.5",
      category_ids: [10],
      seo: {
        title: "t",
        description: "d",
        canonical: "",
        robots: { index: true, follow: true, directive: "index, follow" },
        overrides: ["title"],
      },
      options: null,
      attributes: [],
      tag_ids: [401],
      image_id: 0,
      gallery_image_ids: [],
    };
    expect(Object.keys(writable)).toHaveLength(22);

    for (const [field, value] of Object.entries(writable)) {
      const response = write("PATCH", "/products/101", { [field]: value });
      expect(response.status, `${field} must be writable`).toBe(200);
      // And it actually landed, rather than being accepted and ignored.
      expect(parse(product, get("/products/101")).data[field as "name"]).toEqual(value);
    }
  });

  it("drops exactly the 11 measured read-only fields, each on its own", () => {
    const readOnly = [
      "price",
      "on_sale",
      "permalink",
      "image",
      "gallery",
      "variations",
      "id",
      "date_created",
      "date_modified",
      "bundle",
      "options_problems",
    ];
    expect(readOnly).toHaveLength(11);

    for (const field of readOnly) {
      // Alone in the body, so what is left after the drop is nothing — which is
      // the 400 that names nothing rather than a 400 naming the field.
      const error = apiError(write("PATCH", "/products/101", { [field]: null }));
      expect(error.status, `${field} must be dropped, not refused`).toBe(400);
      expect(error.apiMessage).toBe("No supported fields were provided.");
      expect(error.fields).toBeNull();
    }
  });

  /** Nothing survives a process start, which is what `resetState()` stands in for. */
  it("forgets every write when the state is rebuilt", () => {
    const seeded = parse(product, get("/products/104")).data;
    write("PATCH", "/products/104", { name: "Écrit" });
    expect(parse(product, get("/products/104")).data.name).toBe("Écrit");

    resetState();
    expect(parse(product, get("/products/104")).data).toEqual(seeded);
  });
});

/**
 * The product refusals, each one a distinct screen state the form has to render,
 * and each asserted for the shape of its `details` rather than for its status
 * alone: the body is what the screen renders.
 */
describe("the product refusals, by fixture id", () => {
  it("104 — lists every bad field at once, in English", () => {
    const error = apiError(
      write("PATCH", "/products/104", {
        name: "",
        regular_price: "-1",
        stock_quantity: "twelve",
        status: "archived",
      }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_request");

    // Every one of them, not the first — the form renders one message per
    // control, and a 400 that named only the first would hide the rest.
    expect(error.fields).toEqual({
      name: "A product name cannot be emptied.",
      regular_price: "Cannot be negative.",
      stock_quantity: "Must be a number.",
      status: `Must be one of: ${PRODUCT_STATUSES.join(", ")}.`,
    });
    expect(Object.keys(error.fields ?? {}).length).toBeGreaterThanOrEqual(2);
  });

  /**
   * The mock keeps its own copy of the two vocabularies the panel's form offers —
   * it imports nothing — so the refusal message is what pins the copies together.
   * A list that drifted here would let a form offer a value the API refuses.
   */
  it("104 — refuses a type and a visibility the panel does not offer", () => {
    expect(apiError(write("PATCH", "/products/104", { type: "grouped" })).fields).toEqual({
      type: `Must be one of: ${PRODUCT_TYPES.join(", ")}.`,
    });
    expect(
      apiError(write("PATCH", "/products/104", { catalog_visibility: "secret" })).fields,
    ).toEqual({
      catalog_visibility: `Must be one of: ${CATALOG_VISIBILITIES.join(", ")}.`,
    });
    // `trash` is readable and not writable: a product is trashed by DELETE.
    expect(write("PATCH", "/products/104", { status: "trash" }).status).toBe(400);
    expect(write("PATCH", "/products/104", { stock_status: "maybe" }).status).toBe(400);
  });

  /**
   * **A duplicate SKU is a 409 and it reports under `details.sku`, not
   * `details.fields`.** It still has to land on the SKU control, because that is
   * the field the person has to change — which is only possible if the two
   * shapes are told apart here.
   */
  it("104 — answers 409 for a SKU 101 already holds", () => {
    const taken = parse(product, get("/products/101")).data.sku;
    const error = apiError(write("PATCH", "/products/104", { sku: taken }));

    expect(error.status).toBe(409);
    expect(error.code).toBe("conflict");
    expect(error.apiMessage).toBe("That SKU is already in use.");
    expect(error.conflict).toEqual({ sku: taken });
    expect(error.fields).toBeNull();

    // Its own SKU is not a duplicate of itself, and `""` is a real value rather
    // than a collision with every other product that has none.
    expect(write("PATCH", "/products/104", { sku: taken }, "").status).toBe(409);
    const own = parse(product, get("/products/104")).data.sku;
    expect(write("PATCH", "/products/104", { sku: own }).status).toBe(200);
    expect(write("PATCH", "/products/104", { sku: "" }).status).toBe(200);
  });

  it("999999 — a product that does not exist refuses every verb", () => {
    expect(write("PATCH", "/products/999999", { name: "x" }).status).toBe(404);
    expect(write("DELETE", "/products/999999").status).toBe(404);
    // And the collection itself takes no writes: nothing in the panel creates a
    // product, so `POST /products` must stay unreachable.
    expect(write("POST", "/products", { name: "Nouveau" }).status).toBe(404);
  });
});

/**
 * **`DELETE` and `?force=true` answer identical bodies.** Nothing in the response
 * distinguishes the reversible act from the irreversible one — the panel knows
 * only because it knows what it asked for, which is why the permanent path sits
 * behind a typed confirmation of the product's own name. The difference is
 * visible on the next GET and nowhere else.
 */
describe("DELETE /products/{id}", () => {
  it("answers the same body for a trash and for a permanent delete", () => {
    const trashed = write("DELETE", "/products/209");
    expect(parse(deleteResult, trashed).data).toEqual({ id: 209, deleted: true });

    const forced = write("DELETE", "/products/209", null, "force=true");
    expect(forced.body).toEqual(trashed.body);
    expect(forced.status).toBe(trashed.status);
  });

  it("trashes: the next GET is 200 with status trash, and the listing loses it", () => {
    expect(write("DELETE", "/products/209").status).toBe(200);

    const after = parse(product, get("/products/209")).data;
    expect(after.status).toBe("trash");
    expect(parseList(productList, get("/products", "per_page=100")).data
      .some((row) => row.id === 209)).toBe(false);

    // A trashed product is in no stockroom either.
    expect(parseList(inventoryList, get("/inventory", "per_page=100")).data
      .some((row) => row.id === 209)).toBe(false);
  });

  it("is idempotent, and a second trash never escalates to permanent", () => {
    write("DELETE", "/products/209");
    expect(write("DELETE", "/products/209").status).toBe(200);
    expect(write("DELETE", "/products/209", null, "force=false").status).toBe(200);
    // Still readable — the repeat did not quietly become the irreversible one.
    expect(parse(product, get("/products/209")).data.status).toBe("trash");
  });

  it("forces: the next GET is a 404, and stays one", () => {
    expect(write("DELETE", "/products/209", null, "force=true").status).toBe(200);
    expect(get("/products/209").status).toBe(404);
    expect(get("/products/209/variations").status).toBe(404);
    expect(write("PATCH", "/products/209", { name: "x" }).status).toBe(404);
    expect(write("DELETE", "/products/209").status).toBe(404);
  });

  it("keeps a trashed product's SKU reserved", () => {
    const sku = parse(product, get("/products/209")).data.sku;
    write("DELETE", "/products/209");
    // WooCommerce holds the SKU with the row, so the conflict survives the trash.
    expect(write("PATCH", "/products/104", { sku }).status).toBe(409);
  });
});

describe("the catalogue vocabularies", () => {
  it("serves /product-categories flat, with a tree and a usage count", () => {
    const { data, meta } = parseList(
      productCategories,
      get("/product-categories", "per_page=100"),
    );
    expect(meta.total).toBe(data.length);
    // Flat with `parent`, not nested — the tree is the caller's to build.
    expect(data.some((row) => row.parent !== 0)).toBe(true);
    expect(data.every((row) => data.some((p) => p.id === row.parent) || row.parent === 0))
      .toBe(true);
    expect(data.some((row) => row.count > 0)).toBe(true);
  });

  /**
   * `slug` and `taxonomy` are different strings and confusing them is the
   * mistake this endpoint exists to prevent: the slug addresses the attribute,
   * the taxonomy is what `?attributes[…]` matches and what keys a facet group.
   */
  it("serves /attributes with slug and taxonomy as different things", () => {
    const { data } = parseList(globalAttributes, get("/attributes"));
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((row) => row.taxonomy !== row.slug)).toBe(true);
    expect(data.every((row) => row.taxonomy === `pa_${row.slug}`)).toBe(true);
  });

  it("serves /attributes unpaginated, the way /locations/wilayas is", () => {
    const all = parseList(globalAttributes, get("/attributes")).data;
    // No `per_page`, and still every row: a default of 10 would silently drop a
    // shop's later attributes and every facet group keyed on them with it.
    expect(parseList(globalAttributes, get("/attributes", "per_page=1")).data)
      .toHaveLength(all.length);
  });

  /**
   * **The reason this route is read at all.** A facet group omits its zero-count
   * values, so a term no product carries exists nowhere else — and without it
   * the filter sheet can only ever offer the values that already match.
   */
  it("serves /attributes/{id}/terms, including a term with count 0", () => {
    const { data, meta } = parseList(attributeTerms, get("/attributes/1/terms", "per_page=100"));
    expect(meta.total).toBe(data.length);
    expect(data).toHaveLength(6);
    expect(data.filter((term) => term.count === 0)).toHaveLength(1);
  });

  it("404s a sub-resource nobody wrote, at every collection", () => {
    expect(get("/attributes/9/terms").status).toBe(404);
    expect(get("/attributes/1/nonsense").status).toBe(404);
    // The depth guard is per collection, not a blanket `> 4`: a third or fourth
    // segment on a collection that has no such sub-resource must not be answered
    // by the row above it. `/orders/{id}/notes` used to be on this list and is a
    // real route now — `/orders/{id}/nonsense` took its place, because the point
    // was never that guard's number.
    expect(get("/orders/1000/nonsense").status).toBe(404);
    expect(get("/orders/1000/notes/1").status).toBe(404);
    // `/customers/{id}/orders` used to be on this list and is a real route now —
    // a third segment under another name took its place, because the point was
    // never that guard's number.
    expect(get("/customers/20/nonsense").status).toBe(404);
    expect(get("/customers/20/orders/1").status).toBe(404);
    // `/products/{id}/variations` used to be on this list and is a real route
    // now — a fourth segment under it took its place, because the point was
    // never that guard's number.
    expect(get("/products/101/variations/9030").status).toBe(404);
    expect(get("/inventory/low-stock/anything").status).toBe(404);
    expect(get("/locations/wilayas/16/communes/1").status).toBe(404);
    expect(get("/locations/communes").status).toBe(404);
  });
});

/** `meta.facets`, through the real `facets` schema and the real `productListMeta`. */
function productsMeta(query: string) {
  const { meta } = parse(productList, get("/products", `per_page=100&${query}`));
  return productListMeta.parse(meta);
}

const ALL_FACETS = "facets=attributes,price,category,tag,stock_status";

function productFacets(query: string) {
  const meta = productsMeta(`${ALL_FACETS}&${query}`);
  expect(meta.facets, "?facets= must produce meta.facets").toBeDefined();
  return facetsSchema.parse(meta.facets);
}

const attributeGroup = (query: string, taxonomy: string) => {
  const group = productFacets(query).attributes?.groups.find((g) => g.taxonomy === taxonomy);
  expect(group, `no facet group for ${taxonomy}`).toBeDefined();
  return group!;
};

describe("meta.facets", () => {
  it("is opt-in, and only the groups that were asked for arrive", () => {
    expect(productsMeta("").facets).toBeUndefined();

    const one = productsMeta("facets=price").facets;
    expect(one).toBeDefined();
    expect(facetsSchema.parse(one).price).toBeDefined();
    expect(facetsSchema.parse(one).category).toBeUndefined();
    expect(facetsSchema.parse(one).attributes).toBeUndefined();
  });

  it("carries the scope and the sentence the panel renders", () => {
    const facets = productFacets("");
    expect(facets.scope).toBe("publish");
    expect(facets.scope_note.length).toBeGreaterThan(0);
  });

  /** Three shapes in one object, and a single "facet group" type is wrong twice. */
  it("is three different shapes, not one", () => {
    const facets = productFacets("");
    // `price` is a band.
    expect(facets.price).toMatchObject({ currency: "DZD" });
    // A published product with no price at all stores zero, so the floor is 0.
    expect(facets.price?.min).toBe("0.00");
    // `stock_status` is a bare array, and the one group the API enumerates
    // completely — a closed enum, so the zero is reported rather than omitted.
    expect(Array.isArray(facets.stock_status)).toBe(true);
    expect(facets.stock_status?.map((v) => v.value)).toEqual([...STOCK_STATUSES]);
    expect(facets.stock_status?.some((v) => v.count === 0)).toBe(true);
    // `category` is a group.
    expect(facets.category?.values.length).toBeGreaterThan(0);
    expect(typeof facets.category?.truncated).toBe("boolean");
  });

  it("omits a zero-count value, and total_values counts what is left", () => {
    const vocabulary = parseList(attributeTerms, get("/attributes/1/terms", "per_page=100")).data;
    const group = attributeGroup("", "pa_matiere");

    const uncounted = vocabulary.find((term) => term.count === 0);
    expect(uncounted, "the vocabulary must hold a term no product carries").toBeDefined();

    // The group dropped it entirely — it is not present with a count of zero.
    expect(group.values.some((v) => v.slug === uncounted!.slug)).toBe(false);
    expect(group.values.every((v) => v.count > 0)).toBe(true);
    // And `total_values` is the number of non-zero values, not the vocabulary.
    expect(vocabulary).toHaveLength(6);
    expect(group.total_values).toBe(5);
  });

  it("caps a group at 50 and says so", () => {
    const vocabulary = parseList(attributeTerms, get("/attributes/2/terms", "per_page=100")).data;
    const group = attributeGroup("", "pa_couleur");

    expect(vocabulary).toHaveLength(60);
    expect(group.values).toHaveLength(50);
    // The real number, so "50 sur 60" can be rendered rather than a list that
    // reads as complete.
    expect(group.total_values).toBe(60);
    expect(group.truncated).toBe(true);
  });

  /**
   * **The inconsistency lib/products.ts exists to repair.** Reproduce the API's
   * behaviour, not the repair: `category` narrows itself and the others do not.
   */
  it("does not exclude the category filter from the category group", () => {
    const unfiltered = productFacets("").category!;
    const narrowed = productFacets("category=12").category!;

    expect(unfiltered.values.length).toBeGreaterThan(1);
    expect(narrowed.values).toHaveLength(1);
    expect(narrowed.total_values).toBe(1);
    expect(narrowed.values[0].term_id).toBe(12);
  });

  it("does exclude an attribute group's own filter, and price's and stock's", () => {
    const unfiltered = attributeGroup("", "pa_matiere");
    const filtered = attributeGroup("attributes[pa_matiere]=laine", "pa_matiere");
    // Its own filter would have left one value. It reports all five.
    expect(filtered.values.map((v) => v.slug)).toEqual(unfiltered.values.map((v) => v.slug));

    // While a *different* group narrows under it, which is what makes the line
    // above a measurement rather than a group that ignores filtering entirely.
    expect(attributeGroup("attributes[pa_matiere]=laine", "pa_couleur").total_values)
      .toBeLessThan(attributeGroup("", "pa_couleur").total_values);

    expect(productFacets("min_price=5000").price).toEqual(productFacets("").price);
    expect(productFacets("stock_status=outofstock").stock_status)
      .toEqual(productFacets("").stock_status);
  });

  it("counts published rows only, whatever the list is showing", () => {
    const listed = parseList(productList, get("/products", "per_page=100")).data;
    const published = listed.filter((row) => row.status === "publish").length;
    const counted = productFacets("").stock_status!.reduce((sum, v) => sum + v.count, 0);

    expect(listed.length).toBeGreaterThan(published);
    expect(counted).toBe(published);
  });
});

describe("the /products filters", () => {
  const total = (query: string) =>
    parseList(productList, get("/products", `per_page=100&${query}`)).meta.total;
  const rows = (query: string) =>
    parseList(productList, get("/products", `per_page=100&${query}`)).data;

  it("takes one status, from the product set and not the order set", () => {
    for (const status of PRODUCT_STATUSES) {
      const filtered = rows(`status=${status}`);
      expect(filtered.length, `no rows for status=${status}`).toBeGreaterThan(0);
      expect(filtered.every((row) => row.status === status)).toBe(true);
    }
    // A comma list is a 400 — the measurement every single-select control here
    // is built on — and so is an order status, which this route never accepted.
    expect(get("/products", "status=draft,publish").status).toBe(400);
    expect(get("/products", "status=refunded").status).toBe(400);
    expect(apiError(get("/products", "status=draft,publish")).details).toMatchObject({
      params: { status: expect.stringContaining("draft") },
    });
  });

  it("takes term ids for category, and refuses a slug", () => {
    expect(total("category=12")).toBeGreaterThan(0);
    expect(total("category=12,15")).toBeGreaterThan(total("category=12"));

    // Well-formed and matching nothing is a 200 with zero rows.
    expect(total("category=99999")).toBe(0);

    // Not well-formed is a 400, and the message is the pattern.
    const error = apiError(get("/products", "category=tapis"));
    expect(error.status).toBe(400);
    expect(error.details).toMatchObject({
      params: { category: expect.stringContaining("^$|^[0-9]+(,[0-9]+)*$") },
    });
    expect(get("/products", "tag=nouveaute").status).toBe(400);
  });

  it("filters by tag, sku and stock status", () => {
    const tagged = rows("tag=401");
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.every((row) => row.tag_ids.includes(401))).toBe(true);

    expect(rows("sku=AC-CAT-0206").every((row) => row.sku.includes("AC-CAT-0206"))).toBe(true);

    const out = rows("stock_status=outofstock");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((row) => row.stock_status === "outofstock")).toBe(true);
    // A closed enum, so a value outside it is a 400 rather than zero rows.
    expect(get("/products", "stock_status=bogus").status).toBe(400);
  });

  it("filters by price, and a bad price is a capturable 400", () => {
    const dear = rows("min_price=10000");
    expect(dear.length).toBeGreaterThan(0);
    expect(dear.every((row) => Number(row.price || "0") >= 10000)).toBe(true);
    expect(total("max_price=1000")).toBeLessThan(total(""));

    // The one error state a filter sheet can actually provoke, so the screen has
    // something to render: `details.params.min_price`, not a generic message.
    const error = apiError(get("/products", "min_price=abc"));
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_request");
    expect(error.details).toMatchObject({ params: { min_price: expect.any(String) } });
  });

  /** `""` is absent and `"false"` is a filter. They are not the same request. */
  it("keeps an absent on_sale apart from on_sale=false", () => {
    expect(total("on_sale=true")).toBeGreaterThan(0);
    expect(total("on_sale=false")).toBeGreaterThan(0);
    expect(total("on_sale=true") + total("on_sale=false")).toBe(total(""));
    expect(total("on_sale=false")).not.toBe(total(""));
    expect(total("on_sale=")).toBe(total(""));

    expect(total("featured=true")).toBeGreaterThan(0);
    expect(total("featured=false")).not.toBe(total(""));
    expect(get("/products", "featured=maybe").status).toBe(400);
  });

  it("matches attribute term slugs, and alternatives inside one attribute", () => {
    const laine = rows("attributes[pa_matiere]=laine");
    expect(laine.length).toBeGreaterThan(0);
    // Slugs, not ids, and on a *global* attribute `name` is the taxonomy.
    expect(
      laine.every((row) =>
        row.attributes.some((a) => a.name === "pa_matiere" && a.options.includes("laine")),
      ),
    ).toBe(true);

    // OR within one attribute…
    expect(rows("attributes[pa_matiere]=laine,coton").length).toBe(
      laine.length + rows("attributes[pa_matiere]=coton").length,
    );
    // …and AND across two.
    expect(
      rows("attributes[pa_matiere]=coton&attributes[pa_couleur]=blanc").length,
    ).toBeLessThan(rows("attributes[pa_matiere]=coton").length);

    // A term nobody carries is zero rows, not an error.
    expect(total("attributes[pa_matiere]=cuir")).toBe(0);
  });

  /**
   * The attributes filter reports its errors somewhere else than every other
   * parameter, and a reader that only knows `details.params` renders a generic
   * message and throws the useful half away.
   */
  it("reports a bad attribute under details.fields, never under details.params", () => {
    const error = apiError(get("/products", "attributes[pa_nope]=x"));
    expect(error.status).toBe(400);
    expect(error.details.params).toBeUndefined();
    expect(error.fields?.attributes).toEqual(expect.any(String));
    expect(error.details.facetable_attributes).toEqual(
      expect.arrayContaining(["pa_matiere", "pa_couleur"]),
    );
  });
});

/** Every customer id the mock serves: the sixteen, plus the search control. */
const CUSTOMER_IDS = [...Array.from({ length: 16 }, (_, i) => 20 + i), 36];

const everyCustomer = () =>
  CUSTOMER_IDS.map((id) => parse(customerDetail, get(`/customers/${id}`)).data);

describe("GET /customers", () => {
  /**
   * The one collection where the list row and the detail are different objects.
   * lib/api/schemas/customer.ts is explicit that they differ by exactly
   * `statistics`, and a mock that put it on both would let a component reach for
   * it on a list row and find it — right up until production.
   */
  it("omits statistics from the list and carries it on the detail", () => {
    const { data } = parseList(customerList, get("/customers", "per_page=100"));
    expect(data).toHaveLength(17);
    expect(data.some((row) => "statistics" in row)).toBe(false);

    const detail = parse(customerDetail, get("/customers/24")).data;
    expect(detail.statistics.total_orders).toBeGreaterThan(0);
    // Every shared value is identical, so the detail really is the row plus a
    // report rather than a richer object — which is what makes two types honest.
    const row = data.find((candidate) => candidate.id === 24);
    const shared = Object.fromEntries(
      Object.entries(detail).filter(([key]) => key !== "statistics"),
    );
    expect(shared).toEqual(row);
  });

  it("parses all 17 details, including the 12 who have never ordered", () => {
    const details = everyCustomer();
    const never = details.filter(
      (row) => row.statistics.first_order === null && row.statistics.last_order === null,
    );
    expect(never).toHaveLength(12);
    expect(never.every((row) => row.statistics.total_orders === 0)).toBe(true);
    // **12 of them have no name at all**, which is the measurement the row's
    // whole identity fallback exists for. The seventeenth customer is named and
    // is the search control below, so this count is the measured one unchanged.
    expect(details.filter((row) => row.first_name === "" && row.last_name === "")).toHaveLength(12);
  });
});

/**
 * **`?search=` matches `user_login`, `user_email` and `display_name` — never
 * `first_name` or `last_name`**, and this is the most carefully measured fact
 * about the customers screen.
 *
 * lib/customers.ts:45-60 records how it was pinned down: customer 26 was given
 * the names `Zqxwvu Plmokn`, `?search=Zqxwvu` returned 0 rows and
 * `?search=cus_fresh` returned 1. The mock matched all four fields for three
 * branches, which made `looksLikeAName()`'s empty state — the one that explains
 * *why* nothing matched instead of saying "no results" — unreachable against the
 * harness. A screen could have shipped having never rendered it.
 */
describe("?search= on /customers", () => {
  const found = (term: string) =>
    parseList(customerList, get("/customers", `search=${encodeURIComponent(term)}&per_page=100`));

  it("does NOT match a name, with the positive control the measurement used", () => {
    // The control: a name that appears in no login and no email anywhere here.
    const control = parse(customerDetail, get("/customers/36")).data;
    expect(control.first_name).toBe("Zqxwvu");
    expect(control.last_name).toBe("Plmokn");
    expect(control.username).not.toContain("Zqxwvu");
    expect(control.email).not.toContain("zqxwvu");

    // The negative half, on both halves of the name and on the whole thing.
    expect(found("Zqxwvu").meta.total).toBe(0);
    expect(found("Plmokn").meta.total).toBe(0);
    expect(found("Zqxwvu Plmokn").meta.total).toBe(0);

    // And the positive half, which is what makes the zero above a measurement
    // rather than a search that is simply broken: the same row *is* findable.
    expect(found(control.username).data.map((row) => row.id)).toEqual([36]);
    expect(found(control.email).data.map((row) => row.id)).toEqual([36]);

    // The one named customer nobody can look up by name, which is the sentence
    // the empty state exists to say.
    const named = parse(customerDetail, get("/customers/20")).data;
    expect(named.first_name).not.toBe("");
    expect(found(named.first_name).meta.total).toBe(0);
    expect(looksLikeAName(named.first_name)).toBe(true);
  });

  it("matches a username and an email, case- and accent-insensitively", () => {
    expect(found("CLIENT20").meta.total).toBe(found("client20").meta.total);
    expect(found("client20").meta.total).toBe(1);

    /*
     * **The trap.** `?search=Chérif` returns a row and looks like proof that
     * names are matched. It is the accent-insensitive collation matching the
     * *email* — and the row it returns has no name on it at all, which is the
     * only reason the illusion is visible here.
     */
    const accented = found("Chérif");
    expect(accented.meta.total).toBe(1);
    expect(accented.data[0].email).toContain("cherif");
    expect(accented.data[0].first_name).toBe("");
    expect(accented.data[0].last_name).toBe("");
  });

  /**
   * An unknown parameter is ignored with a 200 and a known one with a bad value
   * is a 400. `queryFromParams()` carries a guard built entirely on that
   * asymmetry, and while the mock answered 200 to both it could have been deleted
   * with nothing noticing.
   */
  it("ignores an unknown parameter and refuses a bad orderby by name", () => {
    const all = parseList(customerList, get("/customers", "per_page=100")).meta.total;
    expect(parseList(customerList, get("/customers", "per_page=100&nonsense=zzz")).meta.total)
      .toBe(all);
    expect(
      parseList(customerList, get("/customers", "per_page=100&role=administrator")).meta.total,
    ).toBe(all);

    expect(get("/customers", "orderby=zzz").status).toBe(400);
    expect(get("/customers", "order=sideways").status).toBe(400);
    expect(apiError(get("/customers", "orderby=zzz")).details).toMatchObject({
      params: { orderby: expect.stringContaining("registered") },
    });

    // The four it does accept, and — the header's rule — it sorts by none of them.
    const ids = (query: string) =>
      parseList(customerList, get("/customers", `per_page=100&${query}`)).data.map((r) => r.id);
    for (const orderby of ["registered", "ID", "display_name", "user_email"]) {
      expect(get("/customers", `orderby=${orderby}`).status).toBe(200);
      expect(ids(`orderby=${orderby}&order=asc`)).toEqual(ids(""));
    }

    // The refusal is the **collection's**. A single read takes no `orderby` at
    // all, so refusing one there would be the same error in the other direction.
    expect(get("/customers/24", "orderby=zzz").status).toBe(200);
  });
});

/**
 * **The statistics block, and the two invariants it is rendered for.**
 *
 * `by_status` sums to `total_orders` exactly — that is the property
 * lib/api/schemas/customer.ts:119-137 says the block exists to publish — and
 * `total_revenue ÷ total_orders` is **not** `average_order_value`, because
 * revenue and the average are both over the *completed* orders. Every figure is
 * internally consistent and only labelling can make that visible, which is what
 * `statFigures()` gives each one a scope for.
 */
describe("a customer's statistics", () => {
  it("sums by_status to total_orders on every fixture", () => {
    for (const customer of everyCustomer()) {
      const summed = Object.values(customer.statistics.by_status).reduce((a, b) => a + b, 0);
      expect(summed, `by_status must sum to total_orders on ${customer.id}`).toBe(
        customer.statistics.total_orders,
      );
      // And the panel's own reader agrees, with the zeros dropped: the sum is the
      // property that survives dropping them.
      const breakdown = statusBreakdown(customer.statistics);
      expect(breakdown.reduce((sum, row) => sum + row.count, 0)).toBe(
        customer.statistics.total_orders,
      );
      expect(breakdown.every((row) => row.count > 0)).toBe(true);
    }
  });

  it("keeps the arithmetic trap: revenue is over the completed orders only", () => {
    const rich = parse(customerDetail, get("/customers/24")).data.statistics;
    expect(rich.completed_orders).toBeGreaterThan(0);
    expect(rich.completed_orders).toBeLessThan(rich.total_orders);

    // The arithmetic a reader performs when the two figures sit side by side, and
    // the arithmetic the API actually did.
    expect(Number(rich.total_revenue) / rich.total_orders).not.toBeCloseTo(
      Number(rich.average_order_value),
    );
    expect(Number(rich.total_revenue) / rich.completed_orders).toBeCloseTo(
      Number(rich.average_order_value),
    );

    // Every figure carries its scope, and the money ones count the completed.
    expect(statFigures(rich).filter((figure) => figure.scope === "completed")).toHaveLength(3);
  });

  /**
   * The breakdown used to hold `pending` and `completed` and nothing else, with
   * `cancelled_orders` and `returned_orders` zero on all sixteen — so the
   * zero-dropped list could never be more than two rows and two of the report's
   * own fields were unrenderable.
   */
  it("gives one customer a breakdown that is more than two rows", () => {
    const rich = parse(customerDetail, get("/customers/24")).data.statistics;
    expect(statusBreakdown(rich).length).toBeGreaterThan(2);
    expect(rich.cancelled_orders).toBeGreaterThan(0);
    expect(rich.returned_orders).toBeGreaterThan(0);
    expect(rich.by_status.cancelled).toBe(rich.cancelled_orders);
    expect(hasNoOrders(rich)).toBe(false);
  });

  /**
   * **The report and the order list cannot disagree**, because they are counted
   * from the same rows. They used to: `customer_id` was assigned round-robin over
   * the whole order book while the statistics were written out beside it, so the
   * detail would have printed "Total orders 6" over a list of twenty-one.
   */
  it("agrees with the customer's own order list, row for row", () => {
    for (const customer of everyCustomer()) {
      const orders = parseList(orderList, get(`/customers/${customer.id}/orders`, "per_page=100"));
      expect(orders.meta.total, `totals disagree on ${customer.id}`).toBe(
        customer.statistics.total_orders,
      );
      expect(orders.data.filter((row) => row.status === "completed")).toHaveLength(
        customer.statistics.completed_orders,
      );

      if (customer.statistics.total_orders === 0) continue;
      // The span is this customer's own oldest and newest, not two invented ids.
      expect(orders.data.map((row) => row.id)).toContain(customer.statistics.first_order?.id);
      expect(customer.statistics.last_order?.id).toBe(orders.data[0].id);
    }
  });
});

/**
 * **The four consent payload states**, three of which no fixture could reach.
 *
 * Only index 0 was `true` with a date and a source; the other fifteen had never
 * decided. A withdrawal — `false` with a **non-null** date — is the second
 * negative and a different answer from "we never asked", and an unknown source
 * string is the shape that once blanked the whole screen.
 */
describe("the consent record", () => {
  const consentOf = (id: number) =>
    consentRecord(parse(customerDetail, get(`/customers/${id}`)).data);

  it("reaches granted, withdrawn and never, and a source with no label", () => {
    const granted = consentOf(20);
    expect(granted.state).toBe("granted");
    expect(granted).toMatchObject({ at: expect.any(String), source: "registration" });
    expect(CONSENT_SOURCES).toContain(granted.state === "granted" ? granted.source : null);

    /*
     * The state the fixtures could not produce: a `false` that is a *decision*.
     * It is on customer 24 because that is the row `scripts/capture.mjs` takes by
     * default — reachable and photographed rather than merely reachable.
     */
    const withdrawn = consentOf(24);
    expect(withdrawn.state).toBe("withdrawn");
    expect(withdrawn.state === "withdrawn" && withdrawn.at).toEqual(expect.any(String));
    expect(parse(customerDetail, get("/customers/24")).data.marketing_consent).toBe(false);
    expect(parse(customerDetail, get("/customers/24")).data.marketing_consent_at).not.toBeNull();

    /*
     * **`"seed"` is the string that blanked the customer screen.**
     * `marketing_consent_source` was `z.enum([...])`, `Consent::set()` stores
     * whatever it is handed with no validation, the campaigns seed passed this,
     * and the detail rendered as "This page couldn't load" over one label on one
     * row. It parses, and it is outside the convention.
     */
    const unknown = consentOf(22);
    expect(unknown.state).toBe("granted");
    const source = unknown.state === "never" ? null : unknown.source;
    expect(source).toBe("seed");
    expect(CONSENT_SOURCES as readonly string[]).not.toContain(source);

    // The common case, and the majority of the shop: no record at all, which is
    // the one that changes what a shop should do next.
    expect(consentOf(21)).toEqual({ state: "never" });
    const never = everyCustomer().filter(
      (row) => consentRecord(row).state === "never",
    );
    expect(never).toHaveLength(14);
    expect(never.every((row) => row.marketing_consent_at === null)).toBe(true);
  });

  /**
   * **The fourth state lib/customers.ts names cannot be told apart, and that is a
   * property of the reader rather than a gap in the fixtures.** *declined* is "a
   * source but no grant" — but `consentRecord()` keys on the date and returns
   * `never` for any null one, whatever the source beside it says. So the mock
   * does not serve a payload for it: a fixture reaching a state the panel cannot
   * distinguish would be this file manufacturing a screen state rather than
   * reproducing one. This test is what stops that being forgotten.
   */
  it("collapses declined into never, because the reader keys on the date", () => {
    expect(
      consentRecord({
        ...parse(customerDetail, get("/customers/24")).data,
        marketing_consent: false,
        marketing_consent_at: null,
        marketing_consent_source: "account",
      }),
    ).toEqual({ state: "never" });

    // No fixture carries that shape, so nothing can come to depend on it.
    expect(
      everyCustomer().some(
        (row) => row.marketing_consent_at === null && row.marketing_consent_source !== null,
      ),
    ).toBe(false);
  });
});

/**
 * `GET /customers/{id}/orders`, which used to be refused as a third segment — and
 * this suite asserted the 404. Three measured behaviours, each one a thing the
 * obvious implementation gets wrong.
 */
describe("GET /customers/{id}/orders", () => {
  it("returns the identical shape to /orders, and 404s a customer who is not one", () => {
    const { data, meta } = parseList(orderList, get("/customers/24/orders", "per_page=100"));
    expect(data.length).toBeGreaterThan(0);
    expect(meta.total).toBe(data.length);
    // Verified by deep key-set equality on the live API, which is why
    // lib/api/schemas/order.ts serves both and there is no second order type.
    expect(Object.keys(data[0]).sort()).toEqual(
      Object.keys(parse(order, get(`/orders/${data[0].id}`)).data).sort(),
    );

    // A customer with no orders is an empty list, not a 404.
    expect(parseList(orderList, get("/customers/36/orders")).data).toEqual([]);
    // An id the collection does not list is a 404 — including the ids the order
    // book's own orphan orders are keyed to.
    expect(get("/customers/900/orders").status).toBe(404);
    expect(get("/customers/999999/orders").status).toBe(404);
  });

  it("takes one status, and a comma list is a 400", () => {
    const filtered = parseList(orderList, get("/customers/24/orders", "status=completed&per_page=100"));
    expect(filtered.data.length).toBeGreaterThan(0);
    expect(filtered.data.every((row) => row.status === "completed")).toBe(true);
    expect(filtered.meta.total).toBeLessThan(
      parseList(orderList, get("/customers/24/orders", "per_page=100")).meta.total,
    );

    expect(get("/customers/24/orders", "status=completed,pending").status).toBe(400);
    expect(get("/customers/24/orders", "status=nonsense").status).toBe(400);
    // `""` is the absence of the filter, not a value.
    expect(parseList(orderList, get("/customers/24/orders", "status=&per_page=100")).meta.total)
      .toBe(parseList(orderList, get("/customers/24/orders", "per_page=100")).meta.total);
  });

  /**
   * **A different `orderby` enum from the parent collection**, which is the whole
   * reason it is worth reproducing: a screen that reused the customer list's
   * control would send a value this route refuses, and vice versa.
   */
  it("takes orderby from its own enum, not the customer list's", () => {
    for (const orderby of ["date", "id", "modified", "total"]) {
      expect(get("/customers/24/orders", `orderby=${orderby}`).status).toBe(200);
      expect(get("/customers", `orderby=${orderby}`).status).toBe(400);
    }
    for (const orderby of ["registered", "ID", "display_name", "user_email"]) {
      expect(get("/customers/24/orders", `orderby=${orderby}`).status).toBe(400);
      expect(get("/customers", `orderby=${orderby}`).status).toBe(200);
    }
    expect(get("/customers/24/orders", "order=sideways").status).toBe(400);

    // Validated and then ignored, the way everything in this file is ignored.
    const ids = (query: string) =>
      parseList(orderList, get("/customers/24/orders", `per_page=100&${query}`)).data.map(
        (row) => row.id,
      );
    expect(ids("orderby=total&order=asc")).toEqual(ids(""));
  });

  /**
   * **`customer_id` is ignored.** Measured: `?customer_id=25` on customer 24's
   * route answers customer 24's orders. The identity is the path and no parameter
   * can redirect it — worth pinning, because the obvious implementation reads the
   * parameter when it is there and quietly serves somebody else's order list.
   */
  it("ignores customer_id entirely", () => {
    const own = parseList(orderList, get("/customers/24/orders", "per_page=100")).data;
    const redirected = parseList(
      orderList,
      get("/customers/24/orders", "per_page=100&customer_id=23"),
    ).data;
    expect(redirected.map((row) => row.id)).toEqual(own.map((row) => row.id));

    // And it is a redirection that would have been visible: 23 has its own,
    // different list.
    const other = parseList(orderList, get("/customers/23/orders", "per_page=100")).data;
    expect(other.map((row) => row.id)).not.toEqual(own.map((row) => row.id));
    // An id that is not a customer at all changes nothing either.
    expect(
      parseList(orderList, get("/customers/24/orders", "per_page=100&customer_id=0")).data.length,
    ).toBe(own.length);
  });

  it("paginates, and reads a PATCHed status back", () => {
    const first = parseList(orderList, get("/customers/24/orders", "per_page=2"));
    expect(first.data).toHaveLength(2);
    expect(first.meta.total).toBeGreaterThan(2);
    expect(get("/customers/24/orders", "per_page=500").status).toBe(400);

    // The list and the report move together, because both are counted from the
    // same rows read through the same write state.
    const pending = parseList(orderList, get("/customers/24/orders", "per_page=100")).data.find(
      (row) => row.status === "pending",
    );
    expect(write("PATCH", `/orders/${pending!.id}`, { status: "completed" }).status).toBe(200);

    const after = parse(customerDetail, get("/customers/24")).data.statistics;
    expect(after.by_status.pending).toBe(0);
    expect(
      Object.values(after.by_status).reduce((a, b) => a + b, 0),
    ).toBe(after.total_orders);
  });
});

/**
 * `GET /notifications`, which was absent entirely — so the customer detail's
 * notifications section rendered its **error state in every capture**, a screen
 * state produced by the harness rather than caught by it.
 */
describe("GET /notifications", () => {
  const rows = (query: string) =>
    parseList(notificationList, get("/notifications", `per_page=100&${query}`));

  it("parses the queue, in all four states the panel derives from three fields", () => {
    const { data, meta } = rows("");
    expect(data.length).toBeGreaterThan(0);
    expect(meta.total).toBe(data.length);

    // `status` is three values and the screen shows four: a retryable failure
    // leaves the row `pending` with the attempt counted and the error on it.
    const counts = stateCounts(data);
    for (const state of QUEUE_STATES) {
      expect(counts[state], `no ${state} row to render`).toBeGreaterThan(0);
    }

    // The two the panel labels, and a recipient that is not an email — the API
    // does not validate it as one, and `seed-notifications.mjs` writes a phone.
    expect(new Set(data.map((row) => row.channel))).toEqual(new Set(["email", "sms"]));
    expect(data.some((row) => !row.recipient.includes("@"))).toBe(true);
    // Nullable and never 0.
    expect(data.some((row) => row.subject_id === null)).toBe(true);
    expect(data.every((row) => row.subject_id !== 0)).toBe(true);
    // Newest first, and nothing can change it.
    expect(data.map((row) => row.created_at)).toEqual(
      [...data.map((row) => row.created_at)].sort().reverse(),
    );
    expect(rows("orderby=channel&order=asc").data.map((row) => row.id)).toEqual(
      data.map((row) => row.id),
    );
    expect(get("/notifications", "orderby=nonsense").status).toBe(200);
  });

  /**
   * The filter the customer detail's section is built on, and the reason it is
   * one request rather than one per order per event name.
   */
  it("filters by recipient, and leaves the shop's own alerts out of it", () => {
    const customer = parse(customerDetail, get("/customers/24")).data;
    const mine = rows(`recipient=${encodeURIComponent(customer.email)}`);
    expect(mine.data.length).toBeGreaterThan(0);
    expect(mine.data.every((row) => row.recipient === customer.email)).toBe(true);
    expect(mine.data.every((row) => row.audience === "customer")).toBe(true);

    // **18 of the 39 measured rows were `admin`** — the shop being told it had an
    // order. They are about this customer's orders and are correctly absent, which
    // is what the section's footnote says and what makes it verifiable.
    const admin = rows("recipient=admin@example.test");
    expect(admin.data.length).toBeGreaterThan(0);
    expect(admin.data.some((row) => mine.data.every((row2) => row2.id !== row.id))).toBe(true);
    expect(rows("").data.filter((row) => row.audience === "admin").length).toBeGreaterThan(0);

    // Exact, never a prefix: an address that is a prefix of another's must not
    // collect their queue.
    expect(rows(`recipient=${customer.email.slice(0, 8)}`).meta.total).toBe(0);
  });

  it("honours channel, status, dedupe_key, subject_id and the date range", () => {
    expect(rows("channel=email").data.every((row) => row.channel === "email")).toBe(true);
    // **Not validated**: an unknown channel is a 200 with 0 rows where an unknown
    // status is a 400, because the route declares a key pattern rather than an enum.
    expect(rows("channel=nonsense").meta.total).toBe(0);
    expect(get("/notifications", "channel=nonsense").status).toBe(200);

    for (const status of ["pending", "sent", "failed"]) {
      expect(rows(`status=${status}`).data.every((row) => row.status === status)).toBe(true);
    }
    const refused = apiError(get("/notifications", "status=delivered"));
    expect(refused.status).toBe(400);
    // Measured: the code is `invalid_request`, not `rest_invalid_param`, and the
    // sentence names the three and ends with a stop.
    expect(refused.code).toBe("invalid_request");
    expect(refused.details).toMatchObject({
      params: { status: "status is not one of pending, sent, and failed." },
    });

    // `dedupe_key` is exact-match only — the left half alone answers 0 rows.
    const one = rows("").data.find((row) => row.subject_id !== null)!;
    expect(rows(`dedupe_key=${one.dedupe_key}`).data.map((r) => r.id)).toContain(one.id);
    expect(rows(`dedupe_key=${one.event}`).meta.total).toBe(0);

    // One order, every event about it — the query `dedupe_key` cannot express.
    const bySubject = rows(`subject_id=${one.subject_id}`);
    expect(bySubject.data.length).toBeGreaterThan(1);
    expect(bySubject.data.every((row) => row.subject_id === one.subject_id)).toBe(true);
    // `minimum: 1`, so the unset value is refused rather than ignored.
    expect(get("/notifications", "subject_id=0").status).toBe(400);

    const day = one.created_at.slice(0, 10);
    expect(rows(`date_from=${day}&date_to=${day}`).data.every((row) =>
      row.created_at.startsWith(day),
    )).toBe(true);
    expect(get("/notifications", "date_from=yesterday").status).toBe(400);
  });

  /**
   * **`event` and `audience` are accepted and ignored**, and reproducing that is
   * the point: both are on every row, both are the obvious thing to filter by,
   * and §90 declined them deliberately. A mock that honoured them would let an
   * agent build the two controls the panel refuses to ship and watch them work.
   */
  it("accepts event, audience and search, and ignores all three", () => {
    const all = rows("").meta.total;
    expect(rows("event=order.placed").meta.total).toBe(all);
    expect(rows("audience=admin").meta.total).toBe(all);
    expect(rows("search=yacine").meta.total).toBe(all);
    expect(rows("wilaya=16").meta.total).toBe(all);
  });

  it("serves the list and nothing else on the collection", () => {
    expect(get("/notifications/1").status).toBe(404);
    expect(write("POST", "/notifications/1/retry").status).toBe(404);
  });
});

describe("GET /inventory", () => {
  /**
   * `include_variations` defaults to **false**, which is the API's own default
   * and was not reproduced here until the ledger work. So the bare list is the
   * 38 listed products and the parameter is what adds the 5 variations — the
   * 28-vs-33 correction the screen's own docblock is about, at this shop's
   * larger fixture count.
   */
  it("defaults include_variations to false", () => {
    const bare = parseList(inventoryList, get("/inventory", "per_page=100"));
    expect(bare.data.filter((row) => row.parent_id !== 0)).toHaveLength(0);
    expect(bare.meta.total).toBe(38);
  });

  it("parses every row, and null is not zero on eight of them", () => {
    // The 38 listed products plus the 5 variations. A trashed product is in no
    // stockroom and is in neither this list nor /products.
    const { data, meta } = parseList(
      inventoryList,
      get("/inventory", "per_page=100&include_variations=true"),
    );
    expect(meta.total).toBe(43);
    expect(data.filter((row) => row.parent_id !== 0)).toHaveLength(5);
    expect(data.filter((row) => row.stock_quantity === null)).toHaveLength(8);
    // Per product, not global — so there is no shop-wide threshold to display.
    expect(data.filter((row) => row.low_stock_amount === 5)).toHaveLength(1);
  });

  it("parses a detail", () => {
    expect(parse(inventoryItem, get("/inventory/101")).data.id).toBe(101);
  });

  /**
   * The inventory screen calls this from the client on every render and the
   * harness brief's endpoint list does not mention it — the capture run is what
   * found that. It returns the same item as the other three inventory routes.
   */
  it("serves /inventory/low-stock with the same row shape", () => {
    const { data, meta } = parseList(inventoryList, get("/inventory/low-stock", "per_page=100"));
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((row) => row.low_stock)).toBe(true);
    expect(meta.total).toBe(data.length);
  });

  /* ------------------------------------------------------ the filters --- */

  it("filters on the three parameters that were measured, and no others", () => {
    const out = parseList(inventoryList, get("/inventory", "stock_status=outofstock"));
    expect(out.data.length).toBeGreaterThan(0);
    expect(out.data.every((row) => row.stock_status === "outofstock")).toBe(true);

    // A known name with a bad value refuses; an unknown *name* is ignored with a
    // 200. That asymmetry is what makes a filter that does nothing look exactly
    // like a filter that works, and it is why every parameter here was measured
    // one at a time.
    expect(get("/inventory", "stock_status=zzz").status).toBe(400);
    const ignored = parseList(inventoryList, get("/inventory", "nonsense=zzz&per_page=100"));
    expect(ignored.meta.total).toBe(38);

    // `per_page` refuses rather than clamping.
    expect(get("/inventory", "per_page=101").status).toBe(400);
  });

  /**
   * Three states, not two. `manage_stock` absent is not the same question as
   * `manage_stock=false`, and a screen whose control collapses them cannot ask
   * for "everything".
   */
  it("treats manage_stock as three states", () => {
    const all = parseList(inventoryList, get("/inventory", "per_page=100")).data.length;
    const on = parseList(inventoryList, get("/inventory", "per_page=100&manage_stock=true")).data;
    const off = parseList(inventoryList, get("/inventory", "per_page=100&manage_stock=false")).data;
    expect(on.length).toBeGreaterThan(0);
    expect(off.length).toBeGreaterThan(0);
    expect(on.length + off.length).toBe(all);
  });

  /**
   * The string branch of `manage_stock`'s union — a variation inheriting its
   * parent's stock. No fixture reported it until now, so the schema's
   * `z.union([z.boolean(), z.literal("parent")])` had never been exercised
   * against this mock, and `saveSettings` sending the whole object would
   * translate it to `true` and silently detach the variation.
   */
  it("serves a row whose manage_stock is the string 'parent'", () => {
    const { data } = parseList(
      inventoryList,
      get("/inventory", "per_page=100&include_variations=true"),
    );
    const delegated = data.find((row) => row.manage_stock === "parent");
    expect(delegated).toBeDefined();
    expect(delegated!.stock_managed_by_id).not.toBe(delegated!.id);
  });

  /* -------------------------------------------------------- the ledger --- */

  it("parses the movements ledger and holds its invariant", () => {
    const { data, meta } = parseList(movementList, get("/inventory/movements", "per_page=100"));
    expect(meta.total).toBeGreaterThan(1000);
    // Enforced by the backend at construction, which is why a row renders as an
    // arrow between two numbers rather than as a delta the reader must apply.
    expect(
      data.every((m) => m.quantity_before + m.delta === m.quantity_after),
    ).toBe(true);
    // No UTC offset, unlike an order's own date_created. parseApiDate() exists
    // only to repair this, and a mock emitting clean ISO would let it be deleted.
    expect(data.every((m) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(m.created_at))).toBe(true);
  });

  /**
   * **A ledger is an archive and a catalogue is not.** Measured, the real ledger
   * names 155 distinct product ids and only 23 appear in /inventory at all. That
   * is what makes a movement's product a real path to a 404, which is why
   * `[id]/not-found.tsx` is a built screen rather than a defensive branch — so a
   * mock whose every movement resolved would make that screen unreachable.
   */
  it("names products that no longer exist", () => {
    const rows = parseList(
      inventoryList,
      get("/inventory", "per_page=100&include_variations=true"),
    ).data;
    const catalogue = new Set(rows.map((row) => row.id));
    const movements = parseList(movementList, get("/inventory/movements", "per_page=100")).data;
    const ids = [...new Set(movements.map((m) => m.product_id))];
    expect(ids.filter((id) => catalogue.has(id)).length).toBeLessThan(ids.length / 2);
  });

  it("filters the ledger on its measured parameters", () => {
    const byReason = parseList(movementList, get("/inventory/movements", "reason=correction"));
    expect(byReason.data.every((m) => m.reason === "correction")).toBe(true);
    expect(get("/inventory/movements", "reason=zzz").status).toBe(400);
    // Y-m-d only; anything else refuses rather than guessing a format.
    expect(get("/inventory/movements", "date_from=31-12-2026").status).toBe(400);
  });

  /**
   * An object keyed by reason, **not** a list, and it omits every reason with no
   * rows. That omission is why the panel builds its filter from ALL_REASONS and
   * takes only the counts from here — the facet lesson, in a second place.
   */
  it("summarises movements by reason, omitting the empty ones", () => {
    const { data } = parse(movementSummary, get("/inventory/movements/summary"));
    const keys = Object.keys(data);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBeLessThan(ALL_REASONS.length);
    expect(Object.values(data).every((entry) => entry.movements > 0)).toBe(true);
  });

  /* -------------------------------------------------------- the lookup --- */

  it("looks a row up by sku, and refuses in two different shapes", () => {
    expect(parse(inventoryItem, get("/inventory/lookup", "sku=AC-CAT-0101")).data.sku).toBe(
      "AC-CAT-0101",
    );
    expect(get("/inventory/lookup", "sku=NOPE").status).toBe(404);

    /*
     * A missing `sku` answers 400 with `details.params` as an **array of
     * names**, where every other refusal in this API uses an object keyed by
     * field. `query.ts` carries a branch for exactly that shape and nothing had
     * ever exercised it.
     */
    const bare = apiError(get("/inventory/lookup"));
    expect(bare.status).toBe(400);
    expect(Array.isArray(bare.details.params)).toBe(true);
  });

  /* --------------------------------------------------------- the write --- */

  it("adjusts stock, and answers with the movement it wrote", () => {
    resetState();
    const rows = parseList(
      inventoryList,
      get("/inventory", "per_page=100&include_variations=true"),
    ).data;
    const target = rows.find(
      (row) => row.managing_stock && row.stock_quantity !== null && row.backorders === "no",
    )!;

    const { data } = parse(
      adjustResult,
      write("POST", `/inventory/${target.id}/adjust`, { mode: "set", quantity: 7, reason: "correction" }),
    );
    expect(data.item.stock_quantity).toBe(7);
    // InventoryMovement::toArray() omits `id`; the ledger's own rows carry one.
    expect("id" in data.movement).toBe(false);
    expect(data.movement.quantity_before + data.movement.delta).toBe(
      data.movement.quantity_after,
    );

    // Stateful in-process, so a screen that adjusts and refetches sees it…
    expect(parse(inventoryItem, get(`/inventory/${target.id}`)).data.stock_quantity).toBe(7);
    // …and gone on the next process, so a capture stays byte-stable.
    resetState();
    expect(parse(inventoryItem, get(`/inventory/${target.id}`)).data.stock_quantity).toBe(
      target.stock_quantity,
    );
  });

  /**
   * **Two 409s, and keeping them apart is the whole point.** One says the shelf
   * cannot go that low; the other says this product has no shelf. They lead to
   * different fixes — the first to a different number, the second to the
   * settings card one section below — so a screen that collapsed them would send
   * someone to the wrong one.
   */
  it("refuses a below-zero move and a non-managing product differently", () => {
    resetState();
    const rows = parseList(
      inventoryList,
      get("/inventory", "per_page=100&include_variations=true"),
    ).data;
    const strict = rows.find(
      (row) => row.managing_stock && row.stock_quantity !== null && row.backorders === "no",
    )!;
    const untracked = rows.find((row) => !row.managing_stock)!;

    const below = apiError(
      write("POST", `/inventory/${strict.id}/adjust`, {
        mode: "decrease",
        quantity: 99_999,
        reason: "correction",
      }),
    );
    expect(below.status).toBe(409);
    // Refused, never clamped — and `projected` is the number the screen renders.
    expect(Number(below.details.projected)).toBeLessThan(0);
    expect(below.details.backorders).toBe("no");

    const noShelf = apiError(
      write("POST", `/inventory/${untracked.id}/adjust`, {
        mode: "set",
        quantity: 1,
        reason: "correction",
      }),
    );
    expect(noShelf.status).toBe(409);
    expect(noShelf.details.id).toBe(untracked.id);
    expect(noShelf.details.manage_stock).toBe(false);
  });

  it("lets a backordering product go negative", () => {
    resetState();
    const rows = parseList(
      inventoryList,
      get("/inventory", "per_page=100&include_variations=true"),
    ).data;
    const lenient = rows.find((row) => row.managing_stock && row.backorders !== "no");
    expect(lenient).toBeDefined();
    const out = write("POST", `/inventory/${lenient!.id}/adjust`, {
      mode: "decrease",
      quantity: 99_999,
      reason: "correction",
    });
    expect(out.status).toBe(200);
    expect(parse(adjustResult, out).data.item.stock_quantity).toBeLessThan(0);
  });

  it("refuses an unknown adjust field, and every bad one at once", () => {
    resetState();
    const rows = parseList(inventoryList, get("/inventory", "per_page=100")).data;
    const target = rows.find((row) => row.managing_stock && row.stock_quantity !== null)!;

    const unknown = apiError(
      write("POST", `/inventory/${target.id}/adjust`, {
        mode: "set",
        quantity: 1,
        reason: "correction",
        nonsense: 1,
      }),
    );
    expect(unknown.status).toBe(400);
    expect(unknown.details.fields).toHaveProperty("nonsense");

    const many = apiError(
      write("POST", `/inventory/${target.id}/adjust`, {
        mode: "zzz",
        quantity: -3,
        reason: "zzz",
      }),
    );
    expect(many.status).toBe(400);
    expect(Object.keys(many.details.fields as object).length).toBeGreaterThan(1);
  });

  /**
   * The settings write, which the brief that scoped this section omitted
   * entirely and which ships anyway. Its 400 on `stock_quantity` names the
   * adjust endpoint, and that is the only path to the orphan-field branch on the
   * item detail.
   */
  it("patches settings, and sends the quantity to the adjust endpoint", () => {
    resetState();
    const rows = parseList(inventoryList, get("/inventory", "per_page=100")).data;
    const target = rows.find((row) => row.managing_stock)!;

    expect(
      parse(inventoryItem, write("PATCH", `/inventory/${target.id}`, { low_stock_amount: 9 }))
        .data.low_stock_amount,
    ).toBe(9);

    const refused = apiError(write("PATCH", `/inventory/${target.id}`, { stock_quantity: 5 }));
    expect(refused.status).toBe(400);
    expect(refused.details.fields).toHaveProperty("stock_quantity");
    expect(
      String((refused.details.fields as Record<string, string>).stock_quantity),
    ).toContain("adjust");
  });

  /**
   * A batch stocktake is a screen nobody has built. The route exists and takes
   * up to 100 items, and lib/api/allowlist.ts refuses it with
   * tests/boundary.test.ts asserting the refusal — the same position products'
   * /bulk is in. Mocking it would manufacture the evidence for a write nobody
   * has seen work.
   */
  it("keeps POST /inventory/bulk unreachable", () => {
    expect(write("POST", "/inventory/bulk", { items: [] }).status).toBe(404);
  });
});

describe("GET /coupons", () => {
  it("parses the list, and keeps zero and null apart", () => {
    // Six listed: the trashed one is in no listing at all.
    const { data, meta } = parseList(couponList, get("/coupons", "per_page=100"));
    expect(meta.total).toBe(6);
    // `"0.00"` is a real coupon; a threshold of zero is stored as null and can
    // never read back as `"0.00"`. Both directions on one object.
    expect(data.some((row) => row.amount === "0.00" && row.free_shipping)).toBe(true);
    expect(
      data.every(
        (row) => row.minimum_amount !== "0.00" && row.maximum_amount !== "0.00",
      ),
    ).toBe(true);
  });

  it("carries restrictions on the detail and not on the list", () => {
    const { data } = parseList(couponList, get("/coupons", "per_page=100"));
    expect(data.some((row) => "restrictions" in row)).toBe(false);

    const detail = parse(couponDetail, get("/coupons/302")).data;
    expect(detail.restrictions.product_ids[0].missing).toBe(false);
    // The list schema still parses a detail body — loose objects — which is why
    // the absence above is asserted rather than inferred from a parse failure.
    expect(parse(coupon, get("/coupons/302")).data.code).toBe("livraison");
  });

  /**
   * **The vocabularies are written out in the mock and imported here**, which is
   * the arrangement `PRODUCT_TYPES` is held to: the mock imports nothing, so the
   * only thing keeping the two copies together is an assertion.
   */
  it("agrees with lib/coupon-status.ts about the two vocabularies", () => {
    // Every discount type the panel knows is writable here, and a fourth is not.
    for (const discount_type of DISCOUNT_TYPES) {
      expect(write("PATCH", "/coupons/301", { discount_type }).status).toBe(200);
    }
    expect(write("PATCH", "/coupons/301", { discount_type: "grouped" }).status).toBe(400);

    // And nothing in the shop carries a type outside the three.
    const { data } = parseList(couponList, get("/coupons", "per_page=100"));
    expect(data.every((row) => (DISCOUNT_TYPES as readonly string[]).includes(row.discount_type)))
      .toBe(true);

    // The filterable pair — writable and filterable are the same two here, and
    // `trash` is neither, because a coupon is trashed by DELETE and never by a
    // PATCH. That is the exact split products has.
    for (const status of COUPON_STATUSES) {
      expect(get("/coupons", `status=${status}`).status).toBe(200);
      expect(write("PATCH", "/coupons/301", { status }).status).toBe(200);
    }
    expect(write("PATCH", "/coupons/301", { status: "trash" }).status).toBe(400);

    // The refusal names them in the panel's own order, empty string first.
    const refused = apiError(get("/coupons", "status=trash"));
    expect(refused.params?.status).toBe("status is not one of , publish, and draft.");
  });

  /**
   * **Three states, and the first sends nothing.** Absent is not a synonym for
   * either value — it is publish *and* draft — which is why the segmented
   * control's first segment omits the parameter rather than sending an empty one.
   * While the mock passed neither `search` nor `status` to its collection helper,
   * every one of these four requests answered with the same rows.
   */
  it("filters by status in three states, the first of which sends nothing", () => {
    const totals = (query: string) =>
      parseList(couponList, get("/coupons", `per_page=100&${query}`)).meta.total;

    const all = totals("");
    const published = totals("status=publish");
    const drafted = totals("status=draft");

    expect(published).toBe(5);
    expect(drafted).toBe(1);
    // The default carries both, and is therefore neither of them.
    expect(all).toBe(published + drafted);
    expect(all).not.toBe(published);
    expect(all).not.toBe(drafted);

    // `?status=` with an empty value is the same request as no parameter.
    expect(totals("status=")).toBe(all);
  });

  /**
   * `?status=trash` is a **400** while a trashed coupon reads back with a **200**,
   * which is why `READABLE_COUPON_STATUSES` is wider than `COUPON_STATUSES`. A
   * schema without `trash` would fail at its own boundary the moment somebody
   * trashed a coupon and the detail reloaded underneath them.
   */
  it("refuses trash as a filter and serves it as a row", () => {
    expect(get("/coupons", "status=trash").status).toBe(400);

    const { data } = parse(couponDetail, get("/coupons/306"));
    expect(data.status).toBe("trash");
    // And it is in no listing, under any of the three states.
    for (const query of ["", "status=publish", "status=draft"]) {
      const rows = parseList(couponList, get("/coupons", `per_page=100&${query}`)).data;
      expect(rows.some((row) => row.id === 306)).toBe(false);
    }
  });

  /**
   * **The code only.** Deliberately narrower than WordPress's own `s`, which
   * would read the description too: nothing measured says which fields this
   * search covers, and the customers collection is why this file will not guess
   * the wider answer.
   */
  it("searches the code, and narrows to it", () => {
    const search = (term: string) =>
      parseList(couponList, get("/coupons", `per_page=100&search=${term}`));

    expect(search("livraison").meta.total).toBe(1);
    expect(search("livraison").data[0].code).toBe("livraison");
    // A prefix matches, because it is a substring search.
    expect(search("bienvenue").meta.total).toBe(1);
    // And a word that appears only in a description does not.
    expect(search("fidélité").meta.total).toBe(0);
    expect(search("zzz").meta.total).toBe(0);
  });

  /**
   * **Validated and then honoured — all four values, both directions.** This suite
   * asserted the opposite for two branches, and the reason it survived is the
   * assertion it used: `date` is the default, so it answers the same sequence
   * whether the sort works or not, and it was compared against itself.
   *
   * **`order` defaults to `desc`**, and `date` cannot show you that: the four live
   * coupons share one `post_date`, so both directions tie there and answer the
   * bare sequence. `id` is the value that reveals it, and it is asserted below.
   *
   * `usage` must be **numeric**: sorted as text, 9 lands after 37. Fixture 307
   * exists for exactly that — `usage_count: 9` against 305's `37` is the only pair
   * in this shop the two orderings disagree about.
   */
  it("sorts on all four keys, in both directions", () => {
    const rows = (query: string) =>
      parseList(couponList, get("/coupons", `per_page=100&${query}`)).data;

    const ids = (query: string) => rows(query).map((row) => row.id);
    const base = ids("");

    // `date` in the default direction *is* the default — the blind spot itself,
    // asserted rather than left to be rediscovered.
    expect(ids("orderby=date")).toEqual(base);
    expect(ids("orderby=date&order=desc")).toEqual(base);
    // `?orderby=` is **not** the absence of the parameter — see the empty-string
    // test below. This line asserted the opposite and was wrong.
    // And it genuinely sorts: the other direction is that sequence reversed.
    expect(ids("orderby=date&order=asc")).toEqual([...base].reverse());

    // `id` is where the default direction shows: descending, unasked.
    expect(ids("orderby=id")).toEqual([...base].sort((a, b) => b - a));
    expect(ids("orderby=id&order=desc")).toEqual([...base].sort((a, b) => b - a));
    expect(ids("orderby=id&order=asc")).toEqual([...base].sort((a, b) => a - b));

    const codes = (query: string) => rows(query).map((row) => row.code);
    expect(codes("orderby=code&order=asc")).toEqual([...codes("")].sort());
    expect(codes("orderby=code&order=desc")).toEqual([...codes("")].sort().reverse());

    const counts = (query: string) => rows(query).map((row) => row.usage_count);
    expect(counts("orderby=usage&order=asc")).toEqual([...counts("")].sort((a, b) => a - b));
    expect(counts("orderby=usage&order=desc")).toEqual([...counts("")].sort((a, b) => b - a));

    // **Numeric, not lexical**, spelled out rather than left to a comparator that
    // agrees with the wrong one on every other row: 9 before 37 ascending, and a
    // `localeCompare` would put 37 first and still satisfy the two lines above if
    // 307 ever lost its count.
    expect(counts("orderby=usage&order=asc")).toEqual([0, 0, 0, 0, 9, 37]);
    expect(counts("orderby=usage&order=desc")).toEqual([37, 9, 0, 0, 0, 0]);

    const refused = apiError(get("/coupons", "orderby=nonsense"));
    expect(refused.status).toBe(400);
    expect(refused.params?.orderby).toContain("orderby is not one of");
    expect(get("/coupons", "order=sideways").status).toBe(400);
  });

  it("refuses a per_page over 100 rather than clamping it", () => {
    expect(get("/coupons", "per_page=101").status).toBe(400);
    expect(get("/coupons/eligible-products", "per_page=101").status).toBe(400);
    expect(get("/coupons/eligible-categories", "per_page=101").status).toBe(400);
  });

  /**
   * **`?orderby=` is a value, not an absence** — and `?status=` on this same
   * collection is an absence, which is why one test asserts both halves.
   *
   * The router checks each parameter against an enum and `""` passes exactly
   * where `""` is a member. It is a member of the coupon status enum — the 400
   * names it first, `status is not one of , publish, and draft.` — and of neither
   * sort enum. This file used to read `""` as absence everywhere, so a select
   * reset to its placeholder verified clean here and 400s in the shop.
   *
   * Measured 2026-08-25.
   */
  it("refuses an empty orderby or order and still reads an empty status as absence", () => {
    const refusedOrderby = apiError(get("/coupons", "orderby="));
    expect(refusedOrderby.status).toBe(400);
    expect(refusedOrderby.params?.orderby).toBe("orderby is not one of date, id, code, and usage.");

    const refusedOrder = apiError(get("/coupons", "order="));
    expect(refusedOrder.status).toBe(400);
    // Two values, and WordPress writes those **without a comma**. This file's
    // `oxford` had only the three-or-more branch and answered "asc, and desc";
    // lib/transfer.ts:189 records a measured two-value refusal from another
    // endpoint — "mode is not one of create and update." — which is the form.
    expect(refusedOrder.params?.order).toBe("order is not one of asc and desc.");

    // The other two on this collection are untouched: `""` is absence for both.
    // Compared against the bare listing rather than a row count, so the
    // assertion survives a fixture being added to this shop.
    const listed = (query: string) =>
      parseList(couponList, get("/coupons", `per_page=100&${query}`)).data.map((row) => row.id);
    expect(listed("status=")).toEqual(listed(""));
    expect(listed("search=")).toEqual(listed(""));
  });

  /**
   * **Five paging edges, and this file refused one of them.**
   *
   * The two sentences are different on purpose: a value that is not a whole
   * number fails the schema, an integer outside the bounds fails the range, and
   * only the second can tell a person what the bounds are.
   *
   * `page=-3` was the dangerous one — not a silent 200 but `rows.slice(-3 * 20)`,
   * which answered the **tail of the list** as though it were a page.
   *
   * Measured 2026-08-25 on `/coupons` and `/products`; asserted on the pickers
   * too, because those validate nothing else and go through the same `paginate`.
   */
  it("refuses every per_page and page edge value, on the pickers as well", () => {
    const between = "per_page must be between 1 (inclusive) and 100 (inclusive)";
    const atLeastOne = "page must be greater than or equal to 1";

    for (const path of ["/coupons", "/products", "/coupons/eligible-products"]) {
      for (const query of ["per_page=0", "per_page=-1", "per_page=101"]) {
        const refused = apiError(get(path, query));
        expect(refused.status).toBe(400);
        expect(refused.params?.per_page).toBe(between);
      }

      const badType = apiError(get(path, "per_page=abc"));
      expect(badType.status).toBe(400);
      expect(badType.params?.per_page).toBe("per_page is not of type integer.");

      for (const query of ["page=0", "page=-3"]) {
        const refused = apiError(get(path, query));
        expect(refused.status).toBe(400);
        expect(refused.params?.page).toBe(atLeastOne);
      }

      const badPage = apiError(get(path, "page=abc"));
      expect(badPage.status).toBe(400);
      expect(badPage.params?.page).toBe("page is not of type integer.");

      /*
       * **`?per_page=` is a type refusal, not an absence** — measured
       * 2026-08-25, after the enum model predicted it. `""` is not an integer
       * for the same reason it is not a member of a sort enum, and only a
       * parameter that is absent entirely reaches the default.
       */
      expect(apiError(get(path, "per_page=")).params?.per_page)
        .toBe("per_page is not of type integer.");
      expect(apiError(get(path, "page=")).params?.page)
        .toBe("page is not of type integer.");
    }
  });

  /**
   * **The one the audit got wrong, kept as a test so it stays got-wrong.**
   *
   * The pickers validate nothing but the paging parameters, and that really is
   * the live behaviour — measured 2026-08-25 one parameter at a time, with
   * `/coupons` as the positive control. It looks like a divergence next to
   * `/coupons` and is not one.
   */
  it("leaves the pickers permissive about everything except paging", () => {
    for (const query of ["orderby=zzz", "order=sideways", "status=zzz"]) {
      expect(get("/coupons/eligible-products", query).status).toBe(200);
      expect(get("/coupons/eligible-categories", query).status).toBe(200);
    }
    // The control: the same value, one route up, is a 400.
    expect(get("/coupons", "orderby=zzz").status).toBe(400);
  });

  /**
   * **The stale restriction, which is the fixture this branch exists for.**
   *
   * `missing` is on every restriction row rather than only the broken ones,
   * because a client that filtered it out would silently delete the restriction
   * the next time the form saved. No fixture had one, so the warning that says so
   * had never been rendered.
   */
  it("resolves restrictions against the real collections, and keeps the stale ids", () => {
    const { data } = parse(couponDetail, get("/coupons/305"));
    const { product_ids: products, product_categories: categories } = data.restrictions;

    expect(products).toHaveLength(2);
    expect(categories).toHaveLength(2);

    // The halves that resolve carry a real name off the real collection — not a
    // number in French clothing, which is what the category arm used to emit.
    expect(refLabel(products[0])).toEqual({ named: true, text: "Miel de jujubier, 500 g" });
    expect(refLabel(categories[0])).toEqual({ named: true, text: "Tapis" });
    expect(categories[0].slug).toBe("tapis");

    // The halves that do not resolve keep their place, and say nothing they
    // cannot know: no name, no status, no slug.
    expect(products[1].missing).toBe(true);
    expect(products[1].name).toBeNull();
    expect(products[1]).not.toHaveProperty("status");
    expect(categories[1].missing).toBe(true);
    expect(categories[1]).not.toHaveProperty("slug");

    // Which is what the form's warning is built from: two rows, across two fields.
    expect(missingRefs(data.restrictions).map((ref) => ref.id)).toEqual([8842, 8843]);
  });

  /**
   * `usage_count` is 0 on the four original fixtures and no route can move it, so
   * the *used* and *exhausted* renderings had no data that could reach them.
   */
  it("reaches the used and the exhausted renderings", () => {
    const used = usage(parse(coupon, get("/coupons/305")).data);
    expect(used).toEqual({ limited: true, count: 37, limit: 50, exhausted: false });

    const spent = usage(parse(coupon, get("/coupons/306")).data);
    expect(spent.limited && spent.exhausted).toBe(true);

    // And the four originals are untouched, which is what lib/coupons.ts and
    // lib/api/schemas/coupon.ts both say about them.
    for (const id of [301, 302, 303, 304]) {
      expect(parse(coupon, get(`/coupons/${id}`)).data.usage_count).toBe(0);
    }
  });
});

/**
 * ── The two picker routes ────────────────────────────────────────────────────
 *
 * They exist because `/products` and `/product-categories` are
 * `ac_manage_products`, which a **Marketing Manager does not hold** while holding
 * `ac_manage_coupons` — one of the three roles that can manage coupons, and the
 * one whose job coupons are. Both schemas were unexercised by anything until now.
 */
describe("the coupon pickers", () => {
  it("serves eligible products as strictly less than the catalogue", () => {
    const { data, meta } = parseList(
      eligibleProductList,
      get("/coupons/eligible-products", "per_page=100"),
    );

    // The listed catalogue: a draft is pickable, a trashed product is not.
    expect(meta.total).toBe(38);
    expect(data.some((row) => row.status === "draft")).toBe(true);
    expect(data.some((row) => row.status === "trash")).toBe(false);

    /*
     * **Four fields and no fifth.** The whole point of the route is that it
     * discloses less than the catalogue, so a price or a stock figure leaking
     * through would erase the reason it was added rather than widening
     * `ac_manage_products`.
     */
    for (const row of data) {
      expect(Object.keys(row).sort()).toEqual(["id", "name", "sku", "status"]);
    }
  });

  /**
   * **The SKU search, which WordPress's own `s` does not do**: it reads the title
   * and the content, so a shop that knows a product by `AC-CAT-0104` would type
   * it and get an empty picker.
   */
  it("finds an eligible product by its SKU as well as its name", () => {
    const bySku = parseList(
      eligibleProductList,
      get("/coupons/eligible-products", "search=AC-CAT-0104"),
    );
    expect(bySku.meta.total).toBe(1);
    expect(bySku.data[0].id).toBe(104);

    const byName = parseList(
      eligibleProductList,
      get("/coupons/eligible-products", "search=burnous"),
    );
    expect(byName.data[0].id).toBe(104);

    // Folded, like every other search here: the collation behind them is the same.
    expect(
      parseList(eligibleProductList, get("/coupons/eligible-products", "search=THE VERT"))
        .meta.total,
    ).toBe(
      parseList(eligibleProductList, get("/coupons/eligible-products", "search=thé vert"))
        .meta.total,
    );
  });

  it("serves eligible categories joined to the real vocabulary", () => {
    const { data, meta } = parseList(
      eligibleCategoryList,
      get("/coupons/eligible-categories", "per_page=100"),
    );
    expect(meta.total).toBe(7);

    const tapis = data.find((row) => row.id === 13);
    expect(tapis?.name).toBe("Tapis");
    expect(tapis?.parent).toBe(12);

    // Five fields: `description` is on the vocabulary and not on this row.
    for (const row of data) {
      expect(Object.keys(row).sort()).toEqual(["count", "id", "name", "parent", "slug"]);
    }

    expect(
      parseList(eligibleCategoryList, get("/coupons/eligible-categories", "search=tapis"))
        .meta.total,
    ).toBe(1);
  });

  /** GET only. The allowlist gives these two no other verb. */
  it("refuses every verb but GET on both pickers", () => {
    expect(write("POST", "/coupons/eligible-products", {}).status).toBe(404);
    expect(write("DELETE", "/coupons/eligible-categories").status).toBe(404);
    // And neither has a sub-resource.
    expect(get("/coupons/eligible-products/1").status).toBe(404);
  });
});

/**
 * ── The coupon writes ────────────────────────────────────────────────────────
 *
 * Every one of these was a 404 before this branch, so the create form, the save
 * button and both delete paths were verified against nothing at all.
 */
describe("the coupon writes", () => {
  const CREATE = { code: "ETE-2026", amount: "5" };

  it("creates a coupon, folding the code as it stores it", () => {
    const { data } = parse(couponDetail, write("POST", "/coupons", CREATE));

    // `BRIEF-TEST-99` comes back `brief-test-99`: the API folds on save, which is
    // why the form folds as the user types.
    expect(data.code).toBe(normalizeCode(CREATE.code));
    expect(data.code).toBe("ete-2026");
    expect(data.amount).toBe("5.00");
    // A created coupon carries `restrictions`, exactly as a GET does.
    expect(data.restrictions.product_ids).toEqual([]);

    // And it is readable, and listed.
    const listed = parseList(couponList, get("/coupons", "per_page=100"));
    expect(listed.data.some((row) => row.id === data.id)).toBe(true);
    expect(parse(coupon, get(`/coupons/${data.id}`)).data.code).toBe("ete-2026");
  });

  /**
   * **`amount` is required, and validated before the uniqueness check.** The
   * order is measured and it is the whole assertion: a duplicate code with a
   * missing amount reports only the amount.
   */
  it("requires amount on create, and checks it before uniqueness", () => {
    const missing = apiError(write("POST", "/coupons", { code: "quelque-chose" }));
    expect(missing.status).toBe(400);
    expect(missing.fields).toEqual({ amount: "Required." });

    // The same body with a code that *would* collide is still the 400, and names
    // the amount alone — never the conflict.
    const both = apiError(write("POST", "/coupons", { code: "BIENVENUE10" }));
    expect(both.status).toBe(400);
    expect(both.fields).toEqual({ amount: "Required." });
    expect(both.details.code).toBeUndefined();
  });

  /**
   * **A duplicate code is a 409 under `details.code`, carrying the LOWER-CASED
   * form.** The API folds on save and the duplicate check runs against the folded
   * value, so `BIENVENUE10` collides with the stored `bienvenue10` — and the
   * message names the second, which is the code the person will recognise.
   */
  it("refuses a duplicate code with the folded form under details.code", () => {
    const refused = apiError(write("POST", "/coupons", { code: "BIENVENUE10", amount: "5" }));
    expect(refused.status).toBe(409);
    expect(refused.details.code).toBe("bienvenue10");
    expect(refused.details.code).toBe(normalizeCode("BIENVENUE10"));
    // Not `details.fields` — the same shape a duplicate SKU has on products.
    expect(refused.fields).toBeNull();

    // Nothing was created.
    expect(parseList(couponList, get("/coupons", "per_page=100")).meta.total).toBe(6);

    // And a PATCH onto another coupon's code is the same refusal.
    const collided = apiError(write("PATCH", "/coupons/302", { code: "BIENVENUE10" }));
    expect(collided.status).toBe(409);
    expect(collided.details.code).toBe("bienvenue10");
    // While a coupon may keep its own code.
    expect(parse(couponDetail, write("PATCH", "/coupons/301", { code: "bienvenue10" })).data.code)
      .toBe("bienvenue10");
  });

  /**
   * **`PATCH {}` is a 200 no-op, not a 400.** Three collections, three rules: a
   * coupon's `{}` is a no-op, a product's is a 400 that names nothing, and an
   * order's COD round-trips whole. A mock that shared one rule between them would
   * make two of the three screens wrong about their own save button.
   */
  it("answers an empty patch with a 200 no-op", () => {
    const before = parse(couponDetail, get("/coupons/301")).data;
    const { data } = parse(couponDetail, write("PATCH", "/coupons/301", {}));
    expect(data).toEqual(before);

    // A product's, for contrast, is a 400 with no `details` at all.
    expect(write("PATCH", "/products/104", {}).status).toBe(400);
  });

  /**
   * **Read-only keys are dropped in silence, which is a product's rule after
   * all.** This suite asserted a 400 by name for two branches — the mock inventing
   * an error path the panel handles and production can never take, which is how a
   * stricter fake does the same damage a more permissive one does.
   *
   * `restrictions` is the one to check hardest: it comes back on every
   * single-coupon response, including the answer to the write itself, so if any
   * key were going to break the round trip it would be that one.
   */
  it("drops every read-only field in silence, and round-trips a GET body", () => {
    const before = parse(couponDetail, get("/coupons/301")).data;

    for (const [field, value] of [
      ["id", 999],
      ["usage_count", 5],
      ["used_by", []],
      ["date_created", "2026-01-01T00:00:00+00:00"],
      ["date_modified", null],
      ["restrictions", {}],
    ] as const) {
      // A body left with nothing supported is the same 200 no-op `PATCH {}` is,
      // and nothing moves.
      const { data } = parse(couponDetail, write("PATCH", "/coupons/301", { [field]: value }));
      expect(data).toEqual(before);
    }

    // The whole GET body back — the round trip this mock used to make impossible.
    expect(parse(couponDetail, write("PATCH", "/coupons/301", before)).data).toEqual(before);

    // A product's rule differs at the end and only at the end: once the read-only
    // keys are gone there is nothing supported left, and that is a 400 there.
    expect(write("PATCH", "/products/104", { id: 9999 }).status).toBe(400);
  });

  /** `maximum_discount` does not exist. Refused by name, so a client hears why. */
  it("refuses an unknown field, maximum_discount included", () => {
    const refused = apiError(write("PATCH", "/coupons/301", { maximum_discount: "50" }));
    expect(refused.status).toBe(400);
    expect(refused.fields).toEqual({ maximum_discount: "Unknown field." });
    expect(apiError(write("PATCH", "/coupons/301", { nonsense: 1 })).fields)
      .toEqual({ nonsense: "Unknown field." });
  });

  /**
   * **400 per restriction field, naming the offending ids.** The ids used to be
   * stored blind — `{"product_ids": [999999]}` answered 200 and the coupon then
   * applied to nothing while looking, in every response and on every screen,
   * exactly like a coupon that worked.
   */
  it("refuses restriction ids that resolve to nothing, and names them", () => {
    const refused = apiError(
      write("PATCH", "/coupons/301", { product_ids: [101, 999999] }),
    );
    expect(refused.status).toBe(400);
    expect(refused.fields?.product_ids).toContain("999999");
    // Named per field, so a form with four pickers can bind four messages.
    const both = apiError(
      write("PATCH", "/coupons/301", {
        product_ids: [999999],
        excluded_product_categories: [4242],
      }),
    );
    expect(Object.keys(both.fields ?? {}).sort()).toEqual([
      "excluded_product_categories",
      "product_ids",
    ]);

    /*
     * **The stale coupon's own body is refused**, which is the point of the
     * fixture: reads stay tolerant and writes do not, so the form has to strip a
     * missing ref rather than post it back.
     */
    const own = parse(couponDetail, get("/coupons/305")).data;
    const echoed = apiError(write("PATCH", "/coupons/305", { product_ids: own.product_ids }));
    expect(echoed.fields?.product_ids).toContain("8842");
    // And the same field with the stale id removed is a 200.
    expect(write("PATCH", "/coupons/305", { product_ids: [101] }).status).toBe(200);

    // A draft is a legal restriction; a trashed product is not pickable.
    expect(write("PATCH", "/coupons/301", { product_ids: [210] }).status).toBe(200);
    expect(write("PATCH", "/coupons/301", { product_ids: [211] }).status).toBe(400);
  });

  /**
   * **Two refusals, two sentences.** `31/12/2026` is the wrong notation and
   * `2026-02-30` is a date that does not exist — measured as different messages,
   * and a form printing "check the format" at somebody who typed a real-looking
   * February 30th would be the mock's fault.
   */
  it("refuses a mis-formatted date and an impossible one differently", () => {
    const format = apiError(write("PATCH", "/coupons/301", { date_expires: "31/12/2026" }));
    const impossible = apiError(write("PATCH", "/coupons/301", { date_expires: "2026-02-30" }));

    expect(format.status).toBe(400);
    expect(impossible.status).toBe(400);
    expect(format.fields?.date_expires).not.toBe(impossible.fields?.date_expires);
    expect(impossible.fields?.date_expires).toContain("does not exist");
  });

  /**
   * **The asymmetry that silently deletes a date.** Written `Y-m-d`, read back as
   * full ISO — so a date input bound to the response renders empty, and the next
   * save posts `""`, which clears it. `expiryInputValue()` is the repair, and it
   * can only be verified against a mock that reproduces the asymmetry.
   */
  it("writes an expiry as Y-m-d and reads it back as full ISO", () => {
    const { data } = parse(couponDetail, write("PATCH", "/coupons/301", {
      date_expires: "2026-12-31",
    }));
    expect(data.date_expires).toBe("2026-12-31T00:00:00+00:00");

    // Which no date input can display — and this is the function that repairs it.
    expect(expiryInputValue(data.date_expires)).toBe("2026-12-31");

    // The full ISO form is accepted back, so a client may post what it was given.
    expect(
      parse(couponDetail, write("PATCH", "/coupons/301", { date_expires: data.date_expires }))
        .data.date_expires,
    ).toBe("2026-12-31T00:00:00+00:00");

    // And both clearing forms really clear it.
    for (const cleared of [null, ""]) {
      expect(
        parse(couponDetail, write("PATCH", "/coupons/301", { date_expires: cleared }))
          .data.date_expires,
      ).toBeNull();
    }
  });

  /**
   * **Zero and null run in opposite directions on the same object.** A negative
   * threshold used to be the worst of both: the clearing arm read `<= 0.0`, so
   * `{"minimum_amount": "-1"}` answered 200 and erased a real 15 000 DA minimum
   * while a negative `amount` was refused by name.
   */
  it("refuses negatives and folds a zero threshold to null", () => {
    expect(apiError(write("PATCH", "/coupons/301", { amount: "-5" })).fields)
      .toEqual({ amount: "Must not be negative." });
    expect(apiError(write("PATCH", "/coupons/301", { minimum_amount: "-1" })).fields)
      .toEqual({ minimum_amount: "Must not be negative." });
    expect(apiError(write("PATCH", "/coupons/301", { usage_limit: -1 })).status).toBe(400);

    // The minimum it would have erased is still there.
    expect(parse(coupon, get("/coupons/301")).data.minimum_amount).toBe("2000.00");

    // Zero clears, and can never be read back as `"0.00"` — all three forms.
    for (const cleared of [0, "0", ""] as const) {
      const { data } = parse(couponDetail, write("PATCH", "/coupons/301", {
        minimum_amount: cleared,
      }));
      expect(data.minimum_amount).toBeNull();
      expect(threshold(data.minimum_amount)).toEqual({ set: false });
    }

    // While `amount: "0.00"` is a real coupon on the very same object.
    const { data } = parse(couponDetail, write("PATCH", "/coupons/301", { amount: "0" }));
    expect(data.amount).toBe("0.00");
  });

  /**
   * **The destructive one.** `PATCH {"code": ""}` answered 200 here and *blanked
   * the code* — destroying both the coupon's identity and the key the uniqueness
   * check runs on — while a form that cleared the field and saved passed every
   * gate against this file.
   *
   * Measured 2026-08-25, on `POST` and `PATCH` alike, for `""` and for `"   "`.
   * The whole response, because two thirds of it were this file's own invention:
   * the envelope was `rest_invalid_param` / "Invalid parameter(s): code",
   * inherited from a helper measured on `POST /orders/{id}/shipments` and never
   * on a coupon.
   */
  it("refuses an empty or whitespace-only code rather than storing it", () => {
    for (const code of ["", "   "]) {
      const refused = apiError(write("PATCH", "/coupons/301", { code }));
      expect(refused.status).toBe(400);
      expect(refused.code).toBe("invalid_request");
      expect(refused.apiMessage).toBe("The coupon is invalid.");
      expect(refused.fields).toEqual({ code: "A coupon needs a code." });

      expect(apiError(write("POST", "/coupons", { code, amount: "5.00" })).fields)
        .toEqual({ code: "A coupon needs a code." });
    }

    // The code it would have erased is still there, and a real one still saves.
    expect(parse(coupon, get("/coupons/301")).data.code).toBe("bienvenue10");
    expect(parse(couponDetail, write("PATCH", "/coupons/301", { code: "NOEL-2026" }))
      .data.code).toBe("noel-2026");

    /*
     * A POST with **no `code` key at all** keeps its own sentence. That refusal
     * is an inference — nothing published one — and folding it into the measured
     * message would dress a guess as a measurement.
     */
    expect(apiError(write("POST", "/coupons", { amount: "5.00" })).fields)
      .toEqual({ code: "Required." });
  });

  /**
   * **Every entry is checked, and one bad entry refuses the list.** This
   * accepted any list of strings, so a restriction control verified here would
   * have shipped and the shop would have refused the save.
   *
   * Measured 2026-08-25, including the wildcard form, which is legal.
   */
  it("refuses an email restriction that is neither an address nor a wildcard", () => {
    const message = "Every entry must be an email address or a wildcard.";

    for (const list of [["not an email"], ["a@b.dz", "nope"]]) {
      const refused = apiError(write("PATCH", "/coupons/301", { email_restrictions: list }));
      expect(refused.status).toBe(400);
      expect(refused.fields).toEqual({ email_restrictions: message });
    }

    for (const list of [["a@b.dz"], ["*@exemple.dz"], []]) {
      expect(parse(couponDetail, write("PATCH", "/coupons/301", { email_restrictions: list }))
        .data.email_restrictions).toEqual(list);
    }
  });

  /**
   * **Two acts with different consequences, answering identical bodies.** Trash
   * is reversible and keeps the code; `?force=true` is permanent, frees the code,
   * and is the only path to a 404.
   */
  it("trashes reversibly and forces permanently", () => {
    const trashed = parse(deleteResult, write("DELETE", "/coupons/302"));
    expect(trashed.data).toEqual({ id: 302, deleted: true });

    // A trashed coupon reads back 200 with `status: "trash"` and leaves the list.
    expect(parse(couponDetail, get("/coupons/302")).data.status).toBe("trash");
    expect(parseList(couponList, get("/coupons", "per_page=100")).meta.total).toBe(5);

    // **It keeps its code**, so recreating with it is a 409.
    const clash = apiError(write("POST", "/coupons", { code: "livraison", amount: "1" }));
    expect(clash.status).toBe(409);
    expect(clash.details.code).toBe("livraison");

    // Trashing is idempotent and never escalates to permanent.
    expect(write("DELETE", "/coupons/302").status).toBe(200);
    expect(get("/coupons/302").status).toBe(200);

    // `?force=true` answers the **identical body** and is visible only afterwards.
    const forced = parse(deleteResult, write("DELETE", "/coupons/302", null, "force=true"));
    expect(forced.data).toEqual(trashed.data);
    expect(get("/coupons/302").status).toBe(404);

    // And now the code is free.
    const remade = parse(couponDetail, write("POST", "/coupons", {
      code: "livraison",
      amount: "1",
    }));
    expect(remade.data.code).toBe("livraison");
  });

  /** A coupon has no sub-resource, and an id that never existed is a 404. */
  it("keeps everything else on the collection unreachable", () => {
    expect(get("/coupons/999").status).toBe(404);
    expect(get("/coupons/301/anything").status).toBe(404);
    expect(write("PATCH", "/coupons", {}).status).toBe(404);
    expect(write("POST", "/coupons/301", {}).status).toBe(404);
  });
});

describe("query parameters", () => {
  it("rejects a comma-separated status with a 400", () => {
    const response = get("/orders", "status=processing,pending");
    expect(response.status).toBe(400);
    try {
      parse(orderList, response);
      expect.unreachable("a 400 must throw");
    } catch (error) {
      expect((error as ApiError).code).toBe("invalid_request");
      expect((error as ApiError).status).toBe(400);
    }
  });

  it("filters by a single status", () => {
    const { data, meta } = parseList(orderList, get("/orders", "status=failed&per_page=100"));
    expect(meta.total).toBe(1);
    expect(data[0].status).toBe("failed");
  });

  it("searches case-insensitively over the obvious fields", () => {
    expect(parseList(productList, get("/products", "search=MIEL")).meta.total).toBe(
      parseList(productList, get("/products", "search=miel")).meta.total,
    );
    expect(parseList(customerList, get("/customers", "search=client20")).meta.total).toBe(1);
    expect(parseList(orderList, get("/orders", "search=benali&per_page=100")).meta.total)
      .toBeGreaterThan(0);
  });

  /**
   * **The load-bearing one.** `/orders` accepts `orderby` and silently ignores
   * it, and the mock must reproduce that or an agent will verify a sort control
   * against the harness and ship one that does nothing in production.
   */
  it("accepts orderby on /orders and ignores it", () => {
    const ids = (query: string) =>
      parseList(orderList, get("/orders", query)).data.map((row) => row.id);

    expect(ids("per_page=100&orderby=date&order=asc")).toEqual(
      ids("per_page=100&orderby=date&order=desc"),
    );
    expect(ids("per_page=100&orderby=title&order=asc")).toEqual(ids("per_page=100"));
    // And a value nobody has heard of is a 200, not a 400.
    expect(get("/orders", "orderby=nonsense").status).toBe(200);
  });

  /**
   * **`/products` sorts twelve of its sixteen combinations**, re-measured
   * 2026-08-25 over the full 28-row catalogue, each ordering checked against the
   * order its own field implies rather than against "differs from the default",
   * with the distinct-value count that backs it:
   *
   *     date 16 · id 28 · title 28 · price 21 · sku 28 · popularity 13
   *
   * This test asserted **five** until that date, on a measurement taken
   * 2026-08-18 — and the backend repair had already outgrown it. `title desc`
   * was pinned here as the case that proved the list was five and not six;
   * it had been working the whole time.
   *
   * `menu_order` and `rating` stay out, and the distinction is the point:
   * they are **unprovable, not dead.** All 28 products carry an identical value
   * for each, so the two directions tie and answer the same whether the sort
   * runs or not — the `date`-on-coupons trap, one collection over. Asserting
   * them working would be asserting the fixture, not the router.
   *
   * `sku asc` is compared as a **whole** sequence, never a head slice: the
   * catalogue's SKUs are `AC-CAT-<id>` and so ascend with the id, and only the
   * one long-SKU fixture separates the two orderings — at the tail. A slice
   * would let a fallback from `sku` to `id` pass.
   */
  it("sorts /products by the twelve measured combinations", () => {
    const ids = (query: string) =>
      parseList(productList, get("/products", `per_page=100&${query}`)).data.map((r) => r.id);
    const names = (query: string) =>
      parseList(productList, get("/products", `per_page=100&${query}`)).data.map((r) => r.name);
    const prices = (query: string) =>
      parseList(productList, get("/products", `per_page=100&${query}`)).data.map((r) =>
        Number(r.price || "0"),
      );
    /** Accent-folded, because a collation that depends on the runtime's ICU
        build is a sort that differs between machines. */
    const fold = (value: string) =>
      value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    const unsorted = ids("");

    // date desc is the default order, and date asc is its reverse.
    expect(ids("orderby=date&order=desc")).toEqual(unsorted);
    expect(ids("orderby=date&order=asc")).toEqual([...unsorted].reverse());

    // title asc is alphabetical, and is not the default order.
    const alphabetical = names("orderby=title&order=asc");
    expect(alphabetical.map(fold)).toEqual([...alphabetical.map(fold)].sort());
    expect(ids("orderby=title&order=asc")).not.toEqual(unsorted);

    // price sorts in both directions.
    const ascending = prices("orderby=price&order=asc");
    expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
    const descending = prices("orderby=price&order=desc");
    expect(descending).toEqual([...descending].sort((a, b) => b - a));
    expect(ids("orderby=price&order=asc")).not.toEqual(unsorted);

    // title desc is the reverse of title asc — the case this file pinned dead.
    expect(ids("orderby=title&order=desc")).toEqual([...ids("orderby=title&order=asc")].reverse());

    // id sorts numerically in both directions.
    expect(ids("orderby=id&order=asc")).toEqual([...unsorted].sort((a, b) => a - b));
    expect(ids("orderby=id&order=desc")).toEqual([...unsorted].sort((a, b) => b - a));

    // sku is alphabetical on the folded SKU, compared whole — see the docblock.
    const skus = (query: string) =>
      parseList(productList, get("/products", `per_page=100&${query}`)).data.map((r) => r.sku ?? "");
    const bySku = skus("orderby=sku&order=asc");
    expect(bySku.map(fold)).toEqual([...bySku.map(fold)].sort());
    expect(ids("orderby=sku&order=desc")).toEqual([...ids("orderby=sku&order=asc")].reverse());
    // The assertion that catches a fallback to `id`: the two orderings differ.
    expect(ids("orderby=sku&order=asc")).not.toEqual(ids("orderby=id&order=asc"));

    // popularity reorders and reverses. The values are not on the response —
    // the live API sorts by `total_sales` and emits it nowhere — so this is
    // asserted as a permutation rather than against a field.
    expect(ids("orderby=popularity&order=asc")).not.toEqual(unsorted);
    expect(ids("orderby=popularity&order=desc")).toEqual(
      [...ids("orderby=popularity&order=asc")].reverse(),
    );

    // The two that are accepted, validated, and honoured by nothing — because
    // every row ties on both and no measurement can exist yet.
    expect(ids("orderby=menu_order&order=asc")).toEqual(unsorted);
    expect(ids("orderby=menu_order&order=desc")).toEqual(unsorted);
    expect(ids("orderby=rating&order=asc")).toEqual(unsorted);
    expect(ids("orderby=rating&order=desc")).toEqual(unsorted);
  });

  /**
   * **`/products` validates its sort, and this file used to think it did not.**
   *
   * Measured 2026-08-25 through the empty string, which is outside the enum and
   * therefore names the whole of it:
   *
   *   /products?orderby=  400 "orderby is not one of date, id, title, price,
   *                            sku, menu_order, popularity, and rating"
   *
   * Eight accepted values against five honoured combinations — the test above is
   * the other half of that, and it is stale in its own way.
   *
   * `orderby=nonsense` was asserted here as a 200, and that **was** a real
   * measurement — taken 2026-08-18, before the backend repair, and never
   * re-taken. A dated measurement that outlives its repair is worse than an
   * unmeasured guess: it looks settled. Re-measured 2026-08-25, `""` and
   * `nonsense` answer the identical sentence.
   */
  it("validates the /products sort against an eight-value enum", () => {
    const refused = apiError(get("/products", "orderby="));
    expect(refused.status).toBe(400);
    expect(refused.params?.orderby).toBe(
      "orderby is not one of date, id, title, price, sku, menu_order, popularity, and rating.",
    );
    expect(get("/products", "orderby=nonsense").status).toBe(400);
    expect(get("/products", "order=").status).toBe(400);
    expect(get("/products", "order=sideways").status).toBe(400);

    // The eight are accepted, whether or not they reorder anything.
    for (const orderby of [
      "date",
      "id",
      "title",
      "price",
      "sku",
      "menu_order",
      "popularity",
      "rating",
    ]) {
      expect(get("/products", `orderby=${orderby}`).status).toBe(200);
    }
  });

  /**
   * **`?status=` is a 400 here and a 200 on `/coupons`**, and that is the shop's
   * asymmetry rather than an inconsistency: the empty string is a member of the
   * coupon status enum and not of this one. Each 400 names its own enum and
   * proves it — `status is not one of , publish, and draft.` there, with the
   * empty string listed first; without it here.
   *
   * Measured 2026-08-25. This answered 200 and read `""` as absence, so a filter
   * sheet that cleared its status select verified clean and 400s in the shop.
   */
  it("refuses an empty status where /coupons accepts one", () => {
    const refused = apiError(get("/products", "status="));
    expect(refused.status).toBe(400);
    expect(refused.params?.status).toBe(
      "status is not one of draft, pending, private, and publish.",
    );
    // The neighbouring collection, unchanged and deliberately different.
    expect(get("/coupons", "status=").status).toBe(200);
  });

  it("refuses a per_page over 100 rather than clamping it", () => {
    expect(get("/orders", "per_page=500").status).toBe(400);
  });
});

/**
 * The mock grows one collection per redesign branch, and the promise this suite
 * makes — every schema the mock serves is validated against it — only stays true
 * if a new schema file cannot arrive unnoticed. So the directory is enumerated
 * and each module is either exercised above or listed here with a reason.
 *
 * Adding an endpoint to the mock means moving its module out of UNCOVERED and
 * writing the parse. Adding a schema file means one line here, deliberately.
 */
const COVERED = [
  "order",
  "product",
  "customer",
  "inventory",
  /*
   * **`coupon` was on this list while naming none of its gaps**, and the list is
   * the only thing that decides what "covered" means — so it meant the list and
   * the detail, and the module's other three schemas were exercised by nothing.
   * `eligibleProduct` and `eligibleCategory` described two routes that were 404s,
   * and `restrictions` was served with every category id synthesised, so
   * `missing: true` could not be produced at all on the half of the block that
   * carries the most ids.
   *
   * Now: the list, the detail, both pickers, `POST`, `PATCH`, both deletes and
   * every refusal each of them can answer. What is left is named below rather
   * than left implied.
   */
  "coupon",
  // Both moved out of UNCOVERED with the order detail's sub-resources: the mock
  // now serves `/shipping/providers`, an order's parcels and its payments, plus
  // the cancel and verify writes. What each module still holds that nothing
  // exercises is named below rather than left implied.
  "shipping",
  "payment",
  // Moved out with the customers redesign: `GET /notifications` is served, and
  // the customer detail's section reads it. The two routes this module still
  // carries schemas for are named below, for the same reason.
  "notification",
];

const UNCOVERED: Record<string, string> = {
  analytics: "the dashboard's report endpoints are not mocked yet",
  audit: "/audit is not mocked yet",
  campaign: "/campaigns is not mocked yet",
  cms: "/cms/* is not mocked yet",
  media: "/media is not mocked yet",
  settings: "/settings is not mocked yet",
  staff: "/users and /roles are not mocked yet",
  transfer: "the import/export endpoints are not mocked yet",
};

/**
 * The bookkeeping the two lists above cannot do: a module counts as covered when
 * the endpoints the panel calls are served, and both of the newly-covered ones
 * carry schemas for routes that are still 404s here. Named, so "covered" does not
 * quietly come to mean "finished".
 */
describe("what the newly-covered modules still do not serve", () => {
  it("leaves the shipping tariff and the standalone collections unmocked", () => {
    // `shippingRule` / `shippingRate` — the rules screen's own endpoints.
    expect(get("/shipping/rules").status).toBe(404);
    expect(get("/shipping/rates", "wilaya_id=16&commune_id=484").status).toBe(404);
    // A parcel and a transaction are reached through their order here, which is
    // the only way the detail reaches them.
    expect(get("/shipments").status).toBe(404);
    expect(get("/shipments/7014").status).toBe(404);
    expect(get("/payments").status).toBe(404);
    expect(get("/payments/5231").status).toBe(404);
    // `codStatistics` — `/cod/statistics` belongs to the analytics screen.
    expect(get("/cod/statistics").status).toBe(404);
  });

  /**
   * **`notification` is covered by its list and by nothing else**, and the gap is
   * larger than the two above: `/notifications/{id}` and its retry are routes a
   * screen that already exists calls on load, not schemas waiting for a branch.
   * `notificationMessage`, `notificationDetail`, `retryResponse`, `retryMeta` and
   * `sentConflictDetails` all describe answers this file cannot give, so the
   * notification detail is the one screen in the panel that cannot be captured at
   * all. Named here so "covered" does not quietly come to mean "finished".
   */
  it("leaves the notification detail and its retry unmocked", () => {
    expect(get("/notifications/1").status).toBe(404);
    expect(get("/notifications/4100").status).toBe(404);
    expect(write("POST", "/notifications/4100/retry").status).toBe(404);
  });

  /**
   * **What the coupon module still cannot express, now that its routes are all
   * served.** Neither of these is a missing endpoint, and both are worth naming
   * so "covered" does not quietly come to mean "complete":
   *
   *   `usage_count` cannot be **moved**. Redemption is `POST /cart/coupons`, on
   *   the storefront, and no panel route touches it — so 305 and 306 carry their
   *   counts as seeds and a screen can never watch one change.
   *
   *   `used_by` is on the API's read-only list and is emitted by nothing at all,
   *   so *who* redeemed a coupon is unanswerable here for the same reason it is
   *   unanswerable in the shop. The mock refuses it on write and never sends it,
   *   which is the honest reproduction of a field that exists and says nothing.
   */
  it("leaves the coupon redemption story unanswerable, as the API does", () => {
    expect(get("/cart/coupons").status).toBe(404);
    expect(write("POST", "/cart/coupons", { code: "bienvenue10" }).status).toBe(404);

    const { data } = parse(couponDetail, get("/coupons/301"));
    expect(data).not.toHaveProperty("used_by");
  });
});

describe("schema coverage", () => {
  it("accounts for every module in lib/api/schemas", () => {
    const modules = readdirSync(resolve(import.meta.dirname, "../lib/api/schemas"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => file.replace(/\.ts$/, ""))
      .sort();

    const unaccounted = modules.filter(
      (name) => !COVERED.includes(name) && !(name in UNCOVERED),
    );
    expect(
      unaccounted,
      "a new schema module must be exercised by this suite or listed in UNCOVERED with a reason",
    ).toEqual([]);

    // And the reverse: a listed reason for a module that no longer exists is a
    // stale exemption, which is how an UNCOVERED list quietly stops meaning
    // anything.
    const stale = [...COVERED, ...Object.keys(UNCOVERED)].filter(
      (name) => !modules.includes(name),
    );
    expect(stale, "UNCOVERED names a module that no longer exists").toEqual([]);
  });
});
