import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BLOCKS,
  MERGE_TOKENS,
  brandColour,
  brandContrast,
  buildEmail,
  directionFor,
  emptyValues,
  insertToken,
  onBrand,
  tokenLiteral,
  type EmailValues,
} from "@/app/[locale]/(panel)/marketing/campaigns/[id]/email-body";
import { EMAIL_PALETTE, EMAIL_PALETTE_TOKENS } from "@/lib/email-palette";
import { TOKENS } from "@/lib/campaigns";
import fixtures from "./fixtures-email-body.json";

/**
 * The campaign composer's body generator — `{html, text}` from form values.
 *
 * ## The first block is the one that matters, and it is not written here
 *
 * `tests/fixtures-email-body.json` holds, for each case, the values *and what the
 * real backend sanitiser handed back when the generated body was pushed through
 * it*. `scripts/email-roundtrip.mjs` produced it by running
 * `Campaigns\EmailHtml::sanitize()` and `::sanitizeText()` inside the running
 * stack in `ecom-temp` — the same `wp_kses` call `CampaignService::create()` makes
 * on save — so "survives the sanitiser byte-for-byte" is an equality against real
 * output rather than a reading of `EmailHtml::ALLOWED`.
 *
 * That distinction is the whole point of doing it this way. The allow-list is a
 * list of tags and attributes; it says nothing about the three things that
 * actually decide the outcome — that `wp_kses` re-quotes and re-writes the tags it
 * keeps, that `style` is filtered a second time by WordPress's own
 * `safecss_filter_attr` (which drops individual declarations and keeps the rest),
 * and that everything it removes is removed **silently, on save, with a 200**.
 *
 * The remaining blocks assert the decisions the round trip cannot see: that the
 * text part is generated rather than stripped, that a refused link or image is
 * refused in *both* parts, and that the layout is fluid in the four specific
 * senses `email-body.ts` defines.
 */

const SANITISED = fixtures.sanitised as Record<string, { html: string; text: string }>;
const CASES = fixtures.cases as unknown as Record<string, EmailValues>;

function full(overrides: Partial<EmailValues> = {}): EmailValues {
  return {
    ...emptyValues("ltr"),
    brandColour: "#0b62d6",
    logo: { src: "https://shop.test/logo.png", alt: "Shop", width: 400 },
    title: "Title",
    paragraphs: ["One.", "Two."],
    image: { src: "https://shop.test/hero.jpg", alt: "Hero", width: 1600 },
    cta: { label: "Buy", href: "https://shop.test/x" },
    footer: "Footer",
    ...overrides,
  };
}

describe("the round trip through the real EmailHtml sanitiser", () => {
  /**
   * The assertion this file exists for. Both directions, the empty body, the
   * hostile body and a call to action whose target is a merge token — every case
   * `scripts/email-roundtrip.mjs` measured, re-asserted offline.
   */
  for (const name of Object.keys(SANITISED)) {
    it(`emits ${name} exactly as the sanitiser returns it`, () => {
      const built = buildEmail(CASES[name]!);

      expect(built.html).toBe(SANITISED[name]!.html);
      expect(built.text).toBe(SANITISED[name]!.text);
    });
  }

  /**
   * A floor under the fixture itself: a file emptied by a bad `--write` run would
   * otherwise make every assertion above pass against nothing.
   */
  it("has a fixture with real bodies in it", () => {
    expect(Object.keys(SANITISED).length).toBeGreaterThanOrEqual(6);
    expect(SANITISED["full-ltr"]!.html.length).toBeGreaterThan(2000);
    expect(SANITISED["full-rtl"]!.html).toContain("direction:rtl");
  });
});

