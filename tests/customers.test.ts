/**
 * @vitest-environment node
 *
 * The customer and coupon logic that carries a measurement. Every case here
 * corresponds to something observed against the live API on 2026-08-19, and the
 * comments name which observation.
 */
import { describe, expect, it } from "vitest";
import {
  addressLines,
  consentRecord,
  customerName,
  hasAddress,
  hasNoOrders,
  searchMatchesName,
  statFigures,
  statusBreakdown,
} from "@/lib/customers";
import {
  discount,
  discountsPerProduct,
  expiryInputValue,
  isExpired,
  isShippingOnly,
  missingRefs,
  normalizeCode,
  refLabel,
  restrictionCount,
  threshold,
  usage,
} from "@/lib/coupons";
import { COUPON_STATUS_TONE, READABLE_COUPON_STATUSES, isExclusion } from "@/lib/coupon-status";
import type { Customer, CustomerStatistics } from "@/lib/api/schemas/customer";
import type { Coupon, Restrictions } from "@/lib/api/schemas/coupon";

/** A customer with the shape the API actually sends, overridable per case. */
function customer(overrides: Partial<Customer> = {}): Customer {
  const blank = {
    first_name: "",
    last_name: "",
    company: "",
    address_1: "",
    address_2: "",
    city: "",
    state: "",
    postcode: "",
    country: "",
    phone: "",
  };

  return {
    id: 24,
    username: "ac_cus_shopper",
    email: "ac_cus_shopper@example.test",
    first_name: "",
    last_name: "",
    role: "customer",
    is_paying_customer: false,
    marketing_consent: false,
    marketing_consent_at: null,
    marketing_consent_source: null,
    billing: { ...blank, email: "" },
    shipping: { ...blank },
    date_created: "2026-08-16T23:06:39+00:00",
    date_modified: null,
    ...overrides,
  };
}

function statistics(overrides: Partial<CustomerStatistics> = {}): CustomerStatistics {
  return {
    total_orders: 0,
    completed_orders: 0,
    cancelled_orders: 0,
    returned_orders: 0,
    total_revenue: "0.00",
    average_order_value: "0.00",
    first_order: null,
    last_order: null,
    by_status: {
      pending: 0,
      processing: 0,
      "on-hold": 0,
      completed: 0,
      cancelled: 0,
      refunded: 0,
      failed: 0,
    },
    ...overrides,
  };
}

describe("what to call a customer", () => {
  /**
   * **12 of the 16 customers in this shop have no name at all.** A list that
   * renders `first_name` as the row's identity renders twelve blank rows, so the
   * fallback chain is the common path here rather than the edge case.
   */
  it("falls back to the username, and then to the email", () => {
    expect(customerName(customer({ first_name: "Amina", last_name: "Benali" }))).toEqual({
      kind: "name",
      text: "Amina Benali",
    });

    expect(customerName(customer())).toEqual({
      kind: "username",
      text: "ac_cus_shopper",
    });

    expect(customerName(customer({ username: "" }))).toEqual({
      kind: "email",
      text: "ac_cus_shopper@example.test",
    });
  });

  /** One half of a name is a name. Half the seeded customers have only one. */
  it("uses whichever half of the name exists", () => {
    expect(customerName(customer({ first_name: "Amina" })).text).toBe("Amina");
    expect(customerName(customer({ last_name: "Benali" })).text).toBe("Benali");
    // And a name of only whitespace is not a name.
    expect(customerName(customer({ first_name: "   " })).kind).toBe("username");
  });

  /**
   * The discriminator exists so the row can *style* the fallback. A login
   * rendered at the same weight as a person's name reads as somebody called
   * ac_cus_shopper, which is why this is a union and not a string.
   */
  it("says which kind of label it returned", () => {
    expect(customerName(customer()).kind).not.toBe("name");
  });
});

