import { TOKENS, tokenLiteral } from "@/lib/campaigns";
import { EMAIL_PALETTE } from "@/lib/email-palette";

/**
 * The composer's body generator: form values in, `{html, text}` out.
 *
 * Separated from the markup for the reason `orders/new-order.ts` is, and the
 * sentence transfers without editing: the interesting part of this form is not the
 * controls, it is **what reaches the wire**, and that is a pure function of a plain
 * object. It is asserted directly in `tests/email-body.test.ts` — including
 * byte-for-byte against output the real backend sanitiser handed back — rather than
 * through a screenshot nobody can diff.
 *
 * No React, no requests, no clock, no `document`. Two exports do the work
 * (`buildEmail` and `emptyValues`) and the rest is vocabulary the form needs.
 *
 * ## What was measured, and how — this is not transcription
 *
 * Every claim below about what survives a save was **measured in-process against
 * the real `wp_kses`**, by running `Campaigns\EmailHtml::sanitize()` inside the
 * running stack in `ecom-temp`:
 *
 *     docker compose run --rm -T wpcli wp eval '…EmailHtml::sanitize($html)…'
 *
 * `scripts/email-roundtrip.mjs` is that measurement made repeatable: it builds every
 * fixture in `tests/fixtures-email-body.json` with the function below, pushes each
 * through the real sanitiser, and fails if a single byte moved. The fixture file is
 * the sanitiser's own output, checked in, so `tests/email-body.test.ts` re-asserts
 * the round trip offline on every run. Nothing here was measured over live HTTP;
 * `BLOCKED.md` records the 401 that stops that, and it would not have helped —
 * the sanitiser runs on save, below the route.
 *
 * ## The constraint that decided the whole design
 *
 * **`Campaigns\EmailHtml::ALLOWED` is the layout language, and it is small.** The
 * sanitiser runs on the way *in* — `CampaignService::create()` and `::update()`
 * both call `cleanHtml()`, which is `EmailHtml::sanitize()` — so whatever it
 * removes is removed **into the database, silently, with a 200**. There is no
 * refusal to render and no diff to read. A generator that emitted one disallowed
 * thing would produce an email nobody could debug, so everything below is chosen
 * from the allow-list rather than trimmed to fit it afterwards.
 *
 * Four removals shaped this file more than the rest:
 *
 *  1. **No `<style>` block, and the failure is worse than "it does not work".**
 *     `style` is in `FORBIDDEN_TAGS`; measured, `<style>p{color:red}</style><p>x</p>`
 *     comes back `p{color:red}<p>x</p>` — the tag goes and **its text stays**, so a
 *     stylesheet is not ignored, it is printed into the message. `<head>` behaves the
 *     same way: `<head><title>t</title></head>` comes back as the bare word `t`.
 *     That is why this file emits no document wrapper at all — no `<html>`, no
 *     `<head>`, no `<body>` — and starts at the outermost `<table>`.
 *  2. **No `class`.** Not on any tag in `ALLOWED`. Measured: `<div class="wrap">`
 *     comes back `<div>`. Every rule is therefore inline, on the element it styles.
 *  3. **No `dir`.** See the RTL section below — this one changed the design.
 *  4. **`style` is filtered again, by a *second* allow-list.** `wp_kses` runs
 *     WordPress's `safecss_filter_attr` over every `style` value and drops the
 *     declarations it does not know, keeping the rest. So a style attribute can come
 *     back *partly* intact, which is the quietest failure of the four. Measured as
 *     dropped: `unicode-bidi`, `box-sizing`, `word-break`, `overflow-wrap`,
 *     `table-layout`, `padding-block`, every `mso-*` and `-webkit-*` property, and
 *     **any colour written as an `rgb` function**. Measured as kept, and the whole vocabulary this file
 *     uses: `width`, `max-width`, `height`, `margin`, `padding`, `padding-top`,
 *     `background-color`, `border`, `border-top`, `border-radius`, `color`,
 *     `direction`, `text-align`, `font-size`, `line-height`, `font-weight`,
 *     `text-decoration`, `display`.
 *
 * The `rgb` function being dropped is why `lib/email-palette.ts` mirrors the `ui-`
 * tokens and not the iOS layer above them: `--color-label` is written as an `rgb`
 * function there and would vanish whole. Hex is the only colour syntax that
 * survives a save, which settles the palette's format as well as its values.
 *
 * ## Byte-for-byte, and the five rules that make it hold
 *
 * `wp_kses` does not merely delete; it *rewrites* the tags it keeps. Everything
 * below is emitted in the shape the sanitiser would have normalised it to, so the
 * output is a fixed point and the round trip is an equality rather than a
 * comparison of two shapes. Measured, each of these changed a byte until it was
 * obeyed:
 *
 *   - **Attribute values are double-quoted.** `width=100%` comes back `width="100%"`
 *     and `style='…'` comes back `style="…"`.
 *   - **No empty `style`.** `style=""` is removed entirely, so a style string is
 *     never built that could come out empty — see `row()`, where the direction pair
 *     guarantees at least two declarations.
 *   - **No trailing semicolon.** A `style` value ending in `;` comes back without
 *     it, measured on `display:block;`.
 *   - **No space after a semicolon.** `display:block; padding:0` comes back
 *     `display:block;padding:0`. (A space after the *colon* is kept, which is why
 *     this file uses neither — one rule is easier to hold than two.)
 *   - **Text and attributes are escaped differently, and that is measured rather
 *     than fastidious.** `wp_kses_normalize_entities` rewrites a bare `&` to
 *     `&amp;` in both, so an unescaped ampersand is a byte that moves. Inside an
 *     **attribute** it goes further: *every* spelling of an apostrophe — a raw one,
 *     and each of the three numeric and named entities, including the one
 *     `htmlspecialchars(ENT_QUOTES)` produces — comes back as `&apos;`. Between
 *     tags, nothing touches an apostrophe or a double quote at all. So there are
 *     two escapers, `escapeText()` and `escapeAttribute()`, and each does exactly
 *     what its position requires.
 *
 * Newlines and indentation between tags survive untouched, so the output is
 * pretty-printed. That is not decoration: this HTML is offered to a shopkeeper for
 * hand-editing in sub-task 5, and a single 4 kB line is not editable.
 *
 * ## The text part is generated from the values, never stripped from the HTML
 *
 * §85 requires both parts and the backend says why in two places —
 * `TemplateRenderer`'s docblock ("a text-only client shows a blank message
 * otherwise, and HTML-only mail scores worse with spam filters") and
 * `EmailTemplates::TEXT_META` ("the authored plain-text part, which is never
 * stripped from the HTML"). The rule is repeated here because the tempting
 * implementation is one regex, and it is wrong three times over:
 *
 *   - **Stripping tags reproduces the layout's scaffolding as text.** Every
 *     `<table>`, `<tr>` and `<td>` below exists to make a column, not to say
 *     anything; a stripped version of this document is the words in the right order
 *     surrounded by the whitespace of a table nobody can see.
 *   - **A link's text and a link's target are different facts.** `<a href="…">Shop
 *     now</a>` strips to `Shop now`, which is the one part of a call to action that
 *     is useless without the other. The text part below writes both.
 *   - **Stripping runs the escaping backwards.** The HTML holds `Th&eacute; &amp;
 *     caf&eacute;` and the text part must hold `Thé & café`; a stripper has to
 *     un-escape, and an un-escaper that is one entity behind mails somebody a
 *     numeric entity in the middle of their own surname. Generating from the values
 *     never encodes in the first place —
 *     which is exactly the split `TemplateRenderer::substitute()` makes with its
 *     `$escape` flag, for the same reason.
 *
 * So `buildEmail` walks the value object twice, once per part, in the same block
 * order. The two cannot disagree about what the email says, because neither is
 * derived from the other.
 *
 * ## RTL, and the attribute that is not there
 *
 * **`dir` is stripped from every tag.** Measured on `table`, `div`, `p` and `td`:
 * `<table dir="rtl">` comes back `<table>`. It is not in `ALLOWED` for anything, and
 * neither is `lang`. That is the finding that changed the design, because `dir` on a
 * table is the mechanism email clients actually honour, and it is unavailable.
 *
 * What survives, measured, is the pair this file uses on every text-bearing cell:
 *
 *   - **`direction:rtl` in the `style`** — `safecss_filter_attr` knows `direction`
 *     and keeps it. This is what sets the base paragraph direction, so a mixed
 *     Arabic-and-Latin line orders correctly and a trailing `?` lands on the correct
 *     side.
 *   - **`align="right"` on the `td`** — `align` *is* in `ALLOWED` for `td`, `th`,
 *     `p`, `div` and `table`, and it is the older attribute that Outlook's Word
 *     renderer honours when it ignores CSS. Belt and braces, on every block.
 *
 * `text-align` is set in the style as well, because `align` on a `td` and
 * `text-align` on the element inside it are not the same instruction in every
 * client, and headings cannot carry `align` at all: `ALLOWED['h1']` is `['style']`
 * and nothing else. So the cell carries the attribute and the element carries the
 * property, and the two agree by construction.
 *
 * **Run isolation is genuinely impossible here, and that is worth knowing before
 * somebody tries.** ADMIN_PANEL.md's own warning — *"numbers inside Arabic text need
 * `dir="ltr"` isolation or the digits reorder silently"* — has no email answer.
 * `dir` is stripped; and `<span style="direction:ltr">` is **not** a substitute,
 * because direction without `unicode-bidi:isolate` does not isolate, and
 * `unicode-bidi` is one of the properties `safecss_filter_attr` drops (measured).
 * The only mechanism that survives both sanitisers is the Unicode isolate characters
 * themselves, U+2068 and U+2069, which are text rather than markup. This file does
 * not insert them, and the reason is not that they would not work: **every string in
 * the message is the shopkeeper's own, written whole into a block whose direction
 * they chose**, so the generator never composes a mixed-script run and has no idea
 * where one is. If it becomes a problem it is the composer's to solve, over a
 * selection, with `components/primitives/Ltr.tsx`'s argument and those two
 * characters.
 *
 * ## No `font-family`, and that is a decision rather than an omission
 *
 * Three reasons, in order of weight.
 *
 * **The panel's own face cannot be delivered.** IBM Plex is self-hosted behind an
 * `@font-face` rule in `styles/tokens.css`; there is no `<style>` block to carry one
 * into a message and a remote stylesheet is stripped with it. Whatever this file
 * named would be a *different* typeface from the panel's, so the choice is not
 * "our font or theirs", it is "one guess or the client's".
 *
 * **A Latin stack is actively wrong for half of this panel's users.** The email is
 * French *or* Arabic. A font stack chosen for French resolves per glyph in Arabic —
 * the client falls back face by face and the result is a paragraph set in two or
 * three fonts at different weights. Naming nothing lets the client use the one face
 * it knows renders both scripts on that device, which is the outcome a stack would
 * have been trying to reach.
 *
 * **And it is what `scripts/check-design.sh` asks for anyway.** The font rule names
 * the two usual web-safe faces and the two generic families and refuses all four in
 * source, and says the fallback stack is `tokens.css`'s alone. That rule was written about the panel and this is
 * an email, so it would have been arguable — but there was nothing to argue *for*,
 * so no exemption was taken. The cost is real and is named rather than hidden: the
 * Outlook desktop renderer defaults an unstyled table cell to a serif, so a campaign
 * read in Outlook 2016 is set in Times New Roman. Everything else about the message
 * — size, leading, colour, measure — is stated explicitly, so only the face moves.
 *
 * ## Colour, and the one exemption this branch takes
 *
 * `scripts/check-design.sh` refuses a colour literal in `app/`, `components/`,
 * `lib/` and `i18n/`, and an inline-styled email is nothing but colour literals.
 * The tension is resolved by **moving all six of them into one file and exempting
 * that file by name** — `lib/email-palette.ts`, on `lib/theme-color.ts`'s precedent,
 * with the token each mirrors written beside it and a unit test that reads
 * `styles/tokens.css` and fails when one drifts. The exemption is added to
 * `COLOUR_EXEMPT` in the script with the reason in a comment, so the widening is on
 * the record rather than in a diff.
 *
 * **This file takes no exemption.** It contains no colour literal at all: the fixed
 * six arrive from the palette and the seventh — the brand colour — is a runtime
 * value the shopkeeper picked, normalised by `brandColour()` below and never
 * written down here. The check still guards every line of the markup, which is
 * where a stray colour would actually get written.
 */