describe("what the sanitiser would take away", () => {
  const html = buildEmail(full()).html;

  /**
   * Measured, each of these: `<div class="wrap">` came back `<div>`,
   * `<table dir="rtl">` came back `<table>`, `<div lang="ar">` came back `<div>`,
   * `<td bgcolor="#ffffff">` came back `<td>`, and `role` went the same way.
   * None is in `EmailHtml::ALLOWED` for any tag.
   */
  it("names no attribute the allow-list does not carry", () => {
    for (const attribute of ["class=", "dir=", "lang=", "role=", "bgcolor=", "id=", "background="]) {
      expect(html).not.toContain(attribute);
    }
  });

  /**
   * `style`, `head`, `html` and `body` are worse than useless rather than merely
   * stripped: measured, `<style>p{color:red}</style>` comes back as the *text*
   * `p{color:red}` and `<head><title>t</title></head>` as the text `t`. So the
   * document has no wrapper at all and begins at a table.
   */
  it("emits no document wrapper and no stylesheet", () => {
    expect(html.startsWith("<table")).toBe(true);
    for (const tag of ["<style", "<head", "<html", "<body", "<center", "<font", "<script"]) {
      expect(html).not.toContain(tag);
    }
  });

  /**
   * The five normalisations `wp_kses` performs on tags it keeps. Each one was a
   * byte that moved until it was obeyed — see `email-body.ts`'s "Byte-for-byte"
   * section — and each is cheap enough to re-assert on every build.
   */
  it("is already in the shape the sanitiser would normalise it to", () => {
    expect(html).not.toMatch(/=[^"\s>]/); // every value double-quoted
    expect(html).not.toContain('style=""'); // an empty style attribute is removed
    expect(html).not.toContain(';"'); // no trailing semicolon
    expect(html).not.toContain("; "); // no space after a semicolon
    // No bare ampersand, and the only entities emitted are the four the two
    // escapers produce — `&apos;` among them, which is the sanitiser's own
    // spelling in an attribute and never PHP's numeric one.
    expect(html).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  /**
   * `safecss_filter_attr` is the second allow-list and the quietest one, because it
   * drops a *declaration* and keeps the attribute. Every property below was
   * measured as dropped; the positive half — that the properties actually used all
   * survive — is what the round trip above proves.
   */
  it("uses no CSS property safecss_filter_attr drops", () => {
    for (const property of [
      "unicode-bidi",
      "box-sizing",
      "word-break",
      "overflow-wrap",
      "table-layout",
      "padding-block",
      "mso-",
      "-webkit-",
      "rgb(",
      "var(",
    ]) {
      expect(html).not.toContain(property);
    }
  });
});

describe("the text part is generated, not stripped", () => {
  it("carries none of the layout's scaffolding", () => {
    const { text } = buildEmail(full());

    expect(text).not.toContain("<");
    expect(text).not.toContain("style");
    expect(text).not.toContain("&amp;");
  });

  /**
   * The three failures a `strip_tags` implementation has, asserted as three
   * properties rather than as an absence of a regex.
   */
  it("writes a link's label and its target, which stripping cannot", () => {
    const { text } = buildEmail(full({ cta: { label: "Shop now", href: "https://shop.test/x" } }));

    expect(text).toContain("Shop now: https://shop.test/x");
  });

  it("holds the characters the HTML part had to escape", () => {
    const values = full({ title: "Thé & café < 5", paragraphs: ["L'été"] });
    const { html, text } = buildEmail(values);

    expect(html).toContain("Thé &amp; café &lt; 5");
    expect(html).toContain("L'été");
    expect(text).toContain("Thé & café < 5");
    expect(text).toContain("L'été");
  });

  it("gives an image its alt text and nothing else", () => {
    const { text } = buildEmail(
      full({ image: { src: "https://shop.test/a.png", alt: "Un tapis", width: 800 } }),
    );

    expect(text).toContain("Un tapis");
    expect(text).not.toContain("shop.test/a.png");
  });

  it("skips a decorative image rather than writing an empty line", () => {
    const { text } = buildEmail(
      full({ logo: null, image: { src: "https://shop.test/a.png", alt: "", width: 800 } }),
    );

    expect(text).not.toContain("\n\n\n");
  });

  it("walks the blocks in BLOCKS order, the same order as the HTML", () => {
    const { text } = buildEmail(
      full({
        logo: { src: "https://shop.test/l.png", alt: "LOGO", width: 100 },
        title: "TITLE",
        paragraphs: ["PARA"],
        image: { src: "https://shop.test/h.png", alt: "IMAGE", width: 100 },
        cta: { label: "CTA", href: "https://shop.test/x" },
        footer: "FOOTER",
      }),
    );

    expect(text.split("\n\n").map((part) => part.split(":")[0])).toEqual([
      "LOGO",
      "TITLE",
      "PARA",
      "IMAGE",
      "CTA",
      "FOOTER",
    ]);
  });

  /**
   * A line of exactly `-- ` is the signature separator and several clients hide
   * everything after one — including `TemplateRenderer::textFooter()`'s unsubscribe
   * link, which is appended after this text and is the one link the message is
   * required to carry.
   */
  it("uses no signature separator above the footer", () => {
    const { text } = buildEmail(full());

    expect(text.split("\n")).not.toContain("-- ");
    expect(text.split("\n")).not.toContain("--");
  });

  it("normalises CRLF and strips the control characters sanitizeText removes", () => {
    const { text } = buildEmail(full({ paragraphs: ["a\r\nb cd"] }));

    expect(text).toContain("a\nbcd");
    expect(text).not.toContain("\r");
  });
});

describe("a block is present exactly when its values are", () => {
  it("produces nothing at all from an empty body", () => {
    expect(buildEmail(emptyValues("ltr"))).toEqual({ html: "", text: "" });
    expect(buildEmail(emptyValues("rtl"))).toEqual({ html: "", text: "" });
  });

  /**
   * `campaignBlocker()` in `lib/campaigns.ts` treats `body_html.trim() === ""` as
   * the `content` blocker that stops the composer advancing. An empty card would
   * satisfy it while being an empty message.
   */
  it("produces nothing from values that are only whitespace", () => {
    expect(buildEmail(full({ logo: null, image: null, cta: null, title: "  ", paragraphs: ["", "\n"], footer: " " })))
      .toEqual({ html: "", text: "" });
  });

  it("drops a blank paragraph without leaving its row behind", () => {
    const { html } = buildEmail(full({ logo: null, image: null, cta: null, footer: "", paragraphs: ["a", "", "b"] }));

    expect(html.match(/<p /g)).toHaveLength(2);
  });

  it("renders one block on its own with the card's inset on both edges", () => {
    const { html } = buildEmail(
      full({ logo: null, image: null, cta: null, footer: "", paragraphs: [], title: "Only" }),
    );

    expect(html).toContain("padding:24px 24px 24px");
    /* Two, not three: the block rows *are* the card table's rows. There is no
       wrapper row between the card and its content, which is what keeps the
       nesting at two tables — see `buildHtml`. */
    expect(html.match(/<tr>/g)).toHaveLength(2);
  });

  it("keeps the blocks in BLOCKS order however the values arrive", () => {
    const { html } = buildEmail(
      full({
        title: "TITLE",
        paragraphs: ["PARA"],
        cta: { label: "CTA", href: "https://shop.test/x" },
        footer: "FOOTER",
      }),
    );

    const order = ["logo.png", "TITLE", "PARA", "hero.jpg", "CTA", "FOOTER"];
    const positions = order.map((needle) => html.indexOf(needle));

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((at) => at >= 0)).toBe(true);
  });

  it("exports the block order the form draws its controls in", () => {
    expect(BLOCKS).toEqual(["logo", "title", "paragraphs", "image", "cta", "footer"]);
  });
});

describe("fluid, in the four senses the file defines", () => {
  const { html } = buildEmail(full());

  it("caps the column with max-width and never with a width", () => {
    expect(html).toContain('width="100%"');
    expect(html).toContain("max-width:600px");
    expect(html.match(/max-width:(?!100%)/g)).toHaveLength(1);
  });

  it("centres the capped column two ways, for the renderer that ignores each", () => {
    expect(html).toContain("margin:0 auto");
    expect(html).toContain('align="center"');
  });

  it("states every horizontal inset in pixels, never a percentage", () => {
    for (const declaration of html.match(/padding:[^;"]+/g) ?? []) {
      expect(declaration).not.toContain("%");
    }
  });

  /**
   * The rule that stops a photograph forcing a horizontal scrollbar: the `width`
   * attribute is what the image *wants* and is capped at the content width, and
   * `max-width:100%` is what it is *allowed*.
   */
  it("lets no image exceed the content width, by attribute or by property", () => {
    const images = html.match(/<img[^>]*>/g) ?? [];

    expect(images.length).toBeGreaterThan(0);

    for (const image of images) {
      expect(image).toContain("max-width:100%");
      expect(image).toContain("height:auto");

      const width = /width="(\d+)"/.exec(image);
      expect(Number(width?.[1] ?? 0)).toBeLessThanOrEqual(552);
    }
  });

  it("omits the width attribute when the picker did not report one", () => {
    const { html: unknownWidth } = buildEmail(
      full({ logo: { src: "https://shop.test/l.png", alt: "L", width: null } }),
    );

    expect(unknownWidth).toContain('<img src="https://shop.test/l.png" alt="L" style=');
  });

  it("does not upscale an image smaller than the cap", () => {
    const { html: small } = buildEmail(
      full({ logo: { src: "https://shop.test/l.png", alt: "L", width: 64 } }),
    );

    expect(small).toContain('width="64"');
  });

  it("is one column at every width — one cell per row, always", () => {
    /* Counted rather than matched row by row, because a non-greedy `<tr>…</tr>`
       cannot see where a *nested* table's row ends and would compare the wrong
       pair. One `<td>` per `<tr>` across the whole document is the same claim and
       is the one a second column would break. */
    expect(html.match(/<td[ >]/g)).toHaveLength(html.match(/<tr>/g)!.length);
    expect(html).not.toMatch(/<\/td>\s*<td/);
  });

  it("has no media query, because there is nowhere to put one", () => {
    expect(html).not.toContain("@media");
  });
});

describe("right to left, without the dir attribute", () => {
  const rtl = buildEmail(full({ direction: "rtl" })).html;
  const ltr = buildEmail(full({ direction: "ltr" })).html;

  /**
   * The measurement that changed the design. `dir` is not in `EmailHtml::ALLOWED`
   * for any tag, and measured, `<table dir="rtl">` comes back `<table>`.
   */
  it("carries no dir attribute anywhere", () => {
    expect(rtl).not.toContain("dir=");
  });

  it("sets the base direction in the style, which does survive", () => {
    expect(rtl).toContain("direction:rtl");
    expect(rtl).not.toContain("direction:ltr");
    expect(ltr).toContain("direction:ltr");
    expect(ltr).not.toContain("direction:rtl");
  });

  /**
   * Both, on purpose: `align` is the attribute Outlook's renderer honours when it
   * ignores CSS, and headings cannot carry it at all — `ALLOWED['h1']` is `['style']`
   * — so the cell takes the attribute and the element takes the property.
   */
  it("aligns with the attribute on the cell and the property on the element", () => {
    expect(rtl).toContain('<td align="right"');
    expect(rtl).toContain("text-align:right");
    expect(rtl).not.toContain('<td align="left"');
    expect(ltr).toContain('<td align="left"');
    expect(ltr).toContain("text-align:left");
  });

  /** A block image ignores text-align, so the auto margin is what moves it. */
  it("pushes a block image to the reading edge with an auto margin", () => {
    expect(rtl).toContain("margin:0 0 0 auto");
    expect(ltr).toContain("margin:0");
    expect(ltr).not.toContain("margin:0 0 0 auto");
  });

  it("puts the call to action on the reading edge too", () => {
    expect(rtl).toContain('align="right" style="border-collapse:collapse"');
    expect(ltr).toContain('align="left" style="border-collapse:collapse"');
  });

  /**
   * `<span style="direction:ltr">` is not a substitute for `dir="ltr"`: direction
   * without `unicode-bidi` does not isolate, and `unicode-bidi` is dropped by
   * `safecss_filter_attr` (measured). Nothing here pretends otherwise.
   */
  it("does not pretend to isolate a run", () => {
    expect(rtl).not.toContain("unicode-bidi");
    expect(rtl).not.toContain("<span");
  });

  it("seeds the direction from the locale, and ar is the only rtl one", () => {
    expect(directionFor("ar")).toBe("rtl");
    expect(directionFor("ar-DZ")).toBe("rtl");
    expect(directionFor("fr")).toBe("ltr");
    expect(directionFor("fr-DZ")).toBe("ltr");
    expect(directionFor("")).toBe("ltr");
  });

  it("says the same thing in both directions", () => {
    expect(buildEmail(full({ direction: "rtl" })).text).toBe(buildEmail(full({ direction: "ltr" })).text);
  });
});

describe("escaping", () => {
  it("escapes the two characters that can start a tag or an entity, and no more", () => {
    const { html } = buildEmail(
      full({ logo: null, image: null, cta: null, footer: "", paragraphs: [], title: `& < > " '` }),
    );

    // Between tags a quote and an apostrophe are not special, and the sanitiser
    // leaves both alone — measured, `<p>a"b</p>` and `<p>L'été</p>` come back
    // byte for byte.
    expect(html).toContain(`&amp; &lt; &gt; " '`);
  });

  /**
   * The sharpest normalisation `wp_kses` performs, and the one that rules out the
   * obvious implementation: *every* spelling of an apostrophe inside an attribute
   * comes back `&apos;` — a raw one, and each numeric form, `htmlspecialchars`'
   * padded decimal included. So an attribute escaped the way PHP escapes a merge
   * value is the one thing that cannot round-trip.
   */
  it("writes an apostrophe in an attribute the only way one survives", () => {
    const { html } = buildEmail(
      full({
        logo: { src: "https://shop.test/l.png", alt: "L'Artisan", width: 100 },
        cta: { label: "Go", href: "https://shop.test/x?q=l'ete" },
      }),
    );

    expect(html).toContain(`alt="L&apos;Artisan"`);
    expect(html).toContain(`href="https://shop.test/x?q=l&apos;ete"`);
    expect(html).not.toContain("&#039;");
    expect(html).not.toContain("&#39;");
  });

  it("leaves an apostrophe alone between tags, where nothing rewrites it", () => {
    const { html, text } = buildEmail(full({ paragraphs: ["L'été"] }));

    expect(html).toContain(">L'été<");
    expect(text).toContain("L'été");
  });

  it("escapes an ampersand a shopkeeper typed, because the sanitiser would", () => {
    const { html } = buildEmail(full({ title: "Thé & café" }));

    expect(html).toContain("Thé &amp; café");
  });

  it("escapes an already-escaped entity, because it is literal text", () => {
    const { html } = buildEmail(full({ title: "&amp;" }));

    expect(html).toContain("&amp;amp;");
  });

  it("refuses to let a paragraph become markup", () => {
    const { html } = buildEmail(full({ paragraphs: [`<img src=x onerror="alert(1)">`] }));

    expect(html).not.toContain("<img src=x");
    expect(html).toContain(`&lt;img src=x onerror="alert(1)"&gt;`);
  });

  it("escapes an alt and an href as well as the text", () => {
    const { html } = buildEmail(
      full({
        logo: { src: "https://shop.test/a.png?x=1&y=2", alt: `Tapis & "Co"`, width: 100 },
        cta: { label: "Go", href: "https://shop.test/x?a=1&b=2" },
      }),
    );

    expect(html).toContain('alt="Tapis &amp; &quot;Co&quot;"');
    expect(html).toContain('href="https://shop.test/x?a=1&amp;b=2"');
    expect(html).toContain('src="https://shop.test/a.png?x=1&amp;y=2"');
  });

  it("leaves a merge token alone, in text and in an attribute", () => {
    const { html, text } = buildEmail(
      full({
        paragraphs: ["Bonjour {{first_name}}"],
        cta: { label: "Stop", href: "{{unsubscribe_url}}" },
      }),
    );

    expect(html).toContain("Bonjour {{first_name}}");
    expect(html).toContain('href="{{unsubscribe_url}}"');
    expect(text).toContain("Bonjour {{first_name}}");
  });

  it("turns a newline inside a paragraph into a br and nothing else", () => {
    const { html, text } = buildEmail(full({ paragraphs: ["a\nb"] }));

    expect(html).toContain("a<br>b");
    expect(text).toContain("a\nb");
  });

  it("keeps a heading and a button to one line", () => {
    const { html } = buildEmail(
      full({ title: "a\nb", cta: { label: "c\nd", href: "https://shop.test/x" } }),
    );

    expect(html).toContain(">a b</h1>");
    expect(html).toContain(">c d</a>");
  });
});

describe("a link or an image this message cannot carry", () => {
  /**
   * Measured: `href="javascript:alert(1)"` comes back `href="alert(1)"` — the
   * protocol is stripped and the rest is kept, leaving a relative link to a page
   * that does not exist. A missing block is a question somebody asks; a 200 that
   * goes nowhere is not.
   */
  it("emits no button at all rather than one the sanitiser would break", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "/relative", "shop.test", ""]) {
      const { html, text } = buildEmail(full({ cta: { label: "Go", href } }));

      expect(html).not.toContain("<a ");
      expect(text).not.toContain("Go:");
    }
  });

  it("keeps http, https and mailto, and a merge token", () => {
    for (const href of [
      "https://shop.test/x",
      "http://shop.test/x",
      "mailto:contact@shop.test",
      "{{unsubscribe_url}}",
      "{{ unsubscribe_url }}",
    ]) {
      expect(buildEmail(full({ cta: { label: "Go", href } })).html).toContain(`href="${href}"`);
    }
  });

  it("emits no button when the label is empty, however good the link", () => {
    expect(buildEmail(full({ cta: { label: "  ", href: "https://shop.test/x" } })).html).not.toContain("<a ");
  });

  /**
   * Measured: `src="data:image/png;base64,AAA"` comes back
   * `src="image/png;base64,AAA"` — mangled into a broken relative path, which is
   * the failure that looks like a working save.
   */
  it("emits no image for a data URI, in either part", () => {
    const values = full({ logo: { src: "data:image/png;base64,AAA", alt: "Shop", width: 40 }, image: null });
    const { html, text } = buildEmail(values);

    expect(html).not.toContain("<img");
    expect(text).not.toContain("Shop");
  });

  it("refuses a relative image source too", () => {
    expect(buildEmail(full({ logo: { src: "/uploads/a.png", alt: "x", width: 40 }, image: null })).html)
      .not.toContain("<img");
  });
});

describe("the brand colour, and what goes on top of it", () => {
  it("expands a three-digit hex and lower-cases everything", () => {
    expect(brandColour("#0A5")).toBe("#00aa55");
    expect(brandColour("#B21F2D")).toBe("#b21f2d");
    expect(brandColour("  #b21f2d  ")).toBe("#b21f2d");
  });

  /**
   * `safecss_filter_attr` drops a declaration it cannot parse and keeps the rest of
   * the attribute, so a bad brand colour would produce a button with **no fill at
   * all** rather than a broken one. A default the shopkeeper can see is
   * recoverable; an invisible button is not.
   */
  it("falls back to the palette rather than emitting something that would be dropped", () => {
    for (const bad of ["", "  ", "red", "rgb(255,0,0)", "#ff", "#12345", "#1234567", "#b21f2dff", "0b62d6"]) {
      expect(brandColour(bad)).toBe(EMAIL_PALETTE.brand);
    }
  });

  it("puts the fallback on the button when nothing was chosen", () => {
    expect(buildEmail(full({ brandColour: "" })).html).toContain(`background-color:${EMAIL_PALETTE.brand}`);
  });

  /**
   * Computed rather than hard-coded, which is the difference between a readable
   * button and one that looked fine to whoever picked the colour. A yellow brand
   * with white text measures 1.3:1.
   */
  it("picks the readable text colour for the fill", () => {
    expect(onBrand("#0b62d6")).toBe(EMAIL_PALETTE.card);
    expect(onBrand("#b21f2d")).toBe(EMAIL_PALETTE.card);
    expect(onBrand("#191d23")).toBe(EMAIL_PALETTE.card);
    expect(onBrand("#ffd60a")).toBe(EMAIL_PALETTE.ink);
    expect(onBrand("#ffffff")).toBe(EMAIL_PALETTE.ink);
    expect(onBrand("#34c759")).toBe(EMAIL_PALETTE.ink);
  });

  it("always clears 4.5:1 on the button, for every colour a picker can produce", () => {
    const luminance = (hex: string) =>
      [1, 3, 5]
        .map((at) => {
          const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, channel, index) => sum + [0.2126, 0.7152, 0.0722][index]! * channel, 0);

    const ratio = (a: string, b: string) =>
      (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

    let worst = Infinity;

    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const fill = `#${[r, g, b].map((one) => one.toString(16).padStart(2, "0")).join("")}`;
          worst = Math.min(worst, ratio(fill, onBrand(fill)));
        }
      }
    }

    /*
     * **4.09, and the number is recorded rather than rounded up to a claim about
     * AA.** With only two candidates the worst case is fixed by arithmetic: it
     * falls where `ratio(brand, card) === ratio(brand, ink)`, which for this
     * palette is a brand luminance of about 0.206 and a ratio of 4.10:1. Pure
     * black as the second candidate would have raised the floor to 4.58 and
     * cleared AA outright — and it was rejected, because the palette's whole
     * justification for existing as an exempt file is that **every value in it
     * mirrors a token**, and there is no token that is pure black. A seventh
     * colour answering to nothing would have bought 0.5:1 and cost the invariant
     * the exemption rests on.
     *
     * So the residual is named instead of hidden: a brand colour in a narrow band
     * of mid-luminance gets a button at 4.10:1 rather than 4.5:1, on 16px
     * semibold text. It is the shopkeeper's colour choice rather than a defect in
     * the generator, and warning about it is the composer's to do — this function
     * guarantees only that it always picks the better of the two, which is the
     * part that would otherwise have been a hard-coded white at 1.3:1.
     */
    expect(worst).toBeGreaterThan(4.09);
    expect(worst).toBeLessThan(4.5);
  });
});

