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
import {
  BASE_PATH,
  createServer,
  parseMultipart,
  resetState,
  respond,
  type MockResponse,
} from "@/scripts/mock-api.mjs";
import { unwrap, listMeta } from "@/lib/api/envelope";
import { ApiError } from "@/lib/api/errors";
import { decodeEntities } from "@/lib/format/html";
import { parseApiDate } from "@/lib/format/date";
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
  shippingRate as shippingRateSchema,
  shippingRates as shippingRatesSchema,
  shippingRule as shippingRuleSchema,
  shippingRules as shippingRulesSchema,
} from "@/lib/api/schemas/shipping";
import {
  DELIVERY_TYPES,
  SHIPMENT_STATUSES,
  isTerminalShipmentStatus,
} from "@/lib/shipment-status";
import { applicableRules, byNarrowestFirst, ruleScope, stripLabelUrls } from "@/lib/shipping";
import {
  codStatistics as codStatisticsSchema,
  payment as paymentSchema,
  paymentMethods,
  payments as paymentsSchema,
  verifyResult,
} from "@/lib/api/schemas/payment";
import { PAYMENT_STATUSES } from "@/lib/payment-status";
import { byStatusSumsToTotal, codByStatus, codFigures, ratePercent, RATE_KEYS } from "@/lib/cod";
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
import {
  codReport,
  customersReport,
  ordersReport,
  overviewReport,
  productsReport,
  revenueReport,
  shippingReport,
} from "@/lib/api/schemas/analytics";
import {
  COUNTED_STATUSES,
  RANGE_PRESETS,
  UNAVAILABLE_KEYS,
  analyticsParams,
  countedReconciliation,
  customRangeProblem,
  hasRankingSignal,
  rateFraction,
  statusCounts,
  unavailableLines,
  wilayaSlices,
} from "@/lib/analytics";
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
import {
  banner,
  bannerList,
  embeddedImage,
  faq,
  faqCategory,
  faqCategoryList,
  faqList,
  homepage,
  homepageProblems,
  homepageSection,
  menu,
  menuItem,
  page as pageSchema,
  pageList,
  pageSeo,
} from "@/lib/api/schemas/cms";
import { mediaItem, mediaList, mediaSizes } from "@/lib/api/schemas/media";
import {
  ACCEPTED_MIME,
  MAX_BYTES,
  MIN_BYTES,
  classifyRefusal,
  formatBytes,
} from "@/lib/media";
import {
  CONTENT_STATUSES,
  DEFAULT_STATUS_FILTER,
  MAX_MENU_DEPTH,
  MAX_MENU_ITEMS,
  MAX_SECTIONS,
  MENU_ITEM_TYPES,
  MENU_LOCATIONS,
  SECTION_TYPES,
  STATUS_FILTERS,
  classifyProblem,
  collidingPaths,
  isAllowedMenuUrl,
  isContentStatus,
  isSectionType,
  isStatusFilter,
  pageDepth,
  parentPathOf,
  positionWrites,
  unknownSectionTypes,
} from "@/lib/cms";

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
    /*
     * `/campaigns`, and this assertion has now moved twice for the same reason:
     * a 404 test is only worth anything while its path is genuinely unmocked. It
     * stood on `/analytics/overview` until the dashboard branch served that, then
     * on `/analytics/revenue` until this one served all six. `campaign` is in
     * UNCOVERED below with a reason, which is what makes it the right anchor —
     * the two lists move together or this line goes stale a third time.
     */
    const response = get("/campaigns");
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

  /**
   * ── A list has three envelope shapes, and this file used to have one ────────
   *
   * Found 2026-08-26 by a request-for-request diff against the live shop. The
   * mock was manufacturing a full paging envelope for routes that page nothing,
   * and on wilayas a `page`/`per_page`/`total_pages` triple the shop does not
   * send at all.
   *
   * **Nothing reads `.meta` on these three today** — every caller takes `r.data`,
   * which was checked — so this cost nothing yet. It would have cost the first
   * screen that read `meta.total` off wilayas: 58 from the harness, 69 from the
   * shop, and the harness calling it green. Same class as the `per_page` default
   * this suite already pins — one shared helper quietly standardising something
   * the API varies.
   *
   * Pinned per shape rather than per route, so a fourth enumeration added later
   * cannot inherit the wrong one in silence.
   */
  it("serves each of the three measured list envelopes with its own shape", () => {
    const metaOf = (path: string) => (get(path).body as { meta?: unknown }).meta;

    // 1. No `meta` key whatsoever — measured on both.
    for (const path of ["/payments/methods", "/shipping/providers"]) {
      expect(metaOf(path), path).toBeUndefined();
      expect(Object.keys(get(path).body as object), path).toEqual(["success", "data"]);
      // `unwrap()` reports the absence as null rather than throwing.
      expect(parse(z.array(z.looseObject({ name: z.string() })), get(path)).meta).toBeNull();
    }

    // 2. `{total}` alone — measured on wilayas, and the only route with it.
    expect(metaOf("/locations/wilayas")).toEqual({ total: 58 });

    // 3. The full paging envelope, which every genuinely paginated collection
    //    carries and which the unmeasured enumerations still borrow.
    expect(metaOf("/payments")).toEqual({
      total: 45,
      page: 1,
      per_page: 20,
      total_pages: 3,
    });
    expect(Object.keys(metaOf("/orders/1023/notes") as object)).toEqual([
      "total",
      "page",
      "per_page",
      "total_pages",
    ]);
  });

  /**
   * **An empty `details` is omitted, not sent as `{}`.** Measured on the 403 and
   * the 404 — the only errors in the mock that carry none. Tidiness rather than a
   * defect: `ApiError` reaches for `details.params`/`details.fields` and gets
   * `undefined` from either shape. A refusal that *has* details still sends them.
   */
  it("omits an empty details rather than sending an empty object", () => {
    const errorOf = (response: MockResponse) =>
      (response.body as { error: Record<string, unknown> }).error;

    expect(errorOf(get("/payments/99999999"))).toEqual({
      code: "not_found",
      message: "No payment with that id.",
    });
    expect(errorOf(get("/nonsense"))).not.toHaveProperty("details");

    // And the half that must not change: a parameter refusal names its parameter.
    expect(errorOf(get("/payments", "status=zzz"))).toHaveProperty("details");
    expect(apiError(get("/payments", "status=zzz")).params?.status).toContain("not one of");
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
    const { data } = parse(wilayas, get("/locations/wilayas"));
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
    const providers = parse(shippingProviders, get("/shipping/providers")).data;
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
    const { data } = parse(shippingProviders, get("/shipping/providers"));
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("manual");
    expect(data[0].is_default).toBe(true);
  });

  /**
   * **The labels are English, and that is the fixture telling the truth rather
   * than being tidy.** The mock invented `"Paiement à la livraison"` for `cod`
   * until 2026-08-26, which is the shipping `providerLabel` defect in a second
   * place: a French label in the fixture renders correctly in the French panel by
   * accident and in the Arabic one as a bug, and no capture could show either.
   *
   * `PaymentsScreen` resolved a provider with `methods.find(…)?.label ?? name`
   * and no message key in front of it, so with the real labels in place the
   * defect landed on a screenshot. That screen was deleted on the payments
   * branch and `lib/payments.ts` is the resolver now — message key → API `label`
   * → raw name, the same rule `lib/shipping.ts` follows. These labels are what it
   * is measured against, which is why they must stay the API's own English.
   */
  it("serves the two payment methods, chargily first, labelled as the API labels them", () => {
    const { data } = parse(paymentMethods, get("/payments/methods"));
    expect(data.map((row) => row.name)).toEqual(["chargily", "cod"]);
    expect(data.filter((row) => row.is_default)).toHaveLength(1);
    expect(data.map((row) => row.label)).toEqual([
      "Chargily (EDAHABIA / CIB)",
      "Cash on delivery",
    ]);
  });

  /**
   * **This is the one route in this suite with no real schema to parse against,
   * and it is written here rather than pretended away.** `CreateParcelDrawer`,
   * `RulesScreen`, `Resolver`, `RuleForm` and `ParcelDrawer` all read
   * `/locations/wilayas/{id}/communes` with an untyped `acRead<Commune[]>` against
   * a local `{id, name, name_ar}` — there is no Zod boundary anywhere in
   * `lib/api/schemas` for it — so this asserts exactly the three keys those
   * components index into, and nothing more.
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

    /*
     * **483 and 484 exist because the rules resolver cannot be exercised
     * without them.** The generator hands out 231 ids for 58 wilayas where the
     * real table runs to 1 541, so the measured commune rule — pinned to
     * commune 484 — sat on an id no picker could ever select, and *commune
     * beats wilaya*, the one thing the rules table exists to display, was
     * unreachable in the harness while working in the shop.
     */
    expect(data.map((row) => row.id)).toEqual(expect.arrayContaining([483, 484]));
  });
});

/* ------------------------------------------------------------------ shipping --- */

/**
 * The shipping section, which is the first collection whose harness had to be
 * built in **both** directions at once: the mock must not offer a sort the API
 * does not implement, and it must not refuse a body the API accepts.
 *
 * Everything below is parsed with the panel's own schema through the panel's own
 * `unwrap()`, and every refusal is checked for its **code** as well as its
 * sentence. DECISIONS.md records why: fourteen parameter refusals once carried
 * `rest_invalid_param`, a code no client can receive, and it survived three
 * readings of the file because every assertion compared the sentence and none
 * compared the code.
 */
const WIRE_CODES = ["invalid_request", "not_found", "conflict", "unauthenticated"];

/** A refusal, checked for status and code together. Neither alone is enough. */
function refusedWith(response: MockResponse, status: number, code: string): ApiError {
  const error = apiError(response);
  expect(error.status).toBe(status);
  expect(error.code).toBe(code);
  return error;
}

describe("GET /shipping/rules", () => {
  it("serves the three measured rules, specificity and all", () => {
    const { data, meta } = parseList(shippingRulesSchema, get("/shipping/rules"));
    expect(meta.total).toBe(3);

    // The shop's own tariff, measured 2026-08-25. Written out rather than
    // spot-checked: a rule whose amount drifts is a screen showing a price the
    // shop does not charge, and every field here is one a cell renders.
    expect(data).toEqual([
      expect.objectContaining({
        id: 164,
        wilaya_id: 16,
        commune_id: 484,
        amount: "350.00",
        free_over: null,
        estimated_days: 1,
        is_active: true,
        specificity: 15,
      }),
      expect.objectContaining({
        id: 163,
        wilaya_id: 16,
        commune_id: 0,
        amount: "500.00",
        free_over: "10000.00",
        estimated_days: 2,
        specificity: 7,
      }),
      expect.objectContaining({
        id: 162,
        wilaya_id: 0,
        commune_id: 0,
        amount: "800.00",
        free_over: null,
        estimated_days: 5,
        specificity: 3,
      }),
    ]);

    /*
     * **`provider` is `"manual"` on every one**, corrected 2026-08-25 from the
     * measured `GET /shipping/rules/164`. This asserted `""` — read out of "a
     * POST with no provider stores the empty string" plus "the whole GET body
     * PATCHes back with provider dropped", neither of which says what a rule
     * created *with* a provider holds. `seed-shipping-rules.mjs:77,88,99` sends
     * `"manual"` on all three, so the server stores what it is given.
     */
    expect(data.every((rule) => rule.provider === "manual")).toBe(true);

    // The panel's own three scopes, each with a row to render.
    expect(data.map(ruleScope)).toEqual(["commune", "wilaya", "national"]);
    // And the server's ranking already agrees with the panel's sort, so the
    // table showing its own resolution is showing the server's.
    expect(byNarrowestFirst(data).map((rule) => rule.id)).toEqual([164, 163, 162]);
  });

  /**
   * **The detail, and the 404 that was the real defect.**
   *
   * This route was left unimplemented on the grounds that nothing calls it and
   * nobody had measured it. Measured 2026-08-25: it is real, and it returns the
   * list row exactly. An unimplemented route is not a neutral gap — it answers
   * `rest_no_route`, a code `ErrorNormalizer` never emits, so a screen
   * branching on this 404 would have been written against a code the API cannot
   * send; and it is the *less capable* direction, which grows an error path
   * production never takes.
   */
  it("serves a rule detail whose key set is the list row exactly", () => {
    const row = parseList(shippingRulesSchema, get("/shipping/rules")).data[0];
    const { data, meta } = parse(shippingRuleSchema, get(`/shipping/rules/${row.id}`));
    expect(meta).toBeNull();
    expect(data).toEqual(row);
    expect(Object.keys(data)).toEqual(Object.keys(row));
    expect(Object.keys(data)).toHaveLength(12);

    // The collection's own 404, shared with the second `DELETE` rather than
    // copied — and the code compared, not only the sentence.
    const error = refusedWith(get("/shipping/rules/999999"), 404, "not_found");
    expect(error.apiMessage).toBe("No shipping rule with that id.");
    expect(error.details).toEqual({});
    expect(error.code).not.toBe("rest_no_route");
    // A deleted rule answers the same way, which is what "shared" has to mean.
    write("DELETE", `/shipping/rules/${row.id}`);
    expect(apiError(get(`/shipping/rules/${row.id}`)).apiMessage).toBe(
      "No shipping rule with that id.",
    );
    // A non-numeric segment is still a path nobody wrote.
    expect(apiError(get("/shipping/rules/abc")).code).toBe("rest_no_route");
  });

  it("refuses the paging edges every other collection refuses", () => {
    // Shared `paginate()`, which is what makes the pickers refuse these too.
    expect(refusedWith(get("/shipping/rules", "per_page=0"), 400, "invalid_request").params)
      .toEqual({ per_page: "per_page must be between 1 (inclusive) and 100 (inclusive)" });
    expect(refusedWith(get("/shipping/rules", "page=abc"), 400, "invalid_request").params)
      .toEqual({ page: "page is not of type integer." });
  });
});

/**
 * The rule writes, and the whole measured refusal table with them.
 *
 * This collection follows the **coupons/products** read-only rule — a key the
 * server owns is dropped in silence and only a genuinely unknown key is a 400 —
 * while `PATCH /shipments/{id}`, one route away on the same subject, rejects
 * every key it does not own. Two rules, one section, and a screen built to the
 * wrong one saves nothing and says it saved.
 */
describe("the shipping rule writes", () => {
  const created = () =>
    parse(
      shippingRuleSchema,
      write("POST", "/shipping/rules", {
        amount: "999.00",
        wilaya_id: 31,
        delivery_type: "desk",
        estimated_days: 3,
      }),
    ).data;

  /**
   * **A create answers 201, and the status is the third thing that drifts.**
   *
   * Measured 2026-08-25; this file answered 200 with a byte-identical body, so
   * a request-for-request diff of envelopes and sentences could not see it —
   * the same blind spot that hid `rest_invalid_param` behind fourteen
   * assertions that compared only messages. `unwrap()` accepts all of 200-299,
   * so no screen can tell the two apart, which is the argument for pinning it
   * here rather than against.
   */
  it("answers a create with 201, not 200", () => {
    expect(write("POST", "/shipping/rules", { amount: "1.00", provider: "" }).status).toBe(201);
    // The bare body too — the second case that was measured.
    expect(write("POST", "/shipping/rules", { amount: "2.00" }).status).toBe(201);
    // A refusal is still a refusal, and a PATCH is still a 200.
    expect(write("POST", "/shipping/rules", {}).status).toBe(400);
    expect(write("PATCH", "/shipping/rules/164", { amount: "3.00" }).status).toBe(200);
  });

  /**
   * **Every create in the file, and the one that is still a question.**
   *
   * Three are measured — `/shipping/rules`, `/coupons` and
   * `/orders/{id}/shipments`, all 201 on 2026-08-25 — and they were moved one
   * at a time rather than swept, because one route's behaviour is not a pattern
   * on an API this file exists to distrust. Three agreeing is what settled it.
   *
   * `POST /orders/{id}/cod/attempts` stays 200 and stays **unmeasured because
   * provoking it is irreversible, not because it is unreachable.** A coupon can
   * be force-deleted and a parcel cancelled, so both were probed and cleaned up;
   * a recorded delivery call cannot be un-recorded. The distinction matters to
   * whoever picks this up: the measurement is available, it just costs an
   * attempt on a real order.
   */
  it("answers all three measured creates with 201, and pins the fourth at 200", () => {
    expect(
      write("POST", "/coupons", {
        code: "harness-201",
        discount_type: "fixed_cart",
        amount: "5.00",
      }).status,
    ).toBe(201);
    expect(
      write("POST", "/orders/1007/shipments", { wilaya_id: 16, commune_id: 484 }).status,
    ).toBe(201);

    // Unmeasured, and 200 here is what the file answers rather than what the
    // shop was seen to answer.
    expect(write("POST", "/orders/1007/cod/attempts", { outcome: "confirmed" }).status).toBe(200);
  });

  it("creates a rule whose specificity is computed, never accepted", () => {
    const rule = created();
    expect(rule.id).toBe(179);
    expect(rule.amount).toBe("999.00");
    // Measured: a wilaya rule at `desk` ranks 6, where the same scope at `home`
    // ranks 7. The client never sends this and cannot.
    expect(rule.specificity).toBe(6);
    // With no provider on the body the server stores the empty string.
    expect(rule.provider).toBe("");

    // A sent `specificity` is dropped rather than honoured — the one assertion
    // that proves the number is the server's.
    const forced = parse(
      shippingRuleSchema,
      write("PATCH", `/shipping/rules/${rule.id}`, { specificity: 99, amount: "999.00" }),
    ).data;
    expect(forced.specificity).toBe(6);

    expect(parseList(shippingRulesSchema, get("/shipping/rules")).meta.total).toBe(4);
  });

  it("requires amount, and requires nothing else at all", () => {
    const error = refusedWith(
      write("POST", "/shipping/rules", { wilaya_id: 16 }),
      400,
      "invalid_request",
    );
    expect(error.apiMessage).toBe("The shipping rule is invalid.");
    expect(error.fields).toEqual({ amount: "Required." });

    // Everything else is server-defaulted, so an amount alone is a whole rule.
    const bare = parse(shippingRuleSchema, write("POST", "/shipping/rules", { amount: "12.00" }))
      .data;
    expect(bare.wilaya_id).toBe(0);
    expect(bare.commune_id).toBe(0);
    expect(bare.is_active).toBe(true);
  });

  it("names a bad amount, an unknown field and a bad delivery type verbatim", () => {
    expect(
      refusedWith(write("POST", "/shipping/rules", { amount: "abc" }), 400, "invalid_request")
        .fields,
    ).toEqual({ amount: "Must be an amount." });

    expect(
      refusedWith(
        write("POST", "/shipping/rules", { amount: "123.00", zzz: 1 }),
        400,
        "invalid_request",
      ).fields,
    ).toEqual({ zzz: "Unknown field." });

    /*
     * **The third refusal family**, and the reason `notOneOf()` was not enough.
     * A query parameter refuses as `"status is not one of a, b, and c."`; a body
     * field refuses as `"Must be one of: a, b, c."`; and this one carries an
     * escape hatch that is not a value, because `""` is a real `delivery_type`
     * meaning *any* and cannot be printed as a list item.
     */
    const enumError = refusedWith(
      write("PATCH", "/shipping/rules/164", { delivery_type: "zzz" }),
      400,
      "invalid_request",
    );
    expect(enumError.fields).toEqual({
      delivery_type: "Must be one of: home, desk, or empty for any.",
    });
    // And the escape hatch is real: the empty string is accepted.
    for (const value of ["", ...DELIVERY_TYPES]) {
      expect(write("PATCH", "/shipping/rules/164", { delivery_type: value }).status).toBe(200);
    }
  });

  /**
   * **`provider` is validated, and its refusal is the fourth family** — the
   * first that quotes the *offending value* back instead of listing the legal
   * set inside the sentence. The legal set arrives beside it, under a key
   * nothing in the panel reads.
   */
  it("refuses an unregistered provider, and names the legal set beside the field", () => {
    for (const verb of ["POST", "PATCH"] as const) {
      const path = verb === "POST" ? "/shipping/rules" : "/shipping/rules/164";
      const error = refusedWith(
        write(verb, path, { amount: "350.00", provider: "acfake" }),
        400,
        "invalid_request",
      );
      expect(error.apiMessage).toBe("The shipping rule is invalid.");
      expect(error.fields).toEqual({ provider: 'Unknown provider "acfake".' });

      /*
       * **A sibling of `fields`, not a member of it — and no reader in
       * `lib/api/` looks at it.** `ApiError` exposes `fields` and `params` and
       * nothing else, so this key is invisible to every screen today. It is the
       * API naming the legal set, the service a 409's `allowed` array performs
       * for an order transition and which the shipment 409 is recorded as
       * lacking. Asserted so it survives until something reads it.
       */
      expect(error.details.available).toEqual(["manual"]);
      expect(error.fields?.available).toBeUndefined();
      // The sentence carries no list of its own; the two halves are split.
      expect(error.fields?.provider).not.toContain("manual");
    }

    // The two values a rule may hold, on both verbs.
    expect(write("PATCH", "/shipping/rules/164", { provider: "manual" }).status).toBe(200);
    expect(
      parse(shippingRuleSchema, write("PATCH", "/shipping/rules/164", { provider: "" })).data
        .provider,
    ).toBe("");
    // And an omitted key still defaults to the empty string on a create.
    expect(
      parse(shippingRuleSchema, write("POST", "/shipping/rules", { amount: "5.00" })).data
        .provider,
    ).toBe("");

    // `available` is the same list the picker is built from, so a refusal and
    // the choices on screen cannot disagree about what is registered.
    const registered = parse(shippingProviders, get("/shipping/providers")).data;
    expect(
      apiError(write("POST", "/shipping/rules", { amount: "1.00", provider: "zzz" })).details
        .available,
    ).toEqual(registered.map((entry) => entry.name));
  });

  /**
   * **`acfake` is a parcel's provider and is not a rule's**, and the split must
   * stay. It is registered at runtime by the backend's webhook suite, so it is
   * on 42 of the 129 shipments and on no registered-provider list. A mock that
   * shared one enum between the two would either refuse a third of the parcels
   * or let a screen save a tariff the shop rejects.
   */
  it("keeps the parcel provider vocabulary and the rule one apart", () => {
    const parcels = [1, 2].flatMap(
      (n) => parseList(shipmentsSchema, get("/shipments", `per_page=100&page=${n}`)).data,
    );
    expect(parcels.filter((row) => row.provider === "acfake").length).toBeGreaterThan(0);
    // The same word: honoured on a parcel, refused on a rule.
    expect(get("/shipments", "provider=acfake").status).toBe(200);
    expect(write("POST", "/shipping/rules", { amount: "1.00", provider: "acfake" }).status).toBe(
      400,
    );
  });

  it("takes its own GET body back, dropping five keys in silence", () => {
    const before = parseList(shippingRulesSchema, get("/shipping/rules")).data[0];
    const after = parse(
      shippingRuleSchema,
      write("PATCH", `/shipping/rules/${before.id}`, before),
    ).data;

    // **A 200, not a 400.** `id`, `specificity`, `created_at`, `updated_at` and
    // `provider` are dropped without comment — the coupons/products rule, and
    // the opposite of what `PATCH /shipments/{id}` does one route away.
    expect(after.id).toBe(before.id);
    expect(after.specificity).toBe(before.specificity);
    expect(after.created_at).toBe(before.created_at);
    // Unchanged — and this is the request that *cannot* tell "dropped" from
    // "written back with the value it already had", which is how `provider`
    // spent a branch on the read-only list by mistake.
    expect(after.provider).toBe("manual");

    // A partial PATCH is a 200 too, and moves only what it names.
    const patched = parse(
      shippingRuleSchema,
      write("PATCH", "/shipping/rules/163", { amount: "111.00" }),
    ).data;
    expect(patched.amount).toBe("111.00");
    expect(patched.free_over).toBe("10000.00");
  });

  it("answers an empty PATCH with a message and NO details key at all", () => {
    const response = write("PATCH", "/shipping/rules/164", {});
    const error = refusedWith(response, 400, "invalid_request");
    expect(error.apiMessage).toBe("No supported fields were provided.");

    /*
     * A products ending, not a coupon's 200 no-op — and `details` is *absent*
     * rather than empty, which is a shape a mock emitting `details: {}` would
     * let a screen read `details.fields` off and never find out.
     */
    const body = response.body as { error: Record<string, unknown> };
    expect("details" in body.error).toBe(false);
    expect(error.fields).toBeNull();

    // A body of nothing but keys the server owns lands in the same place: they
    // are dropped, and dropping them leaves nothing supported. `provider` is
    // deliberately not in this list any more — it is writable.
    expect(
      write("PATCH", "/shipping/rules/164", { id: 1, specificity: 99 }).status,
    ).toBe(400);
  });

  it("deletes once, and the second delete is this collection's own 404", () => {
    const rule = created();
    const { data } = parse(deleteResult, write("DELETE", `/shipping/rules/${rule.id}`));
    expect(data).toEqual({ deleted: true, id: rule.id });

    const error = refusedWith(
      write("DELETE", `/shipping/rules/${rule.id}`),
      404,
      "not_found",
    );
    expect(error.apiMessage).toBe("No shipping rule with that id.");
    // A rule has no trash: unlike a coupon there is no state to come back from.
    expect(parseList(shippingRulesSchema, get("/shipping/rules")).meta.total).toBe(3);
  });
});

