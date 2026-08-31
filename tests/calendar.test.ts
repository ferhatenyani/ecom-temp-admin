/**
 * `lib/calendar.ts` — the arithmetic and the locale reading behind the drawn
 * date picker.
 *
 * A unit file rather than a component one, because everything asserted here is a
 * claim about a *module*: what `Intl` says about `fr-DZ` and `ar-DZ`, and what
 * comes back out of a string that went in. None of it needs a render, and the
 * two things that do — that the field shows the locale's order and that Arabic's
 * arrow keys mirror — are in `tests/form.test.tsx` §7 where a document exists to
 * ask.
 *
 * Six things are asserted, and each of them is either a defect this control
 * would otherwise have shipped or a measurement the docblocks rest on:
 *
 *   1. both locales are day-month-year, which is what makes `mm/dd/yyyy` the
 *      browser's ordering rather than either reader's
 *   2. the week starts on **Saturday** in both, which is Algeria's week and is
 *      not the Sunday-or-Monday the item assumed
 *   3. the grid is always six rows and never has a hole in it
 *   4. what the field prints, it can read back — including in Arabic, whose own
 *      separator carries a RIGHT-TO-LEFT MARK nobody can type
 *   5. a date that is not a date is refused rather than normalised
 *   6. month arithmetic does not roll 31 January into 3 March
 */
import { describe, expect, it } from "vitest";
import {
  fieldOrder,
  firstWeekday,
  formatEntry,
  makeYmd,
  monthGrid,
  parseEntry,
  readYmd,
  sameMonth,
  shiftDays,
  shiftMonths,
  todayYmd,
  toYmd,
  withinRange,
} from "@/lib/calendar";

const LOCALES = ["fr", "ar"] as const;

/* ──────────────────────────────────────────────────────── 1. the locale ─── */

describe("the field order comes from the locale and not from a table here", () => {
  /**
   * The measurement the whole branch rests on. If this ever fails it is *news*,
   * not a broken test: it would mean CLDR had changed one of the two orders and
   * the placeholder, the parser and the printed value would all move together —
   * which is exactly why they are all derived from this one function.
   */
  it("is day-month-year in French and in Arabic", () => {
    for (const locale of LOCALES) {
      expect(fieldOrder(locale), locale).toEqual(["day", "month", "year"]);
    }
  });

  /**
   * The finding that matters most, stated as a test so nobody has to re-derive
   * it: the defect the drawn picker fixes was never a disagreement between the
   * panel's two languages. They agree. The disagreement was with the browser,
   * which rendered a **US** `mm/dd/yyyy` into both of them.
   */
  it("means neither locale ever wanted month-first", () => {
    for (const locale of LOCALES) {
      expect(fieldOrder(locale)[0], locale).not.toBe("month");
    }
  });

  /**
   * CLDR's `firstDay` for `fr-DZ` and `ar-DZ` is 6 — Saturday — with Friday and
   * Saturday as the weekend. The step this was built for said "Sunday/Monday
   * week start … from the locale"; a hand-written table would have been wrong in
   * both languages, which is the argument for reading it.
   */
  it("starts the week on Saturday in both, which is Algeria's week", () => {
    for (const locale of LOCALES) {
      expect(firstWeekday(locale), locale).toBe(6);
    }
  });
});

/* ─────────────────────────────────────────────────────────── 2. the grid ─── */

