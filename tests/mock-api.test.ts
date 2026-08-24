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
  facets as facetsSchema,
  globalAttributes,
  product,
  productCategories,
  productList,
  productListMeta,
} from "@/lib/api/schemas/product";
import { PRODUCT_STATUSES, STOCK_STATUSES } from "@/lib/product-status";
import { customerDetail, customerList } from "@/lib/api/schemas/customer";
import { inventoryItem, inventoryList } from "@/lib/api/schemas/inventory";
import { coupon, couponDetail, couponList } from "@/lib/api/schemas/coupon";

function get(path: string, query = ""): MockResponse {
  return respond("GET", `${BASE_PATH}${path}`, new URLSearchParams(query));
}

/**
 * The writes. A body is passed through exactly as the panel's `acWrite()` sends
 * it — `POST /payments/{id}/verify` sends none at all, which is why `body` is
 * optional here rather than defaulted to `{}`.
 */
function write(method: string, path: string, body?: unknown): MockResponse {
  return respond(method, `${BASE_PATH}${path}`, new URLSearchParams(), body ?? null);
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
    expect(write("PATCH", "/products/101", { status: "draft" }).status).toBe(404);
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
    expect(error.code).toBe("rest_invalid_param");
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
    expect(get("/customers/20/orders").status).toBe(404);
    expect(get("/products/101/variations").status).toBe(404);
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
    expect(error.code).toBe("rest_invalid_param");
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

describe("GET /customers", () => {
  /**
   * The one collection where the list row and the detail are different objects.
   * lib/api/schemas/customer.ts is explicit that they differ by exactly
   * `statistics`, and a mock that put it on both would let a component reach for
   * it on a list row and find it — right up until production.
   */
  it("omits statistics from the list and carries it on the detail", () => {
    const { data } = parseList(customerList, get("/customers", "per_page=100"));
    expect(data).toHaveLength(16);
    expect(data.some((row) => "statistics" in row)).toBe(false);

    const detail = parse(customerDetail, get("/customers/20")).data;
    expect(detail.statistics.total_orders).toBeGreaterThan(0);
  });

  it("parses all 16 details, including the 11 who have never ordered", () => {
    const details = Array.from({ length: 16 }, (_, i) =>
      parse(customerDetail, get(`/customers/${20 + i}`)).data,
    );
    const never = details.filter(
      (row) => row.statistics.first_order === null && row.statistics.last_order === null,
    );
    expect(never).toHaveLength(11);
    expect(details.filter((row) => row.first_name === "" && row.last_name === "")).toHaveLength(12);
  });
});

describe("GET /inventory", () => {
  it("parses every row, and null is not zero on eight of them", () => {
    // The 38 listed products plus the 5 variations. A trashed product is in no
    // stockroom and is in neither this list nor /products.
    const { data, meta } = parseList(inventoryList, get("/inventory", "per_page=100"));
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
    // And its sibling stays a 404: nothing reaches /lookup on load, so nothing
    // may verify a scanner flow against a fixture that does not exist.
    expect(get("/inventory/lookup", "sku=AC-CAT-0101").status).toBe(404);
  });
});

describe("GET /coupons", () => {
  it("parses the list, and keeps zero and null apart", () => {
    const { data, meta } = parseList(couponList, get("/coupons", "per_page=100"));
    expect(meta.total).toBe(4);
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
});

describe("query parameters", () => {
  it("rejects a comma-separated status with a 400", () => {
    const response = get("/orders", "status=processing,pending");
    expect(response.status).toBe(400);
    try {
      parse(orderList, response);
      expect.unreachable("a 400 must throw");
    } catch (error) {
      expect((error as ApiError).code).toBe("rest_invalid_param");
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
   * **The narrow exception, and both halves of it.** `/products` sorts, for
   * exactly the five combinations `SORTS` in lib/product-status.ts records as
   * re-measured after the backend repair — and for nothing else. `title desc`
   * is the case that matters: nobody measured it, so it is accepted with a 200
   * and comes back unsorted, and an agent who builds that control watches it do
   * nothing here rather than in production.
   *
   * Compared as id sequences, the way the live router was measured.
   */
  it("sorts /products by exactly the five measured combinations", () => {
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

    // And everything else is a 200 that did not sort — `title desc` included,
    // which is the whole point of the list being five and not six.
    expect(ids("orderby=title&order=desc")).toEqual(unsorted);
    expect(ids("orderby=title&order=desc")).not.toEqual(
      [...ids("orderby=title&order=asc")].reverse(),
    );
    expect(ids("orderby=sku&order=asc")).toEqual(unsorted);
    expect(ids("orderby=popularity&order=desc")).toEqual(unsorted);
    expect(ids("orderby=nonsense&order=asc")).toEqual(unsorted);
    expect(get("/products", "orderby=nonsense").status).toBe(200);
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
  "coupon",
  // Both moved out of UNCOVERED with the order detail's sub-resources: the mock
  // now serves `/shipping/providers`, an order's parcels and its payments, plus
  // the cancel and verify writes. What each module still holds that nothing
  // exercises is named below rather than left implied.
  "shipping",
  "payment",
];

const UNCOVERED: Record<string, string> = {
  analytics: "the dashboard's report endpoints are not mocked yet",
  audit: "/audit is not mocked yet",
  campaign: "/campaigns is not mocked yet",
  cms: "/cms/* is not mocked yet",
  media: "/media is not mocked yet",
  notification: "/notifications is not mocked yet",
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