describe("GET /shipping/rates", () => {
  it("resolves narrowest-first and never adds two rules together", () => {
    // Measured 350 / 500 / 800 across the three arms, with all three rules in
    // place — and **one** rate comes back each time, not the three that match.
    for (const [wilaya, commune, amount] of [
      [16, 484, "350.00"],
      [16, 61, "500.00"],
      [1, 1, "800.00"],
    ] as const) {
      const { data } = parseList(
        shippingRatesSchema,
        get("/shipping/rates", `wilaya_id=${wilaya}&commune_id=${commune}`),
      );
      expect(data).toHaveLength(1);
      expect(data[0].amount).toBe(amount);
      expect(data[0].source).toBe("rules");
      // The quote is attributed to the configured default provider, while the
      // rule's own `provider` is the empty string.
      expect(data[0].provider).toBe("manual");
      // `label` here is a display string and is **not** the credential a
      // shipment's `metadata.label` is. The two share a name and nothing else.
      expect(data[0].label).toBe("Delivery");
      expect(data[0].free_shipping).toBe(false);
    }

    // The panel's own preview agrees with the server's answer, which is the
    // property the rules screen puts on the page.
    const rules = parseList(shippingRulesSchema, get("/shipping/rules")).data;
    expect(applicableRules(rules, 16, 484)[0].amount).toBe("350.00");
  });

  /**
   * **The second shape of `details.params` in this API**, and the reason the two
   * are reproduced rather than unified: `/shipments?status=zzz` puts an *object
   * of messages* under this key and `/shipping/rates` puts a *bare array of
   * names*. `Object.values` of an array returns its elements, so a reader built
   * for one renders the bare word `wilaya_id` at a person as an explanation.
   */
  it("reports missing parameters as a bare ARRAY, unlike every other route", () => {
    const error = refusedWith(get("/shipping/rates"), 400, "invalid_request");
    expect(error.apiMessage).toBe("Missing parameter(s): wilaya_id, commune_id");
    expect(error.details.params).toEqual(["wilaya_id", "commune_id"]);
    expect(Array.isArray(error.details.params)).toBe(true);

    /*
     * **The trap, and the guard that now closes it.**
     *
     * `ApiError.params` used to run `Object.entries` over whatever was under the
     * key, so this array came back as an object keyed by its *indices* —
     * `{"0":"wilaya_id","1":"commune_id"}`, parameter *names* posing as messages,
     * which a form would bind to controls called `0` and `1` and a banner would
     * print at a person as an explanation. This test asserted that shape as the
     * behaviour, which is how it survived: the mock could reproduce the wire and
     * not fix the reader.
     *
     * Fixed on the shipping branch. `lib/api/errors.ts` now guards both getters
     * with `!Array.isArray(...)`, matching `BrowserApiError.fields` and
     * `firstMessage()`, which have guarded since the inventory branch. An array
     * carries no sentence, so there is nothing to return and the caller falls
     * through to `apiMessage` — which on this route is the readable half.
     */
    expect(error.params).toBeNull();

    // The other shape, on the same subject, one route away.
    const other = refusedWith(get("/shipments", "status=zzz"), 400, "invalid_request");
    expect(Array.isArray(other.details.params)).toBe(false);
    expect(other.params?.status).toBe(
      "status is not one of pending, created, picked_up, in_transit, out_for_delivery, delivered, returning, returned, cancelled, and failed.",
    );
  });

  it("answers 200 with [] once no rule covers the destination", () => {
    // What the whole shop answered before `seed-shipping-rules.mjs` ran: not an
    // error, just nothing — which is a state the screen has to render.
    for (const id of [164, 163, 162]) write("DELETE", `/shipping/rules/${id}`);
    const { data, meta } = parseList(
      shippingRatesSchema,
      get("/shipping/rates", "wilaya_id=16&commune_id=484"),
    );
    expect(data).toEqual([]);
    expect(meta.total).toBe(0);
    expect(shippingRateSchema.safeParse(data[0]).success).toBe(false);
  });
});

describe("GET /shipments", () => {
  const page = (query: string) => parseList(shipmentsSchema, get("/shipments", query));

  it("parses every row, and the shop it reproduces is all but finished", () => {
    const { meta } = page("per_page=1");
    expect(meta.total).toBe(129);

    const rows = [1, 2].flatMap((n) => page(`per_page=100&page=${n}`).data);
    expect(rows).toHaveLength(129);

    /*
     * **`is_live === !isTerminalShipmentStatus(status)` on every row**, which is
     * the measurement the whole parcels screen turns on: the two are the same
     * fact spelled twice, so `is_live` must never be rendered as a second marker
     * beside the status badge.
     */
    for (const row of rows) {
      expect(row.is_live).toBe(!isTerminalShipmentStatus(row.status));
    }

    // One live parcel, and it is the only reason the status picker, cancel and
    // sync are reachable at all. The shop itself has none — 129 finished rows —
    // so a harness seeded to that exactly could verify none of the three writes.
    expect(rows.filter((row) => row.is_live)).toHaveLength(1);

    // Both providers present, because `provider` filtering needs two values and
    // because one of them is not in `/shipping/providers`.
    const providers = new Set(rows.map((row) => row.provider));
    expect([...providers].sort()).toEqual(["acfake", "manual"]);
    const listed = parse(shippingProviders, get("/shipping/providers")).data;
    expect(listed).toHaveLength(1);
    expect(listed.some((entry) => entry.name === "acfake")).toBe(false);

    // The measured `metadata` key union, across the collection and never on one
    // row: `cod_amount` is a manual parcel's and `provider_status` is a
    // courier's own spelling.
    const keys = new Set(rows.flatMap((row) => Object.keys(row.metadata)));
    for (const key of [
      "delivery_type",
      "wilaya_id",
      "commune_id",
      "cod_amount",
      "provider_status",
    ]) {
      expect(keys, `metadata must carry ${key} somewhere`).toContain(key);
    }

    // And the one credential the fixture carries on purpose, so the stripper is
    // exercised by a capture rather than only by its own unit test.
    const labelled = rows.find((row) => row.metadata.label !== undefined);
    expect(labelled).toBeDefined();
    expect(stripLabelUrls(labelled!).metadata.label).toBeUndefined();
    expect(stripLabelUrls(labelled!).labelKeys).toEqual(["label"]);
  });

  it("filters by status, provider and order_id — and validates only status", () => {
    expect(page("status=delivered&per_page=1").meta.total).toBe(86);
    expect(page("status=cancelled&per_page=1").meta.total).toBe(42);
    // A status no parcel holds is a real, empty answer.
    expect(page("status=returning&per_page=1").meta.total).toBe(0);

    expect(page("provider=manual&per_page=1").meta.total).toBe(86);
    expect(page("provider=acfake&per_page=1").meta.total).toBe(43);
    /*
     * **`?provider=zzz` is a 200 with 0 rows**, not a 400 — measured, and the
     * asymmetry is the point: the route declares an enum for `status` and does
     * not for `provider`, so a typo in one is a refusal and a typo in the other
     * is a silent empty list. A screen must not read emptiness as "none match".
     */
    expect(get("/shipments", "provider=zzz").status).toBe(200);
    expect(page("provider=zzz&per_page=1").meta.total).toBe(0);

    const orderId = page("per_page=1").data[0].order_id;
    const byOrder = page(`order_id=${orderId}&per_page=100`);
    expect(byOrder.data.length).toBeGreaterThan(0);
    expect(byOrder.data.every((row) => row.order_id === orderId)).toBe(true);
  });

  /**
   * **The point of the whole harness, on the one collection that proves it.**
   *
   * `orderby` × eight fields × both directions returned a byte-identical id
   * sequence to `?bogus_param=1`, over a page carrying 100 distinct ids and 82
   * distinct `created_at` — so there is nothing to tie on and the explanation
   * cannot be a flat fixture. And `?orderby=zzz` is a **200**: the parameter
   * never reaches a validator, so it cannot be reaching a sort.
   *
   * A mock that 400'd `?orderby=zzz` would be claiming the opposite, and a
   * validator is the first evidence anyone would take for a sort existing.
   */
  it("accepts and ignores is_live, orderby and order — without validating them", () => {
    const control = page("per_page=100&bogus_param=1").data.map((row) => row.id);

    /*
     * **`is_live` is airtight now, not merely probable.** Re-measured
     * 2026-08-25 with a live parcel present: `?bogus_param=1` 130,
     * `?is_live=true` **130**, `?is_live=false` **130**. Every earlier
     * measurement was taken on an all-terminal shop, where `is_live=false`
     * returning everything is exactly what a *working* filter would also do —
     * so the parameter had never actually been proved inert. It has been now,
     * and the fixture holds a live row for the same reason.
     */
    expect(page("per_page=1&is_live=true").meta.total).toBe(129);
    expect(page("per_page=1&is_live=false").meta.total).toBe(129);
    // And the ambiguity really is resolved here too: a live row exists, so
    // `is_live=false` returning all 129 cannot be a filter doing its job.
    expect(page("per_page=100").data.some((row) => row.is_live)).toBe(true);

    for (const query of [
      "is_live=true",
      "is_live=false",
      "search=MAN",
      "orderby=zzz",
      "order=sideways",
      ...["id", "order_id", "created_at", "status", "tracking_number", "provider"].flatMap(
        (field) => [`orderby=${field}`, `orderby=${field}&order=asc`],
      ),
    ]) {
      const response = get("/shipments", `per_page=100&${query}`);
      expect(response.status, `${query} must not be refused`).toBe(200);
      expect(
        parseList(shipmentsSchema, response).data.map((row) => row.id),
        `${query} must not reorder anything`,
      ).toEqual(control);
    }

    // The tie explanation is excluded here the same way it was on the wire.
    expect(new Set(control).size).toBe(control.length);
    expect(new Set(page("per_page=100").data.map((row) => row.created_at)).size).toBeGreaterThan(
      50,
    );
  });

  it("refuses a status outside the ten, naming the parameter", () => {
    const error = refusedWith(get("/shipments", "status=zzz"), 400, "invalid_request");
    expect(error.apiMessage).toBe("Invalid parameter(s): status");
    // The **query-parameter** enum family: Oxford comma, `is not one of`, and
    // the physical order rather than an alphabetical one.
    expect(error.params?.status).toBe(`status is not one of ${SHIPMENT_STATUSES.slice(0, -1).join(", ")}, and failed.`);
    // Every one of the ten is accepted, whether or not any row holds it.
    for (const status of SHIPMENT_STATUSES) {
      expect(get("/shipments", `status=${status}`).status).toBe(200);
    }
  });

  it("serves a detail whose key set is the list row exactly", () => {
    const row = page("per_page=1").data[0];
    const { data, meta } = parse(shipmentSchema, get(`/shipments/${row.id}`));
    expect(meta).toBeNull();
    expect(data).toEqual(row);

    // Written out rather than compared to itself: the measured key set is what
    // makes a peek free on this collection, and a fixture that grew an
    // eleventh key would silently stop proving it.
    expect(Object.keys(data).sort()).toEqual([
      "created_at",
      "id",
      "is_live",
      "metadata",
      "order_id",
      "provider",
      "provider_shipment_id",
      "status",
      "tracking_number",
      "updated_at",
    ]);

    const error = refusedWith(get("/shipments/999999"), 404, "not_found");
    expect(error.apiMessage).toBe("No shipment with that id.");
    // A routed id that holds nothing, against a path nobody wrote.
    expect(apiError(get("/shipments/abc")).code).toBe("rest_no_route");
  });
});

/* ------------------------------------------------------------------ payments --- */

/**
 * **`GET /payments`, `GET /payments/{id}` and `GET /cod/statistics` were pinned
 * at 404 in this file as declared `UNCOVERED` gaps until 2026-08-26, and the
 * declaration had stopped being true of the API long before it stopped being
 * true of the mock.** All three are allowlisted, all three are what `/payments`
 * calls on load, and a 404 here is not a neutral absence — it answers
 * `rest_no_route`, a code `ErrorNormalizer` never emits, so a screen branching on
 * it would have been built against something the shop cannot send.
 *
 * The whole point of this collection is the split between what it honours and
 * what it accepts and throws away, so both halves are asserted: four filters that
 * really filter, and eleven parameters that are byte-identical to the bare
 * listing. Every refusal is checked for its **code** as well as its sentence.
 */
const paymentsBody = (query = "") => JSON.stringify(get("/payments", query).body);

describe("GET /payments", () => {
  it("serves 45 transactions over three pages, newest id first", () => {
    const { data, meta } = parseList(paymentsSchema, get("/payments"));
    expect(meta).toEqual({ total: 45, page: 1, per_page: 20, total_pages: 3 });
    expect(data).toHaveLength(20);

    const all = parseList(paymentsSchema, get("/payments", "per_page=100")).data;
    expect(all).toHaveLength(45);

    // The resting order, and the two things that make a sort regression visible.
    expect(all.map((row) => row.id)).toEqual([...all.map((row) => row.id)].sort((a, b) => b - a));
    expect(new Set(all.map((row) => row.id)).size).toBe(45);
    expect(new Set(all.map((row) => row.created_at)).size).toBe(45);

    /*
     * **`id desc` and `created_at desc` are different sequences**, deliberately.
     * The two pinned rows carry the highest ids and sit in the middle of the date
     * range, so a `date` sort that started working could actually be seen — where
     * a fixture whose ids and stamps agree would answer identically either way,
     * which is precisely how "validated then ignored" got recorded for a working
     * coupon sort.
     */
    const byDate = [...all].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    expect(byDate.map((row) => row.id)).not.toEqual(all.map((row) => row.id));

    // A payment's stamp ends `Z` where a parcel's ends `+00:00`, on all 45.
    expect(all.every((row) => row.created_at.endsWith("Z"))).toBe(true);
    // And every row carries its own currency, like an order and unlike a product.
    expect(all.every((row) => row.currency === "DZD")).toBe(true);
  });

  /**
   * **`paid` is empty on purpose and is not a gap.** Measured 2026-08-20 and
   * again 2026-08-26: nothing in this shop has ever settled, so four of the six
   * statuses return zero rows. That is the positive control the filter needs —
   * `?status=zzz` refuses, `?bogus_param=1` is ignored with all 45 — and
   * inventing a settled shop would hand the panel a state it cannot reach.
   */
  it("filters by status, and three of the six answer nothing at all", () => {
    const count = (query: string) =>
      parseList(paymentsSchema, get("/payments", `${query}&per_page=100`)).meta.total;

    expect(count("status=pending")).toBe(44);
    expect(count("status=failed")).toBe(1);
    for (const status of ["paid", "expired", "cancelled", "refunded"]) {
      expect(count(`status=${status}`), `${status} must be empty in this shop`).toBe(0);
    }
    // The six sum to the collection, so the tabs partition it rather than
    // overlapping.
    const summed = PAYMENT_STATUSES.reduce((total, s) => total + count(`status=${s}`), 0);
    expect(summed).toBe(45);
  });

  /**
   * The enum refusal names all six in the **physical** order, ends in a full stop,
   * and carries `invalid_request` rather than WordPress's own `rest_invalid_param`
   * — the code half is what DECISIONS.md records fourteen refusals hiding behind.
   */
  it("refuses a status outside the six, an empty one, a list and an array", () => {
    const enumSentence =
      "status is not one of pending, paid, failed, expired, cancelled, and refunded.";

    for (const query of ["status=zzz", "status=", "status=pending,failed"]) {
      const error = refusedWith(get("/payments", query), 400, "invalid_request");
      expect(error.params?.status, query).toBe(enumSentence);
      expect(error.apiMessage).toBe("Invalid parameter(s): status");
    }

    /*
     * **`?status[]=pending` is the *type* family, not the enum one**, and it names
     * `status` rather than `status[]`: PHP turns the bracketed name into an array
     * before the router sees it, so what fails is the string check. Reproducing it
     * takes reading the bracketed key by hand — `URLSearchParams` does no such
     * folding, so without that the parameter looks absent and the request would
     * have answered a silent 200 with every row.
     */
    const array = refusedWith(get("/payments", "status[]=pending"), 400, "invalid_request");
    expect(array.params?.status).toBe("status is not of type string.");
  });

  /**
   * **`?status=` is a 400 and `?provider=` is a 200 with every row**, and the
   * asymmetry is measured on the same request pair rather than tidied away. It is
   * the shape this file already records between `/products?status=` and
   * `/coupons?status=`: the empty string is a member of one enum and not of the
   * other, and a parameter that reaches no enum at all cannot refuse anything.
   */
  it("honours provider case-insensitively, refuses nothing, and reads an empty one as absence", () => {
    const count = (query: string) =>
      parseList(paymentsSchema, get("/payments", `${query}&per_page=100`)).meta.total;

    expect(count("provider=cod")).toBe(43);
    expect(count("provider=chargily")).toBe(2);
    // The two providers sum to the collection — nothing is on a third.
    expect(count("provider=cod") + count("provider=chargily")).toBe(45);
    expect(count("provider=COD")).toBe(43);

    // A typo is a silent empty list here, where a status typo is a refusal.
    expect(get("/payments", "provider=zzz").status).toBe(200);
    expect(count("provider=zzz")).toBe(0);
    expect(count("provider=")).toBe(45);
  });

  it("honours order_id, and refuses it in the type family and the range family", () => {
    const rows = (query: string) => parseList(paymentsSchema, get("/payments", query)).data;

    // The rich order carries two transactions; every other order carries one.
    expect(rows("order_id=1023").map((row) => row.id)).toEqual([5231, 5230]);
    expect(rows("order_id=1030")).toHaveLength(1);
    // A real integer for an order that has no transaction is 0 rows, not a 404.
    expect(get("/payments", "order_id=99999999").status).toBe(200);
    expect(rows("order_id=99999999")).toHaveLength(0);

    for (const query of ["order_id=zzz", "order_id="]) {
      const error = refusedWith(get("/payments", query), 400, "invalid_request");
      expect(error.params?.order_id, query).toBe("order_id is not of type integer.");
    }
    /*
     * **A range sentence carries no full stop and a type sentence does.** The
     * inconsistency is WordPress's own and cannot be tidied into a rule, only
     * copied — a form quoting one back would otherwise render a sentence the shop
     * never sends.
     */
    for (const query of ["order_id=0", "order_id=-1"]) {
      const error = refusedWith(get("/payments", query), 400, "invalid_request");
      expect(error.params?.order_id, query).toBe(
        "order_id must be greater than or equal to 1",
      );
      expect(error.params?.order_id.endsWith(".")).toBe(false);
    }
  });

  /**
   * ── The one measurement that needed a fixture built for it ───────────────────
   *
   * **The bounds are inclusive at both ends and cut on the UTC day, not on
   * Africa/Algiers.** Measured, not assumed — and the two readings are
   * indistinguishable on every row in the shop but one. The fixture pins that row
   * at `2026-08-16T23:07:22Z`, which is 00:07 on the **17th** in the shop's
   * timezone, so it is included by `date_to=2026-08-16` and excluded by
   * `date_from=2026-08-17`. Drop it and both assertions below still pass against a
   * mock that cut on the wrong zone.
   */
  it("cuts date_from and date_to on the UTC day, inclusive at both ends", () => {
    const rows = (query: string) =>
      parseList(paymentsSchema, get("/payments", `${query}&per_page=100`)).data;

    const edge = "2026-08-16T23:07:22Z";
    const all = rows("");
    expect(all.filter((row) => row.created_at === edge)).toHaveLength(1);

    const from17 = rows("date_from=2026-08-17");
    const to16 = rows("date_to=2026-08-16");
    expect(from17).toHaveLength(8);
    expect(to16).toHaveLength(37);
    // The discriminating row, on the side the UTC day puts it and not the side
    // the shop's clock would.
    expect(to16.some((row) => row.created_at === edge)).toBe(true);
    expect(from17.some((row) => row.created_at === edge)).toBe(false);
    // The two halves partition the collection, so neither bound drops a row.
    expect(from17.length + to16.length).toBe(45);

    /*
     * Inclusive at both ends: a single day names itself on both sides and comes
     * back whole. Compared against the day's own bucket rather than a literal, so
     * the assertion cannot quietly agree with a bound that is inclusive at one end
     * and exclusive at the other.
     */
    const onThe16th = all.filter((row) => row.created_at.slice(0, 10) === "2026-08-16");
    expect(onThe16th.length).toBeGreaterThan(1);
    expect(rows("date_from=2026-08-16&date_to=2026-08-16")).toEqual(onThe16th);
    // Six days of spread, so no single bound can answer the whole collection.
    expect(new Set(all.map((row) => row.created_at.slice(0, 10))).size).toBe(7);
    // An inverted range is empty rather than refused or swapped.
    expect(rows("date_from=2026-08-18&date_to=2026-08-12")).toHaveLength(0);
  });

  /**
   * **The fourth refusal family: a pattern sentence.** It ends in a full stop like
   * the enum and type families, and unlike either it names neither the legal set
   * nor the offending value — it prints the regex at the person. A date control is
   * what keeps it unreachable, which is the same argument the shipping provider
   * picker makes for its own refusal.
   */
  it("pattern-validates both date bounds, and serves an impossible date as zero rows", () => {
    const pattern = "does not match pattern ^\\d{4}-\\d{2}-\\d{2}$.";

    for (const name of ["date_from", "date_to"]) {
      for (const value of ["", "20-08-2026", "2026-08-20T00:00:00Z", "zzz"]) {
        const error = refusedWith(
          get("/payments", `${name}=${encodeURIComponent(value)}`),
          400,
          "invalid_request",
        );
        expect(error.params?.[name], `${name}=${value}`).toBe(`${name} ${pattern}`);
      }
    }

    /*
     * **`2026-13-45` matches the shape and is not a date**, and answers a 200 with
     * zero rows. The router validates the pattern and never the calendar, so a
     * screen cannot tell "nothing in that window" from "that is not a real date"
     * — because the API cannot either.
     */
    expect(get("/payments", "date_from=2026-13-45").status).toBe(200);
    expect(parseList(paymentsSchema, get("/payments", "date_from=2026-13-45")).meta.total).toBe(
      0,
    );
  });

  /**
   * **Every sort on this collection is accepted and ignored, and `?orderby=zzz` is
   * a 200** — it never reaches a validator, so a 400 here would be the mock
   * claiming the parameter reaches one, and a validator is the first evidence
   * anyone would take for a sort existing. Eleven values × both directions were
   * byte-identical to the bare listing and to `?bogus_param=1`, over 45 distinct
   * ids and 45 distinct stamps, so there is nothing to tie on.
   */
  it("accepts every sort and ignores it, and does not validate one either", () => {
    const bare = paymentsBody("bogus_param=1");
    expect(paymentsBody("")).toBe(bare);

    const fields = [
      "id",
      "date",
      "created_at",
      "amount",
      "status",
      "order_id",
      "provider",
      "reference",
      "updated_at",
      "title",
      "include",
    ];
    for (const field of fields) {
      for (const direction of ["asc", "desc"]) {
        expect(paymentsBody(`orderby=${field}&order=${direction}`), field).toBe(bare);
      }
    }

    // Not validated, at either half of the pair.
    expect(get("/payments", "orderby=zzz").status).toBe(200);
    expect(get("/payments", "order=zzz").status).toBe(200);
    expect(paymentsBody("orderby=zzz")).toBe(bare);
    expect(paymentsBody("order=zzz")).toBe(bare);

    // And the four other spellings somebody will reach for.
    for (const query of ["sort=id", "sort_by=id", "order_by=id", "orderby[]=id"]) {
      expect(paymentsBody(query), query).toBe(bare);
    }
  });

  /**
   * `search` is not a parameter of this route at all — `?search=zzz` returns every
   * row rather than none, which is the trap worth naming: an empty result would
   * look like a working search over a shop with nothing matching.
   */
  it("ignores search, currency, id, include and exclude", () => {
    const bare = paymentsBody("bogus_param=1");
    for (const query of [
      "search=zzz",
      "s=zzz",
      "currency=DZD",
      "currency=zzz",
      "id=5230",
      "include=5230",
      "exclude=5230",
    ]) {
      expect(paymentsBody(query), query).toBe(bare);
    }
    expect(parseList(paymentsSchema, get("/payments", "search=zzz&per_page=100")).data).toHaveLength(
      45,
    );
  });

  /**
   * **`reference` is the odd one: it really is honoured**, and the screen
   * deliberately does not offer it. Served correctly anyway — a mock that ignored
   * a working filter is the same class of error as one that honours a dead one,
   * and it is the direction the coupons branch was burned by.
   *
   * **It is an exact match, and reading it as a substring was a real defect in
   * the first draft of this fixture.** `reference=AC-1 → 42` is satisfied by both
   * readings; the three prefix requests below are what separate them, and all
   * three answer zero. The draft's premise was that 42 rows could not share one
   * value — the whole column holds **two** distinct values across 45 rows, which
   * is also why no control is built on it.
   */
  it("matches reference exactly and case-insensitively, never as a substring", () => {
    const count = (query: string) =>
      parseList(paymentsSchema, get("/payments", `${query}&per_page=100`)).meta.total;

    expect(count("reference=AC-1")).toBe(42);
    expect(count("reference=ac-1")).toBe(42);
    expect(count("reference=3939")).toBe(3);
    // The two values partition the collection.
    expect(count("reference=AC-1") + count("reference=3939")).toBe(45);

    // A prefix, a truncation and an extension are all zero. Any of the three
    // failing is the mock having become a `LIKE` again.
    for (const query of ["reference=AC", "reference=AC-", "reference=C-1", "reference=AC-11"]) {
      expect(count(query), query).toBe(0);
    }
    expect(count("reference=zzz")).toBe(0);
    // Never a refusal, at any of them.
    expect(get("/payments", "reference=AC").status).toBe(200);
    // And an empty one is an absence, not a value. See the three-way split below.
    expect(count("reference=")).toBe(45);

    // The column really is two values wide, which is the fact the screen's
    // missing control rests on.
    const all = parseList(paymentsSchema, get("/payments", "per_page=100")).data;
    expect(new Set(all.map((row) => row.reference))).toEqual(new Set(["AC-1", "3939"]));
    // The three-row cluster is the two pinned transactions plus the second
    // chargily row.
    expect(all.filter((row) => row.reference === "3939").map((row) => row.id).sort()).toEqual(
      [5224, 5230, 5231],
    );
  });

  /**
   * **What the empty string does, on all six honoured parameters — a three-way
   * split, not an asymmetry between two.** Measured 2026-08-26. The first reading
   * of this collection framed it as `status=` against `provider=` and missed the
   * middle row, which is where four of the six actually sit.
   *
   * The rule underneath: `""` is a value rather than an absence **only where it
   * reaches a validator**. Two of these six reach none, and there it cannot be
   * told from a parameter nobody sent.
   */
  it("splits the empty string three ways across its six honoured parameters", () => {
    // 1. Refused by an enum it is not a member of.
    expect(refusedWith(get("/payments", "status="), 400, "invalid_request").params?.status).toBe(
      "status is not one of pending, paid, failed, expired, cancelled, and refunded.",
    );

    // 2. Refused by a type or a pattern it cannot satisfy.
    expect(apiError(get("/payments", "order_id=")).params?.order_id).toBe(
      "order_id is not of type integer.",
    );
    for (const name of ["date_from", "date_to"]) {
      expect(apiError(get("/payments", `${name}=`)).params?.[name], name).toBe(
        `${name} does not match pattern ^\\d{4}-\\d{2}-\\d{2}$.`,
      );
    }

    // 3. Read as an absence, because neither reaches a validator at all.
    const bare = paymentsBody("bogus_param=1");
    for (const query of ["provider=", "reference=", "reference"]) {
      expect(paymentsBody(query), query).toBe(bare);
    }
  });

  it("pages the collection, and past the end answers zero rows with the real total", () => {
    expect(parseList(paymentsSchema, get("/payments", "page=3")).data).toHaveLength(5);

    const { data, meta } = parseList(paymentsSchema, get("/payments", "page=4"));
    expect(data).toHaveLength(0);
    expect(meta).toEqual({ total: 45, page: 4, per_page: 20, total_pages: 3 });

    // The four paging edges come from the shared `paginate()`, so this collection
    // refuses them the way every other one does.
    expect(refusedWith(get("/payments", "per_page=0"), 400, "invalid_request").params?.per_page)
      .toBe("per_page must be between 1 (inclusive) and 100 (inclusive)");
    expect(get("/payments", "per_page=101").status).toBe(400);
    expect(refusedWith(get("/payments", "per_page="), 400, "invalid_request").params?.per_page)
      .toBe("per_page is not of type integer.");
    expect(refusedWith(get("/payments", "page=0"), 400, "invalid_request").params?.page).toBe(
      "page must be greater than or equal to 1",
    );
    expect(get("/payments", "page=").status).toBe(400);
  });

  /**
   * **`GET /payments/{id}` is value-identical to the list row** — all eleven keys,
   * same values — which is what would make a peek drawer free on this collection
   * the way it is on parcels and orders.
   */
  it("serves a payment by id, value-identical to its list row", () => {
    const all = parseList(paymentsSchema, get("/payments", "per_page=100")).data;
    for (const row of [5230, 5231, 5228]) {
      const detail = parse(paymentSchema, get(`/payments/${row}`));
      expect(detail.meta, "a detail response carries no meta").toBeNull();
      expect(detail.data).toEqual(all.find((candidate) => candidate.id === row));
    }
    expect(Object.keys(get("/payments/5230").body as { data: object }).length).toBeGreaterThan(0);
    expect(
      Object.keys((get("/payments/5230").body as { data: object }).data),
    ).toHaveLength(11);

    const error = refusedWith(get("/payments/99999999"), 404, "not_found");
    expect(error.apiMessage).toBe("No payment with that id.");
    // A routed id that holds nothing, against a path nobody wrote. The
    // allowlist's pattern is `\d+`, so this second one never reached a handler.
    expect(apiError(get("/payments/abc")).code).toBe("rest_no_route");
  });

  /**
   * **All three measured `metadata` shapes, on rows a screen can actually reach.**
   * The schema is a free record, so a fixture carrying one shape would let a
   * drawer index into keys the other two rows do not have. `{error: "conflict"}`
   * is the only place a failed payment says *why*, which is why the shop's single
   * failed row has to carry it rather than the `{provider_status}` this file used
   * to invent for it.
   */
  it("carries the three measured metadata shapes", () => {
    const all = parseList(paymentsSchema, get("/payments", "per_page=100")).data;
    const by = (id: number) => all.find((row) => row.id === id)!;

    expect(Object.keys(by(5231).metadata).sort()).toEqual([
      "amount",
      "collect_on_delivery",
      "currency",
    ]);
    expect(by(5230).metadata).toEqual({ error: "conflict" });

    const chargilyPending = all.find(
      (row) => row.provider === "chargily" && row.status === "pending",
    )!;
    expect(Object.keys(chargilyPending.metadata).sort()).toEqual([
      "fees",
      "fees_on_customer",
      "fees_on_merchant",
      "livemode",
      "provider_status",
    ]);
  });

  it("answers every payments refusal with a code a client can receive", () => {
    const refusals: MockResponse[] = [
      get("/payments", "status=zzz"),
      get("/payments", "status="),
      get("/payments", "status[]=pending"),
      get("/payments", "order_id=zzz"),
      get("/payments", "order_id=0"),
      get("/payments", "date_from="),
      get("/payments", "date_to=zzz"),
      get("/payments", "per_page=101"),
      get("/payments", "page=0"),
      get("/payments/99999999"),
    ];

    for (const response of refusals) {
      const error = apiError(response);
      expect(WIRE_CODES, `${error.status} ${error.code} is not on the wire`).toContain(
        error.code,
      );
      expect(error.apiMessage.length).toBeGreaterThan(0);
    }
  });
});