describe("the month grid", () => {
  it("is always six rows of seven, so the popover never changes height", () => {
    /* February 2026 is 28 days starting on a Sunday — the shortest possible
       month on the tightest possible alignment, which is where a grid sized to
       its content would be five rows and would jump when March arrived. */
    for (const month of ["2026-02-01", "2026-03-01", "2026-08-01", "2027-05-01"]) {
      const grid = monthGrid(month, firstWeekday("fr"));
      expect(grid, month).toHaveLength(6);
      for (const week of grid) expect(week, month).toHaveLength(7);
    }
  });

  it("has no holes — every cell is a real day", () => {
    const grid = monthGrid("2026-03-01", firstWeekday("fr"));
    const days = grid.flat();
    expect(days).toHaveLength(42);
    for (const day of days) expect(readYmd(day), day).not.toBeNull();
  });

  it("runs consecutively across the whole grid, including over a month edge", () => {
    const days = monthGrid("2026-03-01", firstWeekday("fr")).flat();
    for (let index = 1; index < days.length; index += 1) {
      expect(days[index], `${days[index - 1]} → ${days[index]}`).toBe(shiftDays(days[index - 1], 1));
    }
  });

  it("opens its first column on the locale's first weekday", () => {
    const first = firstWeekday("ar");
    const grid = monthGrid("2026-03-01", first);
    expect(new Date(`${grid[0][0]}T00:00:00Z`).getUTCDay()).toBe(first);
  });

  it("contains the whole of the month it was asked for", () => {
    const days = new Set(monthGrid("2026-02-01", firstWeekday("fr")).flat());
    for (let day = 1; day <= 28; day += 1) {
      expect(days.has(`2026-02-${String(day).padStart(2, "0")}`), String(day)).toBe(true);
    }
  });
});

/* ─────────────────────────────────────────────────── 3. the round trip ─── */

describe("what the field prints, the field can read back", () => {
  /**
   * The property that makes the control usable at all: a person can copy the
   * value out of one date field and paste it into the other one beside it.
   *
   * It is asserted in **Arabic** as well as French deliberately. `ar-DZ`'s own
   * numeric literal is `‏/` — U+200F RIGHT-TO-LEFT MARK, then the slash — and a
   * field that printed the locale's literal would be printing a value it then
   * refused, because U+200F is not on any keyboard. `formatEntry` prints the
   * locale's *order* with an ASCII separator, and this is what says so.
   */
  it("round-trips every day of a year, in both languages", () => {
    for (const locale of LOCALES) {
      let day = "2026-01-01";
      for (let step = 0; step < 365; step += 1) {
        expect(parseEntry(formatEntry(day, locale), locale), `${locale} ${day}`).toBe(day);
        day = shiftDays(day, 1);
      }
    }
  });

  it("prints an ASCII separator and no bidi marks", () => {
    for (const locale of LOCALES) {
      const printed = formatEntry("2026-03-14", locale);
      expect(printed, locale).toBe("14/03/2026");
      expect(/[‎‏]/.test(printed), locale).toBe(false);
    }
  });

  it("prints nothing for no date, which is a real value here", () => {
    expect(formatEntry("", "fr")).toBe("");
    expect(parseEntry("", "fr")).toBe("");
    expect(parseEntry("   ", "ar")).toBe("");
  });
});

/* ────────────────────────────────────────────────────────── 4. parsing ─── */