/* ------------------------------------------------------------- the values --- */

/**
 * `ltr` or `rtl`, and it is the campaign's direction rather than the panel's.
 *
 * Taken as a value rather than derived from a locale here, because this module
 * imports nothing that knows about locales and because the two are not the same
 * question: an Algerian shop with an Arabic panel writes French campaigns, and the
 * composer's language switch must not silently reflow a body somebody already laid
 * out. `directionFor()` below is the default the form should *offer*.
 */
export type EmailDirection = "ltr" | "rtl";

/**
 * A picked image, in the three facts the layout needs.
 *
 * `src` **must be an absolute `http(s)` URL**, and that is a measured requirement
 * rather than a preference: a `data:` URI does not survive. `EmailHtml::sanitize()`
 * passes `['http', 'https', 'mailto']` as the protocol list, and measured,
 * `src="data:image/png;base64,AAA"` comes back `src="image/png;base64,AAA"` — not
 * removed, *mangled into a broken relative path*, which is the failure that looks
 * like a working save. `imageTag()` refuses anything else rather than emit it.
 *
 * `width` is the file's own pixel width, or `null` when the picker does not know
 * one. It is used only to avoid upscaling — see `imageTag()` — never to lay
 * anything out.
 */
export type EmailImage = {
  src: string;
  /**
   * Always emitted, even when empty (`alt=""`), because an `<img>` with no `alt`
   * attribute is read aloud as its filename while an explicitly empty one is
   * skipped. It is also the image's entire contribution to the text part.
   */
  alt: string;
  width: number | null;
};