describe("the search box cannot find a name", () => {
  /**
   * Measured with a positive control on 2026-08-19: customer 26 was given the
   * names `Zqxwvu Plmokn`, `?search=Zqxwvu` returned **0 rows**, and
   * `?search=cus_fresh` returned 1. `?search=` matches `user_login`, `user_email`
   * and `display_name` — never `first_name` or `last_name`.
   *
   * So Amina Benali, the one richly-populated customer in this shop, cannot be
   * found by typing her name, and the empty state has to say so.
   */
  it("detects a term that matches the name but nothing searchable", () => {
    const amina = customer({
      first_name: "Amina",
      last_name: "Benali",
      username: "ac_cus_shopper",
      email: "ac_cus_shopper@example.test",
    });

    expect(searchMatchesName(amina, "Benali")).toBe(true);
    expect(searchMatchesName(amina, "amina")).toBe(true);
  });

  /**
   * The positive control, and the reason this is not simply "the term looks like
   * a word". `sofiane.benali@example.test` *is* findable by "Benali", because the
   * email carries it — so the same term is a real search for one customer and a
   * dead end for another, and only the fields decide which.
   */
  it("is false when the term is in the email or the username", () => {
    const sofiane = customer({
      first_name: "Sofiane",
      last_name: "Benali",
      username: "sofiane.benali",
      email: "sofiane.benali@example.test",
    });

    expect(searchMatchesName(sofiane, "Benali")).toBe(false);
    expect(searchMatchesName(customer(), "cus_fresh")).toBe(false);
    expect(searchMatchesName(customer(), "")).toBe(false);
  });
});

describe("the consent record", () => {
  /**
   * Four states collapse into three renderings, and the distinction the bare
   * boolean could not make is *declined* versus *never asked*. Before this branch
   * the payload carried only `marketing_consent: false` and there was no way to
   * tell them apart; `marketing_consent_at` is now written for both directions,
   * so its absence is the one reliable signal that no decision exists.
   */
  it("tells never-asked from withdrawn", () => {
    expect(consentRecord(customer())).toEqual({ state: "never" });

    expect(
      consentRecord(
        customer({
          marketing_consent: false,
          marketing_consent_at: "2026-03-03T09:00:00+00:00",
          marketing_consent_source: "unsubscribe_link",
        }),
      ),
    ).toEqual({
      state: "withdrawn",
      at: "2026-03-03T09:00:00+00:00",
      source: "unsubscribe_link",
    });
  });

  it("reports a granted consent with its date and source", () => {
    expect(
      consentRecord(
        customer({
          marketing_consent: true,
          marketing_consent_at: "2026-08-19T00:41:37+00:00",
          marketing_consent_source: "registration",
        }),
      ),
    ).toEqual({
      state: "granted",
      at: "2026-08-19T00:41:37+00:00",
      source: "registration",
    });
  });

  /**
   * A consent recorded before `marketing_consent_source` existed has a date and
   * no source. It must still read as a decision — the date is what proves one was
   * made — rather than falling back to "never asked".
   */
  it("keeps the state when the source predates the record", () => {
    const record = consentRecord(
      customer({ marketing_consent: true, marketing_consent_at: "2026-01-01T00:00:00+00:00" }),
    );

    expect(record.state).toBe("granted");
    expect(record.state !== "never" && record.source).toBe(null);
  });
});