describe("parsing what somebody typed", () => {
  it("takes the locale's order", () => {
    expect(parseEntry("14/03/2026", "fr")).toBe("2026-03-14");
    expect(parseEntry("14/03/2026", "ar")).toBe("2026-03-14");
  });

  it("takes any separator, so a value pasted from anywhere still lands", () => {
    for (const typed of ["14-03-2026", "14.03.2026", "14 03 2026", "14/3/2026"]) {
      expect(parseEntry(typed, "fr"), typed).toBe("2026-03-14");
    }
  });

  /**
   * The Arabic value copied *out of this panel's own rendered text* —
   * `formatDay` writes `14‏/03‏/2026` with the marks in it. Pasting that into
   * the field has to work, and it does because the parser splits on any run of
   * non-digits rather than on the one separator it prints.
   */
  it("takes an Arabic date pasted with its RIGHT-TO-LEFT MARKs", () => {
    expect(parseEntry("14‏/03‏/2026", "ar")).toBe("2026-03-14");
  });

  /**
   * The one place the locale's order is deliberately overruled. `2026-03-14` is
   * the wire format, it is in half the panel's URLs, and no locale writes a
   * four-digit day — so a leading four-digit run is read as ISO whatever
   * `fieldOrder` says.
   */
  it("reads a leading four-digit run as ISO, in both locales", () => {
    for (const locale of LOCALES) {
      expect(parseEntry("2026-03-14", locale), locale).toBe("2026-03-14");
      expect(parseEntry("2026/03/14", locale), locale).toBe("2026-03-14");
    }
  });

  it("refuses a two-digit year rather than guessing a century", () => {
    expect(parseEntry("14/03/26", "fr")).toBeNull();
    /* Three digits is a year somebody meant. Only two is the ambiguous case. */
    expect(parseEntry("14/03/026", "fr")).toBe("0026-03-14");
  });

  it("refuses a day that is not a day, rather than rolling it forward", () => {
    /* `Date.UTC(2026, 1, 31)` is 3 March. A field that accepted `31/02/2026` and
       saved the third of March is the silent-wrong-value defect this refuses. */
    expect(parseEntry("31/02/2026", "fr")).toBeNull();
    expect(parseEntry("30/02/2026", "ar")).toBeNull();
    expect(parseEntry("00/03/2026", "fr")).toBeNull();
    expect(parseEntry("14/13/2026", "fr")).toBeNull();
  });

  it("takes 29 February in a leap year and refuses it in a common one", () => {
    expect(parseEntry("29/02/2028", "fr")).toBe("2028-02-29");
    expect(parseEntry("29/02/2026", "fr")).toBeNull();
  });

  it("refuses anything that is not three numbers", () => {
    for (const typed of ["14/03", "hier", "14/03/2026/11", "--", "14/03/20261"]) {
      expect(parseEntry(typed, "fr"), typed).toBeNull();
    }
  });
});

/* ─────────────────────────────────────────────────────── 5. arithmetic ─── */

describe("the arithmetic the arrow keys and the month buttons run on", () => {
  it("walks days across a month and a year boundary", () => {
    expect(shiftDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(shiftDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDays("2026-03-14", 7)).toBe("2026-03-21");
  });

  /**
   * The defect a bare `setUTCMonth` ships: 31 January plus one month is 3 March,
   * so a "next month" button on a calendar showing January skips February
   * entirely and nothing on screen explains it.
   */
  it("clamps to the end of a shorter month instead of rolling over", () => {
    expect(shiftMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(shiftMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftMonths("2026-03-14", 12)).toBe("2027-03-14");
    expect(shiftMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("compares a range as plain strings, which is what Y-m-d is for", () => {
    expect(withinRange("2026-03-14", "2026-03-01", "2026-03-31")).toBe(true);
    expect(withinRange("2026-04-01", undefined, "2026-03-31")).toBe(false);
    expect(withinRange("2026-02-28", "2026-03-01", undefined)).toBe(false);
    expect(withinRange("2026-03-14")).toBe(true);
  });

  it("knows a month from a month", () => {
    expect(sameMonth("2026-03-01", "2026-03-31")).toBe(true);
    expect(sameMonth("2026-03-31", "2026-04-01")).toBe(false);
    expect(sameMonth("2025-03-14", "2026-03-14")).toBe(false);
  });

  /**
   * Everything in the module is UTC, for `formatDay`'s reason: a calendar day is
   * not an instant, and reading one in a local zone is how a picker shows
   * yesterday to somebody west of Greenwich.
   */
  it("builds and reads every date in UTC", () => {
    expect(toYmd(new Date("2026-03-14T23:59:59Z"))).toBe("2026-03-14");
    expect(toYmd(new Date("2026-03-14T00:00:00Z"))).toBe("2026-03-14");
    expect(makeYmd(2026, 3, 14)).toBe("2026-03-14");
    expect(makeYmd(2026, 2, 31)).toBe("");
    expect(readYmd("2026-02-31")).toBeNull();
    expect(readYmd("2026-3-14")).toBeNull();
  });

  /**
   * `todayYmd` is the one function here that reads a **local** clock, and it is
   * deliberate: "today" on a calendar means the day the person is having, not
   * the day it is in UTC. Injectable so this is not a hostage to the wall clock.
   */
  it("reads today from the reader's own machine", () => {
    expect(todayYmd(new Date(2026, 2, 14, 23, 30))).toBe("2026-03-14");
    expect(todayYmd(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });
});