/** The call to action: a label and where it goes. Both required, or neither. */
export type EmailCta = {
  label: string;
  /**
   * `http(s)`, `mailto:`, or a merge token.
   *
   * The token case is real rather than theoretical — a button reading
   * "Se désabonner" pointing at `{{unsubscribe_url}}` is a thing a shop builds —
   * and it survives the save untouched, measured: `<a href="{{unsubscribe_url}}">`
   * comes back identical, because `{{` is not a protocol. Anything else is
   * dropped by `safeHref()`; see its docblock for why silence is not an option
   * here.
   */
  href: string;
};

/**
 * Everything the composer's form collects that ends up inside the message.
 *
 * ## Which blocks are optional, and the fixed order
 *
 * Every one of them. `BLOCKS` below is the order they appear in and it is fixed;
 * a block is *present* exactly when its own values are non-empty, so the form's
 * toggles are "fill it in" and "clear it" rather than a second piece of state that
 * can disagree with the values. That is the property that makes this function
 * total: there is no combination of inputs it cannot render, and no ordering
 * decision left for the caller to get wrong.
 *
 * A values object where every block is empty produces `{html: "", text: ""}` rather
 * than an empty card — see `buildEmail`.
 *
 * ## What is deliberately **not** here
 *
 * **The subject.** It is a campaign field (`CampaignInput`'s `subject`, `Required —
 * a campaign with no subject line is not sendable.`) and not part of either body,
 * so a generator that took one would carry a field it never reads. The composer
 * already has a subject control and `Steps.tsx` already binds it. Merge tokens work
 * in it — `TemplateRenderer::render()` substitutes the subject too — which is why
 * `MERGE_TOKENS` and `insertToken()` are exported for any field rather than for
 * these ones.
 *
 * **A preheader.** The hidden line some clients show beside the subject is a
 * `<div style="display:none;max-height:0;overflow:hidden">`, and `overflow` is one
 * of the properties `safecss_filter_attr` drops. What survives is a `display:none`
 * div with no clamp, which several clients then render *visibly* at the top of the
 * message. A preheader that is sometimes the first line of the email is worse than
 * none.
 */
export type EmailValues = {
  direction: EmailDirection;
  /**
   * `#rgb` or `#rrggbb` as the colour control produced it, or `""` for *the shop
   * has not chosen one*. Normalised by `brandColour()`, never trusted as typed.
   */
  brandColour: string;
  logo: EmailImage | null;
  title: string;
  paragraphs: readonly string[];
  image: EmailImage | null;
  cta: EmailCta | null;
  footer: string;
};

/**
 * The blocks, in the order they are rendered, in both parts.
 *
 * Exported so the form draws its controls in the order the message reads. A list
 * rather than six hand-kept copies, which is `ADDRESS_KEYS`' argument in
 * `orders/new-order.ts` and holds for the same reason: the HTML walk, the text walk
 * and the form are three places that must agree about the order, and two of them
 * are in this file.
 */
export const BLOCKS = ["logo", "title", "paragraphs", "image", "cta", "footer"] as const;
export type EmailBlock = (typeof BLOCKS)[number];

/** A blank body. `ltr` is not a default — the caller states the direction. */
export function emptyValues(direction: EmailDirection): EmailValues {
  return {
    direction,
    brandColour: "",
    logo: null,
    title: "",
    paragraphs: [],
    image: null,
    cta: null,
    footer: "",
  };
}

/**
 * The direction a campaign in this locale should *start* as.
 *
 * Offered rather than imposed: `EmailValues.direction` is a stored decision, and
 * this is only what the form seeds it with when a new body is composed. `ar` is the
 * panel's one right-to-left locale; anything else is `ltr`.
 */
export function directionFor(locale: string): EmailDirection {
  return locale.toLowerCase().startsWith("ar") ? "rtl" : "ltr";
}

/* ------------------------------------------------------- the merge tokens --- */

/**
 * The five placeholders, **re-exported rather than re-declared**.
 *
 * Sub-task 6 asks for merge tokens to be "offered as a list to insert rather than
 * typed", and the list has to be the renderer's own or the feature is worse than
 * nothing: step 8 leans on `unknown_tokens` to catch a typo, and a picker offering a
 * sixth name the backend does not know would produce a token that renders *empty* —
 * which `TemplateRenderer::substitute()` does deliberately — and a warning the
 * shopkeeper did not cause.
 *
 * So the authority is `TemplateRenderer::TOKENS`, mirrored once in
 * `lib/campaigns.ts`, and this is a re-export of that mirror. Read from source, and
 * they match name for name: `customer_name`, `first_name`, `shop_name`,
 * `order_number`, `unsubscribe_url`. `CampaignService::recipientContext()` fills all
 * five for a real send and `::sampleContext()` fills the same five for a preview, so
 * there is no token that exists only in one of the two paths.
 *
 * **Nothing here pre-checks a body for unknown tokens**, and that is deliberate on
 * `draftProblems()`'s argument in `orders/new-order.ts`: the API already reports
 * them, by name, on the preview and on the test send, and a second local copy of
 * `TemplateRenderer::PATTERN` would be a rule that drifts the day the backend widens
 * it. The picker exists so a token is never typed; `unknown_tokens` exists so one
 * that was typed anyway is still caught.
 */
