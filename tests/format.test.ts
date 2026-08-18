/**
 * @vitest-environment node
 *
 * Pure logic — no DOM. It also has to be node: under jsdom, `jose` receives a
 * Uint8Array from the wrong realm and refuses it ("plaintext must be an instance
 * of Uint8Array"), which is an artefact of the test environment and not of the
 * code under test.
 */
import { describe, expect, it } from "vitest";
import { formatMoney, moneyLocale } from "@/lib/format/money";
import { formatDate, formatWhen, parseApiDate } from "@/lib/format/date";
import { decodeEntities } from "@/lib/format/html";

/**
 * Each of these pins a fact measured against the live API on 2026-08-18. They are
 * regression tests for silent bugs — the kind where nothing throws and the number
 * on screen is simply wrong.
 */

describe("money", () => {
  it("renders the shop's currency symbol, not the ISO code", () => {
    // The region subtag is not decoration: a bare `fr` gives "DZD".
    expect(moneyLocale("fr")).toBe("fr-DZ");
    const rendered = formatMoney("26350.00", "DZD", "fr");
    expect(rendered).toContain("DA");
    expect(rendered).not.toContain("DZD");
  });

  it("uses Latin digits in Arabic", () => {
    const rendered = formatMoney("26350.00", "DZD", "ar");
    // Eastern Arabic numerals would be wrong here and unreadable to the staff
    // using this, so the numbering system is pinned rather than left to default.
    expect(rendered).toMatch(/26.350,00/);
    expect(rendered).not.toMatch(/[٠-٩]/);
  });

  it("never renders NaN beside a currency symbol", () => {
    // Positive control first: a real amount formats.
    expect(formatMoney("4200.00", "DZD", "fr")).toMatch(/4\s?200,00/);
    // A zero is a real number and must still render.
    expect(formatMoney("0.00", "DZD", "fr")).toMatch(/0,00/);
    // Absent or malformed is an em dash, because "NaN DA" gets read as zero.
    for (const bad of [null, undefined, "", "n/a"]) {
      expect(formatMoney(bad, "DZD", "fr")).toBe("—");
    }
  });

  it("does not compute — it renders the string it is given", () => {
    // A value with more precision than the display keeps its own magnitude; the
    // panel never re-derives a total.
    expect(formatMoney("14800.00", "DZD", "fr")).toMatch(/14\s?800,00/);
  });
});

describe("dates", () => {
  it("reads an offsetless timestamp as UTC, not as local time", () => {
    /**
     * The bug this exists for: order.date_created is ISO 8601 with an offset,
     * but note.created_at is "2026-08-18 02:52:22" with none. `new Date()` treats
     * the second as local time, so on a UTC+2 host every order note silently
     * shifted by two hours.
     */
    const withOffset = parseApiDate("2026-08-18T02:52:22+00:00");
    const withoutOffset = parseApiDate("2026-08-18 02:52:22");
    expect(withOffset?.toISOString()).toBe("2026-08-18T02:52:22.000Z");
    expect(withoutOffset?.toISOString()).toBe("2026-08-18T02:52:22.000Z");
    // The positive control that makes the assertion meaningful: the naive parse
    // this guards against really does differ on a non-UTC host.
    const naive = new Date("2026-08-18 02:52:22");
    if (naive.getTimezoneOffset() !== 0) {
      expect(naive.toISOString()).not.toBe("2026-08-18T02:52:22.000Z");
    }
  });

  it("returns null for junk rather than an Invalid Date", () => {
    expect(parseApiDate("not a date")).toBeNull();
    expect(parseApiDate(null)).toBeNull();
    expect(parseApiDate("")).toBeNull();
    // Positive control.
    expect(parseApiDate("2026-08-18T00:00:00+01:00")).toBeInstanceOf(Date);
  });

  it("renders in the shop's timezone, not the host's", () => {
    // 23:30 UTC is the next day in Africa/Algiers (UTC+1). A panel rendering in
    // the browser's zone would date this differently for a manager in France.
    const rendered = formatDate("2026-08-17T23:30:00+00:00", "fr");
    expect(rendered).toMatch(/18/);
  });

  it("is relative under a day and absolute beyond it", () => {
    const now = new Date("2026-08-18T12:00:00Z");
    expect(formatWhen("2026-08-18T10:00:00+00:00", "fr", now)).toMatch(/h|heure/);
    // Beyond 24 hours it becomes a date, and a date contains a year.
    expect(formatWhen("2026-08-01T10:00:00+00:00", "fr", now)).toMatch(/2026/);
  });

  it("renders an absent date as an em dash", () => {
    expect(formatDate(null, "fr")).toBe("—");
    expect(formatWhen(null, "fr")).toBe("—");
  });
});

describe("entity decoding", () => {
  it("decodes the arrow the timeline actually sends", () => {
    // Measured verbatim from GET /orders/3078/timeline.
    expect(decodeEntities("Stock levels reduced: AC-SHIP-BOX (99&rarr;98)")).toBe(
      "Stock levels reduced: AC-SHIP-BOX (99→98)",
    );
  });

  it("does not double-decode", () => {
    // `&amp;rarr;` means the literal text "&rarr;", not an arrow. A sequence of
    // replaces with &amp; handled separately gets this wrong.
    expect(decodeEntities("&amp;rarr;")).toBe("&rarr;");
    expect(decodeEntities("Tapis &amp; Kilims")).toBe("Tapis & Kilims");
  });

  it("handles numeric and hex references", () => {
    expect(decodeEntities("&#8594;")).toBe("→");
    expect(decodeEntities("&#x2192;")).toBe("→");
  });

  it("leaves an unknown entity alone rather than eating it", () => {
    expect(decodeEntities("&notarealentity;")).toBe("&notarealentity;");
    // A lone surrogate would throw from String.fromCodePoint.
    expect(decodeEntities("&#xD800;")).toBe("&#xD800;");
  });

  it("passes through text with no entities untouched", () => {
    const plain = "Order status changed from Pending payment to Processing.";
    expect(decodeEntities(plain)).toBe(plain);
  });
});
