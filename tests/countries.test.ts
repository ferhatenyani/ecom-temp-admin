import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  COUNTRY_READING_ORDER,
  DEFAULT_COUNTRY,
  EXCLUDED_CODES,
  countryName,
  countryOptions,
  isCountryShape,
} from "@/lib/countries";

/**
 * The country table, checked against its own recipe.
 *
 * `lib/countries.ts` is 249 rows of generated data and one number — 280 ICU
 * regions minus 31 named exclusions — and generated data that nobody re-checks
 * is data somebody hand-edits. These are the properties the generator
 * guarantees, asserted so that a hand-edit which breaks one fails here instead
 * of on an operator's screen.
 *
 * **The sync assertion is the reason this file exists.** "French and Arabic in
 * exact sync" is a house rule about strings, and for a *list* it means something
 * stronger than "both exist": the two reading orders must be permutations of one
 * another, or an Arabic operator and a French one are choosing from two
 * different sets of countries under one label. Prose cannot hold that; a
 * permutation check can.
 */
describe("the country table", () => {
  it("holds exactly the 249 codes ISO 3166-1 assigns", () => {
    /*
     * The arithmetic the file's docblock records: ICU resolves 280 region codes
     * in both languages, 31 of them are not countries, and 249 is the published
     * count of officially assigned alpha-2 codes. This asserts the end of that
     * subtraction rather than re-running it — re-running it would mean calling
     * `Intl.DisplayNames` here, which is exactly the runtime dependency the
     * table exists to have already spent.
     */
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(Object.keys(EXCLUDED_CODES)).toHaveLength(31);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
  });

  it("keeps every excluded code out of the table", () => {
    /* `ZZ` above all: it is CLDR's *unknown region*, the API accepts it with a
       200 because the rule is `^[A-Z]{2}$` and nothing more, and an order in
       this shop may already be carrying it. It must be renderable and must not
       be offerable. */
    for (const code of Object.keys(EXCLUDED_CODES)) {
      expect(COUNTRY_CODES).not.toContain(code);
      expect(countryName(code, "fr")).toBeNull();
      expect(countryName(code, "ar")).toBeNull();
    }
  });

  it("names every code in both languages, and never as its own code", () => {
    for (const code of COUNTRY_CODES) {
      const fr = countryName(code, "fr");
      const ar = countryName(code, "ar");

      expect(fr).toBeTruthy();
      expect(ar).toBeTruthy();
      /* `Intl.DisplayNames` with `fallback: "code"` answers the code itself for
         a region it has no name for. The generator asks for `fallback: "none"`
         precisely so that case is dropped rather than committed, and this is
         the check that it was. */
      expect(fr).not.toBe(code);
      expect(ar).not.toBe(code);
      /* No row carries the same string twice — measured over the committed
         table, all 249 differ — so this catches a column filled in from the
         wrong side, which is the shape a bad hand-edit or a half-run generator
         actually takes. */
      expect(ar).not.toBe(fr);
    }
  });

  it("uses well-formed codes throughout, so every option satisfies the API", () => {
    /* The picker can only offer what is in this table, so this is what makes
       the local shape rule unreachable from the control — see
       `AddressFields`'s docblock, which keeps that rule for stored values
       written by something other than this panel. */
    for (const code of COUNTRY_CODES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(isCountryShape(code)).toBe(true);
    }
  });

  it("orders the same 249 codes two ways, and only two ways", () => {
    /* The sync rule, as a permutation. Not a length check: two lists of 249 can
       both be the right length and disagree about San Marino. */
    for (const locale of ["fr", "ar"] as const) {
      const order = COUNTRY_READING_ORDER[locale];
      expect(order).toHaveLength(COUNTRY_CODES.length);
      expect([...order].sort()).toEqual([...COUNTRY_CODES].sort());
    }

    /* And they are genuinely two orders. If somebody regenerated with one
       collator by mistake, every other assertion here would still pass and an
       Arabic reader would get a list alphabetised in French. */
    expect(COUNTRY_READING_ORDER.fr).not.toEqual(COUNTRY_READING_ORDER.ar);
  });

  it("collates each order the way its own language does", () => {
    /*
     * The one assertion that re-derives rather than checks a shape, and it is
     * worth the cost: it is what says the committed sequence is a *collation*
     * and not the order the generator's `for` loop happened to produce.
     *
     * `Intl.Collator` and not `Intl.DisplayNames`, deliberately. Collation data
     * is far more stable across CLDR releases than display names are — the file
     * docblock's whole case against runtime `Intl` is about names being
     * revised — and a failure here means the table was regenerated with a
     * different collator or hand-edited, which is exactly what it should mean.
     */
    for (const locale of ["fr", "ar"] as const) {
      const collator = new Intl.Collator(locale);
      const names = COUNTRY_READING_ORDER[locale].map(
        (code) => countryName(code, locale) as string,
      );

      for (let i = 1; i < names.length; i += 1) {
        expect(
          collator.compare(names[i - 1], names[i]),
          `${names[i - 1]} should sort before ${names[i]} in ${locale}`,
        ).toBeLessThanOrEqual(0);
      }
    }
  });

  it("opens the Arabic list on the Arabic alphabet, article and all", () => {
    /*
     * The measurement the file's docblock quotes, pinned. CLDR does **not**
     * strip the definite article, so `الجزائر` sorts under `ا` with every other
     * `ال…` name rather than under `ج` — which is what an Arabic reader's other
     * software does and therefore what this must keep doing. A future
     * "improvement" that stripped it would fail here with the reason attached.
     */
    const ar = COUNTRY_READING_ORDER.ar;
    expect(ar.slice(0, 5).map((code) => countryName(code, "ar"))).toEqual([
      "آيسلندا",
      "إثيوبيا",
      "أذربيجان",
      "أرمينيا",
      "أروبا",
    ]);
    expect(ar.indexOf("DZ")).toBeLessThan(ar.indexOf("JP"));
  });
});