export const MERGE_TOKENS = TOKENS;
export { tokenLiteral };

/**
 * Insert a token at the caret, and say where the caret goes afterwards.
 *
 * Pure, and here rather than in the component, because the interesting part is the
 * two edge cases and both are worth a test: a *selection* is replaced rather than
 * pushed aside, and the caret lands **after** the inserted token rather than at the
 * end of the field — a caret that jumps to the end after every insert is how
 * somebody loses the sentence they were in the middle of.
 *
 * `start` and `end` are a DOM selection as `HTMLTextAreaElement` reports it, so
 * `start === end` is a plain caret. Both are clamped, because a stale selection
 * read from a field that has since been re-rendered is out of range rather than
 * impossible.
 */
export function insertToken(
  value: string,
  start: number,
  end: number,
  token: string,
): { value: string; caret: number } {
  const literal = tokenLiteral(token);
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));

  return {
    value: value.slice(0, from) + literal + value.slice(to),
    caret: from + literal.length,
  };
}

/* ------------------------------------------------------------ the metrics --- */

/**
 * The layout's numbers, in one place because they appear in both the markup and
 * the tests, and because "fluid" is a claim about exactly these.
 *
 * ## What "fluid" means in a table-based email, concretely
 *
 * There are no media queries — a media query needs a `<style>` block and the block
 * is stripped — so the layout cannot *rearrange* at a width. It has to be right at
 * every width instead, and that is four rules rather than an adjective:
 *
 *  1. **Every table is `width="100%"` and `style="width:100%"`, and the column is
 *     capped by `max-width` rather than by a width.** So the card is
 *     `min(100%, 600px)`: it fills a 320 px phone and stops at 600 px on a desktop,
 *     with no width at which it overflows. The attribute and the property are both
 *     set because Outlook's renderer reads the attribute and ignores the property,
 *     and it is the one client that does not honour `max-width` — where it
 *     therefore renders at its own fixed body width, which is close enough to 600 px
 *     that the design is unaffected.
 *  2. **`margin:0 auto` centres the capped column** once it is narrower than its
 *     parent, and `align="center"` on the cell above it does the same job for the
 *     renderer that ignores `margin`.
 *  3. **Horizontal space is padding in fixed pixels, never a percentage.** A
 *     percentage padding resolves against the *containing block's width*, so the
 *     inset would shrink to 6 px on a phone — where it is needed most — and stretch
 *     to 60 px on a desktop. 24 px inside the card and 12 px outside it are the same
 *     at every width, which is what makes the measure comfortable at 320 px without
 *     a second layout.
 *  4. **Nothing has an intrinsic width that can exceed the column.** Images carry
 *     `max-width:100%` with `height:auto` beside it, so a 1200 px photograph scales
 *     rather than forcing a horizontal scrollbar; their `width` attribute is capped
 *     at the content width so the renderer that ignores `max-width` still does not
 *     overflow. There is no fixed-width cell anywhere, no `white-space:nowrap`, and
 *     no second column at any width — which is the other half of "single-column":
 *     not "one column on a phone", but *one column, always*.
 *
 * Verified by measuring the emitted document rather than by looking at it:
 * `tests/email-body.test.ts` asserts that no `width` attribute exceeds
 * `CONTENT_WIDTH`, that every `<img>` carries `max-width:100%`, that the only
 * `max-width` on a table is the cap, and that the block table's row count equals the
 * block count — a second column would show up as a second `<td>` in a row.
 */
const CARD_WIDTH = 600;
/** 600 less the card's own 24 px inset on each side: the widest an image may be. */
const CONTENT_WIDTH = CARD_WIDTH - 48;
/** The logo is a mark, not a hero. Capped well below the content width. */
const LOGO_WIDTH = 180;
/** The card's inset, and the gutter outside it at a narrow width. */
const INSET = 24;
const OUTER_INSET = 12;

/**
 * The gap above each block, once it is not the first one on the card.
 *
 * Paragraphs sit closer to each other than blocks do to each other, which is the
 * only piece of vertical rhythm in the message and the reason this is a record
 * rather than one number. All on the 8 pt grid tokens.css sets.
 */
const GAP: Record<EmailBlock, number> = {
  logo: 24,
  title: 24,
  paragraphs: 16,
  image: 24,
  cta: 24,
  footer: 24,
};

/**
 * The type, and the one place this file departs from the panel's own scale.
 *
 * `--text-ui-display` (28/34) and `--text-ui-label` (13/18) are taken as they are.
 * The body is **16/26 where the panel's `--text-ui-body` is 15/22**, and the
 * departure is argued from that token's own comment: *"Body drops 17 → 15: this is
 * read on a monitor, and 17px in a table cell is a table that holds four columns."*
 * Neither half is true of a campaign — it is read on a phone at arm's length and it
 * has one column — so the reason for the smaller size is absent, and the leading is
 * opened up for the same reason a body of running prose is not a data table.
 */
const TYPE = {
  title: { size: 28, leading: 34, weight: 600 },
  body: { size: 16, leading: 26 },
  cta: { size: 16, leading: 24, weight: 600 },
  footer: { size: 13, leading: 20 },
};

/** `--radius-ui-lg` for the card, `--radius-ui-md` for the button. */
const RADIUS = { card: 8, button: 6 };

/* ------------------------------------------------------------- escaping --- */