/**
 * `GET /cod/statistics`, reproduced verbatim from the live stack. Every one of
 * the four properties below is load-bearing for the screen, and each is asserted
 * through the panel's own reader rather than against a literal — a fixture that
 * satisfied the numbers and broke `codFigures()` would be no fixture at all.
 */
describe("GET /cod/statistics", () => {
  it("keeps the four properties the COD funnel is built on", () => {
    const { data, meta } = parse(codStatisticsSchema, get("/cod/statistics"));
    expect(meta, "a report is not a list").toBeNull();

    // 1. `by_status` accounts for every order, which is what makes the breakdown
    //    explanatory rather than decorative.
    expect(byStatusSumsToTotal(data)).toBe(true);
    expect(data.total_orders).toBe(599);

    /*
     * 2. **Two different "confirmed" counts in one payload, and both are right.**
     *    `by_status.confirmed` is the shop now; `confirmed_orders` counts every
     *    order ever confirmed. Put them side by side unlabelled and a reader
     *    concludes one is broken, which is why `CodFigure.scope` is not optional
     *    — so the fixture must keep them *different* or nothing exercises it.
     */
    expect(data.by_status.confirmed).toBe(84);
    expect(data.confirmed_orders).toBe(126);
    expect(data.by_status.confirmed).not.toBe(data.confirmed_orders);

    const figures = codFigures(data);
    expect(figures.find((f) => f.key === "current_confirmed")).toEqual({
      key: "current_confirmed",
      scope: "now",
      value: 84,
    });
    expect(figures.find((f) => f.key === "ever_confirmed")?.value).toBe(126);
    expect(figures.every((f) => f.scope !== undefined)).toBe(true);

    // 3. The published rate divides the *ever* count by the total, so it cannot
    //    be re-derived from `by_status`.
    const confirmation = ratePercent(data.rates.confirmation);
    expect(confirmation).not.toBeNull();
    expect(confirmation).toBeCloseTo(data.confirmed_orders / data.total_orders, 4);
    for (const key of RATE_KEYS) {
      expect(ratePercent(data.rates[key]), key).not.toBeNull();
    }

    // 4. `unreachable` is 0, so `codByStatus()` drops a row. A fixture with five
    //    non-zero counts would never exercise that branch.
    expect(data.by_status.unreachable).toBe(0);
    const breakdown = codByStatus(data);
    expect(breakdown).toHaveLength(4);
    expect(breakdown.map((row) => row.status)).toEqual([
      "pending",
      "confirmed",
      "rejected",
      "cancelled",
    ]);
  });

  it("serves nothing else under /cod", () => {
    expect(get("/cod").status).toBe(404);
    expect(get("/cod/zzz").status).toBe(404);
    expect(write("POST", "/cod/statistics", {}).status).toBe(404);
  });
});

/**
 * ── The dashboard's one request ──────────────────────────────────────────────
 *
 * Until 2026-08-26 there was no `case "analytics"` in the mock at all, so every
 * `/analytics/*` path answered `rest_no_route` and the dashboard rendered its
 * error state against this harness — always, at every width, in both locales.
 * That is why the route has never been captured.
 *
 * Only `/analytics/overview` is served. The other six stay 404s and are named
 * below rather than left implied.
 */
describe("GET /analytics/overview", () => {
  const overview = (query = "") => parse(overviewReport, get("/analytics/overview", query));

  /**
   * **`range` is the only parameter and it is honoured** — five presets over one
   * shop, measured 2026-08-26. Both halves of this table are load-bearing:
   * `inventory.low_stock` is identical across a 90× window because it is current
   * state under a control that does not move it, and `customers.customers` moves
   * because that control works. A fixture that inverted either would teach a
   * screen the opposite of the truth, so both are asserted in one pass rather
   * than left to two tests that could drift apart.
   */
  it("honours every preset, and moves only the figures the shop moves", () => {
    const measured = [
      // preset       low  customers  placed  shipments  net        days
      ["today", 3, 0, 0, 0, "0.00", 1],
      ["yesterday", 3, 0, 0, 2, "0.00", 1],
      ["7d", 3, 5, 126, 20, "156900.00", 7],
      ["30d", 3, 9, 901, 131, "812200.00", 30],
      ["90d", 3, 9, 901, 131, "812200.00", 90],
    ] as const;

    for (const [preset, low, customers, placed, shipments, net, days] of measured) {
      const { data } = overview(`range=${preset}`);
      expect(data.range.preset, preset).toBe(preset);
      expect(data.range.days, preset).toBe(days);
      expect(data.range.timezone, preset).toBe("+00:00");
      expect(data.inventory.low_stock, preset).toBe(low);
      expect(data.customers.customers, preset).toBe(customers);
      expect(data.orders.placed, preset).toBe(placed);
      expect(data.shipping.shipments, preset).toBe(shipments);
      expect(data.revenue?.net, preset).toBe(net);
    }

    // The two properties said as claims rather than as five rows of a table.
    const lows = measured.map(([preset]) => overview(`range=${preset}`).data.inventory.low_stock);
    expect(new Set(lows), "low_stock is not range-scoped").toEqual(new Set([3]));
    const counts = measured.map(
      ([preset]) => overview(`range=${preset}`).data.customers.customers,
    );
    expect(new Set(counts).size, "customers is range-scoped").toBeGreaterThan(1);

    // And it is the same three rows `/inventory/low-stock` lists, rather than a
    // number tabled beside them that could drift out of agreement with the
    // screen the dashboard card links to.
    expect(parseList(inventoryList, get("/inventory/low-stock")).meta.total).toBe(3);
  });

  /**
   * **The widest preset answers the middle one**, measured identical on every
   * column: this shop holds nothing older than about a month. A screen that
   * treats a wider window as necessarily a larger number is wrong about this
   * shop, and only the fixture can say so.
   */
  it("answers 90d with 30d, which is what the shop does", () => {
    const wide = overview("range=90d").data;
    const middle = overview("range=30d").data;
    expect({ ...wide, range: null }).toEqual({ ...middle, range: null });
    expect(wide.range.days).toBe(90);
  });

  /** No parameters at all is the 30-day default, not an error and not "all time". */
  it("defaults to 30d when range is not sent", () => {
    expect(overview().data.range.preset).toBe("30d");
    expect(JSON.stringify(get("/analytics/overview").body)).toBe(
      JSON.stringify(get("/analytics/overview", "range=30d").body),
    );
  });

  /**
   * **The payload's own invariants**, all of which a screen reads:
   * `by_status` sums to `placed`, the four COUNTED_STATUSES sum to
   * `counted_as_revenue` — which is what makes `countedReconciliation()` able to
   * *prove* its explanation rather than assert it — and the money block's own
   * arithmetic closes.
   */
  it("keeps the invariants the reconciliation and the money block depend on", () => {
    const { data } = overview("range=30d");

    const sum = Object.values(data.orders.by_status).reduce((a, b) => a + b, 0);
    expect(sum).toBe(data.orders.placed);

    const reconciliation = countedReconciliation(data.orders);
    expect(reconciliation.proves, "the four counted statuses must sum exactly").toBe(true);
    expect(reconciliation.counted).toBe(323);

    const revenue = data.revenue;
    expect(revenue).toBeDefined();
    if (revenue === undefined) return;
    expect(revenue.orders_placed).toBe(data.orders.placed);
    expect(revenue.orders_counted).toBe(data.orders.counted_as_revenue);
    expect(Number(revenue.gross) - Number(revenue.refunds)).toBeCloseTo(Number(revenue.net), 2);
    expect(Number(revenue.average_order_value)).toBeCloseTo(
      Number(revenue.gross) / revenue.orders_counted,
      2,
    );
    expect(revenue.refund_count).toBe(data.orders.by_status.refunded);
    expect(revenue.refunded_orders).toBe(data.orders.by_status.refunded);

    // Every rate is its own numerator over its own denominator.
    expect(rateFraction(data.cod.confirmation_rate)).toBeCloseTo(
      data.cod.confirmed_orders / data.cod.total_orders,
      4,
    );
    expect(rateFraction(data.shipping.delivery_rate)).toBeCloseTo(
      data.shipping.delivered / data.shipping.shipments,
      4,
    );

    // The COD block is a strict subset of `/cod/statistics`, measured key for
    // key — derived from it here so the two cannot drift into two answers.
    const { data: statistics } = parse(codStatisticsSchema, get("/cod/statistics"));
    expect(data.cod).toEqual({
      total_orders: statistics.total_orders,
      confirmed_orders: statistics.confirmed_orders,
      confirmation_rate: statistics.rates.confirmation,
      delivery_rate: statistics.rates.delivery,
    });
  });

  /**
   * **`unavailable` is an object of sentences, not a list of names**, and it is
   * the reason `unavailableLines()` exists. The *sentences* are reconstructions
   * — only a fragment of the API's own wording survives anywhere in this repo —
   * so nothing here asserts one. The three keys are what the panel switches on,
   * and they are what is measured.
   */
  it("reports three unavailable lines as reasons rather than as names", () => {
    const revenue = overview("range=30d").data.revenue;
    expect(revenue).toBeDefined();
    const lines = unavailableLines(revenue?.unavailable ?? {});
    expect(lines.map((line) => line.key)).toEqual([...UNAVAILABLE_KEYS]);
    expect(lines.every((line) => line.known)).toBe(true);
    // Sentences, so a screen that renders one renders prose and not a slug.
    expect(lines.every((line) => line.note.length > 40 && line.note.endsWith("."))).toBe(true);

    /*
     * **And `unavailable` sits where the API puts it** — between
     * `average_order_value` and `refund_count`, not appended after the refund
     * counts, which is where a plain spread had left it. Key order is part of
     * the measured shape and this suite already holds the money-blind payload to
     * it, so the money block is held to it too: a screen rendering this block by
     * iterating its entries would otherwise print three prose reasons last.
     */
    expect(Object.keys(revenue ?? {})).toEqual([
      "currency",
      "order_total",
      "orders_placed",
      "orders_counted",
      "gross",
      "discounts",
      "shipping_revenue",
      "tax",
      "refunds",
      "net",
      "collected",
      "average_order_value",
      "unavailable",
      "refund_count",
      "refunded_orders",
    ]);
  });

  /**
   * ── Two error shapes on one route, and both are real ─────────────────────────
   *
   * A bad `range` is the query-parameter enum family and lands in
   * `details.params`; a bad custom window is the body-field family and lands in
   * `details.fields` — on query parameters, from the controller. `ApiError`
   * keeps the two apart, which is the whole reason it exposes both.
   *
   * **The code is asserted beside every sentence.** DECISIONS.md records that
   * all fourteen parameter refusals in this file once answered
   * `rest_invalid_param` — a code no client can receive — and that it survived
   * because every assertion compared only the message.
   */
  it("refuses an unknown range as a parameter, naming all six presets", () => {
    for (const query of ["range=zzz", "range=", "range=400d"]) {
      const refused = apiError(get("/analytics/overview", query));
      expect(refused.status, query).toBe(400);
      expect(refused.code, query).toBe("invalid_request");
      expect(refused.apiMessage, query).toBe("Invalid parameter(s): range");
      expect(refused.params?.range, query).toBe(
        "range is not one of today, yesterday, 7d, 30d, 90d, and custom.",
      );
      // The parameter family, so nothing arrives under `fields`.
      expect(refused.fields, query).toBeNull();
    }

    // Every preset the panel offers is a member, so `RANGE_PRESETS` and the
    // refusal cannot drift apart.
    for (const preset of RANGE_PRESETS.filter((value) => value !== "custom")) {
      expect(get("/analytics/overview", `range=${preset}`).status, preset).toBe(200);
    }
  });

  it("refuses a custom window under fields, with the three measured sentences", () => {
    const refusal = (query: string) => {
      const refused = apiError(get("/analytics/overview", query));
      expect(refused.status, query).toBe(400);
      expect(refused.code, query).toBe("invalid_request");
      expect(refused.apiMessage, query).toBe("The reporting range is invalid.");
      // The field family, so nothing arrives under `params`.
      expect(refused.params, query).toBeNull();
      return refused.fields;
    };

    expect(refusal("range=custom")).toEqual({
      date_from: "Required when range is custom.",
      date_to: "Required when range is custom.",
    });
    expect(refusal("range=custom&date_from=2026-08-01")).toEqual({
      date_to: "Required when range is custom.",
    });
    expect(refusal("range=custom&date_from=2026-08-20&date_to=2026-08-01")).toEqual({
      date_from: "Must not be later than date_to.",
    });
    expect(refusal("range=custom&date_from=2020-01-01&date_to=2026-08-20")).toEqual({
      date_from: "A custom range covers at most 366 days.",
    });

    /*
     * **A `Y-m-d` the calendar does not have is refused rather than served.**
     * `/payments?date_from=2026-13-45` is a measured 200 with 0 rows — the
     * pattern matches and nothing checks the calendar — but this route computes
     * `range.days` from the two dates, and `NaN` serialises as `null`, which
     * `analyticsRange` refuses at the panel's own boundary. A 200 the dashboard
     * throws on is worse than either answer, so it joins the malformed case.
     */
    expect(refusal("range=custom&date_from=2026-13-45&date_to=2026-13-46")).toEqual({
      date_from: "Required when range is custom.",
      date_to: "Required when range is custom.",
    });
    expect(refusal("range=custom&date_from=zzz&date_to=2026-08-20")).toEqual({
      date_from: "Required when range is custom.",
    });

    // Every served custom window carries a finite `days`, which is the property
    // the two refusals above exist to keep true.
    for (const query of [
      "range=custom&date_from=2026-02-30&date_to=2026-03-05",
      "range=custom&date_from=2026-08-01&date_to=2026-08-01",
    ]) {
      expect(Number.isFinite(overview(query).data.range.days), query).toBe(true);
    }

    // The panel's own predicate agrees with the API on all three, which is what
    // lets the picker refuse before the round trip rather than after it.
    expect(customRangeProblem("2026-08-20", "2026-08-01")).toBe("reversed");
    expect(customRangeProblem("2020-01-01", "2026-08-20")).toBe("too-long");
    expect(customRangeProblem("", "2026-08-20")).toBe("missing");
  });

  it("serves a legal custom window, counting its days inclusively", () => {
    const { data } = overview("range=custom&date_from=2026-08-01&date_to=2026-08-20");
    expect(data.range).toEqual({
      preset: "custom",
      from: "2026-08-01",
      to: "2026-08-20",
      days: 20,
      timezone: "+00:00",
    });
    // The cap is inclusive: 366 days is served and 367 is not.
    expect(get("/analytics/overview", "range=custom&date_from=2025-08-19&date_to=2026-08-19").status)
      .toBe(200);
    expect(get("/analytics/overview", "range=custom&date_from=2025-08-18&date_to=2026-08-19").status)
      .toBe(400);
  });

  /**
   * ── The dishonesty this route is reproduced for ──────────────────────────────
   *
   * **`date_from`/`date_to` outside `range=custom` are accepted and ignored**,
   * answering the thirty-day default with a 200. That is the trap
   * `analyticsParams()` is built around: a picker that sent only the two dates
   * would show an operator a ten-day window above thirty days of figures, and
   * nothing anywhere would error. A mock that refused them would hide it.
   *
   * `per_page` is in the same set and is the quieter half — this route returns
   * one object rather than a page, so `paginate()` is deliberately not called
   * and `per_page=abc` is **not** the 400 every collection answers.
   */
  it("accepts and ignores every parameter but range", () => {
    const thirty = JSON.stringify(get("/analytics/overview", "range=30d").body);
    for (const query of [
      "bogus_param=1",
      "per_page=5",
      "per_page=abc",
      "page=0",
      "orderby=id",
      "date_from=2026-08-01&date_to=2026-08-10",
      "range=30d&date_from=2026-08-01&date_to=2026-08-10",
      "range=7d&date_from=2026-08-01&date_to=2026-08-10&per_page=5",
    ]) {
      const response = get("/analytics/overview", query);
      expect(response.status, query).toBe(200);
      if (!query.startsWith("range=7d")) {
        expect(JSON.stringify(response.body), query).toBe(thirty);
      }
    }
    // The 7d row above still answers 7d: the dates are ignored, the preset is not.
    expect(overview("range=7d&date_from=2026-08-01&date_to=2026-08-10").data.range.preset).toBe(
      "7d",
    );

    // What `analyticsParams()` actually sends, for each preset the panel offers.
    for (const preset of RANGE_PRESETS.filter((value) => value !== "custom")) {
      const query = new URLSearchParams(
        analyticsParams({ preset, from: "", to: "" }),
      ).toString();
      expect(get("/analytics/overview", query).status, preset).toBe(200);
    }
  });

  /**
   * **`generated_at` is pinned by a 60-second server cache** — two live requests
   * six seconds apart returned the identical stamp, and `meta.cache_ttl` reports
   * the window. That is what lets a Server Component's figures be up to a minute
   * older than the navigation that fetched them, which is why the dashboard
   * prints the stamp at all: a screen must never read a fresh stamp as proof of
   * a fresh request.
   */
  it("pins generated_at and reports the cache that pins it", () => {
    // `meta` here is a report's, not a list's — `parse()` hands it back exactly
    // as the panel's `acFetch` does, which is where the dashboard reads it.
    const meta = (query = "") =>
      overview(query).meta as Record<string, unknown> & { generated_at?: unknown };

    const first = meta();
    expect(first.cache_ttl).toBe(60);
    expect(first.money_requires).toBe("ac_manage_orders");
    expect(first.money_visible).toBe(true);
    expect(typeof first.generated_at).toBe("string");
    expect(first.generated_at).toMatch(/\+00:00$/);
    // Unmoved across requests and across ranges: the stamp is the cache's, not
    // the request's.
    expect(meta("range=7d").generated_at).toBe(first.generated_at);
    expect(meta("range=today").generated_at).toBe(first.generated_at);
  });

  it("serves no other verb and no other path under /analytics", () => {
    expect(get("/analytics").status).toBe(404);
    expect(get("/analytics/overview/zzz").status).toBe(404);
    expect(write("POST", "/analytics/overview", {}).status).toBe(404);
  });
});

/**
 * ── The other six, which the `/analytics` screen reads one at a time ─────────
 *
 * Measured 2026-08-26 against the live shop, payload by payload. Until then all
 * six answered `rest_no_route`, so `/analytics` had never been captured at any
 * width, theme or locale — every screenshot of it would have been a photograph of
 * `ErrorState`, and there are none.
 *
 * The overview's suite above owns what the seven share: the range enum, the two
 * error families, the custom window's four refusals, the ignored parameters and
 * the pinned stamp. This one owns what is true of a report and not of the
 * dashboard — the payload shapes, the fixture variety each screen needs, and the
 * arithmetic that has to close *across* the six rather than inside one.
 */