describe("what the control asks of it", () => {
  it("pre-selects Algeria, under a name in both languages", () => {
    expect(DEFAULT_COUNTRY).toBe("DZ");
    expect(COUNTRY_CODES).toContain(DEFAULT_COUNTRY);
    expect(countryName(DEFAULT_COUNTRY, "fr")).toBe("Algérie");
    expect(countryName(DEFAULT_COUNTRY, "ar")).toBe("الجزائر");
  });

  it("matches a lowercase code, because the API accepts one and upper-cases it", () => {
    /* `AddressInput::validateCountry()` does `strtoupper()` before it tests, so
       an order stored by some other client may hold `dz`. A picker that failed
       to match it would report the shop's own country as unrecognised. */
    expect(countryName("dz", "fr")).toBe("Algérie");
    expect(countryName("  Dz  ", "ar")).toBe("الجزائر");
  });

  it("answers null for a code the shop does not know, rather than echoing it", () => {
    /* The whole reason `countryName` returns `null`: `AddressFields` has to be
       able to tell "France" from "ZZ" so it can append an option carrying the
       raw value with the right second line. A function that returned the code
       would hand it something that renders like a name and is not one. */
    expect(countryName("ZZ", "fr")).toBeNull();
    expect(countryName("Algeria", "fr")).toBeNull();
    expect(countryName("", "ar")).toBeNull();
  });

  it("splits an off-list value on shape, which is what gives it two sentences", () => {
    /* `ZZ` is a well-formed code naming no country — unroutable, not malformed.
       `Algeria` is a name where a code belongs, which is the mistake the API
       itself refuses by name. The control says different things about them. */
    expect(isCountryShape("ZZ")).toBe(true);
    expect(isCountryShape("dz")).toBe(true);
    expect(isCountryShape("Algeria")).toBe(false);
    expect(isCountryShape("D")).toBe(false);
  });

  it("builds the options in the locale's order, and caches the array", () => {
    const fr = countryOptions("fr");
    const ar = countryOptions("ar");

    expect(fr).toHaveLength(249);
    expect(fr.map((option) => option.value)).toEqual([...COUNTRY_READING_ORDER.fr]);
    expect(ar[0].label).toBe("آيسلندا");

    /* Identity, not equality: the same frozen array comes back, so a form
       re-rendering on every keystroke in the field beside it does not allocate
       249 objects per character. */
    expect(countryOptions("fr")).toBe(fr);
    expect(countryOptions("en")).toBe(fr);
  });
});