/**
 * Escaping for text between tags.
 *
 * ## Why an ampersand has to be escaped even when nothing is attacking
 *
 * `wp_kses_normalize_entities()` runs on save and rewrites a bare `&` to `&amp;` —
 * measured, `<p>Thé & café</p>` comes back `<p>Thé &amp; café</p>`. So an
 * unescaped ampersand is not a security problem, it is a **byte that moves**, and
 * the round trip would fail on a shopkeeper who typed "Thé & café" into a title.
 * The `<` case is the same shape and is a real one: a title reading
 * `Soldes < 1000 DA` becomes `Soldes &lt; 1000 DA`, and left unescaped it is a
 * malformed tag that `wp_kses` may swallow along with everything after it. `>` is
 * escaped for symmetry with `<` rather than because it moves on its own.
 *
 * ## The quote and the apostrophe are deliberately **not** escaped here
 *
 * This is the one place this file knowingly departs from
 * `htmlspecialchars($value, ENT_QUOTES)`, which is what `TemplateRenderer::
 * substitute()` uses on merge values, and the departure is measured rather than
 * stylistic. Between tags, neither character is special and neither is touched by
 * the sanitiser: `<p>a"b</p>` and `<p>L'été</p>` both come back byte for byte.
 * Escaping them would still have round-tripped — `&quot;` and the padded
 * decimal apostrophe entity both survive intact in text — so the reason to leave them alone is what a mail client does
 * with them: `&apos;` is an HTML5 and XHTML entity that the older renderers this
 * layout is built for do not all define, and a message that prints the characters
 * `&apos;` in the middle of *L'été* is a defect nobody would find by reading the
 * generator. What is typed is what is sent.
 *
 * `escapeAttribute()` is the other half, and it has no such freedom.
 *
 * ## And it is the injection boundary, which is not this file's alone
 *
 * `EmailHtml`'s own docblock is explicit that a stored template is re-rendered in
 * *the admin's own preview*, with whatever session the admin app holds, so a
 * shopkeeper who pastes `<img src=x onerror=…>` into a paragraph is aiming at the
 * next person to open the composer. `wp_kses` would stop it on save; escaping here
 * stops it one step earlier, in the preview the composer renders from the client's
 * own draft before anything has been saved at all. Neither layer is sufficient
 * alone and this one is three lines. `<` and `&` are the two characters that can
 * start a tag or an entity, and they are exactly the two escaped.
 *
 * Merge tokens pass through untouched — `{` and `}` are not special to HTML — which
 * is what makes `{{first_name}}` typed into a paragraph still a merge field.
 */
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escaping for an attribute value, where the sanitiser has an opinion of its own.
 *
 * ## `&apos;` is not a choice, it is the only apostrophe that survives
 *
 * Measured, and this is the sharpest normalisation `wp_kses` performs: **every
 * spelling of an apostrophe inside an attribute value comes back as `&apos;`.** A
 * raw `'`, and its decimal entity in both the padded and unpadded spellings, and
 * `&#x27;`, were each sent in an `href` and in an `alt`, and each came back
 * `&apos;` — the padded decimal one included, which is precisely what
 * `htmlspecialchars(ENT_QUOTES)` produces. So the obvious implementation, "escape
 * an attribute the way PHP escapes a merge value", is the one implementation that
 * cannot round-trip: a shopkeeper whose shop is called *L'Artisan* would have moved
 * a byte on every save.
 *
 * There is no way to keep a literal apostrophe in an attribute, so this emits the
 * form the sanitiser would have produced anyway. In a URL the better answer is
 * upstream of this function — `%27` survives untouched, measured — and the media
 * library and the link field are where that belongs.
 *
 * The double quote is escaped because it terminates the value, and `&quot;` in an
 * attribute survives intact (measured, in an `href` and in an `alt`). `&amp;` and
 * `&lt;` survive intact there too, which is why a URL carrying a query string is a
 * fixture rather than a worry.
 */
function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Newlines normalised, control characters removed, ends trimmed.
 *
 * The character class is `EmailHtml::sanitizeText()`'s, copied deliberately: that
 * is what the backend runs over `body_text` on save (`CampaignService::create()`
 * and `::update()` both call it), so emitting anything it would remove means the
 * stored text part differs from the generated one — the same silent divergence the
 * HTML half is built to avoid, in the field nobody previews. `\t` and `\n` are
 * outside the class in both places, which is why a tab in a paragraph survives.
 */
function plain(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
}

/**
 * A heading is one line, and so is a button.
 *
 * `TemplateRenderer::oneLine()`'s rule, borrowed for a different reason: there it
 * is header injection, here it is that a hard break inside a 28 px heading breaks
 * at the width the author's textarea happened to be, which at 320 px is never where
 * they meant. Both wrap on their own.
 */
function oneLine(value: string): string {
  return plain(value).replace(/[\r\n\t]+/g, " ").trim();
}

/** A paragraph's own newlines become `<br>`; `br` takes no attributes. */
function paragraphHtml(value: string): string {
  return escapeText(plain(value)).replace(/\n/g, "<br>");
}

/* --------------------------------------------------------- the runtime bits --- */

/**
 * The brand colour, normalised to the one syntax that survives a save, or the
 * palette's default.
 *
 * A three-digit hex is expanded and everything is lower-cased, so the short and the
 * long spelling of one colour produce one string and the round trip is stable.
 * Anything else — a colour name, an `rgb` function, an eight-digit hex carrying
 * alpha, a half-typed value — falls back rather than being
 * emitted, and **falling back is the whole point**: `safecss_filter_attr` drops a
 * declaration it cannot parse and keeps the rest of the attribute, so a bad brand
 * colour would not produce a broken button, it would produce a button with **no
 * fill at all** — dark text on the card, still clickable, still looking deliberate.
 * A default the shopkeeper can see is recoverable; an invisible button is not.
 *
 * Alpha is refused rather than truncated for the same reason it is not offered: an
 * email has nothing behind the button to blend with, so a translucent brand colour
 * is a value that means something different in the picker than it does in the inbox.
 */
export function brandColour(input: string): string {
  const text = input.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);

  if (short) return `#${short[1]!.repeat(2)}${short[2]!.repeat(2)}${short[3]!.repeat(2)}`;
  if (/^#[0-9a-f]{6}$/.test(text)) return text;

  return EMAIL_PALETTE.brand;
}

/**
 * Black or white on the brand colour, whichever a person can actually read.
 *
 * WCAG 2.1's relative luminance and contrast ratio, computed rather than assumed,
 * because the shopkeeper picks the fill and the panel picks the text on it. A shop
 * whose brand is a bright yellow gets ink on it at 15.9:1; one whose brand is the
 * panel's own blue gets card on it at 5.6:1. Hard-coding white — which is what most
 * email builders do — would have handed the first shop a button nobody can read at
 * 1.3:1, and it would have looked fine to whoever chose it on a bright monitor.
 *
 * The two candidates are the palette's own `card` and `ink` rather than pure black
 * and white, so the button's text is the same two colours as the rest of the
 * message.
 */
