import { describe, expect, it } from "vitest";
import { TOKENS, mergeRepairs, repairTokens, tokenLiteral } from "@/lib/campaigns";
import {
  buildEmail,
  emptyValues,
  repairValues,
} from "@/app/[locale]/(panel)/marketing/campaigns/[id]/email-body";

/**
 * Item 9 — repairing `{{first name}}`, the merge tag the API cannot see.
 *
 * `TemplateRenderer::PATTERN` is `/\{\{\s*([a-z0-9_]{1,40})\s*\}\}/i`
 * (`Campaigns/TemplateRenderer.php:78`, read from source), so a space between
 * the braces means the pair matches nothing: it is not substituted, and it is
 * not listed in `unknown_tokens` either, because that list is built by scanning
 * with the same pattern. It is mailed verbatim, braces showing.
 *
 * **The assertions that matter here are the ones about what is *not* repaired.**
 * Correcting the three obvious mistypings is easy and a reviewer can eyeball it.
 * The property that keeps this feature from being worse than the defect is that
 * a name which does not land on one of the five real tokens is left exactly as
 * typed — because rewriting it would turn text that mails visibly into a well
 * formed unknown token that renders *empty*, which is the failure the whole
 * token subsystem exists to prevent.
 */

describe("repairTokens", () => {
  it("corrects the three ways this is actually mistyped", () => {
    expect(repairTokens("Bonjour {{first name}},").text).toBe("Bonjour {{first_name}},");
    expect(repairTokens("Bonjour {{first-name}},").text).toBe("Bonjour {{first_name}},");
    expect(repairTokens("Bonjour {{First Name}},").text).toBe("Bonjour {{first_name}},");
  });

  it("reports what it corrected, in both spellings", () => {
    const { repairs } = repairTokens("{{first name}}");

    expect(repairs).toEqual([{ from: "first name", to: "first_name" }]);
  });

  it("repairs every one of the five, so none is quietly unsupported", () => {
    for (const token of TOKENS) {
      const mistyped = `{{${token.replace(/_/g, " ")}}}`;

      expect(repairTokens(mistyped).text).toBe(tokenLiteral(token));
    }
  });

  it("leaves a well formed pair alone, including one the API calls unknown", () => {
    /*
     * `{{firstname}}` is well formed and misspelled — the API *can* see it and
     * reports it in `unknown_tokens`, which is a warning the operator already
     * gets. Silently turning it into `{{first_name}}` would be guessing which of
     * five words somebody meant, which is a much larger claim than repairing
     * punctuation, and it would delete the evidence the existing warning shows.
     */
    for (const untouched of [
      "{{first_name}}",
      "{{ first_name }}",
      "{{First_Name}}",
      "{{firstname}}",
      "{{prenom}}",
    ]) {
      const { text, repairs } = repairTokens(untouched);

      expect(text).toBe(untouched);
      expect(repairs).toEqual([]);
    }
  });

  it("leaves a malformed name that is not a real token exactly as typed", () => {
    /*
     * The safety property. `{{numéro de suivi}}` mails verbatim today — visible,
     * embarrassing, and caught by whoever reads the test send. Normalised to
     * `{{numero_de_suivi}}` it would become a well formed unknown token and
     * render **empty**, so the repair would have manufactured the exact failure
     * it exists to prevent. Accents are not folded for the same reason: somebody
     * who typed `{{prénom}}` typed a different word, not a damaged one.
     */
    for (const untouched of ["{{numéro de suivi}}", "{{hello world}}", "{{prénom}}", "{{}}"]) {
      const { text, repairs } = repairTokens(untouched);

      expect(text).toBe(untouched);
      expect(repairs).toEqual([]);
    }
  });

  it("repairs stray punctuation inside the braces, because the gate still holds", () => {
    /*
     * `{{first name!}}` normalises to `first_name` — every run outside
     * `[a-z0-9]` becomes one `_`, and leading and trailing ones are dropped —
     * and is repaired. Worth an assertion rather than left to be discovered,
     * because it looks at first like the aggressive case the test above forbids.
     *
     * It is not, and the reason is the same membership gate: the `!` is *inside*
     * the braces, so it was part of what somebody typed as a token name rather
     * than punctuation in a sentence, and the result still has to land on one of
     * the five real tokens before anything is rewritten. `{{hello world!}}` is
     * left alone by the very same rule.
     */
    expect(repairTokens("{{first name!}}").text).toBe("{{first_name}}");
    expect(repairTokens("{{hello world!}}").text).toBe("{{hello world!}}");
  });

  it("counts one mistake made twice as one correction", () => {
    const { text, repairs } = repairTokens("{{first name}} … {{first name}}");

    expect(text).toBe("{{first_name}} … {{first_name}}");
    expect(repairs).toHaveLength(1);
  });

  it("repairs each distinct mistake in one pass", () => {
    const { text, repairs } = repairTokens("{{first name}} chez {{shop name}}");

    expect(text).toBe("{{first_name}} chez {{shop_name}}");
    expect(repairs.map((made) => made.to)).toEqual(["first_name", "shop_name"]);
  });

  it("is safe to call twice — a repaired body is a fixed point", () => {
    /*
     * `save()` runs this on every save, over text that may already have been
     * repaired by an earlier one. A second pass must be a no-op, or the notice
     * would re-announce a correction made minutes ago.
     */
    const once = repairTokens("Bonjour {{first name}},").text;
    const twice = repairTokens(once);

    expect(twice.text).toBe(once);
    expect(twice.repairs).toEqual([]);
  });
});