describe("the six analytics reports", () => {
  const REPORTS = ["revenue", "orders", "products", "customers", "shipping", "cod"] as const;
  const ask = (view: string, query = "range=30d") => get(`/analytics/${view}`, query);

  const revenue = (query = "range=30d") => parse(revenueReport, ask("revenue", query)).data;
  const orders = (query = "range=30d") => parse(ordersReport, ask("orders", query)).data;
  const products = (query = "range=30d") => parse(productsReport, ask("products", query)).data;
  const customers = (query = "range=30d") => parse(customersReport, ask("customers", query)).data;
  const shipping = (query = "range=30d") => parse(shippingReport, ask("shipping", query)).data;
  const cod = (query = "range=30d") => parse(codReport, ask("cod", query)).data;

  /**
   * Every report parses through the panel's own schema, and the headline figure
   * of each is the measured one. Six parses in one pass rather than six tests,
   * because the thing being checked is that the *set* is served — a report that
   * regressed to a 404 is the failure this catches, and it should read as one
   * failure and not as one of six.
   */
  it("serves all six at the default window, through the panel's own schemas", () => {
    for (const view of REPORTS) expect(ask(view).status, view).toBe(200);

    expect(revenue().net).toBe("812200.00");
    expect(orders().placed).toBe(901);
    expect(products().best_sellers).toHaveLength(10);
    expect(customers().customers).toBe(9);
    expect(shipping().shipments.total).toBe(131);
    expect(cod().total_orders).toBe(599);

    // Every one of them echoes the window it describes, which is what
    // `AnalyticsScreen` renders rather than the picker's own state.
    for (const view of REPORTS) {
      const body = ask(view).body as { data: { range: { preset: string; days: number } } };
      expect(body.data.range.preset, view).toBe("30d");
      expect(body.data.range.days, view).toBe(30);
    }
  });

  /**
   * ── The zero window, and it is a shape rather than an absence ────────────────
   *
   * `range=today` is a **200 on all six with every block present**, and the exact
   * key set each one returns was measured. Nothing is omitted, so a screen cannot
   * detect the empty window by a missing key — `isEmptyWindow()` reads a headline
   * count instead, and this is what keeps that branch reachable here.
   */
  it("keeps every block present at range=today, with every figure zero", () => {
    const KEYS: Record<string, string[]> = {
      revenue: [
        "range", "currency", "order_total", "orders_placed", "orders_counted", "gross",
        "discounts", "shipping_revenue", "tax", "refunds", "net", "collected",
        "average_order_value", "unavailable", "refund_count", "refunded_orders",
      ],
      orders: [
        "range", "placed", "by_status", "cancelled", "completed", "refunded", "guest_orders",
        "counted_as_revenue", "average_order_value", "currency",
      ],
      products: ["range", "best_sellers", "best_sellers_limit", "low_stock"],
      customers: ["range", "customers", "new", "returning", "guest_orders", "rates"],
      shipping: [
        "range", "shipments", "rates", "providers", "unavailable", "by_wilaya", "unattributed",
        "shipping_revenue", "currency",
      ],
      cod: [
        "range", "total_orders", "by_status", "confirmed_orders", "delivered_orders",
        "returned_orders", "rates",
      ],
    };

    for (const view of REPORTS) {
      const response = ask(view, "range=today");
      expect(response.status, view).toBe(200);
      expect(Object.keys((response.body as { data: object }).data), view).toEqual(KEYS[view]);
    }

    /*
     * Every count `0`, every list `[]`, every rate `"0.0000"`. Walked rather
     * than listed, because the point is that *nothing* survives the empty
     * window with a stale figure in it — a hand-written list would check the
     * keys somebody thought of.
     */
    const allZero = (value: unknown): boolean =>
      typeof value === "number"
        ? value === 0
        : Array.isArray(value)
          ? value.length === 0
          : typeof value === "object" && value !== null
            ? Object.values(value).every(allZero)
            : true;

    for (const view of ["revenue", "orders", "customers", "shipping", "cod"] as const) {
      const { range, ...rest } = (ask(view, "range=today").body as { data: Record<string, unknown> })
        .data;
      expect(range, view).toBeDefined();
      expect(allZero(rest), `${view} carries a non-zero figure in an empty window`).toBe(true);
    }

    // And the money strings are zeros rather than empty, which is a different
    // answer and the one `formatMoney` can render.
    const empty = revenue("range=today");
    expect([empty.gross, empty.net, empty.collected, empty.average_order_value]).toEqual([
      "0.00", "0.00", "0.00", "0.00",
    ]);
    expect(Object.values(shipping("range=today").rates)).toEqual(["0.0000", "0.0000"]);
    expect(Object.values(cod("range=today").rates)).toEqual([
      "0.0000", "0.0000", "0.0000", "0.0000", "0.0000",
    ]);

    /*
     * **`products` is the exception and it is the whole reason it is one.** Its
     * `best_sellers` empties like everything else, but `low_stock` is current
     * state under a range control that does not move it — measured
     * `{"products":3}` at today, 7d, 30d and 90d alike — and
     * `best_sellers_limit` is configuration rather than a figure. A screen that
     * replaced this report with "nothing happened in this window" would hide a
     * number that is true right now, which is why `AnalyticsScreen` leaves
     * `products` out of its empty-window list.
     */
    const quiet = products("range=today");
    expect(quiet.best_sellers).toEqual([]);
    expect(quiet.best_sellers_limit).toBe(10);
    expect(quiet.low_stock.products).toBe(3);
  });

  /**
   * **All six are range-scoped**, measured across a 90× window. A report that
   * answered the same bytes for a day and for a quarter would be a control that
   * does nothing, and the only place that can be caught is here.
   */
  it("scopes every report to its window", () => {
    for (const view of REPORTS) {
      const narrow = JSON.stringify((ask(view, "range=today").body as { data: unknown }).data);
      const wide = JSON.stringify((ask(view, "range=90d").body as { data: unknown }).data);
      expect(narrow, `${view} is identical across a 90x window`).not.toBe(wide);
    }

    // And the one figure inside a scoped report that is deliberately *not*
    // scoped, which is the pair that makes the control legible.
    const lows = ["today", "yesterday", "7d", "30d", "90d"].map(
      (preset) => products(`range=${preset}`).low_stock.products,
    );
    expect(new Set(lows), "low_stock is not range-scoped").toEqual(new Set([3]));
    expect(parseList(inventoryList, get("/inventory/low-stock")).meta.total).toBe(3);
  });

  /**
   * ── The arithmetic that has to close across reports, not only inside one ────
   *
   * The same shop described six ways. A report that disagrees with the dashboard
   * above it does not teach a reader that one number is wrong — it teaches them
   * the panel is broken. Asserted against the *served payloads* rather than
   * against the fixture table, so a future edit that breaks the agreement in one
   * place cannot pass by being consistent with itself.
   */
  it("tells one story across the six and the overview", () => {
    const money = revenue();
    const activity = orders();
    const parcels = shipping();
    const overview = parse(overviewReport, get("/analytics/overview", "range=30d")).data;

    // 1. Refunds are one number wearing three names.
    expect(money.refund_count).toBe(activity.by_status.refunded);
    expect(money.refunded_orders).toBe(activity.by_status.refunded);
    expect(activity.refunded).toBe(activity.by_status.refunded);

    // 2. The two order counts, and the reconciliation that explains the gap.
    expect(money.orders_placed).toBe(activity.placed);
    expect(money.orders_counted).toBe(activity.counted_as_revenue);
    expect(Object.values(activity.by_status).reduce((a, b) => a + b, 0)).toBe(activity.placed);
    const proof = countedReconciliation(activity);
    expect(proof.proves, "the four counted statuses must sum exactly").toBe(true);
    expect(proof.included.map((row) => row.status).sort()).toEqual(
      [...COUNTED_STATUSES].filter((s) => (activity.by_status[s] ?? 0) > 0).sort(),
    );

    // 3. The orders report's money keys are the revenue report's own.
    expect(activity.average_order_value).toBe(money.average_order_value);
    expect(activity.currency).toBe(money.currency);
    expect(activity.currency).toBe(parcels.currency);
    expect(parcels.shipping_revenue).toBe(money.shipping_revenue);

    // 4. Low stock is one count in three places, and none of them is tabled.
    expect(products().low_stock.products).toBe(overview.inventory.low_stock);
    expect(products().low_stock.products).toBe(
      parseList(inventoryList, get("/inventory/low-stock")).meta.total,
    );

    // 5. `/analytics/cod` is `/cod/statistics` with a range on it, and the
    //    overview's four keys are a strict subset of that.
    const { range, ...statistics } = cod();
    expect(range.preset).toBe("30d");
    expect(statistics).toEqual(parse(codStatisticsSchema, get("/cod/statistics")).data);
    expect(overview.cod).toEqual({
      total_orders: statistics.total_orders,
      confirmed_orders: statistics.confirmed_orders,
      confirmation_rate: statistics.rates.confirmation,
      delivery_rate: statistics.rates.delivery,
    });
    // And the pair inside it that looks like one number and is two: the shop
    // now, against every order ever confirmed.
    expect(statistics.by_status.confirmed).not.toBe(statistics.confirmed_orders);

    // 6. The overview's shipping block is this report's, four keys of it.
    expect(overview.shipping).toEqual({
      shipments: parcels.shipments.total,
      delivered: parcels.shipments.by_status.delivered,
      live: parcels.shipments.live,
      delivery_rate: parcels.rates.delivery,
    });

    /*
     * 7. **The geography reconciles to the money.** Derived from the measured
     *    payloads rather than stated by them: the attributed wilayas plus the
     *    unattributed slice are `orders_counted` orders and `gross` dinars. It is
     *    why the third wilaya row in the fixture is carved out of the
     *    unattributed slice rather than added beside it.
     */
    const slices = [...parcels.by_wilaya, parcels.unattributed];
    expect(slices.reduce((sum, row) => sum + row.orders, 0)).toBe(money.orders_counted);
    expect(slices.reduce((sum, row) => sum + Number(row.revenue), 0)).toBeCloseTo(
      Number(money.gross),
      2,
    );

    /*
     * And **the one identity that must not hold.** `customers.guest_orders`
     * counts the orders the customer report could attribute to nobody;
     * `orders.guest_orders` counts guest orders in the window. Two questions,
     * one name, measured 209 against 422 in a single window — and a fixture that
     * made them agree would delete the reason the customers report exists.
     */
    expect(customers().guest_orders).not.toBe(activity.guest_orders);
    expect([customers().guest_orders, activity.guest_orders]).toEqual([209, 422]);
    expect(customers().new + customers().returning).toBe(customers().customers);
  });

  /**
   * Each report's own invariants, the ones a screen reads directly: the status
   * breakdowns sum to their totals, and every rate is its own numerator over its
   * own denominator to four places.
   */
  it("keeps each report's own breakdown summing and its own rates dividing", () => {
    const parcels = shipping();
    expect(
      statusCounts(parcels.shipments.by_status, SHIPMENT_STATUSES).reduce(
        (sum, row) => sum + row.count,
        0,
      ),
    ).toBe(parcels.shipments.total);
    expect(rateFraction(parcels.rates.delivery)).toBeCloseTo(
      parcels.shipments.by_status.delivered / parcels.shipments.total,
      4,
    );

    // Column by column, the couriers sum to the shop. Two providers, so both the
    // empty branch (`range=today`) and the populated one are reachable, and one
    // window has exactly one courier.
    for (const column of ["shipments", "delivered", "returned", "cancelled", "failed"] as const) {
      const total = parcels.providers.reduce((sum, row) => sum + row[column], 0);
      const expected =
        column === "shipments"
          ? parcels.shipments.total
          : (parcels.shipments.by_status[column] ?? 0);
      expect(total, column).toBe(expected);
    }
    for (const provider of parcels.providers) {
      expect(rateFraction(provider.rates.delivery), provider.provider).toBeCloseTo(
        provider.delivered / provider.shipments,
        4,
      );
    }
    expect(shipping("range=today").providers).toEqual([]);
    expect(shipping("range=yesterday").providers).toHaveLength(1);

    const statistics = cod();
    expect(Object.values(statistics.by_status).reduce((a, b) => a + b, 0)).toBe(
      statistics.total_orders,
    );
    for (const [key, numerator] of [
      ["confirmation", statistics.confirmed_orders],
      ["rejection", statistics.by_status.rejected],
      ["cancellation", statistics.by_status.cancelled],
      ["delivery", statistics.delivered_orders],
      ["return", statistics.returned_orders],
    ] as const) {
      expect(rateFraction(statistics.rates[key]), key).toBeCloseTo(
        numerator / statistics.total_orders,
        4,
      );
    }

    const money = revenue();
    expect(Number(money.gross) - Number(money.refunds)).toBeCloseTo(Number(money.net), 2);
    expect(Number(money.average_order_value)).toBeCloseTo(
      Number(money.gross) / money.orders_counted,
      2,
    );

    const people = customers();
    expect(rateFraction(people.rates.new)).toBeCloseTo(people.new / people.customers, 4);
    expect(rateFraction(people.rates.returning)).toBeCloseTo(
      people.returning / people.customers,
      4,
    );
  });

  /**
   * ── The geography, which is mostly one row and says so ──────────────────────
   *
   * Three named wilayas, each bilingual, and an unattributed slice larger than
   * all three put together. Two of the three are measured; the third is
   * invention, carved out of the unattributed slice so the reconciliation above
   * survives — a two-row chart proves nothing about ranking or about a third
   * label at 340px, which is the lesson shipping and payments both paid for.
   */
  it("ranks the unattributed slice as a labelled row above every named wilaya", () => {
    const parcels = shipping();
    expect(parcels.by_wilaya.length).toBeGreaterThanOrEqual(3);
    expect(parcels.by_wilaya.every((row) => row.name !== "" && row.name_ar !== "")).toBe(true);

    const named = parcels.by_wilaya.reduce((sum, row) => sum + row.orders, 0);
    expect(parcels.unattributed.orders).toBeGreaterThan(named);
    // In English, from the API, which is why `ShippingView` renders its own line
    // rather than this sentence.
    expect(parcels.unattributed.reason).toMatch(/free text/);

    const slices = wilayaSlices(parcels);
    expect(slices[0]?.kind).toBe("unattributed");
    expect(slices.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 6);

    // The window where nothing is attributed at all: parcels moved for orders
    // placed before it, so the row `wilayaSlices()` filters out is reachable.
    const idle = shipping("range=yesterday");
    expect(idle.by_wilaya).toEqual([]);
    expect(idle.shipments.total).toBe(2);
    expect(wilayaSlices(idle)).toEqual([]);
  });

  /**
   * ── The best sellers, and the limit that is not a knob ──────────────────────
   *
   * The measured units spread is reproduced; the products it hangs on are this
   * fixture's, because every row of this report is a link to `/products/{id}` and
   * ten ids that 404 would be the harness disagreeing with itself. So the
   * agreement is asserted rather than assumed: each id resolves, each name is the
   * catalogue's own, and each `revenue` is units × that product's price.
   */
  it("hangs best_sellers on catalogue rows, priced from them", () => {
    for (const row of products().best_sellers) {
      const listing = parse(product, get(`/products/${row.product_id}`)).data;
      expect(listing.name, String(row.product_id)).toBe(row.name);
      expect(Number(row.revenue), String(row.product_id)).toBeCloseTo(
        row.units * Number(listing.price),
        2,
      );
    }

    // Ranked descending by units, which is what makes it a best-seller list.
    const units = products().best_sellers.map((row) => row.units);
    expect([...units].sort((a, b) => b - a)).toEqual(units);
    // And the top ten do not out-sell the window they are drawn from.
    const drawn = products().best_sellers.reduce((sum, row) => sum + Number(row.revenue), 0);
    expect(drawn).toBeLessThanOrEqual(Number(revenue().gross));
  });

  /**
   * **`best_sellers_limit` is a published constant, not a control.** Measured at
   * `range=90d`: `limit=3`, `per_page=3` and `best_sellers_limit=3` each return
   * ten rows with `10` beside them. So no screen may ship a "show more" — there
   * is nothing to ask for, and the number is there to be *stated*.
   */
  it("publishes the best-seller cut-off and refuses to be moved off it", () => {
    for (const query of ["range=90d", "range=90d&limit=3", "range=90d&per_page=3", "range=90d&best_sellers_limit=3"]) {
      const report = products(query);
      expect(report.best_sellers, query).toHaveLength(10);
      expect(report.best_sellers_limit, query).toBe(10);
    }
  });

  /**
   * ── Both branches of `hasRankingSignal()`, which is why `narrow` exists ─────
   *
   * A window with sales returns a spread and the bars carry it. A window without
   * returns `[]`, which is the *empty* branch. The third rendering — every row
   * tied, drawn as a plain list of counts because four identical full-length bars
   * would imply a ranking that does not exist — had **no reachable window at
   * all**, at any preset, because this shop has no small non-zero day.
   *
   * So it lives on a two-day custom window, in the one part of these routes that
   * is already declared invention: `bucketFor()`, which until now sent two days
   * to the *seven*-day table. That is the same dishonesty one step smaller, and
   * closing it is what makes the branch reachable.
   */
  it("reaches the ranked, the flat and the empty best-seller renderings", () => {
    const ranked = products("range=30d").best_sellers.map((row) => row.units);
    expect(hasRankingSignal(ranked)).toBe(true);
    // A tie inside a ranked set, which draws two equal bars in a chart that still
    // has a ranking — a different picture from the flat set below.
    expect(new Set(ranked).size).toBeLessThan(ranked.length);

    const flat = products("range=custom&date_from=2026-08-10&date_to=2026-08-11").best_sellers;
    expect(flat.length).toBeGreaterThan(1);
    expect(hasRankingSignal(flat.map((row) => row.units))).toBe(false);

    expect(products("range=today").best_sellers).toEqual([]);
    expect(hasRankingSignal([])).toBe(false);

    /*
     * The rest of that window, so the flat list is not a screen sitting on top of
     * figures nothing else agrees with. Two branches live here and nowhere else:
     * a non-zero `returning` rate — every measured window is 1.0000 / 0.0000 —
     * and a non-zero return rate on parcels.
     */
    const narrow = "range=custom&date_from=2026-08-10&date_to=2026-08-11";
    expect(customers(narrow).returning).toBe(1);
    expect(customers(narrow).rates.returning).toBe("0.5000");
    expect(shipping(narrow).rates.return).toBe("0.5000");
    expect(shipping(narrow).unattributed.orders).toBe(0);
    expect(countedReconciliation(orders(narrow)).proves).toBe(true);
  });

  /**
   * The same window reader as the overview, so the same two error families and
   * the same silently-ignored parameters. Asserted on a report route rather than
   * inferred from the overview's suite: they are separate handlers, and "they
   * share a helper" is exactly the kind of claim that stops being true quietly.
   */
  it("accepts and ignores every parameter but range, on a report route", () => {
    const bare = JSON.stringify(ask("orders", "range=30d").body);
    for (const query of [
      "range=30d&bogus_param=1",
      "range=30d&per_page=5",
      "range=30d&orderby=id",
      "range=30d&limit=3",
      "range=30d&date_from=2026-01-01",
      // The paging refusals every collection answers are **not** answered here.
      // `paginate()` is not called: this route returns one object, not a page.
      "range=30d&per_page=abc",
      "range=30d&page=0",
    ]) {
      const response = ask("orders", query);
      expect(response.status, query).toBe(200);
      expect(JSON.stringify(response.body), query).toBe(bare);
    }
  });

  it("refuses a bad window on every report, in the same two families", () => {
    for (const view of REPORTS) {
      const enumeration = apiError(ask(view, "range=zzz"));
      expect(enumeration.status, view).toBe(400);
      expect(enumeration.params?.range, view).toBe(
        "range is not one of today, yesterday, 7d, 30d, 90d, and custom.",
      );
      expect(enumeration.fields, view).toBeNull();

      const window = apiError(ask(view, "range=custom"));
      expect(window.apiMessage, view).toBe("The reporting range is invalid.");
      expect(window.fields, view).toEqual({
        date_from: "Required when range is custom.",
        date_to: "Required when range is custom.",
      });
      expect(window.params, view).toBeNull();

      // No parameters at all is the 30-day default on every one of them.
      expect(JSON.stringify(ask(view, "").body), view).toBe(
        JSON.stringify(ask(view, "range=30d").body),
      );
    }

    // Every preset the panel offers is served by every report, so `RANGE_PRESETS`
    // and these six cannot drift apart.
    for (const view of REPORTS) {
      for (const preset of RANGE_PRESETS.filter((value) => value !== "custom")) {
        const query = new URLSearchParams(analyticsParams({ preset, from: "", to: "" })).toString();
        expect(ask(view, query).status, `${view} ${preset}`).toBe(200);
      }
    }
  });

  /**
   * `unavailable` is the revenue report's three and the shipping report's one,
   * out of one object rather than two copies of a sentence. The *sentences* are
   * the measured wording as of 2026-08-26 — they were reconstructions until the
   * revenue payload was captured — and nothing here asserts one, because the
   * panel localises by key and only falls back to the API's text.
   */
  it("reports what cannot be known as reasons rather than as names", () => {
    expect(unavailableLines(revenue().unavailable).map((line) => line.key)).toEqual([
      ...UNAVAILABLE_KEYS,
    ]);

    const only = unavailableLines(shipping().unavailable);
    expect(only.map((line) => line.key)).toEqual(["shipping_cost"]);
    expect(only[0]?.known).toBe(true);
    expect(only[0]?.note).toBe(revenue().unavailable.shipping_cost);
    expect(only.every((line) => line.note.length > 40 && line.note.endsWith("."))).toBe(true);
  });

  it("carries the same meta on all six as the overview carries", () => {
    for (const view of REPORTS) {
      const { meta } = parse(z.looseObject({}), ask(view));
      expect(meta, view).toEqual({
        generated_at: "2026-08-18T02:52:22+00:00",
        cache_ttl: 60,
        money_visible: true,
        money_requires: "ac_manage_orders",
      });
    }
  });

  it("serves no other report, no other depth and no other verb", () => {
    // A name nobody wrote, and two inherited properties that must not resolve
    // through the handler table.
    for (const path of ["/analytics/traffic", "/analytics/toString", "/analytics/constructor"]) {
      expect(get(path).status, path).toBe(404);
    }
    expect(get("/analytics/orders/1").status).toBe(404);
    expect(write("POST", "/analytics/orders", {}).status).toBe(404);
    expect(write("PATCH", "/analytics/revenue", {}).status).toBe(404);
  });

  /**
   * ── The money gate, which is two shapes on one surface ──────────────────────
   *
   * Measured 2026-08-26 with a real Support Agent credential —
   * `ac_view_analytics` without `ac_manage_orders`:
   *
   *     /analytics/revenue    403 forbidden, the only 403 on this whole surface
   *     the other five        200, with every money key **gone**, nested included
   *
   * The five 200s are the half a schema cannot catch: every money field in
   * `lib/api/schemas/analytics.ts` is `.optional()`, so a fixture that answered
   * `"0.00"` here would parse cleanly and teach a screen that a Support Agent
   * sees a shop which sold nothing.
   */
  it("refuses the revenue report outright and strips money from the other five", async () => {
    vi.stubEnv("MOCK_IDENTITY", "support");
    try {
      vi.resetModules();
      const mock = await import("@/scripts/mock-api.mjs");
      const gated = (view: string) =>
        mock.respond("GET", `${mock.BASE_PATH}/analytics/${view}`, new URLSearchParams("range=30d"));

      const refused = gated("revenue");
      expect(refused.status).toBe(403);
      expect((refused.body as { error: { code: string; message: string } }).error).toEqual({
        code: "forbidden",
        message: "You are not allowed to perform this action.",
      });

      /*
       * The seven keys the schemas record as money, swept for anywhere in the
       * payload rather than checked at the top level: `best_sellers[].revenue`
       * and `by_wilaya[].revenue` are one level down, and a fixture that stripped
       * only the outer ones would look correct in a key-set assertion.
       */
      const MONEY = ["revenue", "currency", "average_order_value", "shipping_revenue"];
      const found = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.flatMap(found)
          : typeof value === "object" && value !== null
            ? Object.entries(value).flatMap(([key, inner]) =>
                MONEY.includes(key) ? [key, ...found(inner)] : found(inner),
              )
            : [];

      for (const view of ["orders", "products", "customers", "shipping", "cod"]) {
        const response = gated(view);
        expect(response.status, view).toBe(200);
        const { data, meta } = unwrap(z.looseObject({}), response.body, 200);
        expect(found(data), `${view} still carries a money key`).toEqual([]);
        expect(meta?.money_visible, view).toBe(false);
        expect(meta?.money_requires, view).toBe("ac_manage_orders");
      }

      /*
       * **Omitted, not nulled and not zeroed**, and the counts beside them are
       * untouched — which is what lets the five screens render complete rather
       * than with holes in them.
       */
      const parcels = unwrap(shippingReport, gated("shipping").body, 200).data;
      expect(parcels).not.toHaveProperty("shipping_revenue");
      expect(parcels).not.toHaveProperty("currency");
      expect(parcels.unattributed).not.toHaveProperty("revenue");
      expect(Object.keys(parcels.unattributed)).toEqual(["orders", "reason"]);
      expect(parcels.by_wilaya.every((row) => !("revenue" in row))).toBe(true);
      expect(parcels.shipments.total).toBe(131);
      expect(parcels.unattributed.orders).toBe(263);

      const activity = unwrap(ordersReport, gated("orders").body, 200).data;
      expect(activity.average_order_value).toBeUndefined();
      expect(activity.currency).toBeUndefined();
      expect(activity.placed).toBe(901);
      expect(countedReconciliation(activity).proves).toBe(true);

      const catalogue = unwrap(productsReport, gated("products").body, 200).data;
      expect(catalogue.best_sellers).toHaveLength(10);
      expect(catalogue.best_sellers.every((row) => row.revenue === undefined)).toBe(true);
      expect(catalogue.low_stock.products).toBe(3);

      /*
       * And the two reports with no money key at all are **byte-identical** for
       * both credentials, which is the honest reproduction: the gate takes keys
       * away, it does not change answers.
       */
      for (const view of ["customers", "cod"]) {
        expect(JSON.stringify((gated(view).body as { data: unknown }).data), view).toBe(
          JSON.stringify((ask(view).body as { data: unknown }).data),
        );
      }
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("the shipment writes", () => {
  it("moves a live parcel anywhere, and recomputes is_live from the status", () => {
    /*
     * **Backwards is legal while live**, re-measured 2026-08-25 on parcel 258:
     * `{"status":"in_transit"}` 200, then `{"status":"pending"}` 200. A courier
     * reports what it reports, sometimes late and out of order, and refusing a
     * status to defend a diagram would put the shop's record at odds with the
     * physical world — so there is no transition matrix here, only `is_live`.
     */
    const forward = parse(
      shipmentSchema,
      write("PATCH", "/shipments/7014", { status: "in_transit" }),
    ).data;
    expect(forward.status).toBe("in_transit");

    const back = parse(shipmentSchema, write("PATCH", "/shipments/7014", { status: "pending" }))
      .data;
    expect(back.status).toBe("pending");
    expect(back.is_live).toBe(true);

    // Every live→live move, not a curated few: a matrix would show up here as
    // one of the ten being refused.
    for (const status of SHIPMENT_STATUSES.filter((value) => !isTerminalShipmentStatus(value))) {
      expect(write("PATCH", "/shipments/7014", { status }).status, status).toBe(200);
    }

    const done = parse(shipmentSchema, write("PATCH", "/shipments/7014", { status: "delivered" }))
      .data;
    expect(done.is_live).toBe(false);
    // And the collection reads it back, which is what a screen that writes and
    // refetches depends on.
    expect(parse(shipmentSchema, get("/shipments/7014")).data.status).toBe("delivered");
  });

  /**
   * **This is where a shipment breaks the rule coupons and products share.**
   *
   * A coupon or a product takes its own GET body back and drops the read-only
   * keys without comment. A shipment refuses every key it does not own, so
   * sending its GET body back is a 400 naming nine fields — which is why
   * `ParcelDrawer` sends `{status}` alone out of requirement rather than
   * caution.
   */
  it("rejects unknown keys rather than dropping them, unlike coupons", () => {
    for (const [key, body] of [
      ["zzz", { zzz: 1 }],
      ["provider", { provider: "acfake" }],
      ["tracking_number", { tracking_number: "AC1" }],
    ] as const) {
      const error = refusedWith(write("PATCH", "/shipments/7014", body), 400, "invalid_request");
      expect(error.apiMessage).toBe("The shipment data is invalid.");
      expect(error.fields?.[key]).toBe("Unknown field.");
    }

    // The whole GET row back is therefore a 400 here and a 200 on a rule.
    const row = parse(shipmentSchema, get("/shipments/7014")).data;
    expect(write("PATCH", "/shipments/7014", row).status).toBe(400);
    expect(write("PATCH", "/shipping/rules/164", get("/shipping/rules").body).status).toBe(400);

    // The **body-field** enum family, which is not the query-parameter family
    // `?status=zzz` answers one route away: colon, no Oxford comma, no `and`.
    const bad = refusedWith(
      write("PATCH", "/shipments/7014", { status: "zzz" }),
      400,
      "invalid_request",
    );
    expect(bad.fields?.status).toBe(`Must be one of: ${SHIPMENT_STATUSES.join(", ")}.`);
    expect(bad.fields?.status).not.toContain(" and ");

    // An empty body asks for a status rather than answering the rules
    // collection's "No supported fields were provided."
    expect(refusedWith(write("PATCH", "/shipments/7014", {}), 400, "invalid_request").fields)
      .toEqual({ status: "Required." });
  });

  it("refuses a terminal move with the quoted statuses and no allowed list", () => {
    const error = refusedWith(
      write("PATCH", "/shipments/7023", { status: "in_transit" }),
      409,
      "conflict",
    );
    // The quotes are literal, and `{from, to, is_live}` is the whole body —
    // this is the one refusal in the panel that cannot be rendered as "here is
    // what is legal", which is why the picker is hidden rather than offered.
    expect(error.apiMessage).toBe('This shipment cannot move from "delivered" to "in_transit".');
    expect(error.details).toEqual({ from: "delivered", to: "in_transit", is_live: false });
    expect(error.conflict?.allowed).toBeUndefined();
  });

  /**
   * **Sync answers 200 on the parcel you would not sync and refuses the one you
   * would**, which is confusing on the server's side rather than the panel's.
   *
   * **Both arms are measured 2026-08-25** — the live one on parcel 258, created
   * against order 4586 for exactly this and cancelled afterwards.
   *
   * The consequence is worth stating as an assertion rather than a note: on
   * this shop **sync can never succeed**, because `manual` is the only provider
   * `/shipping/providers` returns and a manual parcel is either live (refused)
   * or finished (a 200 that changes nothing).
   */
  it("syncs a terminal parcel to a 200 unchanged and refuses a live one", () => {
    const before = parse(shipmentSchema, get("/shipments/7023")).data;
    const after = parse(shipmentSchema, write("POST", "/shipments/7023/sync")).data;
    expect(after).toEqual(before);

    const error = apiError(write("POST", "/shipments/7014/sync"));
    expect(error.status).toBe(409);
    expect(error.apiMessage).toBe(
      "In-house delivery reports no status of its own; update this shipment directly.",
    );
    // The sentence quotes the provider's **label**, not its slug, so it is
    // built from the providers row rather than written out.
    const provider = parse(shippingProviders, get("/shipping/providers")).data[0];
    expect(error.apiMessage.startsWith(provider.label)).toBe(true);

    /*
     * **`sync_unsupported` is real and now measured**, and it is the fifth wire
     * code. `ErrorNormalizer.php:31-32` rewrites `rest_invalid_param` and
     * `rest_missing_callback_param` — WordPress's own **parameter** codes — and
     * leaves a domain code raised by a controller alone. So DECISIONS.md's four
     * are the four a *parameter* refusal can carry, and this 409 is not one.
     */
    expect(error.code).toBe("sync_unsupported");
    expect(WIRE_CODES).not.toContain(error.code);

    // Neither state can move the parcel, which is the whole answer for this
    // provider: refused while live, a no-op once finished.
    write("POST", "/shipments/7014/cancel");
    expect(parse(shipmentSchema, write("POST", "/shipments/7014/sync")).data.status).toBe(
      "cancelled",
    );
  });

  it("cancels a live parcel, and a cancelled parcel then refuses everything", () => {
    const cancelled = parse(shipmentSchema, write("POST", "/shipments/7014/cancel")).data;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.is_live).toBe(false);

    // A second cancel is the finished refusal, and the parcel is now terminal
    // for the other two writes as well.
    expect(refusedWith(write("POST", "/shipments/7014/cancel"), 409, "conflict").details).toEqual(
      { status: "cancelled" },
    );
    expect(write("PATCH", "/shipments/7014", { status: "pending" }).status).toBe(409);
    expect(write("POST", "/shipments/7014/sync").status).toBe(200);
  });

  /**
   * **The sweep DECISIONS.md asks for**: every refusal this section can produce,
   * checked for a code a client can actually receive. Fourteen refusals once
   * carried `rest_invalid_param` — a code `ErrorNormalizer` rewrites on the way
   * out — and it survived because no assertion anywhere compared a code.
   */
  it("answers every shipping refusal with a code a client can receive", () => {
    const refusals: MockResponse[] = [
      get("/shipments", "status=zzz"),
      get("/shipments/999999"),
      get("/shipping/rates"),
      get("/shipping/rates", "wilaya_id=16"),
      get("/shipping/rules", "per_page=101"),
      write("POST", "/shipping/rules", {}),
      write("POST", "/shipping/rules", { amount: "abc" }),
      write("PATCH", "/shipping/rules/164", {}),
      write("PATCH", "/shipping/rules/164", { zzz: 1 }),
      write("DELETE", "/shipping/rules/999"),
      write("PATCH", "/shipments/7014", { zzz: 1 }),
      write("PATCH", "/shipments/7023", { status: "pending" }),
      write("POST", "/shipments/7023/cancel"),
      write("POST", "/orders/1014/shipments", { wilaya_id: 16, commune_id: 484 }),
    ];

    for (const response of refusals) {
      const error = apiError(response);
      expect(WIRE_CODES, `${error.status} ${error.code} is not on the wire`).toContain(
        error.code,
      );
      // A refusal with no sentence is a refusal nothing can render.
      expect(error.apiMessage.length).toBeGreaterThan(0);
    }
  });

  /**
   * **The two the last code sweep missed, and why it missed them.**
   *
   * DECISIONS.md records fourteen refusals corrected from `rest_invalid_param`
   * to `invalid_request` — a code `ErrorNormalizer.php:31-32` rewrites on the
   * way out, so no client can receive it. These two answered
   * `rest_missing_callback_param`, which the *same two lines* rewrite the same
   * way: they are **missing**-parameter refusals rather than invalid-value
   * ones, so a sweep for the code that had been named found neither. Both
   * corrected 2026-08-25.
   *
   * Neither sentence changed, and that is the point — the sentences were right
   * the whole time, which is exactly what let the codes hide behind assertions
   * that only ever compared sentences.
   */
  it("answers the two MISSING-parameter refusals with a code a client can receive", () => {
    const outcome = apiError(write("POST", "/orders/1007/cod/attempts", {}));
    expect(outcome.code).toBe("invalid_request");
    expect(outcome.apiMessage).toBe("Missing parameter(s): outcome");
    expect(outcome.fields?.outcome).toContain("Required.");

    const sku = apiError(get("/inventory/lookup"));
    expect(sku.code).toBe("invalid_request");
    expect(sku.apiMessage).toBe("Missing parameter(s): sku");
    // The array shape under `params` is measured and is untouched by the code
    // correction — it is the other half of the `/shipping/rates` asymmetry.
    expect(sku.details.params).toEqual(["sku"]);
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
    // and does not block. **201**, measured 2026-08-25; this read 200 until
    // then, which is what caught the change when the route moved onto the
    // `created()` envelope.
    expect(
      write("POST", "/orders/1014/shipments", {
        provider: "manual",
        wilaya_id: 16,
        commune_id: 484,
        delivery_type: "home",
      }).status,
    ).toBe(201);
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
    // Measured 2026-08-25 against a deliberately created live parcel. This read
    // "in flight" until then — the `details` had been recorded and the sentence
    // had been written here, which is the whole failure mode this suite exists
    // for: a screen quoting a sentence the shop never sends.
    expect(error.apiMessage).toBe("This order already has a shipment in progress.");
    expect(error.details).toMatchObject({
      shipment_id: 7014,
      provider: "manual",
      status: "created",
    });
    // No field list on this one — the form has nothing wrong with it, so the
    // refusal renders as a sentence rather than binding to a control.
    expect(error.fields).toBeNull();
  });

  it("1007 — a missing destination is a 400 naming both halves at once", () => {
    const error = apiError(write("POST", "/orders/1007/shipments", { provider: "manual" }));
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_request");
    // Measured 2026-08-25. `expect.any(String)` is what let two invented
    // sentences — "Required. The destination wilaya." and its commune twin —
    // sit here looking asserted, so the words are pinned now.
    expect(error.apiMessage).toBe("The shipment data is invalid.");
    // `details.fields`, an object of messages — not `details.params` — because
    // each one binds to its own control on the create-parcel form.
    expect(error.fields).toEqual({ wilaya_id: "Required.", commune_id: "Required." });
    expect(error.params).toBeNull();
    // The destination is validated before anything else, so a body carrying only
    // a provider fails the same way an empty one does.
    expect(apiError(write("POST", "/orders/1007/shipments", {})).fields).toEqual(
      error.fields,
    );
  });

  /**
   * **Both halves of this were wrong until 2026-08-25**, and the assertion that
   * let it survive is the one below it: the mock answered `"A delivered shipment
   * cannot be cancelled."` with `{from, to, is_live}` — the *`PATCH` conflict's*
   * shape, on a request that names no `to` at all. The wire is one key.
   */
  it("7023 — a finished parcel refuses cancellation, blaming its own status", () => {
    const error = refusal(write("POST", "/shipments/7023/cancel"));
    expect(error.apiMessage).toBe("This shipment has already finished.");
    expect(error.details).toEqual({ status: "delivered" });
    // An order's 409 carries `allowed` and a shipment's does not, which is the
    // one place this subject cannot follow the panel's usual rule.
    expect(error.conflict?.allowed).toBeUndefined();
    // And the shape it is *not*: cancel names no destination, so a screen
    // reading `to` off this would render "undefined".
    expect(error.details.to).toBeUndefined();
    expect(error.details.is_live).toBeUndefined();
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
    expect(data.capabilities).toContain("ac_manage_orders");
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
   * ── The 403, and the one route beside it that is not one ─────────────────────
   *
   * Measured 2026-08-26 with a credential holding no `ac_manage_payments`: all
   * three payments reads answer `403 forbidden` with *"You are not allowed to
   * perform this action."*, and `/cod/statistics` answers **200** — it is
   * `ac_view_analytics`, which both tiers hold. That pair is the entire reason
   * `/payments` is two sections rather than one, and it is the only place in the
   * panel where a figure renders for a reader who cannot open a single record
   * behind it.
   *
   * **`forbidden` is a wire code DECISIONS.md's "Carried forward" does not
   * list.** That list is the four codes a *parameter* refusal can carry — which
   * is what the `sync_unsupported` assertion above already established — so this
   * is the second domain code found outside it rather than a fifth value the
   * ledger simply missed. The ledger's sentence needs the distinction, not just
   * another entry.
   *
   * Until this existed the reduced identity was served all 45 transactions, which
   * is the *more permissive* direction and the one the coupons branch was burned
   * by: a screen verified against a harness that never refuses is a screen whose
   * forbidden state nobody has seen.
   */
  it("refuses the three payments reads for a credential without the capability", async () => {
    vi.stubEnv("MOCK_IDENTITY", "reduced");
    try {
      const mock = await freshMock();
      const ask = (path: string) => mock.respond("GET", `${mock.BASE_PATH}${path}`);

      for (const path of ["/payments", "/payments/methods", "/payments/5230"]) {
        const response = ask(path);
        expect(response.status, path).toBe(403);
        try {
          unwrap(paymentsSchema, response.body, response.status);
          expect.unreachable("a 403 must throw at the panel's boundary");
        } catch (error) {
          expect(error).toBeInstanceOf(ApiError);
          expect((error as ApiError).code, path).toBe("forbidden");
          expect((error as ApiError).apiMessage, path).toBe(
            "You are not allowed to perform this action.",
          );
          // The panel branches on the status and never on this code — checked
          // rather than assumed, the way the fourteen were.
          expect((error as ApiError).isForbidden, path).toBe(true);
        }
      }

      // And the report beside them is a 200 for the same credential.
      const statistics = ask("/cod/statistics");
      expect(statistics.status).toBe(200);
      expect(unwrap(codStatisticsSchema, statistics.body, 200).data.total_orders).toBe(599);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  /**
   * ── The third identity, and the state `reduced` cannot reach ────────────────
   *
   * The dashboard's money gate is `canSeeMoney()` — `ac_view_analytics` **and**
   * `ac_manage_orders` — and `reduced` holds both. It holds the second on
   * purpose: dropping it would turn `/orders/1023` from a screen with two
   * sections missing into a whole page refused, which is the one capture that
   * identity exists for. So a third was added rather than the second bent.
   *
   * Measured 2026-08-26 with a real Support Agent credential, and this test is
   * the whole of what was measured: the overview is a **200** whose keys are
   * exactly `range, orders, customers, cod, shipping, inventory` — `revenue` is
   * *absent*, not null and not zeroed — with `money_visible: false` beside it,
   * and the same reader is 403 on `/orders` and `/inventory` and **200** on
   * `/customers`.
   *
   * The absence is the part a schema cannot catch on its own: every money field
   * in `lib/api/schemas/analytics.ts` is `.optional()`, so a fixture that emitted
   * `revenue: {…}` for this credential would parse cleanly and be wrong, and the
   * dashboard would render a money card no such reader can see.
   */
  it("omits the money block entirely for a credential without ac_manage_orders", async () => {
    vi.stubEnv("MOCK_IDENTITY", "support");
    try {
      const mock = await freshMock();
      const ask = (path: string) => mock.respond("GET", `${mock.BASE_PATH}${path}`);

      const response = ask("/analytics/overview");
      expect(response.status).toBe(200);
      const { data, meta } = unwrap(overviewReport, response.body, 200);

      expect(Object.keys(data)).toEqual([
        "range",
        "orders",
        "customers",
        "cod",
        "shipping",
        "inventory",
      ]);
      expect(data).not.toHaveProperty("revenue");
      expect(data.revenue).toBeUndefined();
      expect(meta?.money_visible).toBe(false);
      expect(meta?.money_requires).toBe("ac_manage_orders");

      // The counts and rates are all still there, which is what lets
      // `dashboardCards()` return a set of the same length rather than a grid
      // with two holes in it.
      expect(data.orders.placed).toBe(901);
      expect(data.inventory.low_stock).toBe(3);
      expect(data.cod.confirmation_rate).toBe("0.2104");

      // The two collections the same credential was measured 403 on, and the one
      // it was measured 200 on. The third is why there is no gate on
      // `/customers` however plausible one would look.
      for (const path of ["/orders", "/orders/1023", "/inventory", "/inventory/201"]) {
        const refused = ask(path);
        expect(refused.status, path).toBe(403);
        expect((refused.body as { error: { code: string } }).error.code, path).toBe("forbidden");
      }
      expect(ask("/customers").status).toBe(200);
      expect(ask("/cod/statistics").status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  /**
   * The half-payload state is `support`'s and **not** `reduced`'s, and the
   * distinction is worth an assertion rather than a comment: `reduced` sees the
   * money, so a capture run asking it for the dashboard's gated state would
   * photograph the ungated one and report green.
   */
  it("still shows the money to the reduced identity, which keeps ac_manage_orders", async () => {
    vi.stubEnv("MOCK_IDENTITY", "reduced");
    try {
      const mock = await freshMock();
      const response = mock.respond("GET", `${mock.BASE_PATH}/analytics/overview`);
      const { data, meta } = unwrap(overviewReport, response.body, 200);
      expect(data.revenue).toBeDefined();
      expect(meta?.money_visible).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  /**
   * ── The fourth identity, and the section none of the other three can refuse ──
   *
   * **Every route under `/cms/` and `/media` is `ac_manage_content`, and all
   * three identities above hold it** — `reduced` drops shipping and payments,
   * `support` drops orders and inventory, and neither touches content. So the
   * Content hub, its six screens and the media library had no capturable
   * forbidden state at all, and neither did the `MediaPicker` inside the banner
   * form.
   *
   * `reduced` could not be widened into it: its own block says its delta from
   * `full` is exactly the two 403s that were seen, and adding a third capability
   * would be a claim about the shop's roles nothing has measured.
   *
   * Measured, and recorded in `lib/api/allowlist.ts` and in ADMIN_PANEL.md's
   * Media section: a Manager is **403 on every route in the `/cms/` block and on
   * `GET /media`**, and **200 on `/notifications`** — which is
   * `ac_manage_customers`, so those two fixtures invert. That inversion is
   * asserted here because it is the whole reason notifications is a separate
   * branch rather than part of this one.
   */
  it("refuses every content route for a credential without ac_manage_content", async () => {
    vi.stubEnv("MOCK_IDENTITY", "no_content");
    try {
      const mock = await freshMock();
      const ask = (path: string) => mock.respond("GET", `${mock.BASE_PATH}${path}`);

      const { data } = unwrap(identity, ask("/auth/me").body, 200);
      // Exactly one capability off `full`, and it is the one the name says.
      expect(data.capabilities).toHaveLength(12);
      expect(data.capabilities).not.toContain("ac_manage_content");

      for (const path of [
        "/cms/pages",
        "/cms/pages/legal/conditions-generales",
        "/cms/homepage",
        "/cms/banners",
        "/cms/faqs",
        "/cms/faq-categories",
        "/cms/menus/primary",
        "/media",
        "/media/5001",
      ]) {
        const response = ask(path);
        expect(response.status, path).toBe(403);
        try {
          unwrap(pageList, response.body, response.status);
          expect.unreachable("a 403 must throw at the panel's boundary");
        } catch (error) {
          expect(error).toBeInstanceOf(ApiError);
          expect((error as ApiError).code, path).toBe("forbidden");
          expect((error as ApiError).isForbidden, path).toBe(true);
        }
      }

      // A write is refused by the gate too, before it can reach a validator.
      expect(
        mock.respond("PUT", `${mock.BASE_PATH}/cms/homepage`, new URLSearchParams(), {
          sections: [],
        }).status,
      ).toBe(403);

      // **And the two fixtures invert here.** `/notifications` is
      // `ac_manage_customers`, which this credential keeps.
      expect(ask("/notifications").status).toBe(200);
      expect(ask("/orders").status).toBe(200);
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
 * ── Content, and the one filter in this panel that inverts ───────────────────
 *
 * `?status=` on every `/cms/` collection **defaults to `publish`**, and `any`
 * means publish plus draft and never the trash. Everywhere else in this panel
 * the absence of the parameter means everything, so this is the one family where
 * a screen that sends nothing gets *less* than it asked for — and a mock that
 * answered drafts on a bare listing would make `DEFAULT_STATUS_FILTER`, every
 * screen's explicit `?status=any` and the whole hub-count inversion look like
 * padding somebody could delete. It would delete cleanly, against a green
 * harness, and hide every draft in the shop the first time it shipped.
 *
 * So the inversion is asserted from both ends: the default really is narrower
 * than `any`, and `any` really does exclude the trash.
 */
describe("GET /cms/pages", () => {
  it("parses the index and reports more rows under ?status=any than under the default", () => {
    const bare = parseList(pageList, get("/cms/pages", "per_page=100"));
    const any = parseList(pageList, get("/cms/pages", "per_page=100&status=any"));

    // 62 listed pages, of which 52 are published and 10 are drafts. The counts
    // are written out because the whole point of the fixture is that the two
    // readings differ — equal numbers would let a mock that ignored the
    // parameter pass this test.
    expect(any.meta.total).toBe(62);
    expect(bare.meta.total).toBe(52);
    expect(any.meta.total).toBeGreaterThan(bare.meta.total);

    expect(new Set(bare.data.map((row) => row.status))).toEqual(new Set(["publish"]));
    expect(new Set(any.data.map((row) => row.status))).toEqual(new Set(["publish", "draft"]));

    // And the screen's own default is the wider one, which is the inversion.
    expect(DEFAULT_STATUS_FILTER).toBe("any");
  });

  it("never returns the trash, under any filter", () => {
    for (const filter of STATUS_FILTERS) {
      const { data } = parseList(pageList, get("/cms/pages", `per_page=100&status=${filter}`));
      expect(data.some((row) => row.path === "ancienne-page"), filter).toBe(false);
      for (const row of data) expect(isContentStatus(row.status), filter).toBe(true);
    }
    // The trashed page is not reachable by path either — `any` is publish plus
    // draft, which is exactly why it is not a synonym for "everything".
    expect(get("/cms/pages/ancienne-page", "status=any").status).toBe(404);
  });

  it("refuses an empty ?status= and a trash filter with the enum sentence", () => {
    for (const value of ["", "trash", "pending"]) {
      const error = apiError(get("/cms/pages", `status=${value}`));
      expect(error.status, value).toBe(400);
      // `invalid_request`, never WordPress's `rest_invalid_param` — the code
      // `ErrorNormalizer` maps it to on the way out.
      expect(error.code, value).toBe("invalid_request");
      expect(error.params?.status, value).toBe(
        "status is not one of publish, draft, and any.",
      );
    }
    // Every filter the panel offers is accepted, which is the other half: a mock
    // that refused one of the three would hide a working control.
    for (const filter of STATUS_FILTERS) {
      expect(get("/cms/pages", `status=${filter}`).status, filter).toBe(200);
      expect(isStatusFilter(filter)).toBe(true);
    }
  });

  it("matches ?search= against the title and the body and never against the path", () => {
    /*
     * `Mentions` catches two rows and each one proves a different half: it is in
     * the *title* of `legal/mentions-legales` and in the *body* of `legal`,
     * whose prose lists what the section holds. Both, in one query.
     */
    const both = parseList(pageList, get("/cms/pages", "per_page=100&status=any&search=Mentions"));
    expect(both.data.map((row) => row.path).sort()).toEqual(["legal", "legal/mentions-legales"]);
    expect(both.data.find((row) => row.path === "legal")?.title).not.toContain("Mentions");

    // A second body-only match, on a word no title carries at all.
    const byBody = parseList(pageList, get("/cms/pages", "per_page=100&status=any&search=wilayas"));
    expect(byBody.data.some((row) => row.path === "livraison")).toBe(true);
    expect(byBody.data.every((row) => !row.title.includes("wilaya"))).toBe(true);

    /*
     * **And never the path.** `WP_Query`'s `s` does not search `post_name`, so
     * on the one resource whose address *is* its path, typing a path finds
     * nothing — which is why the screen renders a footnote saying what the field
     * matches. The control is that the page really is there and really is
     * findable by its title.
     */
    const byPath = parseList(
      pageList,
      get("/cms/pages", "per_page=100&status=any&search=legal/conditions-generales"),
    );
    expect(byPath.meta.total).toBe(0);
    expect(get("/cms/pages/legal/conditions-generales", "status=any").status).toBe(200);
  });

  it("pages for real, and refuses the four paging edges", () => {
    // `PER_PAGE` on the index is 50, and the seed is deliberately over it: the
    // second page had never been requested by anything before this branch.
    const first = parseList(pageList, get("/cms/pages", "per_page=50&page=1&status=any"));
    expect(first.data).toHaveLength(50);
    expect(first.meta.total_pages).toBe(2);

    const second = parseList(pageList, get("/cms/pages", "per_page=50&page=2&status=any"));
    expect(second.data).toHaveLength(12);
    // Disjoint, which is what proves the slice rather than the count.
    const ids = new Set(first.data.map((row) => row.id));
    expect(second.data.some((row) => ids.has(row.id))).toBe(false);

    // Past the last page: a 200 with nothing on it, which is the state the
    // pager's dead "next" button is for.
    expect(parseList(pageList, get("/cms/pages", "per_page=50&page=3&status=any")).data).toEqual([]);

    for (const query of ["per_page=abc", "per_page=0", "per_page=101", "page=0", "page=-3", "page="]) {
      expect(get("/cms/pages", query).status, query).toBe(400);
    }
  });

  it("reports the functional pages it left out in meta.excluded_system", () => {
    const response = get("/cms/pages", "per_page=100&status=any");
    const { meta } = parse(pageList, response);
    // `shop`, `cart`, `checkout` and `my-account` — a block, a shortcode or no
    // body at all — so the count here is short of what wp-admin reports and the
    // footnote on the index says by how many.
    expect(meta?.excluded_system).toBe(4);

    const { data } = parseList(pageList, response);
    for (const path of ["shop", "cart", "checkout", "my-account"]) {
      expect(data.some((row) => row.path === path), path).toBe(false);
      // Omitted from the *index* and still addressable, which is the whole
      // distinction `SystemPages` draws.
      expect(get(`/cms/pages/${path}`, "status=any").status, path).toBe(200);
    }
  });

  it("carries two pages on one path, so the index has a row it cannot link", () => {
    const { data } = parseList(pageList, get("/cms/pages", "per_page=100&status=any"));
    const collisions = collidingPaths(data.map((row) => row.path));

    // Non-empty is the point: until this fixture existed, `collidingPaths()`
    // could only ever return an empty set and the non-linkable row was
    // unreachable.
    expect([...collisions]).toEqual(["ac-unpublished"]);
    expect(data.filter((row) => row.path === "ac-unpublished")).toHaveLength(2);

    // `get_page_by_path()` resolves exactly one of them, which is why the panel
    // refuses to link either: following one would be a coin flip that ends in
    // editing somebody else's page.
    const { data: resolved } = parse(pageSchema, get("/cms/pages/ac-unpublished", "status=any"));
    expect(resolved.id).toBe(19);
  });

  it("is ordered by title, which is the one thing the route does instead of a sort", () => {
    const { data } = parseList(pageList, get("/cms/pages", "per_page=100&status=any"));
    const titles = data.map((row) => row.title);
    const sorted = [...titles].sort((a, b) =>
      a.localeCompare(b, "fr", { sensitivity: "base" }),
    );
    // Not a strict equality against `localeCompare` — the mock folds rather than
    // collating — but the first row must not be the newest one, which is what
    // `menu_order`'s degenerate default would give.
    expect(titles[0]).toBe(sorted[0]);
    expect(data[0].date_created).not.toBe(
      [...data].sort((a, b) => b.date_created.localeCompare(a.date_created))[0].date_created,
    );
  });

  /**
   * **`orderby` on this collection is recorded neither as working nor as
   * ignored**, so the mock neither sorts on it nor refuses it — and this test
   * pins the *absence* of a decision rather than a behaviour.
   *
   * Refusing an unknown value would be inventing a validator nobody has seen,
   * which is the direction the coupons branch was burned by: a screen built to a
   * 400 the API never sends. Sorting on it would be worse, because somebody
   * would then ship the control.
   */
  it("neither honours nor refuses ?orderby=, because nobody has measured it", () => {
    const base = parseList(pageList, get("/cms/pages", "per_page=100&status=any"));
    for (const query of ["orderby=title&order=desc", "orderby=zzz", "orderby="]) {
      const other = parseList(pageList, get("/cms/pages", `per_page=100&status=any&${query}`));
      expect(other.data.map((row) => row.id), query).toEqual(base.data.map((row) => row.id));
    }
  });
});

describe("GET /cms/pages/{path}", () => {
  it("parses a whole page, including the SEO block the form binds to", () => {
    const { data } = parse(pageSchema, get("/cms/pages/legal/conditions-generales", "status=any"));

    // A multi-segment path is one resource, which is what the catch-all route
    // and the greedy allowlist rule exist for.
    expect(data.path).toBe("legal/conditions-generales");
    expect(data.slug).toBe("conditions-generales");
    expect(data.parent_path).toBe("legal");
    expect(parentPathOf(data.path)).toBe(data.parent_path);
    expect(pageDepth(data.path)).toBe(1);

    // Rendered HTML, not what was sent — the property that makes binding the
    // form straight to the response safe here.
    expect(data.content.startsWith("<p>")).toBe(true);
    pageSeo.parse(data.seo);
    // The one page with a hand-set SEO title, so the form's overridden branch
    // has a fixture and does not always render the derived placeholder.
    expect(data.seo.overrides).toContain("title");
    expect(data.image).toBeNull();
  });

  /**
   * **The measurement the whole Pages index exists for.** `?status=` *filters* a
   * single read rather than widening it, so a draft asked for at the default is
   * a 404 — with the **same sentence** a path that does not exist gets. On a
   * single-resource route the two facts are indistinguishable, and WordPress
   * creates `privacy-policy` as a draft, so the shop said "no such page" about a
   * page sitting right there.
   */
  it("answers a draft and a missing path with the same 404 and the same sentence", () => {
    const draft = apiError(get("/cms/pages/privacy-policy"));
    const missing = apiError(get("/cms/pages/nulle-part", "status=any"));

    expect(draft.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(draft.code).toBe("not_found");
    expect(draft.apiMessage).toBe("No page at that path.");
    expect(missing.apiMessage).toBe(draft.apiMessage);

    // And the index is where they separate, which is the argument for it over a
    // path box: the same page is in the listing with `status: "draft"`.
    const { data } = parse(pageSchema, get("/cms/pages/privacy-policy", "status=any"));
    expect(data.status).toBe("draft");
  });
});

describe("the page writes", () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    title: "Page d’essai",
    slug: "page-d-essai",
    parent_path: "",
    status: "draft",
    content: "Bonjour",
    excerpt: "",
    menu_order: 0,
    ...extra,
  });

  it("creates a page with 201 and the whole document back", () => {
    const response = write("POST", "/cms/pages", body());
    expect(response.status).toBe(201);
    const { data } = parse(pageSchema, response);
    expect(data.path).toBe("page-d-essai");
    expect(data.content).toBe("<p>Bonjour</p>\n");
    // And it is readable at its own address immediately, which is the failure
    // §89's correction block describes when there were no drafts: a 201 for a
    // resource whose GET is a 404.
    expect(parse(pageSchema, get("/cms/pages/page-d-essai", "status=any")).data.id).toBe(data.id);
  });

  /**
   * **A `parent_path` naming nothing is a 400 on that field** — measured, rather
   * than an orphan created quietly. `parentPathOf()` in `lib/cms.ts` says
   * explicitly that it is for display and for pre-filling a form and never for
   * deciding whether a move is legal, and this is why: the API decides.
   */
  it("refuses a parent_path that names nothing, on that field", () => {
    const error = apiError(write("PATCH", "/cms/pages/contact", { parent_path: "nulle-part" }));
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_request");
    expect(error.fields?.parent_path).toBe('No page at path "nulle-part".');

    // A real one moves the page, and the empty string is the root.
    const moved = parse(pageSchema, write("PATCH", "/cms/pages/contact", { parent_path: "legal" }));
    expect(moved.data.path).toBe("legal/contact");
  });

  it("renames with slug and reports the move in meta", () => {
    const response = write("PATCH", "/cms/pages/contact", { slug: "nous-contacter" });
    const { data, meta } = parse(pageSchema, response);
    expect(data.path).toBe("nous-contacter");
    expect(meta?.path_changed).toBe(true);
    // WordPress leaves nothing behind at the old address.
    expect(get("/cms/pages/contact", "status=any").status).toBe(404);

    // A write that does not move the page carries no such key.
    const still = parse(pageSchema, write("PATCH", "/cms/pages/nous-contacter", { title: "X" }));
    expect(still.meta?.path_changed).toBeUndefined();
  });

  it("refuses an unknown field by name and a bad status with the body enum", () => {
    expect(apiError(write("PATCH", "/cms/pages/contact", { nonsense: 1 })).fields?.nonsense).toBe(
      "Unknown field.",
    );
    // Family 2: a body field, colon, no Oxford comma — against the query
    // parameter's "is not one of a, b, and c."
    expect(apiError(write("PATCH", "/cms/pages/contact", { status: "trash" })).fields?.status).toBe(
      "Must be one of: publish, draft.",
    );
    expect(CONTENT_STATUSES).toEqual(["publish", "draft"]);
    // Read-only keys leave in silence rather than being refused, which is what
    // lets a GET body PATCH back whole.
    const { data } = parse(pageSchema, get("/cms/pages/contact", "status=any"));
    expect(write("PATCH", "/cms/pages/contact", data).status).toBe(200);
  });

  it("lands an SEO error on its own dotted field, where the form binds it", () => {
    const error = apiError(
      write("PATCH", "/cms/pages/contact", { seo: { title: "T", canonical: 5 } }),
    );
    expect(error.fields?.["seo.canonical"]).toBe("Must be a string.");
    // There is no SEO endpoint and §89 does not add one, so this is the page's
    // own PATCH and its errors arrive in the same `details.fields` list.
    expect(error.fields?.seo).toBeUndefined();
  });

  /**
   * **`?force=true` means something different here from everywhere else in this
   * API**, and the two 409s are the reason.
   *
   * On a product and on a coupon, force is *permanence*. Here it overrides the
   * children guard — reparenting is recoverable — and explicitly does **not**
   * override an option reference, because leaving `woocommerce_checkout_page_id`
   * pointing at nothing makes WooCommerce report a missing page rather than a
   * broken setting.
   */
  it("refuses a parent with a children 409 that force overrides", () => {
    const refused = apiError(write("DELETE", "/cms/pages/legal"));
    expect(refused.status).toBe(409);
    expect(refused.code).toBe("conflict");
    expect(refused.details.children).toBe(2);
    expect(refused.details.child_ids).toEqual([12, 13]);

    expect(write("DELETE", "/cms/pages/legal", undefined, "force=true").status).toBe(200);
    // The children reparented to the root rather than disappearing with it.
    expect(get("/cms/pages/legal/conditions-generales", "status=any").status).toBe(404);
    const { data } = parse(pageSchema, get("/cms/pages/conditions-generales", "status=any"));
    expect(data.id).toBe(12);
    expect(data.parent_path).toBe("");
  });

  it("refuses an option-referenced page with a 409 that force does not override", () => {
    for (const query of ["status=any", "status=any&force=true"]) {
      const refused = apiError(write("DELETE", "/cms/pages/privacy-policy", undefined, query));
      expect(refused.status, query).toBe(409);
      expect(refused.details.option, query).toBe("wp_page_for_privacy_policy");
      expect(refused.details.children, query).toBeUndefined();
    }
    // And it is still there afterwards, which is the half a 409 alone does not
    // prove.
    expect(get("/cms/pages/privacy-policy", "status=any").status).toBe(200);
  });

  it("trashes a page nothing references, and the trash is reachable through no filter", () => {
    expect(write("DELETE", "/cms/pages/refund_returns").status).toBe(200);
    for (const filter of STATUS_FILTERS) {
      expect(get("/cms/pages/refund_returns", `status=${filter}`).status, filter).toBe(404);
    }
  });
});

/**
 * ── The homepage: one document, two error shapes, and a report about neither ──
 *
 * `GET` **drops** a malformed section and reports it in `meta.problems`; `PUT`
 * **refuses** one with a 400. §89 states that asymmetry deliberately — an option
 * edited by hand must degrade, a form filled in by a person must not lose their
 * work quietly — and the drop report therefore cannot be provoked through the
 * API at all, which is why `scripts/seed-cms.mjs` writes the option underneath
 * it with `wp eval` and why the mock seeds it here.
 */
describe("GET /cms/homepage", () => {
  it("drops what it cannot parse and reports it at 1-based positions over the stored document", () => {
    const response = get("/cms/homepage");
    const { data, meta } = parse(homepage, response);

    // Twelve stored, three malformed, nine on screen.
    expect(data.sections).toHaveLength(9);
    const problems = homepageProblems.parse(meta?.problems);
    expect(problems).toHaveLength(3);

    const classified = problems.map(classifyProblem);
    expect(classified.map((problem) => problem.kind)).toEqual([
      "not_an_object",
      "unknown_type",
      "bad_data",
    ]);
    // **Interleaved, not appended.** The positions are over the *stored*
    // document, so none of them is its own row on screen — an assertion that
    // could pass with the malformed sections at the end would prove nothing.
    expect(classified.map((problem) => problem.position)).toEqual([2, 4, 6]);
    for (const problem of classified) {
      expect(data.sections[(problem.position ?? 1) - 1]?.type).not.toBe(problem.detail);
    }
    // "Section 6" is the fourth thing on screen, which is the sentence the panel
    // has to state in the reader's own language rather than render verbatim.
    expect(classified[2].detail).toBe('Section 6 ("promotion") has a "data" that is not an object.');
  });

  it("serves only types this build has a name for, on the default document", () => {
    const { data } = parse(homepage, get("/cms/homepage"));
    for (const section of data.sections) {
      expect(isSectionType(section.type), section.type).toBe(true);
      homepageSection.parse(section);
    }
    expect(unknownSectionTypes(data.sections.map((section) => section.type))).toEqual([]);
  });

  /**
   * **`meta` is absent entirely when there is nothing to report** — not an empty
   * array, measured. Code that destructured `meta.problems` would throw on the
   * healthy document and work on the broken one, which is the wrong way round
   * for a failure mode, and `homepage/page.tsx` reads `result.meta?.problems`
   * for exactly that reason.
   *
   * The healthy document is reachable because a successful `PUT` **repairs** it
   * by discarding what the read had dropped — which is also why the editor gates
   * its save behind a confirmation naming the count.
   */
  it("carries no meta at all once the document is clean", () => {
    const saved = write("PUT", "/cms/homepage", {
      sections: [{ type: "hero", data: { heading: "Bonjour" } }],
    });
    expect(saved.status).toBe(200);

    const response = get("/cms/homepage");
    expect(Object.keys(response.body as object)).toEqual(["success", "data"]);
    expect(parse(homepage, response).meta).toBeNull();
  });
});

describe("PUT /cms/homepage", () => {
  const sections = (count: number) =>
    Array.from({ length: count }, () => ({ type: "hero", data: {} }));

  it("refuses a bad section positionally, naming every type it knows", () => {
    const error = apiError(
      write("PUT", "/cms/homepage", {
        sections: [...sections(2), { type: "not_a_real_type", data: {} }],
      }),
    );
    expect(error.status).toBe(400);
    expect(error.fields?.["sections[2].type"]).toBe(
      'Unknown section type "not_a_real_type". One of: hero, featured_products, categories, promotion, banner, text, image, faq, testimonials, newsletter, custom.',
    );
    // The 400 is the only place the vocabulary is published at all — there is no
    // endpoint for it — so the sentence and `SECTION_TYPES` must not drift.
    expect(SECTION_TYPES.join(", ")).toBe(
      "hero, featured_products, categories, promotion, banner, text, image, faq, testimonials, newsletter, custom",
    );
    expect(SECTION_TYPES).toHaveLength(11);
  });

  /**
   * **The second shape, and it is not positional.** A form binding every
   * homepage error to a row index drops this one on the floor, which is why
   * `HomepageEditor` keeps `rowErrors` and `listError` apart.
   */
  it("refuses a 51st section on `sections` rather than on `sections[50]`", () => {
    const error = apiError(write("PUT", "/cms/homepage", { sections: sections(MAX_SECTIONS + 1) }));
    expect(error.status).toBe(400);
    expect(error.fields?.sections).toBe(
      "A homepage carries at most 50 sections; this one has 51.",
    );
    expect(error.fields?.["sections[50]"]).toBeUndefined();
    // Exactly fifty is fine, which is what makes the bound a bound.
    expect(write("PUT", "/cms/homepage", { sections: sections(MAX_SECTIONS) }).status).toBe(200);
  });

  it("refuses a section whose data is not an object, positionally", () => {
    const error = apiError(
      write("PUT", "/cms/homepage", { sections: [...sections(2), { type: "faq", data: "x" }] }),
    );
    expect(error.fields?.["sections[2].data"]).toBe("Must be an object.");
  });

  it("replaces the document and hands the stored one back", () => {
    const payload = {
      sections: [
        { type: "hero", data: { heading: "A" } },
        { type: "newsletter", data: {} },
      ],
    };
    const { data } = parse(homepage, write("PUT", "/cms/homepage", payload));
    expect(data.sections.map((section) => section.type)).toEqual(["hero", "newsletter"]);
    expect(parse(homepage, get("/cms/homepage")).data).toEqual(data);
  });
});

/**
 * ── The two homepage documents that are not the default ─────────────────────
 *
 * `MOCK_HOMEPAGE` is the second harness switch after `MOCK_IDENTITY`, and it
 * exists because the three states this screen has are properties of the stored
 * *document* rather than of the reader or the URL: `/content/homepage` takes no
 * parameters and the panel's server component forwards none, so neither an
 * identity nor a query string can reach them.
 */
describe("MOCK_HOMEPAGE", () => {
  const freshMock = async () => {
    vi.resetModules();
    return import("@/scripts/mock-api.mjs");
  };

  const withHomepage = async (value: string, run: (body: unknown) => void) => {
    vi.stubEnv("MOCK_HOMEPAGE", value);
    try {
      const mock = await freshMock();
      run(mock.respond("GET", `${mock.BASE_PATH}/cms/homepage`).body);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  };

  it("serves the empty document this shop answered before the seed existed", async () => {
    await withHomepage("empty", (body) => {
      const { data, meta } = unwrap(homepage, body, 200);
      expect(data.sections).toEqual([]);
      // Empty is not broken: there is nothing to report, so there is no `meta`.
      expect(meta).toBeNull();
    });
  });

  /**
   * **A hypothesis, not a measurement, and it is behind a switch for that
   * reason.** The reader measured on 2026-08-21 *drops* a type it does not know
   * and reports it, so an unknown type arriving intact says the backend has
   * gained one — which is precisely the scenario `unknownSectionTypes()` exists
   * for and the only way its non-empty branch can be reached at all.
   */
  it("passes a twelfth type through when asked to model a backend that moved", async () => {
    await withHomepage("future", (body) => {
      const { data, meta } = unwrap(homepage, body, 200);
      const types = data.sections.map((section) => section.type);
      expect(types).toContain("countdown");
      // Not reported as a problem: the shop knows it, this build does not.
      expect(meta).toBeNull();
      expect(unknownSectionTypes(types)).toEqual(["countdown"]);
      expect(isSectionType("countdown")).toBe(false);
    });
  });

  it("refuses a document name it does not recognise, rather than falling back", async () => {
    vi.stubEnv("MOCK_HOMEPAGE", "reportt");
    try {
      await expect(freshMock()).rejects.toThrow(/MOCK_HOMEPAGE/);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("GET /cms/banners", () => {
  it("parses the collection and carries a dense position across it", () => {
    const { data, meta } = parseList(bannerList, get("/cms/banners", "per_page=100&status=any"));
    expect(meta.total).toBe(5);
    // **Dense**, 0..n-1 across the whole collection rather than per placement,
    // which is what lets a reorder swap two adjacent values.
    expect(data.map((row) => row.position)).toEqual([0, 1, 2, 3, 4]);
    // And `positionWrites()` therefore says nothing needs writing.
    expect(positionWrites(data, data)).toEqual([]);
    // Moving one row is one PATCH per row that actually moved, because there is
    // no bulk endpoint on this collection.
    const moved = [data[1], data[0], ...data.slice(2)];
    expect(positionWrites(data, moved)).toEqual([
      { id: data[1].id, position: 0 },
      { id: data[0].id, position: 1 },
    ]);
  });

  it("carries a texturized title and a null image on every row", () => {
    const { data } = parseList(bannerList, get("/cms/banners", "per_page=100&status=any"));
    const soldes = data.find((row) => row.id === 7301);
    // WordPress texturizes what it stores, so a title never reads back as it was
    // written — and a screen that skipped `decodeEntities` prints the six
    // literal characters of the entity.
    expect(soldes?.title).toBe("Soldes d&#8217;été");
    expect(decodeEntities(soldes?.title ?? "")).toBe("Soldes d’été");
    // Null on every seeded row, which is the measured state of this shop: a
    // banner without a picture is a banner.
    for (const row of data) expect(row.image, String(row.id)).toBeNull();
  });

  it("defaults to publish here as everywhere else under /cms/", () => {
    const bare = parseList(bannerList, get("/cms/banners", "per_page=100"));
    const any = parseList(bannerList, get("/cms/banners", "per_page=100&status=any"));
    expect(bare.meta.total).toBe(3);
    expect(any.meta.total).toBe(5);
    expect(apiError(get("/cms/banners", "status=")).params?.status).toBe(
      "status is not one of publish, draft, and any.",
    );
  });

  /**
   * **The hub reads `meta.total` off this route and off `/cms/faqs`**, with
   * `?per_page=1&status=any` — one row for the count alone — through `listMeta`,
   * which requires all four paging keys. So the envelope is the full one here,
   * and whether the shop sends `page`, `per_page` and `total_pages` beside
   * `total` is **unverified**: no request-for-request diff has been taken. The
   * assertion pins what the panel depends on, not what was measured.
   */
  it("carries the four-key envelope the Content hub's count is read through", () => {
    for (const path of ["/cms/pages", "/cms/banners", "/cms/faqs"]) {
      const response = get(path, "per_page=1&status=any");
      const { meta } = parse(z.array(z.unknown()), response);
      expect(listMeta.safeParse(meta).success, path).toBe(true);
      expect(listMeta.parse(meta).per_page, path).toBe(1);
    }
    // `/media` is the hub's fourth count and takes no `?status=`.
    expect(listMeta.safeParse(parse(mediaList, get("/media", "per_page=1")).meta).success).toBe(
      true,
    );
  });
});

describe("the banner writes", () => {
  /**
   * **Both sentences here are `src/CMS/`'s own since the media branch**, and both
   * were this file's invention before it — two of the six DECISIONS.md carries.
   * `BannerInput::REFUSED` quotes the field name it is telling the client to use,
   * and the mock did not; `CmsRepository::assertImageAttachment()` answers "{id}
   * is not an image attachment." where this file wrote its own wording. Settled by
   * reading the router, which is a better source than reading the panel and is
   * still not the request-for-request diff that collection has never had.
   */
  it("refuses image_url by name, telling the client which field to send", () => {
    const error = apiError(write("PATCH", "/cms/banners/7301", { image_url: "https://x/y.jpg" }));
    expect(error.status).toBe(400);
    expect(error.fields?.image_url).toBe(
      'Upload through POST /media and send the attachment id as "image_id".',
    );
  });

  it("resolves image_id into the embedded image, which is the only fixture for that shape", () => {
    const { data } = parse(banner, write("PATCH", "/cms/banners/7301", { image_id: 5001 }));
    expect(data.image).not.toBeNull();
    embeddedImage.parse(data.image);
    expect(data.image?.id).toBe(5001);
    // And an id naming nothing is refused rather than stored blind — the defect
    // `{"product_ids":[999999]}` was on coupons, one collection over.
    expect(apiError(write("PATCH", "/cms/banners/7301", { image_id: 9999 })).fields?.image_id).toBe(
      "9999 is not an image attachment.",
    );
    // A bad *shape* is a different sentence from an id that names nothing, and
    // `0` is one of the three ways to clear the picture rather than an id to look
    // up — this rule refused it until the media branch, which made one of the
    // documented ways to remove a banner image unreachable against the harness.
    expect(apiError(write("PATCH", "/cms/banners/7301", { image_id: -1 })).fields?.image_id).toBe(
      "Must be an attachment id, or 0 to clear.",
    );
    expect(parse(banner, write("PATCH", "/cms/banners/7301", { image_id: 0 })).data.image).toBeNull();
  });

  it("creates with 201 and removes on delete", () => {
    const response = write("POST", "/cms/banners", {
      title: "Ramadan",
      caption: "",
      link: "/x",
      placement: "home_hero",
      status: "draft",
      position: 5,
      image_id: null,
    });
    expect(response.status).toBe(201);
    const { data } = parse(banner, response);
    expect(data.id).toBe(7320);

    expect(write("DELETE", `/cms/banners/${data.id}`, undefined, "force=true").status).toBe(200);
    const after = parseList(bannerList, get("/cms/banners", "per_page=100&status=any"));
    expect(after.data.some((row) => row.id === data.id)).toBe(false);
  });

  /**
   * `GET /cms/banners/{id}` is a 404 on purpose: `lib/api/allowlist.ts` carries
   * `PATCH` and `DELETE` on that pattern and no `GET`, so the panel's own proxy
   * refuses a single banner. A fixture that answered would let a screen render
   * green here and 404 at the proxy in production — the position `POST
   * /products` and `/product-categories/{id}` are held to.
   */
  it("leaves the single-banner and single-FAQ reads unreachable, as the allowlist does", () => {
    expect(get("/cms/banners/7301").status).toBe(404);
    expect(get("/cms/faqs/8101").status).toBe(404);
    expect(get("/cms/faq-categories/8201").status).toBe(404);
  });
});

describe("GET /cms/faqs and /cms/faq-categories", () => {
  it("parses both, and count is on the collection and absent on the embedded form", () => {
    const { data: faqs } = parseList(faqList, get("/cms/faqs", "per_page=100&status=any"));
    const { data: categories } = parse(faqCategoryList, get("/cms/faq-categories"));

    // Present here…
    for (const category of categories) expect(typeof category.count, category.slug).toBe("number");
    expect(categories.find((row) => row.slug === "livraison")?.count).toBe(2);
    // …and absent on the category embedded inside an FAQ, which is one shape
    // published two ways and the reason the panel's schema marks it optional.
    for (const faq of faqs) {
      for (const category of faq.categories) {
        expect(category.count, `${faq.id}/${category.slug}`).toBeUndefined();
        faqCategory.parse(category);
      }
    }
    // A category nothing is in, so the safe delete has a fixture.
    expect(categories.find((row) => row.slug === "grossistes")?.count).toBe(0);
  });

  it("puts one FAQ in two categories and one in none", () => {
    const { data } = parseList(faqList, get("/cms/faqs", "per_page=100&status=any"));
    expect(data.find((row) => row.id === 8102)?.categories.map((c) => c.slug)).toEqual([
      "paiement",
      "livraison",
    ]);
    expect(data.find((row) => row.id === 8104)?.categories).toEqual([]);
    // Dense positions here too, and no bulk endpoint.
    expect(data.map((row) => row.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it("carries the long Arabic question the 340px assertion needs", () => {
    const { data } = parseList(faqList, get("/cms/faqs", "per_page=100&status=any"));
    const arabic = data.find((row) => row.id === 8103);
    expect(arabic?.question.length).toBeGreaterThan(100);
    expect(/[؀-ۿ]/.test(arabic?.question ?? "")).toBe(true);
  });
});

describe("the FAQ writes", () => {
  /**
   * **Four fields refused by name, and that is how they were found rather than
   * guessed.** Only the `category` sentence is measured — `lib/api/schemas/cms.ts`
   * quotes it verbatim — and the other three are the mock's, written to the same
   * shape. What each one *names* is on the record either way, and the
   * replacement is the load-bearing half: a generic "Unknown field." tells a
   * client that `title` is wrong and not that `question` is right.
   */
  it("refuses category, title, content and menu_order by name, in one 400", () => {
    const error = apiError(
      write("PATCH", "/cms/faqs/8101", {
        category: "livraison",
        title: "x",
        content: "y",
        menu_order: 2,
      }),
    );
    expect(error.status).toBe(400);
    expect(error.fields?.category).toBe('Use "categories" — an FAQ may sit in more than one.');
    for (const [wrong, right] of [
      ["title", "question"],
      ["content", "answer"],
      ["menu_order", "position"],
    ]) {
      expect(error.fields?.[wrong], wrong).toContain(`"${right}"`);
    }
  });

  it("refuses an unknown category rather than creating the FAQ and then complaining", () => {
    const before = parseList(faqList, get("/cms/faqs", "per_page=100&status=any")).meta.total;
    const error = apiError(
      write("POST", "/cms/faqs", { question: "Q", answer: "A", categories: ["inexistante"] }),
    );
    expect(error.fields?.categories).toBe('No FAQ category "inexistante".');
    // **Resolve every reference before the first write** — §89's own rule, from
    // the build that created an FAQ and *then* refused it.
    expect(parseList(faqList, get("/cms/faqs", "per_page=100&status=any")).meta.total).toBe(before);
  });

  it("takes slugs on write and reads objects back", () => {
    const { data } = parse(
      faq,
      write("PATCH", "/cms/faqs/8101", { categories: ["livraison", "paiement"] }),
    );
    expect(data.categories.map((category) => category.slug)).toEqual(["livraison", "paiement"]);
    // And the read body PATCHes back unchanged, which is what the object form is
    // accepted for.
    expect(write("PATCH", "/cms/faqs/8101", data).status).toBe(200);
  });

  it("refuses a category delete with a 409 naming the count, and force detaches", () => {
    const refused = apiError(write("DELETE", "/cms/faq-categories/8203"));
    expect(refused.status).toBe(409);
    expect(refused.details.faqs).toBe(2);

    expect(write("DELETE", "/cms/faq-categories/8203", undefined, "force=true").status).toBe(200);
    // Detached, not deleted: the FAQs are still there with one fewer category.
    const { data } = parseList(faqList, get("/cms/faqs", "per_page=100&status=any"));
    expect(data.some((row) => row.id === 8103)).toBe(true);
    expect(data.find((row) => row.id === 8103)?.categories).toEqual([]);
  });

  it("creates a category from a name and refuses an empty one", () => {
    expect(apiError(write("POST", "/cms/faq-categories", { name: "   " })).fields?.name).toBe(
      "A category needs a name.",
    );
    const { data } = parse(faqCategory, write("POST", "/cms/faq-categories", { name: "Grossistes et revendeurs" }));
    expect(data.slug).toBe("grossistes-et-revendeurs");
    expect(data.count).toBe(0);
  });
});

describe("/cms/menus", () => {
  it("publishes WordPress's vocabulary, which is not the writer's", () => {
    const { data } = parse(menu, get("/cms/menus/primary"));
    expect(data.location).toBe("primary");

    const [, tapis] = data.items;
    // `type` is `taxonomy` with the real kind under `object`, and the label is
    // `title` rather than `label` — `CmsPresenter::menu()` has published this
    // since §61 and changing it would break every existing caller.
    expect(tapis.type).toBe("taxonomy");
    expect(tapis.object).toBe("product_cat");
    expect(tapis.title).toBe("Tapis");
    expect(tapis).not.toHaveProperty("label");
    // Two levels, and the second one has something in it.
    expect(tapis.children).toHaveLength(2);
    expect(tapis.children[0].children).toEqual([]);
    for (const item of data.items) menuItem.parse(item);
  });

  /**
   * **`GET /cms/menus/footer` is a 404 with its own sentence**, which is a
   * different fact from a location that was never registered — and a `PUT` there
   * **creates and assigns** the menu. So an unassigned location is an empty state
   * with a working action behind it rather than a dead end, and it is the only
   * 404 in the panel that is a state.
   */
  it("answers an unassigned location with its own 404, and creates one on PUT", () => {
    const refused = apiError(get("/cms/menus/footer"));
    expect(refused.status).toBe(404);
    expect(refused.code).toBe("not_found");
    expect(refused.apiMessage).toBe("No menu is assigned to that location.");
    // Not the generic `rest_no_route` a path nobody wrote gets.
    expect(get("/cms/menus/sidebar").status).toBe(404);
    expect(apiError(get("/cms/menus/sidebar")).code).toBe("rest_no_route");

    const created = parse(
      menu,
      write("PUT", "/cms/menus/footer", {
        items: [{ label: "Conditions", type: "page", path: "legal/conditions-generales", children: [] }],
      }),
    );
    expect(created.data.name).toBe("Footer navigation");
    expect(created.data.location).toBe("footer");
    // Assigned, so the 404 is gone.
    expect(parse(menu, get("/cms/menus/footer")).data.id).toBe(created.data.id);
    expect(MENU_LOCATIONS).toEqual(["primary", "footer"]);
  });

  it("accepts the reader's own body back unchanged, which is the round trip", () => {
    const { data } = parse(menu, get("/cms/menus/primary"));
    const saved = parse(menu, write("PUT", "/cms/menus/primary", { items: data.items }));
    expect(saved.data.items.map((item) => item.title)).toEqual(
      data.items.map((item) => item.title),
    );
    expect(saved.data.items[1].children.map((item) => item.object_id)).toEqual(
      data.items[1].children.map((item) => item.object_id),
    );
  });

  it("refuses through the tree, positionally", () => {
    const error = apiError(
      write("PUT", "/cms/menus/primary", {
        items: [
          { label: "A", type: "url", url: "/soldes", children: [] },
          {
            label: "B",
            type: "category",
            object_id: 13,
            children: [{ label: "C", type: "product", object_id: 999999, children: [] }],
          },
        ],
      }),
    );
    expect(error.status).toBe(400);
    expect(error.fields?.["items[1].children[0].object_id"]).toBe("No product with id 999999.");
  });

  /**
   * `javascript:` **is a valid URL**, which is exactly where that matters, and
   * `//host` is not a path — it is a protocol-relative URL to somewhere else.
   * The panel refuses both before sending so the person is told by the field
   * rather than by a round trip, and `isAllowedMenuUrl()` is that half; this is
   * the API's.
   */
  it("refuses javascript: and //host on the item's own url", () => {
    for (const url of ["javascript:alert(1)", "//evil.example", ""]) {
      const error = apiError(
        write("PUT", "/cms/menus/primary", {
          items: [{ label: "A", type: "url", url, children: [] }],
        }),
      );
      expect(error.fields?.["items[0].url"], url).toBeDefined();
      expect(isAllowedMenuUrl(url), url).toBe(false);
    }
    // And the three shapes that are allowed really are.
    for (const url of ["/soldes", "https://instagram.com/x", "http://example.dz"]) {
      expect(isAllowedMenuUrl(url), url).toBe(true);
      expect(
        write("PUT", "/cms/menus/primary", {
          items: [{ label: "A", type: "url", url, children: [] }],
        }).status,
        url,
      ).toBe(200);
    }
  });

  it("refuses a third level positionally and a 51st item flatly", () => {
    const deep = apiError(
      write("PUT", "/cms/menus/primary", {
        items: [
          {
            label: "A",
            type: "category",
            object_id: 13,
            children: [
              {
                label: "B",
                type: "page",
                path: "contact",
                children: [{ label: "C", type: "url", url: "/x", children: [] }],
              },
            ],
          },
        ],
      }),
    );
    expect(deep.fields?.["items[0].children[0].children"]).toBe("A menu is 2 levels deep at most.");
    expect(MAX_MENU_DEPTH).toBe(2);

    const item = (index: number) => ({
      label: `I${index}`,
      type: "url" as const,
      url: "/x",
      children: [],
    });
    const many = apiError(
      write("PUT", "/cms/menus/primary", {
        items: Array.from({ length: MAX_MENU_ITEMS + 1 }, (_, index) => item(index)),
      }),
    );
    /*
     * **Flat on `items`, and that is a departure this file records rather than
     * hides.** Nothing published the shape of this cap. The one cap in this
     * subject that *was* measured — the homepage's fifty sections — is flat, on
     * `sections`, precisely so a form cannot bind it to a row index; making this
     * one positional would teach the opposite lesson from the only measurement
     * available.
     */
    expect(many.fields?.items).toBe("A menu carries at most 50 items; this one has 51.");
    expect(many.fields?.["items[50]"]).toBeUndefined();
    expect(
      write("PUT", "/cms/menus/primary", {
        items: Array.from({ length: MAX_MENU_ITEMS }, (_, index) => item(index)),
      }).status,
    ).toBe(200);
  });

  it("refuses a page path naming nothing, and a type the writer does not have", () => {
    expect(
      apiError(
        write("PUT", "/cms/menus/primary", {
          items: [{ label: "A", type: "page", path: "nulle-part", children: [] }],
        }),
      ).fields?.["items[0].path"],
    ).toBe('No page at path "nulle-part".');

    expect(
      apiError(
        write("PUT", "/cms/menus/primary", {
          items: [{ label: "A", type: "machin", children: [] }],
        }),
      ).fields?.["items[0].type"],
    ).toBe("Must be one of: page, category, product, url.");
    expect(MENU_ITEM_TYPES).toEqual(["page", "category", "product", "url"]);
  });
});

/**
 * ── `/media`, checklist item 13, and the branch that owns it ─────────────────
 *
 * These assertions used to pin "the measured half plus the shape the two Content
 * callers depend on", because the collection was served for the hub's count and
 * nothing else. The screen is being built now, so the upload, the four query
 * parameters and every PATCH refusal are pinned as well — and pinned by their
 * **`code` and their `details` keys**, not by their sentences. DECISIONS.md's
 * "Every error `code` in the mock was WordPress's" entry is why: fourteen wrong
 * codes survived for weeks behind assertions that only ever compared prose.
 *
 * The five upload refusals are additionally run through `classifyRefusal()` —
 * the panel's own function, from lib/media.ts — because that is what a screen
 * will branch on, and a mock whose refusals classify wrongly is a mock that
 * teaches an upload dialog to show the wrong sentence.
 */

/** The three formats the mock serves, as the bytes it serves. */
const REAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAB4AAAAUCAIAAAAVyRqTAAAAJklEQVR42mPYp6FBI8QwavSo0aNG" +
    "jxo9ajQVjZ4mJ0cjNGo0GgIAT/Vcz6Ldo2YAAAAASUVORK5CYII=",
  "base64",
);
const REAL_JPEG = Buffer.from(
  "/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB" +
    "AQEBAQEBAQEBAQEBAQH/wAARCAAUAB4DAREAAhEAAxEA/8QAMgAAAAAMAAAAAAAAAAAAAAAAAAEC" +
    "AwQFBgcICQoLEAACAAAAAAAAAAAAAAAAAAAA8P/aAAwDAQACAAMAAD8AlTkG5UsAAAAAAAAAAAAA" +
    "AAAAAAAAEM41A4cAAAAAAAAA/9k=",
  "base64",
);

/**
 * A real `multipart/form-data` body, built the way a browser's `FormData` does.
 *
 * Hand-writing the object `parseMultipart()` produces would leave the parser
 * itself untested and would pin the upload against a shape nothing sends. This
 * builds bytes and hands them to the mock's own parser, so the boundary the
 * panel's `uploadWithProgress()` crosses is the boundary under test.
 */
const MULTIPART_BOUNDARY = "----ac-test-boundary";
function multipart(parts: { name: string; filename?: string; value: string | Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition =
      part.filename === undefined
        ? `form-data; name="${part.name}"`
        : `form-data; name="${part.name}"; filename="${part.filename}"`;
    chunks.push(Buffer.from(`--${MULTIPART_BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n\r\n`, "latin1"));
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value, "utf8"));
    chunks.push(Buffer.from("\r\n", "latin1"));
  }
  chunks.push(Buffer.from(`--${MULTIPART_BOUNDARY}--\r\n`, "latin1"));
  return Buffer.concat(chunks);
}

const upload = (parts: { name: string; filename?: string; value: string | Buffer }[]) =>
  respond(
    "POST",
    `${BASE_PATH}/media`,
    new URLSearchParams(),
    parseMultipart(multipart(parts), `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`),
  );

const uploadFile = (filename: string, value: Buffer | string, fields: [string, string][] = []) =>
  upload([{ name: "file", filename, value }, ...fields.map(([name, v]) => ({ name, value: v }))]);

/** The raw error, because `details` is what separates two refusals that share a code. */
const rawError = (response: MockResponse) =>
  (
    response.body as {
      error: { code: string; message: string; details?: Record<string, unknown> };
    }
  ).error;

/** What the panel would make of a refusal — its own function, on the mock's own answer. */
const classify = (response: MockResponse) => {
  const error = rawError(response);
  return classifyRefusal(response.status, error.code, error.details ?? {}, error.message);
};

describe("GET /media", () => {
  it("parses the library, with sizes empty on every row", () => {
    const { data, meta } = parseList(mediaList, get("/media", "per_page=100"));
    expect(meta.total).toBe(41);
    for (const item of data) {
      mediaItem.parse(item);
      // 30×20 fixtures, below every threshold at which WordPress generates a
      // thumbnail — so a client indexing into `sizes[0]` works in production and
      // fails on every test fixture. `url` is the size that always exists.
      //
      // `{}` and not `[]`: the mock emits PHP's serialisation of an empty map,
      // and the schema normalises it to the map it means. See `mediaSizes`.
      expect(item.sizes, String(item.id)).toEqual({});
      expect(item.url).not.toBe("");
    }
  });

  /**
   * **The populated shape has no fixture and cannot have one, so it is asserted
   * directly.**
   *
   * `sizes` is empty on all 41 rows and on every upload through this mock, which
   * is a *consequence* of the 30×20 fixtures rather than a shortcut — see the
   * seed. That left the field with no exercise at all, and it was wrong:
   * `MediaPresenter::sizes()` returns `array<string, array{width, height,
   * mime_type}>`, a map keyed by size name, and this schema declared an **array
   * of `{name, url, width, height}`**. It parsed only because an empty PHP map
   * serialises as `[]`; the day one sub-size existed, every media response in
   * the panel would have thrown at the boundary.
   *
   * So: both serialisations in, the map out, and the retired shape refused
   * rather than tolerated — a populated array is not something PHP can emit for
   * this field, and accepting one would be the permissive direction.
   */
  it("accepts both serialisations of sizes and refuses the shape that never existed", () => {
    expect(mediaSizes.parse([])).toEqual({});
    expect(
      mediaSizes.parse({
        thumbnail: { width: 150, height: 150, mime_type: "image/jpeg" },
        medium: { width: 300, height: 200, mime_type: "image/jpeg" },
      }).thumbnail.width,
    ).toBe(150);

    expect(
      mediaSizes.safeParse([{ name: "thumbnail", url: "u", width: 1, height: 1 }]).success,
    ).toBe(false);
    expect(mediaSizes.safeParse({ thumbnail: { width: 150 } }).success).toBe(false);
  });

  /**
   * **Every row is `image/*`, and that is a measurement rather than a
   * convenience.** All 41 attachments in this shop are images, so seeding a
   * `video/mp4` row to give a type filter something to separate would make the
   * harness hold something the shop does not — and a screen built to it would
   * render a "video" tile nobody can produce. `?type=video/mp4` is still a 200
   * with nothing in it, which is the honest way to reach that state.
   */
  it("holds nothing but images, because that is what the shop holds", () => {
    const { data } = parseList(mediaList, get("/media", "per_page=100"));
    for (const item of data) {
      expect(item.mime_type, String(item.id)).toMatch(/^image\//);
      expect(ACCEPTED_MIME as readonly string[]).toContain(item.mime_type);
    }
    const empty = parseList(mediaList, get("/media", "type=video/mp4"));
    expect(empty.data).toEqual([]);
    expect(empty.meta.total).toBe(0);
  });

  it("generates the filename as a collision suffix rather than a rewrite", () => {
    // Oldest first, because the resting order is `date desc` and these three are
    // the first attachments the shop ever took.
    const { data } = parseList(mediaList, get("/media", "per_page=3&orderby=id&order=asc"));
    // `real.jpg` uploaded three times stored `real.jpg`, `real-1.jpg` and
    // `real-2.jpg`, and the extension comes from the *sniffed* type. Show the
    // returned name, never the one the person picked. All three are JPEG: one
    // file uploaded three times cannot have produced three different types, and
    // this fixture rotated them through jpg/png/webp until the media branch.
    expect(data.map((item) => item.filename)).toEqual(["real.jpg", "real-1.jpg", "real-2.jpg"]);
  });

  it("pages the way its callers ask it to, at the screen's PER_PAGE of 20", () => {
    const first = parseList(mediaList, get("/media", "per_page=20&page=1"));
    const third = parseList(mediaList, get("/media", "per_page=20&page=3"));
    expect(first.data).toHaveLength(20);
    expect(third.data).toHaveLength(1);
    expect(first.meta.total_pages).toBe(3);
    expect(get("/media", "per_page=101").status).toBe(400);
  });

  /**
   * The fixtures the screen's own code paths need, each present for one reason.
   *
   * `filesize` is the length of what `/wp-content/uploads/…` really answers with
   * on every row, so the megabyte one is a genuine 1.2 MB file rather than a
   * large number over a 95-byte body.
   */
  it("carries the four fixtures the grid and the drawer have branches for", () => {
    const { data } = parseList(mediaList, get("/media", "per_page=100&orderby=id&order=asc"));

    // A row with no alt text at all: the grid says so rather than rendering blank.
    expect(data.filter((item) => item.alt === "")).toHaveLength(1);

    // The longest name `UploadPolicy::storedFilename()` can produce — an 80-char
    // stem with no break opportunity — and the title WordPress derives from it.
    const longest = data.find((item) => item.filename.length > 60);
    expect(longest?.filename.replace(/\.[^.]*$/, "")).toHaveLength(80);
    expect(longest?.filename).not.toContain("-");
    expect(longest?.title).toBe(longest?.filename.replace(/\.[^.]*$/, ""));

    // A long *title* is the other wrap, and it comes from a PATCH rather than
    // from a filename — `MediaInput::MAX_LENGTH` is 500.
    const wordy = data.find((item) => item.title.length > 100);
    expect(wordy?.title.length).toBeGreaterThan(100);
    expect(wordy?.title.length).toBeLessThanOrEqual(500);

    // `formatBytes`' `Mo` branch had no fixture anywhere until this row existed.
    const large = data.find((item) => item.filesize >= 1024 * 1024);
    expect(large).toBeDefined();
    expect(formatBytes(large!.filesize, "fr")).toMatch(/Mo$/);
    // And the other two branches, so all three are exercised by real rows.
    expect(formatBytes(data[0].filesize, "fr")).toMatch(/ o$/);
  });

  /**
   * **`url` resolves.** It named `boutique.example.dz` until this branch — a host
   * that does not exist — so every tile in a capture would have been a broken
   * box. The bytes themselves are fetched over HTTP further down; this pins the
   * shape, which is the half a pure `respond()` can see.
   */
  it("points url at this process rather than at a host that does not resolve", () => {
    const { data } = parseList(mediaList, get("/media", "per_page=100"));
    for (const item of data) {
      expect(item.url, String(item.id)).toMatch(
        new RegExp(`^http://127\\.0\\.0\\.1:\\d+/wp-content/uploads/2026/08/${item.filename}$`),
      );
    }
  });

  /**
   * **A third timestamp format, measured on the live router 2026-08-27.**
   *
   * `MediaPresenter` uses `mysql_to_rfc3339()`, which emits `Y-m-d\\TH:i:s` with
   * no offset — `"2026-08-27T19:52:00"`. This file emitted the order's
   * `"…+00:00"` until the media branch. `new Date()` reads an offsetless stamp as
   * *local* time and shifts it by the host's offset in silence, so a mock with an
   * offset here would let a media screen skip `parseApiDate()` and look right.
   */
  it("stamps dates with no offset, which is a third format and not the order's", () => {
    const { data } = parseList(mediaList, get("/media", "per_page=100"));
    for (const item of data) {
      for (const field of [item.date_created, item.date_modified]) {
        expect(field, String(item.id)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      }
    }
    // And it still reaches the right instant through the panel's own reader,
    // which is the only thing that makes reproducing the format safe.
    expect(parseApiDate(data[0].date_created)?.toISOString()).toBe(
      `${data[0].date_created}.000Z`,
    );
  });
});

/**
 * ── The four parameters the router honours and this file used to ignore ──────
 *
 * `type`, `orderby`, `order` and `search` all reach `MediaRepository::paginate()`
 * and all four do something. The mock ignored every one of them, which is the
 * *less capable* direction — a screen offering a sort would have looked broken
 * against the harness and invited someone to delete a control that works.
 *
 * The refusals are the router's, and they are what keeps two fallbacks in the
 * repository unreachable: an off-enum `orderby` silently becomes `date` there and
 * a non-mime `type` silently becomes no filter, but `MediaController::indexArgs()`
 * 400s on both first. Copying the repository instead of the router is how a mock
 * becomes more permissive than the shop.
 */
describe("GET /media — the query", () => {
  it("refuses off-enum and off-pattern exactly where the controller does", () => {
    const orderby = get("/media", "orderby=rand");
    expect(orderby.status).toBe(400);
    expect(rawError(orderby).code).toBe("invalid_request");
    expect(apiError(orderby).params?.orderby).toBe("orderby is not one of date, title, and id.");

    const order = get("/media", "order=sideways");
    expect(order.status).toBe(400);
    expect(apiError(order).params?.order).toBe("order is not one of asc and desc.");

    const type = get("/media", "type=../../etc");
    expect(type.status).toBe(400);
    expect(rawError(type).code).toBe("invalid_request");
    expect(apiError(type).params?.type).toContain("does not match pattern");

    expect(get("/media", "per_page=100000").status).toBe(400);

    // `""` is a value that fails the pattern, not an absence — the reading
    // `?date_from=` was measured to take and `?orderby=` takes everywhere.
    expect(get("/media", "type=").status).toBe(400);
    expect(get("/media", "orderby=").status).toBe(400);
  });

  it("sorts by all three fields in both directions, with distinct sequences", () => {
    const ids = (query: string) =>
      parseList(mediaList, get("/media", `${query}&per_page=100`)).data.map((item) => item.id);

    const ascending = ids("orderby=id&order=asc");
    const descending = ids("orderby=id&order=desc");
    expect(ascending).toEqual([...descending].reverse());
    expect(new Set(ascending).size).toBe(41);

    /*
     * The positive control the standing rules ask for: a sort proved against the
     * order its own field implies, and never against the collection's default.
     * Compared accent-folded because MySQL's own collation is, which is the same
     * reason `searchRows` folds — a raw code-unit sort puts `épices` after
     * `nattes` and the shop does not.
     */
    const byTitle = parseList(mediaList, get("/media", "orderby=title&order=asc&per_page=100")).data;
    const titles = byTitle.map((item) =>
      item.title.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase(),
    );
    expect([...titles].sort()).toEqual(titles);
    // 27 distinct titles over 41 rows, so this cannot pass by tying on every row.
    expect(new Set(titles).size).toBeGreaterThan(20);

    // `date desc` is the resting order, which is what the bare listing answers.
    expect(ids("orderby=date&order=desc")).toEqual(ids("page=1"));
  });

  it("filters by a mime family and by an exact type", () => {
    const family = parseList(mediaList, get("/media", "type=image&per_page=100"));
    expect(family.meta.total).toBe(41);

    const exact = parseList(mediaList, get("/media", "type=image/jpeg&per_page=100"));
    expect(exact.meta.total).toBeGreaterThan(0);
    expect(exact.meta.total).toBeLessThan(41);
    for (const item of exact.data) expect(item.mime_type).toBe("image/jpeg");
  });

  /**
   * `?search=` matches title and caption — `WP_Query`'s `s` over `post_title` and
   * `post_excerpt`, which are the two of the three it searches that this
   * presenter emits. **Filename is deliberately not searched**: core has gated
   * attachment-filename search behind `wp_allow_query_attachment_by_filename`
   * since 5.9 and nobody has measured which way it sits on this install, so a
   * screen must not learn "search finds filenames" from the harness.
   */
  it("searches title and caption, accent-folded, and not the filename", () => {
    const found = parseList(mediaList, get("/media", "search=savon&per_page=100"));
    expect(found.meta.total).toBeGreaterThan(0);
    for (const item of found.data) {
      expect(`${item.title} ${item.caption}`.toLowerCase()).toContain("savon");
    }
    // The collation behind this endpoint is accent-insensitive on both sides.
    expect(parseList(mediaList, get("/media", "search=ceramique&per_page=100")).meta.total).toBe(
      parseList(mediaList, get("/media", "search=céramique&per_page=100")).meta.total,
    );
    // A filename that no title or caption contains finds nothing.
    expect(parseList(mediaList, get("/media", "search=real-1.png")).meta.total).toBe(0);
  });
});

/**
 * ── `PATCH /media/{id}`, against `tests/Api/media.php:387-437` case by case ───
 *
 * Every one of these is an assertion the backend's own suite makes, reproduced
 * here so the mock cannot drift from it in silence. Two of them were wrong in
 * this file before the media branch: `{}` answered **200** where the shop answers
 * 400, and the refusal sentence was `"The attachment is invalid."` where
 * `MediaInput` says `"The media data is invalid."`
 */
describe("PATCH /media/{id}", () => {
  it("writes alt, title and caption, and reads them back", () => {
    const { data } = parse(
      mediaItem,
      write("PATCH", "/media/5001", { alt: "Tapis berbère", title: "Tapis", caption: "Fait main" }),
    );
    expect(data.alt).toBe("Tapis berbère");
    expect(data.title).toBe("Tapis");
    expect(parse(mediaItem, get("/media/5001")).data.caption).toBe("Fait main");
  });

  it("refuses an empty body, and a body of nothing but read-only keys", () => {
    for (const body of [{}, { filename: "autre.jpg", id: 9, sizes: [] }]) {
      const response = write("PATCH", "/media/5001", body);
      expect(response.status).toBe(400);
      expect(rawError(response).code).toBe("invalid_request");
      expect(rawError(response).message).toBe("No supported fields were provided.");
      // The shape `PATCH /products/{id}` was measured with: no `details` at all,
      // so a screen reaching for `details.fields` has to check.
      expect(rawError(response)).not.toHaveProperty("details");
    }
    // And the read-only key really did leave in silence rather than land.
    expect(parse(mediaItem, get("/media/5001")).data.filename).toBe("real.jpg");
  });

  it("refuses an unknown field, and the file by name", () => {
    const unknown = write("PATCH", "/media/5001", { description: "nope" });
    expect(unknown.status).toBe(400);
    expect(rawError(unknown).message).toBe("The media data is invalid.");
    expect(apiError(unknown).fields?.description).toBe("Unknown field.");

    // The bytes are not editable, and the refusal says what to do instead —
    // asserted by substring in the backend suite, so by substring here.
    const file = write("PATCH", "/media/5001", { file: "other.jpg" });
    expect(file.status).toBe(400);
    expect(String(apiError(file).fields?.file)).toContain("upload a new one");
  });

  it("refuses the three post fields a write path must never reach", () => {
    for (const field of ["post_type", "post_status", "post_author"]) {
      const response = write("PATCH", "/media/5001", { [field]: "page" });
      expect(response.status, field).toBe(400);
      expect(apiError(response).fields?.[field], field).toBe("Not editable.");
    }
  });

  it("clears a field with null, and takes a scalar rather than refusing it", () => {
    expect(parse(mediaItem, write("PATCH", "/media/5001", { caption: null })).data.caption).toBe("");
    /*
     * `MediaInput` casts anything `is_scalar()` and PATCH has no arg schema above
     * it, so `{"alt": 5}` is a 200 storing `"5"` at the shop. This file answered
     * 400 — the *stricter* direction, which DECISIONS.md §0 says is not the safe
     * one. Only objects and arrays are refused.
     */
    expect(parse(mediaItem, write("PATCH", "/media/5001", { alt: 5 })).data.alt).toBe("5");
    expect(apiError(write("PATCH", "/media/5001", { alt: { a: 1 } })).fields?.alt).toBe(
      "Must be a string.",
    );
    expect(apiError(write("PATCH", "/media/5001", { title: "x".repeat(501) })).fields?.title).toBe(
      "Must be at most 500 characters.",
    );
  });

  /**
   * **Two different 404s.** `/media/99999999` matches the route pattern and
   * reaches the controller, which answers `not_found` with its own sentence;
   * `/media/abc` matches nothing and is a `rest_no_route`. This file answered
   * `rest_no_route` to both until the media branch, which would have let a screen
   * treat "no such attachment" as "no such endpoint".
   */
  it("separates the missing row from the missing route", () => {
    for (const response of [get("/media/99999999"), write("PATCH", "/media/99999999", { alt: "x" })]) {
      expect(response.status).toBe(404);
      expect(rawError(response).code).toBe("not_found");
      expect(rawError(response).message).toBe("No media item with that id.");
    }
    expect(rawError(get("/media/abc")).code).toBe("rest_no_route");
  });

  /**
   * `DELETE /media/{id}` exists at the API and `ac_manage_content` allows it. It
   * is off the panel's allowlist and unserved here for one reason: nothing tells
   * a client what an attachment is *used by* — a banner's `image`, a page
   * thumbnail and a homepage section all reference one with no back-reference
   * anywhere — so the library cannot answer "what would this break?", and an
   * irreversible action a screen cannot explain is worse than one it does not
   * offer.
   */
  it("leaves the delete unreachable", () => {
    expect(write("DELETE", "/media/5001").status).toBe(404);
    expect(write("PUT", "/media/5001", { alt: "x" }).status).toBe(404);
  });
});

/**
 * ── `POST /media`, and the order of its checks is the whole contract ─────────
 *
 * The five refusals are lib/media.ts:18-23, with their statuses, their codes and
 * their `details` keys — and the ordering trap that measurement itself took a
 * correction for: **the size floor fires before the sniffer**, so a 48-byte fake
 * PDF answers 400 `invalid_upload` and not 415. That reading survived a whole
 * measurement until a 5.4 KB control was run beside it.
 *
 * Asserted by `code` and by `details`, never by sentence alone: the two 415s that
 * share a code are separated by `details` and by nothing else, and comparing
 * prose is exactly what let fourteen wrong codes live in this file for weeks.
 */
describe("POST /media", () => {
  it("creates an attachment, at 201, with the name the server generated", () => {
    const response = uploadFile("Tapis Berbère #2.JPG", REAL_JPEG, [["alt", "Un tapis"]]);
    expect(response.status).toBe(201);

    const { data } = parse(mediaItem, response);
    // The stored name comes from `storedFilename()`: lowercased, every character
    // outside [a-z0-9] collapsed to a hyphen, and the extension from the
    // *sniffed* type rather than from the `.JPG` that was sent.
    expect(data.filename).toBe("tapis-berb-re-2.jpg");
    expect(data.mime_type).toBe("image/jpeg");
    expect(data.alt).toBe("Un tapis");
    // Read from the image header, the way `getimagesize()` does.
    expect([data.width, data.height]).toEqual([30, 20]);
    expect(data.filesize).toBe(REAL_JPEG.length);
    // The empty map, normalised from PHP's `[]` — see `mediaSizes`.
    expect(data.sizes).toEqual({});

    // And it is in the library immediately, at the top of the resting order.
    const listed = parseList(mediaList, get("/media", "per_page=100"));
    expect(listed.meta.total).toBe(42);
    expect(listed.data[0].id).toBe(data.id);
  });

  it("suffixes a name already taken, which is the trio the fixture reproduces", () => {
    expect(parse(mediaItem, uploadFile("real.jpg", REAL_JPEG)).data.filename).toBe("real-3.jpg");
    expect(parse(mediaItem, uploadFile("real.jpg", REAL_JPEG)).data.filename).toBe("real-4.jpg");
  });

  it("takes alt, title and caption beside the file, and ignores anything else", () => {
    const { data } = parse(
      mediaItem,
      uploadFile("x.png", REAL_PNG, [
        ["title", "Titre"],
        ["caption", "Légende"],
        // The controller only ever reads `MediaInput::allowedFields()` out of the
        // request, so an unknown field beside the file is dropped where the same
        // key on `PATCH` is a 400. The asymmetry is the router's.
        ["nope", "1"],
      ]),
    );
    expect(data.title).toBe("Titre");
    expect(data.caption).toBe("Légende");

    // The text fields are validated before the policy runs — `MediaService`'s
    // own order — so an over-long alt is an `invalid_request`, not a file error.
    const long = uploadFile("y.png", REAL_PNG, [["alt", "a".repeat(501)]]);
    expect(long.status).toBe(400);
    expect(rawError(long).code).toBe("invalid_request");
  });

  it("refuses a file under the 64-byte floor, before it sniffs anything", () => {
    const response = uploadFile("t.jpg", Buffer.alloc(MIN_BYTES - 16, 0x41));
    expect(response.status).toBe(400);
    expect(rawError(response).code).toBe("invalid_upload");
    expect(rawError(response).details).toEqual({ size: MIN_BYTES - 16 });
    expect(classify(response)).toEqual({ kind: "too_small", size: MIN_BYTES - 16 });

    /*
     * The ordering trap, and the reason lib/media.ts carries a paragraph about
     * it: a 48-byte PDF renamed `.png` answers **400** and not 415, because
     * `MIN_BYTES` is checked before `finfo` runs. A mock that sniffed first would
     * teach an upload dialog to expect a `detected` that never arrives.
     */
    const tiny = uploadFile("t.png", Buffer.from(`%PDF-1.4\n${"A".repeat(39)}`));
    expect(tiny.status).toBe(400);
    expect(rawError(tiny).code).toBe("invalid_upload");
    expect(rawError(tiny).details).not.toHaveProperty("detected");
  });

  it("refuses a file over 8 MiB, with the cap in the details", () => {
    const response = uploadFile("big.jpg", Buffer.alloc(MAX_BYTES + 1, 0x41));
    expect(response.status).toBe(413);
    expect(rawError(response).code).toBe("file_too_large");
    expect(rawError(response).details).toEqual({ size: MAX_BYTES + 1, max_bytes: MAX_BYTES });
    expect(classify(response)).toEqual({
      kind: "too_large",
      size: MAX_BYTES + 1,
      maxBytes: MAX_BYTES,
    });
  });

  it("refuses an extension it does not accept, naming the extension", () => {
    const response = uploadFile(
      "drawing.gif",
      Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(200, 0x41)]),
    );
    expect(response.status).toBe(415);
    expect(rawError(response).code).toBe("unsupported_media_type");
    expect(rawError(response).details).toEqual({ extension: "gif" });
    expect(classify(response)).toEqual({ kind: "bad_extension", extension: "gif" });

    // The SVG the backend suite sends, byte for byte, takes this same path —
    // `.svg` is not an accepted extension, so nothing ever reads the `<script>`
    // inside it. It is 71 bytes, which is over the floor, so the extension check
    // really is what refuses it rather than the size one.
    expect(
      uploadFile(
        "a.svg",
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ).status,
    ).toBe(415);
  });

  it("refuses a file that is not an image, naming what it detected", () => {
    // 5.4 KB, which is the control the measurement needed: over `MIN_BYTES`, so
    // the sniffer actually runs.
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5400, 0x41)]);
    const response = uploadFile("doc.png", pdf);
    expect(response.status).toBe(415);
    expect(rawError(response).code).toBe("unsupported_media_type");
    expect(rawError(response).details).toEqual({ detected: "application/pdf" });
    expect(classify(response)).toEqual({ kind: "not_an_image", detected: "application/pdf" });

    // A PHP web shell wearing an image's extension: nothing about the name gives
    // it away, and the content sniff is the only thing that refuses it.
    const shell = uploadFile("innocent.jpg", `<?php system($_GET['c']); ?>${"#".repeat(300)}`);
    expect(shell.status).toBe(415);
    expect(rawError(shell).details).toHaveProperty("detected");
    expect(classify(shell).kind).toBe("not_an_image");
  });

  /**
   * The fifth, and the one worth separating from the third. "Only jpg, png and
   * webp are accepted" tells someone who picked a `.gif` exactly what to do; it
   * tells someone who renamed a JPEG to `.png` something that looks false, when
   * the fix is to re-export rather than to pick a different file. `details`
   * carrying **both** facts is the only thing that separates the two.
   */
  it("refuses a file whose contents disagree with its extension, naming both", () => {
    const response = uploadFile("photo.png", REAL_JPEG);
    expect(response.status).toBe(415);
    expect(rawError(response).code).toBe("unsupported_media_type");
    expect(rawError(response).details).toEqual({ extension: "png", detected: "image/jpeg" });
    expect(classify(response)).toEqual({
      kind: "contents_disagree",
      extension: "png",
      detected: "image/jpeg",
    });
  });

  /**
   * **`../../evil.jpg` is not in this list, and that is the correction the diff
   * against the live router produced.** PHP strips the path before the
   * application sees a name, so a traversal filename is a **201** storing
   * `evil.jpg` — measured 2026-08-27. `a..b.jpg` carries no separator for the
   * basename to strip and is the shape that really does reach the path check.
   *
   * The control-character case cannot arrive over HTTP either; it is kept
   * because the shop keeps it.
   */
  it("refuses a hostile filename with no details at all", () => {
    const cases: [string, string][] = [
      ["shell.php.jpg", "The filename contains a disallowed extension."],
      ["a..b.jpg", "The filename must not contain a path."],
      ["evil.php\u0007.jpg", "The filename contains control characters."],
      ["noextension", "The filename has no extension."],
    ];
    for (const [filename, message] of cases) {
      const response = uploadFile(filename, REAL_JPEG);
      expect(response.status, filename).toBe(400);
      expect(rawError(response).code, filename).toBe("invalid_upload");
      expect(rawError(response).message, filename).toBe(message);
      // No `details`, which is what `classifyRefusal()` reads as "bad filename"
      // rather than as "too small" — the two share both status and code.
      expect(rawError(response), filename).not.toHaveProperty("details");
      expect(classify(response), filename).toEqual({ kind: "bad_filename" });
    }
  });

  it("refuses a request with no file, and one with more than one", () => {
    const none = upload([{ name: "alt", value: "x" }]);
    expect(none.status).toBe(400);
    expect(rawError(none).code).toBe("invalid_upload");
    expect(rawError(none).message).toContain('field named "file"');

    /*
     * **Only a `file[]` field reaches this refusal.** Two parts both named
     * `file` are one field written twice — PHP keeps the last and the shop
     * answers 201, measured live 2026-08-27. This file answered 400 to both
     * until the diff that found it, which is a refusal an upload dialog could
     * never provoke.
     */
    const two = upload([
      { name: "file[]", filename: "a.jpg", value: REAL_JPEG },
      { name: "file[]", filename: "b.jpg", value: REAL_JPEG },
    ]);
    expect(two.status).toBe(400);
    expect(rawError(two).message).toBe("Upload one file per request.");

    const repeated = upload([
      { name: "file", filename: "first.jpg", value: REAL_JPEG },
      { name: "file", filename: "second.jpg", value: REAL_JPEG },
    ]);
    expect(repeated.status).toBe(201);
    expect(parse(mediaItem, repeated).data.filename).toBe("second.jpg");

    // And the path a traversal name really takes: stripped by PHP, stored, 201.
    expect(parse(mediaItem, uploadFile("../../evil.jpg", REAL_JPEG)).data.filename).toBe("evil.jpg");
    expect(parse(mediaItem, uploadFile("C:\\dir\\b.jpg", REAL_JPEG)).data.filename).toBe("b.jpg");

    // A JSON body reaches the same refusal: to this route, "no multipart" and
    // "no file entry" are the same failure.
    const json = write("POST", "/media", { file: "x" });
    expect(json.status).toBe(400);
    expect(rawError(json).code).toBe("invalid_upload");
  });

  /**
   * The **second** reader `UploadPolicy::sniff()` runs. `finfo` matches the head
   * of a file and `getimagesize()` parses the image header, and a file that
   * satisfies one and not the other is refused with the *detected* type rather
   * than with a fourth code. A truncated PNG is what reaches that line.
   */
  it("refuses a file whose magic bytes and header disagree", () => {
    const truncated = Buffer.concat([REAL_PNG.subarray(0, 12), Buffer.alloc(80, 0x41)]);
    const response = uploadFile("t.png", truncated);
    expect(response.status).toBe(415);
    expect(rawError(response).details).toEqual({ detected: "image/png" });
  });
});

/**
 * ── The half a pure `respond()` cannot see ───────────────────────────────────
 *
 * `url` is the field the whole screen rests on, and until this branch it pointed
 * at `boutique.example.dz` — so every tile in a capture would have been a broken
 * box and the screenshot would have proved only that the grid laid out. Fetching
 * one is the only assertion that can tell the difference, so it is taken over
 * real HTTP against a real listener rather than inferred from the string.
 */
describe("the uploads directory", () => {
  it("answers real image bytes for a seeded tile and for an uploaded one", async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
    const port = (server.address() as { port: number }).port;
    // `url` carries the port this module read at load, which is not the ephemeral
    // one this listener took — the path is what is under test either way.
    const fetchTile = (url: string) => fetch(`http://127.0.0.1:${port}${new URL(url).pathname}`);

    try {
      const { data } = parseList(mediaList, get("/media", "per_page=100"));
      // One row of each accepted type, plus the 1.2 MB one — which is the row
      // where a declared size and a real body are most able to disagree.
      const samples = [
        ...ACCEPTED_MIME.map((mime) => data.find((item) => item.mime_type === mime)!),
        data.find((item) => item.filesize >= 1024 * 1024)!,
      ];

      const magic: Record<string, (bytes: Buffer) => void> = {
        "image/jpeg": (bytes) =>
          expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff])),
        "image/png": (bytes) => expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG"),
        "image/webp": (bytes) => expect(bytes.subarray(8, 12).toString("latin1")).toBe("WEBP"),
      };

      for (const item of samples) {
        const response = await fetchTile(item.url);
        expect(response.status, item.filename).toBe(200);
        expect(response.headers.get("content-type"), item.filename).toBe(item.mime_type);
        const bytes = Buffer.from(await response.arrayBuffer());
        // The declared size is the real one, which is what keeps `formatBytes`
        // honest about a file somebody could download.
        expect(bytes.length, item.filename).toBe(item.filesize);
        // And the magic bytes, so "200 with a body" cannot pass for an image.
        magic[item.mime_type](bytes);
      }

      // An uploaded file is served the same way, or the grid right after an
      // upload is one broken box among forty-one working ones.
      const created = parse(mediaItem, uploadFile("tapis.jpg", REAL_JPEG));
      const uploaded = await fetchTile(created.data.url);
      expect(uploaded.status).toBe(200);
      expect(Buffer.from(await uploaded.arrayBuffer())).toEqual(REAL_JPEG);

      expect((await fetchTile("http://x/wp-content/uploads/2026/08/nothing.png")).status).toBe(404);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});

/**
 * `MOCK_MEDIA=empty`, on the `MOCK_HOMEPAGE` precedent — and it is the only way
 * to reach an empty library, because the screen takes no parameters at all.
 */
describe("MOCK_MEDIA", () => {
  it("serves an empty library behind the knob, and nothing else changes", async () => {
    vi.stubEnv("MOCK_MEDIA", "empty");
    try {
      vi.resetModules();
      const mock = await import("@/scripts/mock-api.mjs");
      const response = mock.respond("GET", `${mock.BASE_PATH}/media`);
      const { data, meta } = unwrap(mediaList, response.body, response.status);
      expect(data).toEqual([]);
      expect(listMeta.parse(meta).total).toBe(0);
      // The picker inside the banner sheet reads this collection, so an empty
      // library is also the only way to photograph a picker with nothing to pick
      // — and an `image_id` it cannot resolve is correctly a 400 there.
      expect(
        mock.respond("PATCH", `${mock.BASE_PATH}/cms/banners/7301`, new URLSearchParams(), {
          image_id: 5001,
        }).status,
      ).toBe(400);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
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
  /*
   * **Covered by all seven of its reports**, and it is the first module on this
   * list with nothing named below it. `overviewReport` is the dashboard's whole
   * request — the screen the specification describes as six round trips is one,
   * because the overview nests every block the cards need — and the six the
   * `/analytics` screen reads one at a time are served and parsed above.
   *
   * Every schema in the module is exercised: `revenueBody` on its own route and
   * nested in the overview, `bestSeller`, `providerStat`, `wilayaRow` and
   * `unattributed` inside their reports, `unavailableReasons` in two of them,
   * and `analyticsRange` in all seven.
   */
  "analytics",
  /*
   * **Covered by every schema in the module**, which is the standard `analytics`
   * set and the one this branch had to meet: `pageRow`/`pageList` on the index,
   * `page` and `pageSeo` on the document, `banner`/`bannerList`,
   * `faqCategory`/`faqCategoryList`, `faq`/`faqList`, `menuItem`/`menu`,
   * `homepageSection`/`homepage` and `homepageProblems` on the drop report, and
   * `embeddedImage` through the one write that can produce it — a banner's
   * `image_id`, since `image` is null on every seeded row in this shop.
   *
   * What the module cannot express is named below rather than left implied.
   */
  "cms",
  /*
   * `mediaItem` and `mediaList` are exercised across the listing, the four query
   * parameters, every PATCH case in the backend's own suite and the upload — the
   * media branch owns this collection and covers it.
   *
   * **`mediaSizes` has no fixture and that is correct, not a gap.** `sizes` is
   * empty on all 41 rows because the images are 30×20, below every threshold at
   * which WordPress generates a thumbnail, and an upload through this mock
   * produces none either. Inventing one would mean inventing WordPress's
   * thresholds.
   *
   * **What it did hide, until the media branch, was a wrong shape.** The schema
   * declared an array of `{name, url, width, height}` where
   * `MediaPresenter::sizes()` returns a map keyed by size name of
   * `{width, height, mime_type}` — two objects with nothing in common, parsing
   * only because an empty PHP map serialises as `[]`. A missing fixture is not
   * the same as a field nobody has to be right about, so the corrected schema is
   * asserted directly beside the listing rather than left to a future upload.
   */
  "media",
];

const UNCOVERED: Record<string, string> = {
  audit: "/audit is not mocked yet",
  campaign: "/campaigns is not mocked yet",
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
  /**
   * **The shipping half of this block became real coverage on 2026-08-25** and
   * the payments half on 2026-08-26 — `/shipping/rules`, `/shipping/rates`, `GET
   * /shipments`, `GET /shipments/{id}`, `GET /payments`, `GET /payments/{id}` and
   * `GET /cod/statistics` are all served and all parsed above, so the seven
   * assertions that used to pin them at 404 are gone rather than deleted quietly.
   *
   * **The three payments pins were a declared gap that had stopped being true.**
   * Every one of them is allowlisted and every one is called by a screen that
   * already exists, so the reason recorded beside them — "a transaction is
   * reached through its order" — described the order detail and never described
   * the API. A declared gap is only honest while somebody re-reads the
   * declaration; this is the second time on this branch that one outlived its
   * measurement, after `GET /shipping/rules/{id}`.
   *
   * What is left here is what is still genuinely unserved.
   */
  it("leaves the payment mint and the standalone parcel create unmocked", () => {
    /*
     * **`POST /orders/{id}/payments` stays a 404 at both spellings**, and it is
     * the one write on this subject the API really offers: it opens a checkout at
     * the provider and hands back a real `pay.chargily.dz` link for a *shopper*.
     * lib/api/allowlist.ts:164-178 refuses it deliberately, so a fixture that
     * answered it would be an invitation to build the screen that must not exist.
     */
    expect(write("POST", "/payments", { provider: "chargily" }).status).toBe(404);
    expect(write("POST", "/orders/1023/payments", { provider: "chargily" }).status).toBe(404);
    // And there is no PATCH on a transaction anywhere in the surface, which is
    // why `lib/payment-status.ts`'s rule that `paid` is not terminal can never
    // surface as a 409 the panel could render.
    expect(write("PATCH", "/payments/5231", { status: "paid" }).status).toBe(404);

    // There is still no `POST /shipments` — a parcel is created against an
    // order and nowhere else.
    expect(write("POST", "/shipments", { order_id: 1007 }).status).toBe(404);
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
  /**
   * **The six analytics reports stopped being a declared gap on 2026-08-26**, and
   * the assertion that pinned them at 404 is gone rather than deleted quietly.
   * It said the gap was scope rather than doubt — the dashboard needed one route,
   * the analytics screen the other six — and that was true right up until the six
   * payloads were measured. All seven are served and parsed above.
   *
   * **`GET /analytics/shipping` in particular was a gap in this file and never in
   * the shop.** DECISIONS.md still records it as "the one allowlisted route on
   * this subject still answering `rest_no_route`"; measured 2026-08-26 it answers
   * **200 with a full payload**, for a Support Agent as well as for a Super
   * Admin. The ledger still needs that correction — it is a documentation file
   * and this branch could not touch it. Nothing here should teach anyone to
   * branch on a `rest_no_route` the API does not send.
   *
   * What is left unserved under `/analytics` is a name nobody wrote, which is the
   * assertion this keeps: the collection must not have become a catch-all.
   */
  it("serves the seven analytics reports and nothing else under the collection", () => {
    for (const report of [
      "overview", "revenue", "orders", "products", "customers", "shipping", "cod",
    ]) {
      expect(get(`/analytics/${report}`).status, report).toBe(200);
    }
    expect(get("/analytics/traffic").status).toBe(404);
    expect(get("/analytics/inventory").status).toBe(404);
  });

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