export function onBrand(fill: string): string {
  return contrast(fill, EMAIL_PALETTE.card) >= contrast(fill, EMAIL_PALETTE.ink)
    ? EMAIL_PALETTE.card
    : EMAIL_PALETTE.ink;
}

/**
 * The contrast the call-to-action's label **actually gets**, so the form can warn.
 *
 * `onBrand()` picks the better of two candidates and returns the colour; it cannot
 * say whether the better one is good enough, and for a narrow band of brand colours
 * it is not. Exported so the composer can render that as a warning rather than
 * re-implementing WCAG beside it — one luminance function in this codebase, and the
 * screen that warns and the markup that is warned about read the same number.
 *
 * ## The worst case is **4.1130:1**, and it is a bound rather than an observation
 *
 * Two candidates: `card`, whose relative luminance is 1, and `ink`, whose luminance
 * is 0.012068. Contrast against the first falls as the fill lightens and contrast
 * against the second rises, so the worst fill is the one where the two curves cross,
 * and it can be solved for rather than searched for:
 *
 *     1.05 / (L + 0.05) = (L + 0.05) / (L_ink + 0.05)
 *     L = sqrt(1.05 × 0.062068) − 0.05 = 0.205286
 *     ratio = 4.1130
 *
 * Below AA's 4.5 for normal text, which is why a warning exists at all. Confirmed by
 * brute force over 65 536 fills, whose minimum was 4.1131 — the analytic bound, one
 * ulp up — and pinned in `tests/email-body.test.ts` so a change to either candidate
 * has to restate the number.
 *
 * No value appears in this paragraph, deliberately: the file takes no colour
 * exemption and the check that enforces that reads the whole source, prose included.
 *
 * **A third candidate would remove the band and is refused**, because the two
 * colours on the button have to be two of the six the rest of the message already
 * uses; a mid-grey chosen only to pass a ratio would be a seventh colour that
 * appears nowhere else in the mail. The composer warns instead, and does not refuse:
 * it is the shopkeeper's brand.
 */
export function brandContrast(fill: string): number {
  return Math.max(contrast(fill, EMAIL_PALETTE.card), contrast(fill, EMAIL_PALETTE.ink));
}