describe("the merge tokens", () => {
  /**
   * Step 8 leans on `unknown_tokens` to catch a typo, so a picker offering a name
   * the renderer does not know would produce a token that renders empty and a
   * warning the shopkeeper did not cause. The authority is
   * `TemplateRenderer::TOKENS`, mirrored once in `lib/campaigns.ts`.
   */
  it("is the renderer's own vocabulary, re-exported rather than re-declared", () => {
    expect(MERGE_TOKENS).toBe(TOKENS);
    expect([...MERGE_TOKENS]).toEqual([
      "customer_name",
      "first_name",
      "shop_name",
      "order_number",
      "unsubscribe_url",
    ]);
  });

  it("writes a token the way the renderer's pattern reads one", () => {
    for (const token of MERGE_TOKENS) {
      expect(tokenLiteral(token)).toBe(`{{${token}}}`);
      // TemplateRenderer::PATTERN, reproduced only to check the spelling.
      expect(/\{\{\s*([a-z0-9_]{1,40})\s*\}\}/i.test(tokenLiteral(token))).toBe(true);
    }
  });

  it("inserts at the caret and leaves the caret after what it inserted", () => {
    expect(insertToken("Bonjour , merci", 8, 8, "first_name")).toEqual({
      value: "Bonjour {{first_name}}, merci",
      caret: 22,
    });
  });

  it("replaces a selection rather than pushing it aside", () => {
    expect(insertToken("Bonjour NOM,", 8, 11, "first_name")).toEqual({
      value: "Bonjour {{first_name}},",
      caret: 22,
    });
  });

  it("clamps a selection that no longer fits the value", () => {
    expect(insertToken("ab", 99, 120, "shop_name")).toEqual({
      value: "ab{{shop_name}}",
      caret: 15,
    });
    expect(insertToken("ab", -5, -5, "shop_name")).toEqual({
      value: "{{shop_name}}ab",
      caret: 13,
    });
  });
});