describe("the statistics do not divide", () => {
  /**
   * The measurement this whole card is designed around. On customer 24:
   * `total_orders: 5`, `completed_orders: 2`, `total_revenue: "2100.00"`,
   * `average_order_value: "1050.00"`.
   *
   * 2100 ÷ 5 is 420. The API's own arithmetic is 2100 ÷ 2 — revenue is the sum of
   * the *completed* orders, verified against that customer's order list
   * (1500 + 600) — so every figure is internally consistent and only the labels
   * can make it visible.
   */
  const twentyFour = statistics({
    total_orders: 5,
    completed_orders: 2,
    cancelled_orders: 1,
    returned_orders: 1,
    total_revenue: "2100.00",
    average_order_value: "1050.00",
    by_status: {
      pending: 0,
      processing: 1,
      "on-hold": 0,
      completed: 2,
      cancelled: 1,
      refunded: 1,
      failed: 0,
    },
  });

  it("gives every figure a scope, so none can be printed bare", () => {
    const figures = statFigures(twentyFour);

    expect(figures.find((f) => f.key === "total_orders")?.scope).toBe("all");
    // The two money figures and the completed count all share one scope, and it
    // is not the one `total_orders` uses. That mismatch is the whole point.
    for (const key of ["completed_orders", "total_revenue", "average_order_value"] as const) {
      expect(figures.find((f) => f.key === key)?.scope).toBe("completed");
    }
  });

  it("marks exactly the two figures that are money", () => {
    // The money gate hides these two and keeps the counts, so the card degrades
    // to a narrower report rather than to an empty box.
    expect(statFigures(twentyFour).filter((f) => f.money).map((f) => f.key)).toEqual([
      "total_revenue",
      "average_order_value",
    ]);
  });

  /**
   * `by_status` sums to `total_orders` exactly, which is what makes it the block
   * that explains why revenue counts fewer orders than the customer placed.
   * Asserted rather than assumed, because if it ever stopped being true the
   * breakdown would be quietly contradicting the count above it.
   */
  it("has a breakdown that sums to the total", () => {
    const breakdown = statusBreakdown(twentyFour);
    const sum = breakdown.reduce((total, row) => total + row.count, 0);

    expect(sum).toBe(twentyFour.total_orders);
    // Zeros dropped: five of the seven statuses are 0 here, and rendering them
    // would bury two real numbers on a 390px screen.
    expect(breakdown.map((row) => row.status).sort()).toEqual([
      "cancelled",
      "completed",
      "processing",
      "refunded",
    ]);
  });

  /** 11 of the 16 have never ordered, so this is the common case, not the edge. */
  it("knows when there is nothing to report", () => {
    expect(hasNoOrders(statistics())).toBe(true);
    expect(statusBreakdown(statistics())).toEqual([]);
    expect(hasNoOrders(twentyFour)).toBe(false);
  });
});