/** WCAG 2.1 contrast ratio between two `#rrggbb` strings. */
function contrast(a: string, b: string): number {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

/** WCAG 2.1 relative luminance of a `#rrggbb` string. */
function luminance(hex: string): number {
  const channel = (from: number) => {
    const value = Number.parseInt(hex.slice(from, from + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * A link target, or `null` for *do not emit a link at all*.
 *
 * `EmailHtml::sanitize()` passes `['http', 'https', 'mailto']` to `wp_kses`, and
 * what `wp_kses` does to a protocol outside that list is the reason this function
 * refuses rather than delegates: measured, `href="javascript:alert(1)"` comes back
 * `href="alert(1)"`. The protocol is stripped and **the rest is kept**, leaving a
 * link that is no longer dangerous and no longer works — a relative URL to a page
 * called `alert(1)` on the shop's own domain. The same shape turns
 * `data:image/png;base64,…` into `image/png;base64,…` on an `<img>`.
 *
 * So the choice is between a button that quietly goes nowhere and no button at all,
 * and no button is the honest one: the composer's preview shows the block missing,
 * which is a question somebody asks, where a link to `alert(1)` is a 200 nobody
 * notices until a customer clicks it.
 *
 * A merge token is allowed through as-is; see `EmailCta.href`.
 */
function safeHref(href: string): string | null {
  const text = oneLine(href);

  if (/^\{\{\s*[a-z0-9_]{1,40}\s*\}\}/i.test(text)) return text;
  if (/^(https?:\/\/|mailto:)/i.test(text)) return text;

  return null;
}

/* --------------------------------------------------------------- the markup --- */

/**
 * One `style` value from a list of declarations, with the empties dropped.
 *
 * The drop is what makes `style=""` unreachable, and `style=""` is removed by the
 * sanitiser — so a cell that computed to no declarations would come back a byte
 * shorter than it went in. Joined with `;` and no space, and with no trailing one:
 * both are normalisations the sanitiser would otherwise perform for us.
 */
function style(...declarations: (string | null)[]): string {
  return declarations.filter((one): one is string => one !== null && one !== "").join(";");
}

/**
 * `attribute="value"` pairs, in the order given, with the empties dropped.
 *
 * Order is preserved rather than sorted because the round trip is byte-for-byte and
 * `wp_kses` re-emits attributes in the order it read them.
 */
function attributes(pairs: [string, string | null][]): string {
  return pairs
    .filter(([, value]) => value !== null && value !== "")
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");
}

/**
 * The four attributes every layout table carries, and why each is not optional.
 *
 * `cellpadding`, `cellspacing` and `border` are the 1997 attributes and they are in
 * `ALLOWED` because Outlook's renderer still adds its own default spacing to a
 * table that omits them — which is how a carefully padded single column acquires a
 * 2 px seam down one side. `width="100%"` is the fluid rule's first half; the
 * `style` carries the second.
 */
function layoutTable(styleValue: string, align: string | null): string {
  return `<table${attributes([
    ["width", "100%"],
    ["cellpadding", "0"],
    ["cellspacing", "0"],
    ["border", "0"],
    ["align", align],
    ["style", styleValue],
  ])}>`;
}

/**
 * The image's source, or `null` for *this message cannot carry it*.
 *
 * Its own function because **both parts have to agree about it**, and the first
 * draft of this file did not: the HTML dropped an image whose `src` was a `data:`
 * URI and the text part still wrote its `alt`, so a message with no picture in it
 * described one. A single predicate, called from both walks, is what makes the two
 * bodies say the same thing about a refused block — the rule the file docblock
 * states, enforced rather than restated.
 *
 * `https` and `http` only, and see `imageTag()` for the measurement that rules
 * everything else out.
 */
function imageSrc(image: EmailImage): string | null {
  const src = image.src.trim();

  return /^https?:\/\//i.test(src) ? src : null;
}

/**
 * An `<img>`, or `null` when the source is not one this message can carry.
 *
 * The `width` attribute is `min(the file's own width, the cap)` so a small logo is
 * never blown up to 180 px, and is omitted entirely when the picker did not report
 * one — an absent attribute lets the client use the file's intrinsic size, where a
 * guessed one would stretch it. `max-width:100%` and `height:auto` beside it are the
 * fluid rule for images: the attribute is the width it *wants*, the property is the
 * width it is *allowed*.
 *
 * `display:block` removes the descender gap under an image in a table cell — the
 * few pixels of line-box below the baseline that read as a broken border — and it
 * is also what makes the margin below meaningful.
 */
function imageTag(image: EmailImage, cap: number, direction: EmailDirection): string | null {
  const src = imageSrc(image);
  if (src === null) return null;

  const width =
    image.width !== null && Number.isFinite(image.width) && image.width > 0
      ? String(Math.min(Math.round(image.width), cap))
      : null;

  return `<img${attributes([
    ["src", escapeAttribute(src)],
    ["alt", escapeAttribute(plain(image.alt))],
    ["width", width],
    [
      "style",
      style(
        "display:block",
        // Physical on purpose: `margin-inline-start` is not in
        // `safecss_filter_attr`'s list and would be dropped, and this is the one
        // place in the message where the block direction is not enough — a block
        // image ignores `text-align` entirely, so an auto margin is what pushes it
        // to the reading edge.
        direction === "rtl" ? "margin:0 0 0 auto" : "margin:0",
        "border:0",
        "max-width:100%",
        "height:auto",
      ),
    ],
  ])}>`;
}

/**
 * One row of the card: a `<tr>` and a `<td>` carrying the block's inset, its gap
 * and the direction pair.
 *
 * `padding` is always three values — top, sides, bottom — so the shorthand is one
 * shape everywhere and never collapses to something the sanitiser would rewrite.
 * The first block's top inset is the card's own 24 px rather than its gap, and the
 * last block's bottom inset is the card's; every other edge is zero, so the gaps
 * between blocks are stated once each rather than as two halves that have to add up.
 */
function row(inner: string, padding: string, direction: EmailDirection): string {
  const align = direction === "rtl" ? "right" : "left";

  return [
    "<tr>",
    `<td${attributes([
      ["align", align],
      ["style", style(`padding:${padding}`, `direction:${direction}`, `text-align:${align}`)],
    ])}>`,
    inner,
    "</td>",
    "</tr>",
  ].join("\n");
}

/** The typography every text element repeats, because email clients do not inherit it. */
function text(size: number, leading: number, colour: string, weight: number | null): string {
  return style(
    "margin:0",
    `font-size:${size}px`,
    `line-height:${leading}px`,
    weight === null ? null : `font-weight:${weight}`,
    `color:${colour}`,
  );
}

/* ------------------------------------------------------------ the generator --- */

export type EmailBody = {
  /** `body_html`. Survives `EmailHtml::sanitize()` unchanged — see the file docblock. */
  html: string;
  /** `body_text`. Survives `EmailHtml::sanitizeText()` unchanged, and is not the HTML with its tags removed. */
  text: string;
};

/**
 * The two bodies, from one values object, in one pass each.
 *
 * ## The empty case is `{"", ""}` and not an empty card
 *
 * A values object with nothing in it produces two empty strings rather than a
 * blank white rectangle, because `lib/campaigns.ts`'s `campaignBlocker()` already
 * treats `body_html.trim() === ""` as the `content` blocker that stops the composer
 * advancing. An empty card would satisfy that check while being an empty message —
 * the composer would let it through to a preview, a test send and an audience.
 * Producing nothing keeps the existing guard meaningful, which is worth more than
 * producing something.
 *
 * ## The blocks are walked twice, deliberately
 *
 * Once for `html` and once for `text`, in `BLOCKS` order both times, from the same
 * values. Neither derives from the other; see the file docblock for the three
 * reasons stripping is the wrong implementation.
 */
export function buildEmail(values: EmailValues): EmailBody {
  return { html: buildHtml(values), text: buildText(values) };
}

function buildHtml(values: EmailValues): string {
  const { direction } = values;
  const fill = brandColour(values.brandColour);
  const blocks: { block: EmailBlock; html: string }[] = [];

  const push = (block: EmailBlock, html: string | null) => {
    if (html !== null && html !== "") blocks.push({ block, html });
  };

  for (const block of BLOCKS) {
    switch (block) {
      case "logo":
        push(block, values.logo === null ? null : imageTag(values.logo, LOGO_WIDTH, direction));
        break;

      case "title": {
        const title = oneLine(values.title);
        push(
          block,
          title === ""
            ? null
            : `<h1 style="${style(
                text(TYPE.title.size, TYPE.title.leading, EMAIL_PALETTE.ink, TYPE.title.weight),
                `direction:${direction}`,
                `text-align:${direction === "rtl" ? "right" : "left"}`,
              )}">${escapeText(title)}</h1>`,
        );
        break;
      }

      case "paragraphs":
        /* One row per paragraph rather than several `<p>`s in one cell. It costs
           four lines of markup and buys a uniform rule — every gap in the message
           is a cell's `padding-top` — instead of a last-child exception that email
           clients could not have expressed anyway. */
        for (const paragraph of values.paragraphs) {
          const html = paragraphHtml(paragraph);
          if (html === "") continue;
          blocks.push({
            block,
            html: `<p style="${style(
              text(TYPE.body.size, TYPE.body.leading, EMAIL_PALETTE.ink, null),
              `direction:${direction}`,
              `text-align:${direction === "rtl" ? "right" : "left"}`,
            )}">${html}</p>`,
          });
        }
        break;

      case "image":
        push(block, values.image === null ? null : imageTag(values.image, CONTENT_WIDTH, direction));
        break;

      case "cta":
        push(block, values.cta === null ? null : ctaHtml(values.cta, fill, direction));
        break;

      case "footer":
        push(block, footerHtml(values.footer, direction));
        break;
    }
  }

  if (blocks.length === 0) return "";

  const rows = blocks.map(({ block, html }, index) =>
    row(
      html,
      `${index === 0 ? INSET : GAP[block]}px ${INSET}px ${index === blocks.length - 1 ? INSET : 0}px`,
      direction,
    ),
  );

  return [
    layoutTable(style("width:100%", `background-color:${EMAIL_PALETTE.ground}`), null),
    "<tr>",
    `<td align="center" style="padding:${INSET}px ${OUTER_INSET}px">`,
    layoutTable(
      style(
        "width:100%",
        `max-width:${CARD_WIDTH}px`,
        "margin:0 auto",
        `background-color:${EMAIL_PALETTE.card}`,
        `border:1px solid ${EMAIL_PALETTE.line}`,
        `border-radius:${RADIUS.card}px`,
      ),
      "center",
    ),
    ...rows,
    "</table>",
    "</td>",
    "</tr>",
    "</table>",
  ].join("\n");
}

/**
 * The call to action, as a table rather than a styled `<a>`.
 *
 * A padded, filled anchor is not a button in Outlook's renderer, which ignores
 * padding on an inline element — the fill collapses to the text's own box and the
 * result is a coloured word. A one-cell table with the fill and the padding on the
 * `<td>` is the shape that renders as a button everywhere, and the `<a>` inside is
 * `display:block` so the whole padded area is the target rather than the four
 * characters in the middle of it.
 *
 * It shrinks to its label rather than filling the column, and `align` puts it on the
 * reading edge. A full-width button would have been simpler and is the wrong shape
 * at 600 px: a call to action the width of a desktop card reads as a banner.
 */
function ctaHtml(cta: EmailCta, fill: string, direction: EmailDirection): string | null {
  const href = safeHref(cta.href);
  const label = oneLine(cta.label);

  if (href === null || label === "") return null;

  const align = direction === "rtl" ? "right" : "left";

  return [
    `<table${attributes([
      ["cellpadding", "0"],
      ["cellspacing", "0"],
      ["border", "0"],
      ["align", align],
      ["style", "border-collapse:collapse"],
    ])}>`,
    "<tr>",
    `<td align="center" style="${style(
      `background-color:${fill}`,
      `border-radius:${RADIUS.button}px`,
      "padding:12px 20px",
    )}">`,
    `<a${attributes([
      ["href", escapeAttribute(href)],
      ["target", "_blank"],
      [
        "style",
        style(
          text(TYPE.cta.size, TYPE.cta.leading, onBrand(fill), TYPE.cta.weight),
          "text-decoration:none",
          "display:block",
        ),
      ],
    ])}>${escapeText(label)}</a>`,
    "</td>",
    "</tr>",
    "</table>",
  ].join("\n");
}

/**
 * The footer, under a rule.
 *
 * `<hr>` rather than a one-pixel table row: it is in `ALLOWED` with `style`, which
 * is the backend saying it expects one, and `border:0;border-top:…` is what stops a
 * client drawing its own inset 3-D groove. The rule's spacing is the `hr`'s own
 * margin rather than the cell's padding, because a `<td>` puts its padding *inside*
 * its border and there would have been nowhere to put the gap above the line.
 *
 * `muted` rather than `ink`: this is the small print under the message, and it still
 * measures 6.25:1 on the card. It is also where the shop's address and the reason
 * this person is receiving the message belong — which is what makes the block worth
 * having rather than decoration, and why `TemplateRenderer` appends its unsubscribe
 * paragraph after everything here.
 */
function footerHtml(footer: string, direction: EmailDirection): string | null {
  const html = paragraphHtml(footer);
  if (html === "") return null;

  return [
    `<hr style="${style("border:0", `border-top:1px solid ${EMAIL_PALETTE.line}`, "margin:0 0 16px")}">`,
    `<p style="${style(
      text(TYPE.footer.size, TYPE.footer.leading, EMAIL_PALETTE.muted, null),
      `direction:${direction}`,
      `text-align:${direction === "rtl" ? "right" : "left"}`,
    )}">${html}</p>`,
  ].join("\n");
}

/**
 * The text part, from the same values in the same order.
 *
 * ## What each block contributes, and the one that contributes nothing
 *
 * An image's contribution is its `alt`, which is not a fallback dressed up as one:
 * alt text exists precisely to be the textual equivalent of a picture, so a logo
 * whose alt is the shop's name opens the message with the shop's name, and a
 * decorative image with `alt=""` contributes nothing and is skipped. That is the
 * same decision the HTML makes with `alt`, read the other way round.
 *
 * The call to action writes **both** halves — `Label: https://…` — because a label
 * without its target is the one thing in a plain-text message that cannot be acted
 * on, and a target without its label is a bare URL nobody knows the purpose of.
 *
 * ## Blocks are separated by a blank line and nothing else
 *
 * No rule of hyphens under the footer, and the reason is specific: a line of exactly
 * `-- ` is the signature separator, and several clients hide everything after one.
 * `TemplateRenderer::textFooter()` appends the unsubscribe link *after* this text,
 * so a separator that triggered that heuristic would hide the one link the message
 * is legally required to carry. A blank line does the same work and triggers nothing.
 *
 * ## Not wrapped at 72 characters
 *
 * The classic advice assumes a fixed-width terminal. Every client that will actually
 * open this soft-wraps, and a hard wrap costs twice: it re-breaks Arabic at
 * positions chosen by counting Latin characters, and it turns a paragraph into
 * fragments that cannot be reflowed when somebody reads it on a phone in portrait.
 * Line length on the wire is the transfer encoding's problem, not the body's.
 */
function buildText(values: EmailValues): string {
  const parts: string[] = [];

  for (const block of BLOCKS) {
    switch (block) {
      case "logo":
      case "image": {
        const image = block === "logo" ? values.logo : values.image;
        /* `imageSrc` first, so a picture the HTML refused is not described by the
           text — see its docblock, which is a defect this suite now guards. */
        if (image === null || imageSrc(image) === null) break;
        const alt = plain(image.alt);
        if (alt !== "") parts.push(alt);
        break;
      }

      case "title": {
        const title = oneLine(values.title);
        if (title !== "") parts.push(title);
        break;
      }

      case "paragraphs":
        for (const paragraph of values.paragraphs) {
          const one = plain(paragraph);
          if (one !== "") parts.push(one);
        }
        break;

      case "cta": {
        if (values.cta === null) break;
        const href = safeHref(values.cta.href);
        const label = oneLine(values.cta.label);
        /* The same refusal the HTML makes, for the same reason: a text part that
           advertised a link the HTML part does not contain would be the one place
           a stripped-protocol URL still reached a customer. */
        if (href === null || label === "") break;
        parts.push(`${label}: ${href}`);
        break;
      }

      case "footer": {
        const footer = plain(values.footer);
        if (footer !== "") parts.push(footer);
        break;
      }
    }
  }

  return parts.join("\n\n");
}
