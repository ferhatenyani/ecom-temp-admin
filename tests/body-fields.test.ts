import { describe, expect, it } from "vitest";
import {
  AA_NORMAL_TEXT,
  BODY_FIELD_KEYS,
  brandLegible,
  brandRatio,
  handEdited,
  isComposed,
  nextBodies,
  readValues,
  seededValues,
  shopLogo,
  writeValues,
} from "@/app/[locale]/(panel)/marketing/campaigns/[id]/body-fields";
import {
  BLOCKS,
  buildEmail,
  emptyValues,
  type EmailValues,
} from "@/app/[locale]/(panel)/marketing/campaigns/[id]/email-body";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * The seam between the composer's form and the `body_fields` column.
 *
 * Every backend claim asserted here was **read from source** in `../ecom-temp` on
 * `feat/campaign-composer` — the column is another agent's uncommitted work, so
 * there is nothing to measure in-process and nothing on the wire. The citations are
 * in `body-fields.ts` beside each decision; this file pins the panel's half of
 * them, which is the half a refactor can break.
 */

/** Every leaf key under a namespace, as a dotted path. `new-order.test.ts`'s. */
function flatKeys(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix];

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatKeys(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

const filled = (): EmailValues => ({
  direction: "ltr",
  brandColour: "#b21f2d",
  logo: { src: "https://shop.example/logo.png", alt: "La boutique", width: 240 },
  title: "Nos soldes commencent",
  paragraphs: ["Bonjour {{first_name}},", "Tout à moins de 500 DA."],
  image: { src: "https://shop.example/hero.jpg", alt: "", width: null },
  cta: { label: "Voir la boutique", href: "https://shop.example/fr/boutique" },
  footer: "Vous recevez ce message parce que vous êtes client.",
});

describe("the wire shape", () => {
  it("writes eight named keys and nothing else", () => {
    expect(Object.keys(writeValues(filled())).sort()).toEqual([...BODY_FIELD_KEYS].sort());
  });

  it("keeps the block keys and their order the generator's, not a second list", () => {
    expect(BODY_FIELD_KEYS.slice(2)).toEqual([...BLOCKS]);
  });

  /*
   * `CampaignInput::MAX_FIELD_KEY` is 64 **bytes**, measured with `strlen()`, and a
   * key over it is a 400 on the whole document. The margin today is enormous; the
   * assertion exists so a rename that reached for something descriptive would fail
   * here rather than on somebody's save.
   */
  it("keeps every key inside the backend's 64-byte name cap", () => {
    for (const key of BODY_FIELD_KEYS) {
      expect(Buffer.byteLength(key, "utf8")).toBeLessThanOrEqual(64);
      // `EmailHtml::looksLikeMarkup()`, which refuses a key as well as rewriting a
      // value. No key here can contain a `<`, and this says so rather than assuming.
      expect(key).not.toMatch(/<[a-zA-Z/!]/);
    }
  });

  /**
   * **The nested-empty-object wrinkle, refused by construction.**
   *
   * A nested `{}` reads back as `[]` — the assoc decode, and a `stdClass` cast that
   * is deliberately shallow so a repeater of blocks stays a list. This document can
   * never contain one, because an absent block is `null`. Asserted on the blank
   * values, which is the shape most likely to grow an empty object by accident.
   */
  it("writes an absent block as null and never as an empty object", () => {
    const wire = writeValues(emptyValues("rtl"));

    expect(wire.logo).toBeNull();
    expect(wire.image).toBeNull();
    expect(wire.cta).toBeNull();
    // The one list, and it stays a list through the round trip.
    expect(wire.paragraphs).toEqual([]);

    /* Arrays excluded on purpose: an empty *list* survives as `[]` and always did.
       It is the empty **object** that changes type on the way back. */
    const nested = Object.values(wire).filter(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0,
    );
    expect(nested).toEqual([]);
  });

  it("round-trips a filled document unchanged", () => {
    const values = filled();
    expect(readValues(writeValues(values), "ltr")).toEqual(values);
  });

  it("round-trips the blank document, in both directions", () => {
    for (const direction of ["ltr", "rtl"] as const) {
      const blank = emptyValues(direction);
      expect(readValues(writeValues(blank), "ltr")).toEqual(blank);
    }
  });
});

describe("null and {} are different claims", () => {
  /*
   * The whole branch. `null` means *no answers were ever recorded* — a hand-written
   * body, a template, a campaign older than the column, or a column that would not
   * parse, which `Campaign::decodedFields()` also reports as `null`. `{}` means the
   * form was used and every answer is blank.
   */
  it("reads null as no answers and {} as the empty form", () => {
    expect(readValues(null, "ltr")).toBeNull();
    expect(readValues({}, "ltr")).toEqual(emptyValues("ltr"));

    expect(isComposed(null)).toBe(false);
    expect(isComposed({})).toBe(true);
  });

  /**
   * A shop that has not run the migration answers without the key at all, so the
   * schema keeps it `.optional()` and this is the value that arrives. Absent and
   * `null` are the same claim and must not need a second branch anywhere.
   */
  it("reads an absent field exactly as it reads null", () => {
    expect(readValues(undefined, "ltr")).toBeNull();
    expect(isComposed(undefined)).toBe(false);
  });

  /**
   * `[]` reaches `readValues` two ways and both mean an empty document: the wire
   * accepts it (*"`[]` and `{}` are the same value once PHP has decoded them"*), and
   * a nested one is what an empty object decays into. Either way there is nothing to
   * read, and the important half is that it is **not** `null` — the form opens.
   */
  it("reads an empty list as the empty form rather than as no answers", () => {
    expect(isComposed([])).toBe(true);
    expect(readValues([], "rtl")).toEqual(emptyValues("rtl"));
  });

  it("takes the direction from the campaign's locale when the document states none", () => {
    expect(readValues({ title: "x" }, "rtl")?.direction).toBe("rtl");
    expect(readValues({ direction: "ltr", title: "x" }, "rtl")?.direction).toBe("ltr");
    // A value that is neither falls back rather than being trusted through.
    expect(readValues({ direction: "sideways" }, "rtl")?.direction).toBe("rtl");
  });
});

describe("reading degrades field by field", () => {
  /*
   * A validator rather than a parser: the pressure is a document written by an older
   * shape of this file, or one whose value the backend rewrote — not a hostile
   * payload. A thrown parse would blank a campaign that is otherwise fine.
   */
  it("never throws on a document of the wrong shapes", () => {
    const junk = readValues(
      {
        direction: 7,
        brand_colour: null,
        logo: "https://shop.example/logo.png",
        title: ["a"],
        paragraphs: ["kept", 3, null, "also kept"],
        image: {},
        cta: { label: 5 },
        footer: false,
      },
      "ltr",
    );

    expect(junk).toEqual({
      ...emptyValues("ltr"),
      // A `src` that is not a usable string is the whole block gone, not a block
      // with an empty source in it — the form would draw a picked image with no
      // picture, which reads as a broken upload.
      logo: null,
      image: null,
      paragraphs: ["kept", "also kept"],
      cta: null,
    });
  });

  it("keeps a call to action that has only one of its two halves", () => {
    // `EmailCta` wants both, and the *form* is where the missing one is named — the
    // generator drops the block silently, which is right in a message and wrong in
    // an editor. So a half-filled value survives the read.
    expect(readValues({ cta: { label: "Voir" } }, "ltr")?.cta).toEqual({
      label: "Voir",
      href: "",
    });
    expect(readValues({ cta: { label: "", href: "" } }, "ltr")?.cta).toBeNull();
  });

  it("keeps a null image width, which is what the shop's own logo has", () => {
    const values = readValues({ logo: { src: "https://s/x.png", alt: "" } }, "ltr");
    expect(values?.logo).toEqual({ src: "https://s/x.png", alt: "", width: null });
  });
});

describe("the hand-edit flag is derived", () => {
  /**
   * Sound because the generator's output survives `EmailHtml::sanitize()` byte for
   * byte — fourteen fixtures, `npm run test:email-roundtrip` — so a difference is a
   * person's doing and never the sanitiser's. Without that property every reload
   * would report an edit nobody made.
   */
  it("reports nothing on a body the generator just produced", () => {
    const values = filled();
    const built = buildEmail(values);

    expect(handEdited(values, built.html, built.text)).toBe(false);
  });

  it("reports an edit to either half", () => {
    const values = filled();
    const built = buildEmail(values);

    expect(handEdited(values, `${built.html}\n<p>x</p>`, built.text)).toBe(true);
    expect(handEdited(values, built.html, `${built.text}\nx`)).toBe(true);
  });

  /*
   * The empty case, which is the one `furthestStep()` depends on: blank answers
   * produce two empty strings rather than an empty card, so a blank form is not
   * "hand edited" and the content step still refuses to advance.
   */
  it("reports nothing on the blank form, whose bodies are two empty strings", () => {
    const blank = emptyValues("ltr");

    expect(buildEmail(blank)).toEqual({ html: "", text: "" });
    expect(handEdited(blank, "", "")).toBe(false);
  });

  it("reports a body that was written before the form was", () => {
    // A campaign whose answers are `{}` and whose HTML somebody typed. The two
    // disagree, which is exactly what the flag claims.
    expect(handEdited(emptyValues("ltr"), "<p>Bonjour</p>", "Bonjour")).toBe(true);
  });
});

describe("a field change does not silently do what Undo asks permission for", () => {
  it("regenerates while the bodies still match the answers", () => {
    const before = filled();
    const built = buildEmail(before);
    const after = { ...before, title: "Nos soldes finissent" };

    expect(nextBodies(before, after, built.html, built.text)).toEqual(buildEmail(after));
  });

  it("leaves a hand-edited body alone, however the answers change", () => {
    const before = filled();
    const html = "<p>écrit à la main</p>";
    const text = "écrit à la main";
    const after = { ...before, title: "Nos soldes finissent" };

    expect(nextBodies(before, after, html, text)).toEqual({ html, text });
  });

  /**
   * The state machine closes on itself, which is why no "has been edited" flag is
   * needed to arm the rule: once diverged, a second and third field change keep the
   * bodies exactly where they were.
   */
  it("stays diverged across repeated field changes", () => {
    let values = filled();
    let bodies = { html: "<p>à la main</p>", text: "à la main" };

    for (const title of ["un", "deux", "trois"]) {
      const next = { ...values, title };
      bodies = nextBodies(values, next, bodies.html, bodies.text);
      values = next;
    }

    expect(bodies).toEqual({ html: "<p>à la main</p>", text: "à la main" });
    expect(handEdited(values, bodies.html, bodies.text)).toBe(true);
  });
});

describe("the brand colour is warned about, never refused", () => {
  /*
   * `onBrand()` picks the better of the message's two text colours by WCAG
   * luminance. With two candidates the best available bottoms out at 4.1130:1 — see
   * `brandContrast()`'s derivation — so a band of mid-luminance fills cannot reach
   * AA's 4.5 by any choice the generator can make.
   */
  it("passes a fill either candidate is readable on", () => {
    // The panel's own accent, and a bright yellow: white on the first, ink on the
    // second, both comfortably over the threshold.
    expect(brandLegible("#0b62d6")).toBe(true);
    expect(brandLegible("#ffd60a")).toBe(true);
  });

  it("warns on a fill in the band where neither candidate reaches AA", () => {
    expect(brandLegible("#e200cc")).toBe(false);
    expect(brandRatio("#e200cc")).toBeLessThan(AA_NORMAL_TEXT);
  });

  /**
   * **A value that is not a colour is not a warning.** `brandColour()` falls back to
   * the palette's accent for anything it cannot parse, so the message carries a
   * legible button and the form must not claim otherwise — the person is mid-way
   * through typing, and a warning about a colour that will never be emitted is
   * noise.
   */
  it("reads a half-typed value as the default it will actually become", () => {
    expect(brandLegible("")).toBe(true);
    expect(brandLegible("#12")).toBe(true);
    expect(brandLegible("rebeccapurple")).toBe(true);
    expect(brandRatio("")).toBe(brandRatio("#0b62d6"));
  });

  it("normalises the short form the same way the generator does", () => {
    expect(brandRatio("#0a5")).toBe(brandRatio("#00aa55"));
  });
});

describe("the prefill from shop settings", () => {
  /**
   * **A logo and no colour**, and the absence is read from source rather than
   * assumed: `SettingsInput::SCHEMA` is four blocks and nineteen keys and none of
   * them is a colour, an accent, a brand or a theme. So the seed fills one field.
   */
  it("seeds the logo and leaves the colour empty", () => {
    const logo = { src: "https://shop.example/logo.png", alt: "La boutique", width: null };
    const seeded = seededValues("rtl", logo);

    expect(seeded).toEqual({ ...emptyValues("rtl"), logo });
    expect(seeded.brandColour).toBe("");
  });

  /**
   * **Branch on `logo`, never on `logo_id`.** An attachment deleted after being set
   * leaves the id non-zero while `wp_get_attachment_url()` answers nothing, and the
   * service reports `null` rather than a URL that would render as a gap.
   */
  it("reads the resolved attachment and not the id", () => {
    expect(shopLogo(null)).toBeNull();
    expect(shopLogo({ logo: null })).toBeNull();
    expect(shopLogo({ logo: { url: "", alt: "x" } })).toBeNull();
    expect(shopLogo({ logo: { url: "https://s/l.png", alt: "Boutique" } })).toEqual({
      src: "https://s/l.png",
      alt: "Boutique",
      /* `SettingsService::image()` publishes `id`, `url` and `alt` and no width, so
         the generator caps the logo rather than avoiding an upscale. */
      width: null,
    });
  });
});

describe("the copy", () => {
  it("keeps French and Arabic in exact sync under campaigns", () => {
    expect(flatKeys(ar.campaigns).sort()).toEqual(flatKeys(fr.campaigns).sort());
  });

  it("names every control the body form draws", () => {
    const keys = new Set(flatKeys(fr.campaigns));

    for (const block of BLOCKS) {
      // Every block has a heading, so a seventh added to the generator fails here as
      // well as in the form's own `switch`.
      expect(keys.has(`bodyForm.${block}`)).toBe(true);
    }

    for (const key of [
      "bodyForm.shown",
      "bodyForm.hidden",
      "bodyForm.handEdited",
      "bodyForm.undoConfirm",
      "bodyForm.colourUnreadable",
      "bodyForm.colourDefault",
      "tokenStep.insert",
      "tokenStep.noField",
      "field.bodyFields",
    ]) {
      expect(keys.has(key)).toBe(true);
    }
  });

  /*
   * The two `{placeholder}` messages, checked as ICU rather than by eye: a token
   * written `{{ratio}}` would render the key path instead of the number, which is
   * the defect the preview step's own note records.
   */
  it("passes the contrast numbers as ICU values", () => {
    for (const messages of [fr, ar]) {
      expect(messages.campaigns.bodyForm.colourUnreadableWhy).toContain("{ratio}");
      expect(messages.campaigns.bodyForm.colourUnreadableWhy).toContain("{target}");
      expect(messages.campaigns.bodyForm.colourUnreadableWhy).not.toContain("{{");
    }
  });
});