describe("addresses", () => {
  /**
   * Every address field is a string and an unset address is eleven empty ones,
   * never `null` — so a card gated on `billing !== null` is eleven blank rows.
   * `shipping` is empty on all but one customer in this shop.
   */
  it("is empty when every field is blank", () => {
    expect(hasAddress(customer().billing)).toBe(false);
    expect(hasAddress(customer({ billing: { ...customer().billing, city: "Alger" } }).billing)).toBe(
      true,
    );
  });

  /**
   * A billing email is not an address. Every customer has one on the account, and
   * counting it would render an address card whose only row is not part of any
   * address.
   */
  it("does not count the billing email as an address", () => {
    const billing = { ...customer().billing, email: "a@b.test" };
    expect(hasAddress(billing)).toBe(false);
  });

  it("drops the empty lines and pairs the postcode with the city", () => {
    expect(
      addressLines({
        address_1: "12 rue Larbi Ben M'hidi",
        address_2: "",
        city: "Bab El Oued",
        state: "Alger",
        postcode: "16008",
      }),
    ).toEqual(["12 rue Larbi Ben M'hidi", "16008 Bab El Oued", "Alger"]);

    expect(
      addressLines({ address_1: "", address_2: "", city: "", state: "", postcode: "" }),
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ coupons --- */

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 30,
    code: "tapis15",
    status: "publish",
    discount_type: "percent",
    amount: "15.00",
    description: "",
    date_expires: null,
    minimum_amount: null,
    maximum_amount: null,
    usage_limit: null,
    usage_limit_per_user: null,
    limit_usage_to_x_items: null,
    usage_count: 0,
    individual_use: false,
    free_shipping: false,
    exclude_sale_items: false,
    product_ids: [],
    excluded_product_ids: [],
    product_categories: [],
    excluded_product_categories: [],
    email_restrictions: [],
    date_created: "2026-08-16T23:03:31+00:00",
    date_modified: null,
    ...overrides,
  };
}

describe("the coupon code", () => {
  /**
   * WooCommerce lower-cases every code on save — `BRIEF-TEST-99` came back
   * `brief-test-99` — and the duplicate check runs on the folded form, which is
   * why `BIENVENUE10` answers 409 against the stored `bienvenue10`.
   */
  it("folds to the form that will actually be stored", () => {
    expect(normalizeCode("BIENVENUE10")).toBe("bienvenue10");
    expect(normalizeCode("  Tapis15 ")).toBe("tapis15");
  });
});

describe("zero and null are different in opposite directions", () => {
  /**
   * **The trap this object carries twice, pointing two ways.**
   *
   * `amount: "0.00"` is a real coupon: the `livraison` fixture is a zero discount
   * with `free_shipping: true`. A threshold of zero is not — the API folds it to
   * null on write, so `"0.00"` can never be read back from `minimum_amount`.
   */
  it("keeps a zero amount as a value", () => {
    expect(discount(coupon({ discount_type: "fixed_cart", amount: "0.00" }))).toEqual({
      kind: "money",
      value: "0.00",
    });
  });

  it("treats an absent threshold as unset, never as zero", () => {
    expect(threshold(null)).toEqual({ set: false });
    expect(threshold("")).toEqual({ set: false });
    expect(threshold("15000.00")).toEqual({ set: true, value: "15000.00" });
  });

  /**
   * The `livraison` fixture: `amount: "0.00"`, `free_shipping: true`. A row
   * reading "0 DA" beside it would be accurate and useless.
   */
  it("recognises a coupon whose whole effect is the shipping", () => {
    expect(isShippingOnly(coupon({ amount: "0.00", free_shipping: true }))).toBe(true);
    // Free shipping *and* a real discount is led by the discount.
    expect(isShippingOnly(coupon({ amount: "2000.00", free_shipping: true }))).toBe(false);
    expect(isShippingOnly(coupon({ amount: "0.00", free_shipping: false }))).toBe(false);
  });
});

describe("the expiry is asymmetric", () => {
  /**
   * **Written as `Y-m-d`, read back as full ISO.**
   *
   *   PATCH {"date_expires": "2026-12-31"}  →  "2026-12-31T00:00:00+00:00"
   *
   * An `<input type="date">` given the ISO form renders *empty*, then posts an
   * empty string on the next save — which the API accepts as "clear the expiry".
   * The round trip deletes a date nobody touched.
   */
  it("gives a date input a value it can actually display", () => {
    expect(expiryInputValue("2026-12-31T00:00:00+00:00")).toBe("2026-12-31");
    expect(expiryInputValue("2026-12-31")).toBe("2026-12-31");
    expect(expiryInputValue(null)).toBe("");
    // Anything the control could not render becomes empty rather than garbage.
    expect(expiryInputValue("31/12/2026")).toBe("");
  });

  /**
   * A past date is accepted by the API without complaint — measured,
   * `2020-01-01` is a 200 — so an expired coupon is an ordinary row that reads as
   * `publish` and would otherwise look live.
   */
  it("marks a past expiry, and keeps today valid", () => {
    const now = new Date("2026-08-19T10:00:00Z");

    expect(isExpired("2020-01-01T00:00:00+00:00", now)).toBe(true);
    // Valid *through* the day it expires: WooCommerce stores midnight UTC and the
    // coupon works all that day.
    expect(isExpired("2026-08-19T00:00:00+00:00", now)).toBe(false);
    expect(isExpired("2026-12-31T00:00:00+00:00", now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
  });
});

describe("usage", () => {
  /**
   * `usage_count` is 0 on all four fixtures and no panel route can move it —
   * redemption is `POST /cart/coupons` on the storefront — so the exhausted
   * rendering has no data in this shop that can reach it, and is tested here
   * instead.
   */
  it("reports an unlimited coupon as unlimited, not as a limit of zero", () => {
    expect(usage(coupon({ usage_count: 3, usage_limit: null }))).toEqual({
      limited: false,
      count: 3,
    });
  });

  it("knows when the allowance is gone", () => {
    expect(usage(coupon({ usage_count: 50, usage_limit: 50 })).limited).toBe(true);
    expect(usage(coupon({ usage_count: 50, usage_limit: 50 }))).toMatchObject({
      exhausted: true,
    });
    expect(usage(coupon({ usage_count: 12, usage_limit: 50 }))).toMatchObject({
      exhausted: false,
    });
  });
});

describe("the restrictions", () => {
  function restrictions(overrides: Partial<Restrictions> = {}): Restrictions {
    return {
      product_ids: [],
      excluded_product_ids: [],
      product_categories: [],
      excluded_product_categories: [],
      ...overrides,
    };
  }

  it("counts across all four fields", () => {
    expect(restrictionCount(coupon())).toBe(0);
    expect(
      restrictionCount(coupon({ product_categories: [16], excluded_product_ids: [1, 2] })),
    ).toBe(3);
  });

  /**
   * An id that resolves to nothing keeps its place with `name: null` rather than
   * being dropped — a client that filtered it out would delete the restriction the
   * next time the form saved, and the only evidence would be a discount that
   * stopped applying.
   */
  it("finds the stale ids across every field", () => {
    const stale = missingRefs(
      restrictions({
        product_ids: [
          { id: 119, name: "Shipping test", missing: false },
          { id: 8842, name: null, missing: true },
        ],
        excluded_product_categories: [{ id: 999999, name: null, missing: true }],
      }),
    );

    expect(stale.map((ref) => ref.id)).toEqual([8842, 999999]);
  });

  /**
   * Never a bare id where a name goes. An id printed as a label reads as a
   * product called 8842, so the caller renders the missing case as its own thing
   * with the id as evidence — the rule `movementActor()` follows for an actor it
   * cannot name.
   */
  it("refuses to pass off an id as a name", () => {
    expect(refLabel({ id: 16, name: "Tapis et Textiles", missing: false })).toEqual({
      named: true,
      text: "Tapis et Textiles",
    });
    expect(refLabel({ id: 8842, name: null, missing: true })).toEqual({ named: false });
    // A resolved row with an empty name is the same problem wearing a string.
    expect(refLabel({ id: 5, name: "", missing: false })).toEqual({ named: false });
  });

  it("knows which fields exclude", () => {
    expect(isExclusion("excluded_product_ids")).toBe(true);
    expect(isExclusion("excluded_product_categories")).toBe(true);
    expect(isExclusion("product_ids")).toBe(false);
    expect(isExclusion("product_categories")).toBe(false);
  });

  /**
   * Only `fixed_product` discounts each matching line. The other two apply to the
   * cart and use the product list as a *condition* — so "500 DA off these two
   * products" on a `fixed_cart` coupon takes 500 DA off the whole basket, and the
   * form has to say which it is.
   */
  it("knows which discount type actually bites per product", () => {
    expect(discountsPerProduct("fixed_product")).toBe(true);
    expect(discountsPerProduct("fixed_cart")).toBe(false);
    expect(discountsPerProduct("percent")).toBe(false);
  });
});

describe("the coupon status vocabulary", () => {
  /**
   * `trash` is readable and not filterable — `?status=trash` is a 400 while a
   * trashed coupon GETs as 200 — so the readable set has to be wider than the
   * settable one, and every readable value needs a tone or the badge crashes on
   * the one status nobody tested.
   */
  it("has a tone for every status that can be read back", () => {
    for (const status of READABLE_COUPON_STATUSES) {
      expect(COUPON_STATUS_TONE[status]).toBeTruthy();
    }
  });
});