describe("the colour exemption stays paired to the tokens it mirrors", () => {
  /**
   * `lib/email-palette.ts` is the second file outside `styles/tokens.css` allowed a
   * colour literal — `scripts/check-design.sh`'s `COLOUR_EXEMPT` names it, and the
   * script's comment says why. Nothing enforces the pairing, so this does, exactly
   * as `tests/boundary.test.ts` does for `lib/theme-color.ts`.
   */
  it("equals the light value of every token it names", () => {
    const tokens = readFileSync("styles/tokens.css", "utf8");
    /* The `ui-` layer's own `@theme` block, which begins after the banner that
       introduces it — so a dark override further down cannot be matched instead. */
    const light = tokens.slice(tokens.indexOf("THE NEW SYSTEM"), tokens.indexOf("prefers-color-scheme: dark", tokens.indexOf("THE NEW SYSTEM")));

    for (const [name, token] of Object.entries(EMAIL_PALETTE_TOKENS)) {
      const found = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{3,8})`).exec(light);

      expect(found?.[1]?.toLowerCase(), `${name} mirrors ${token}`).toBe(
        EMAIL_PALETTE[name as keyof typeof EMAIL_PALETTE].toLowerCase(),
      );
    }
  });

  it("names a token for every colour, so a seventh cannot be added unpaired", () => {
    expect(Object.keys(EMAIL_PALETTE_TOKENS).sort()).toEqual(Object.keys(EMAIL_PALETTE).sort());
  });

  it("is the only place the generator's colours come from", () => {
    const source = readFileSync("app/[locale]/(panel)/marketing/campaigns/[id]/email-body.ts", "utf8");

    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\brgb\(|\boklch\(|\bhsl\(/);
  });

  /**
   * The other half of the design system this file deliberately does not use. See
   * `email-body.ts`'s "No font-family" section: the panel's face cannot be
   * delivered, a Latin stack is wrong for an Arabic campaign, and naming one would
   * have needed a second exemption nobody argued for.
   */
  it("names no typeface", () => {
    const { html } = buildEmail(full());

    expect(html).not.toContain("font-family");
  });
});

/**
 * The call-to-action's label, and the number the composer's warning is built on.
 *
 * **Added on the composer's half of the branch, and it is a gap being closed rather
 * than a new claim.** `onBrand()` shipped with a docblock naming the worst case and
 * nothing asserting it — so the one number the form's warning threshold depends on
 * could have drifted with a palette change and taken the warning with it.
 */
describe("the label on the brand colour", () => {
  const AA = 4.5;

  it("picks whichever of the two candidates a person can read", () => {
    // A dark fill takes the card colour; a bright one takes the ink. Hard-coding
    // white — which most email builders do — hands the second shop 1.3:1.
    expect(onBrand("#0b0b0b")).toBe(EMAIL_PALETTE.card);
    expect(onBrand("#ffd60a")).toBe(EMAIL_PALETTE.ink);
  });

  /**
   * **4.1130:1, solved rather than searched for.** Contrast against `card` falls as
   * the fill lightens and contrast against `ink` rises, so the worst fill is where
   * the two curves cross:
   *
   *     1.05 / (L + 0.05) = (L + 0.05) / (L_ink + 0.05)
   *
   * Asserted to four decimals, so a change to either candidate has to restate the
   * number rather than quietly move it.
   */
  it("bottoms out at the bound the composer's warning is set against", () => {
    const luminance = (hex: string) => {
      const channel = (from: number) => {
        const value = Number.parseInt(hex.slice(from, from + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };

    const worst = Math.sqrt(1.05 * (luminance(EMAIL_PALETTE.ink) + 0.05)) - 0.05;
    const bound = (worst + 0.05) / (luminance(EMAIL_PALETTE.ink) + 0.05);

    expect(bound).toBeCloseTo(4.113, 3);
    // Below AA for normal text, which is the entire reason the composer warns.
    expect(bound).toBeLessThan(AA);

    /* And no fill does worse, checked by search rather than by trusting the algebra:
       65 536 colours across the cube, none under the bound. */
    let found = Number.POSITIVE_INFINITY;
    for (let r = 0; r < 256; r += 1) {
      for (let g = 0; g < 256; g += 16) {
        for (let b = 0; b < 256; b += 16) {
          const hex = `#${[r, g, b].map((one) => one.toString(16).padStart(2, "0")).join("")}`;
          found = Math.min(found, brandContrast(hex));
        }
      }
    }

    expect(found).toBeGreaterThanOrEqual(bound);
    expect(found).toBeCloseTo(bound, 3);
  });

  it("agrees with the colour `onBrand` picked, for every fixture", () => {
    for (const values of Object.values(fixtures.cases) as EmailValues[]) {
      const fill = brandColour(values.brandColour);
      const chosen = onBrand(fill);
      const other = chosen === EMAIL_PALETTE.card ? EMAIL_PALETTE.ink : EMAIL_PALETTE.card;

      // The reported ratio is the *chosen* candidate's, which is the better of the
      // two — otherwise the warning would fire on colours that are fine.
      expect(brandContrast(fill)).toBeGreaterThanOrEqual(contrast(fill, other) - 1e-9);
    }
  });

  /** The same ratio the module computes, written out once for the check above. */
  function contrast(a: string, b: string): number {
    const luminance = (hex: string) => {
      const channel = (from: number) => {
        const value = Number.parseInt(hex.slice(from, from + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };

    const light = Math.max(luminance(a), luminance(b));
    const dark = Math.min(luminance(a), luminance(b));
    return (light + 0.05) / (dark + 0.05);
  }
});