describe("mergeRepairs", () => {
  it("merges the same mistake found in the subject and in a paragraph", () => {
    expect(
      mergeRepairs([
        { from: "first name", to: "first_name" },
        { from: "first name", to: "first_name" },
        { from: "shop name", to: "shop_name" },
      ]),
    ).toEqual([
      { from: "first name", to: "first_name" },
      { from: "shop name", to: "shop_name" },
    ]);
  });
});

describe("repairValues", () => {
  const MISTYPED = {
    ...emptyValues("ltr"),
    title: "Bonjour {{first name}}",
    paragraphs: ["Chez {{shop name}}, votre commande {{order number}}.", "Rien à corriger ici."],
    footer: "Se désabonner : {{unsubscribe url}}",
    cta: { label: "Voir {{first name}}", href: "{{unsubscribe url}}" },
  };

  it("repairs every string that reaches a recipient", () => {
    const { values, repairs } = repairValues(MISTYPED);

    expect(values.title).toBe("Bonjour {{first_name}}");
    expect(values.paragraphs[0]).toBe("Chez {{shop_name}}, votre commande {{order_number}}.");
    expect(values.paragraphs[1]).toBe("Rien à corriger ici.");
    expect(values.footer).toBe("Se désabonner : {{unsubscribe_url}}");
    expect(values.cta?.label).toBe("Voir {{first_name}}");
    /* The href case is real rather than theoretical — `EmailCta.href` documents
       `{{unsubscribe_url}}` as a thing shops build, so a mistyped one is a button
       pointing at literal braces. */
    expect(values.cta?.href).toBe("{{unsubscribe_url}}");

    expect(repairs.map((made) => made.to).sort()).toEqual([
      "first_name",
      "order_number",
      "shop_name",
      "unsubscribe_url",
    ]);
  });

  it("agrees with repairing the generated bodies, for every field that is prose", () => {
    /*
     * The half of the invariant that **does** hold, and the reason it holds:
     * a token's characters — braces, ASCII letters, digits, underscores, and the
     * space or hyphen being repaired — are none of them touched by the HTML
     * escaping `buildEmail()` does on the way through. So for text that is merely
     * copied into a cell, repairing the answer and repairing the rendered body
     * are the same edit in two places.
     *
     * This matters because `handEdited()` regenerates from the answers and
     * compares against the stored bodies. Anywhere the two orders disagree, a
     * corrected campaign would report a hand edit nobody made.
     */
    const prose = {
      ...MISTYPED,
      /* The one field that is validated rather than copied — next test. */
      cta: null,
    };

    const generatedThenRepaired = buildEmail(prose);
    const repairedThenGenerated = buildEmail(repairValues(prose).values);

    expect(repairedThenGenerated.html).toBe(repairTokens(generatedThenRepaired.html).text);
    expect(repairedThenGenerated.text).toBe(repairTokens(generatedThenRepaired.text).text);
  });

  it("cannot be done after generation for a call-to-action's href, and that decides the order", () => {
    /*
     * **The case that makes the composer regenerate rather than text-repair, and
     * it was found by this test rather than by reading the code.**
     *
     * `safeHref()` accepts `http(s)`, `mailto:` and a **well formed** merge token,
     * and drops everything else — and dropping the href drops the whole block, so
     * a call to action pointing at `{{unsubscribe url}}` is not a button with a
     * broken link. There is no button at all.
     *
     * Repairing the generated HTML therefore finds nothing to fix: the text it
     * would have repaired is not in the document. The answers end up holding a
     * good href while the body holds no button, the two disagree, and
     * `handEdited()` reports an edit nobody made — item 12's defect, manufactured
     * by item 9's fix.
     *
     * So `Composer.save()` runs the repair through `nextBodies()`, which rebuilds
     * the bodies from the repaired answers whenever they still match — the only
     * order that brings the button back.
     */
    const generatedThenRepaired = repairTokens(buildEmail(MISTYPED).html).text;
    const repairedThenGenerated = buildEmail(repairValues(MISTYPED).values).html;

    expect(generatedThenRepaired).not.toContain("</a>");
    expect(repairedThenGenerated).toContain('href="{{unsubscribe_url}}"');
    expect(repairedThenGenerated).toContain("Voir {{first_name}}");
  });

  it("leaves a body with nothing to correct byte-identical", () => {
    /*
     * The common case, and the one that decides whether the notice appears at
     * all: a save that corrected nothing must report nothing and must not
     * disturb a single character of somebody's message.
     */
    const clean = {
      ...emptyValues("rtl"),
      title: "مرحبا {{first_name}}",
      paragraphs: ["طلبك {{order_number}}."],
    };
    const { values, repairs } = repairValues(clean);

    expect(values).toEqual(clean);
    expect(repairs).toEqual([]);
  });
});
