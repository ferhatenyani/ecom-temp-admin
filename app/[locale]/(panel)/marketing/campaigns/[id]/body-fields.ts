import {
  BLOCKS,
  brandColour,
  brandContrast,
  buildEmail,
  emptyValues,
  type EmailCta,
  type EmailDirection,
  type EmailImage,
  type EmailValues,
} from "./email-body";

/**
 * The seam between `EmailValues` and the `body_fields` column, and the two
 * questions the composer asks about a body it did not generate.
 *
 * `email-body.ts` beside this is the pure generator: values in, `{html, text}`
 * out. This file is everything the *form* needs that the generator deliberately
 * does not own — how a values object is written to the wire and read back from
 * it, whether the stored bodies still match the answers that produced them, and
 * whether the shopkeeper's brand colour is legible on the call-to-action. All of
 * it pure, all of it asserted in `tests/body-fields.test.ts`, for the reason
 * `orders/new-order.ts` gives: the interesting half of a form is which values go
 * on the wire and in what shape, and that is a function of a plain object rather
 * than of eleven `fireEvent`s.
 *
 * ## How the backend claims below were established
 *
 * **Read from source** in `../ecom-temp` on `feat/campaign-composer`, by
 * `file:symbol`, and the API test file is cited where it pins a claim this file
 * depends on. Nothing here was measured over live HTTP — `BLOCKED.md` records the
 * 401 that stops that — and nothing was measured in-process either: the column is
 * another agent's uncommitted work on a branch this repo cannot run.
 *
 * ## `null` and `{}` are different claims, and this file is where the panel branches
 *
 * `body_fields` is a nullable `mediumtext` column —
 * `migrations/014_add_campaign_body_fields.php:109`, `body_fields mediumtext NULL
 * DEFAULT NULL` — and `Campaign::toArray()` emits it on **every** campaign read,
 * present-and-`null` rather than absent (`Campaigns/Campaign.php:355`). So there
 * are exactly two states and they mean different things:
 *
 *   **`null` — no answers were ever recorded.** A campaign written before the
 *   column existed, one built from a template, one whose HTML somebody wrote by
 *   hand or through the API. `Campaign::decodedFields()` also answers `null` for a
 *   column it cannot parse (`Campaign.php:181-190`), which is the same claim: the
 *   panel has no answers it can trust. **The form must not open**, because opening
 *   it would regenerate a body from nothing and write an empty message over
 *   somebody's work. `readValues()` returns `null` and the composer shows the two
 *   text areas.
 *
 *   **`{}` — the form was used and every answer is blank.** A campaign the panel
 *   created, or one whose blocks were all cleared. **The form opens.** The
 *   migration's own docblock argues the same distinction from the other side:
 *   *"Defaulting to `{}` would tell the panel that every campaign in the shop's
 *   history was composed with a form that did not exist when they were written."*
 *
 * The panel therefore has to *put* the campaigns it creates on the `{}` side, and
 * `CampaignsList.tsx` does: its `POST /campaigns` body carries `body_fields: {}`.
 * Without that line a campaign created by the button would read back `null` and
 * open the HTML editor, which is the one thing the two-state design exists to
 * avoid for a brand-new draft.
 *
 * **A top-level `{}` survives the round trip and a nested one does not.**
 * `Campaign::encodedFields()` substitutes `new stdClass()` for a wholly empty
 * document before encoding (`Campaign.php:315-318`) so the column holds `{}` and
 * not `[]`, and `toArray()` casts the outermost level back to an object — but the
 * cast is shallow, deliberately, because *"a repeater of blocks is a list on
 * purpose"* (`Campaign.php:300-302`). A **nested** empty object is therefore read
 * back as `[]`. `docs/API.md:1232` states it outright.
 *
 * That wrinkle cannot bite this shape, and it is by construction rather than by
 * luck: **an absent block is written as `null`, never as `{}`.** `logo`, `image`
 * and `cta` are the only nested objects here and they are either fully populated
 * or null. `paragraphs` is a list and stays one. So nothing in this document can
 * change type between the write and the read — which is the property `readValues()`
 * would otherwise have to defend against, and the reason it can be a plain
 * validator instead.
 *
 * ## The four refusals, and why none of them is reachable from this form
 *
 * `CampaignInput::bodyFields()` answers 400 with `details.fields.body_fields`
 * (`Campaigns/CampaignInput.php:390-431`, thrown at `:271`) for: a value that is
 * not an object; more than `MAX_FIELDS_BYTES = 65_536` bytes of encoded JSON
 * (`:126`, measured with `strlen()` on the **pre-sanitised** document); nesting
 * deeper than `MAX_DOCUMENT_DEPTH = 10` (`Campaigns/EmailHtml.php:259`); a key
 * longer than `MAX_FIELD_KEY = 64` bytes (`:135`); and a key containing markup.
 *
 * `writeValues()` emits a fixed set of eight keys, the longest of which is
 * `brand_colour` at twelve bytes, none containing markup, nested at most three
 * deep. Four of the five are unreachable by construction. **The size cap is the
 * one that is not**, because `paragraphs` is unbounded and somebody can paste a
 * book into it — so `body_fields` is bound in the composer's `ErrorSummary` like
 * every other field rather than assumed impossible. A refusal with no cause on
 * screen is the failure this panel has spent a run removing.
 *
 * ## The rewrite that is *not* a refusal
 *
 * `CampaignService::cleanFields()` runs `EmailHtml::sanitizeDocument()` over the
 * document on write (`Campaigns/CampaignService.php:960-963`, called at `:133` and
 * `:195`). It walks values only — the key is copied verbatim, `EmailHtml.php:222-232`
 * — and rewrites a string **only when it looks like markup**, which is
 * `preg_match('/<[a-zA-Z\/!]/', $value) === 1` (`EmailHtml.php:247`). Everything
 * else is returned byte-identical, including prose with a bare `<` in it — the API
 * test pins `"Tout à < 500 DA"` as unchanged, because no letter follows the `<` —
 * and including a hex colour, which the same test pins.
 *
 * So a paragraph reading `Nos <b>soldes</b> d'été` is stored with the `<b>` gone,
 * because `b` is not in `EmailHtml::ALLOWED`. That is a real edit to the
 * shopkeeper's text and `handEdited()` below reports it as one — see its docblock,
 * where it is the interesting case rather than a caveat.
 */

/* ------------------------------------------------------------ the wire shape --- */

/**
 * The eight keys `body_fields` holds, in `BLOCKS` order with the two that are not
 * blocks in front.
 *
 * **snake_case, and mapped rather than spread.** `EmailValues` is a TypeScript
 * type this branch invented and may rename; the column is stored data that outlives
 * every rename, and a shape written by spreading today's field names is a shape
 * that changes silently the day one of them is refactored. So the translation is
 * explicit in both directions and this constant is the only place the wire names
 * are written down — the seam a future rename is handled at, rather than a bug it
 * causes. It is also the panel's own house style: every other payload on this wire
 * is snake_case.
 *
 * Exported for the test that asserts every key is inside the backend's 64-byte key
 * cap, which is the one refusal a rename could walk into.
 */
export const BODY_FIELD_KEYS = [
  "direction",
  "brand_colour",
  ...BLOCKS,
] as const;

/** `body_fields` as it goes on the wire. Absent blocks are `null`, never `{}`. */
export function writeValues(values: EmailValues): Record<string, unknown> {
  return {
    direction: values.direction,
    brand_colour: values.brandColour,
    logo: writeImage(values.logo),
    title: values.title,
    /* A list, and it stays one through the round trip — `JSON_FORCE_OBJECT` is
       deliberately not used on the backend for exactly this reason. */
    paragraphs: [...values.paragraphs],
    image: writeImage(values.image),
    cta: values.cta === null ? null : { label: values.cta.label, href: values.cta.href },
    footer: values.footer,
  };
}

function writeImage(image: EmailImage | null): Record<string, unknown> | null {
  return image === null ? null : { src: image.src, alt: image.alt, width: image.width };
}

/**
 * `body_fields` as it came back, or `null` for *this campaign has no answers*.
 *
 * **A validator rather than a parser, and every field degrades on its own.** The
 * document is the panel's own writing, so the pressure here is not a hostile
 * payload — it is a document written by an older version of this file, or one the
 * backend's sanitiser rewrote a value inside. A whole-document `zod` schema would
 * turn either into a thrown parse and a blank screen on a campaign that is
 * otherwise fine; this reads what it recognises, defaults what it does not, and
 * never fails. That is `unknownSectionTypes()`'s rule on the homepage and
 * `recipient.status`' one collection over, arriving here for the same reason.
 *
 * The one thing it will not do is invent answers: `null` in, `null` out. The
 * caller branches on that and opens the HTML editor instead — see the file
 * docblock.
 *
 * `fallback` is the direction a document that does not state one gets, and it is
 * the *campaign's* locale rather than `ltr`: a body written by an older shape of
 * this file has no `direction` key, and defaulting an Arabic shop's campaign to
 * left-to-right would reflow a message somebody already laid out.
 */
export function readValues(raw: unknown, fallback: EmailDirection): EmailValues | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;

  /*
   * An array reaches here two ways and both mean "an empty document": a nested
   * `[]` cannot occur at the top level, but a client that sent `[]` would have it
   * accepted (`CampaignInput.php:402-405` — *"`[]` and `{}` are the same value
   * once PHP has decoded them"*), and `Object.entries([])` is `[]` either way. So
   * this needs no branch; it is named because the asymmetry is surprising.
   */
  const document = raw as Record<string, unknown>;
  const base = emptyValues(readDirection(document.direction, fallback));

  return {
    ...base,
    brandColour: readString(document.brand_colour),
    logo: readImage(document.logo),
    title: readString(document.title),
    paragraphs: readParagraphs(document.paragraphs),
    image: readImage(document.image),
    cta: readCta(document.cta),
    footer: readString(document.footer),
  };
}

/** Whether a campaign's `body_fields` means *the form composed this*. */
export function isComposed(raw: unknown): boolean {
  return raw !== null && raw !== undefined && typeof raw === "object";
}

function readDirection(raw: unknown, fallback: EmailDirection): EmailDirection {
  return raw === "rtl" || raw === "ltr" ? raw : fallback;
}

function readString(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function readParagraphs(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((one): one is string => typeof one === "string") : [];
}

/**
 * An image block, or null — and **a `src` that is not a string is the whole block
 * gone**, not a block with an empty `src`.
 *
 * `imageTag()` in the generator already refuses a non-`http(s)` source, so an
 * empty one would render as nothing anyway; what this avoids is the *form*
 * drawing a picked-image row with no picture in it, which reads as a broken
 * upload rather than as an empty block.
 */
function readImage(raw: unknown): EmailImage | null {
  if (raw === null || typeof raw !== "object") return null;

  const image = raw as Record<string, unknown>;
  if (typeof image.src !== "string" || image.src === "") return null;

  return {
    src: image.src,
    alt: readString(image.alt),
    /* `MediaItem.width` is `number | null` — null for a file WordPress could not
       measure — and the generator uses it only to avoid upscaling. */
    width: typeof image.width === "number" ? image.width : null,
  };
}

/** The call to action. **Both halves or neither** — `EmailCta` says so. */
function readCta(raw: unknown): EmailCta | null {
  if (raw === null || typeof raw !== "object") return null;

  const cta = raw as Record<string, unknown>;
  const label = readString(cta.label);
  const href = readString(cta.href);

  return label === "" && href === "" ? null : { label, href };
}

/* --------------------------------------------------- the prefill from the shop --- */

/**
 * What the shop's own settings can seed a blank body with.
 *
 * ## There is a logo and there is **no brand colour**, and that is read from source
 *
 * Sub-task 3 asks for "the store logo and colour". Only one of the two exists.
 * `Settings\SettingsInput::SCHEMA` is the entire writable surface —
 * `SettingsInput.php:39-44`, four blocks and nineteen keys — and
 * `SettingsService::assemble()` is the entire read surface (`:117-157`). Neither
 * holds a colour, an accent, a brand or a theme, under any spelling; unknown keys
 * are refused by name (`SettingsInput.php:131-137`) so one cannot be smuggled in
 * either. A grep for `colou?r|brand|accent|primary|theme` across `src/Settings/`
 * returns nothing at all, and across the whole plugin returns only accent-folding
 * of place names, a WooCommerce `pa_colour` product attribute, and prose.
 *
 * **So the colour is not prefilled and no field is invented for it.** The brand
 * colour starts empty, which is not a gap: `brandColour("")` answers
 * `EMAIL_PALETTE.brand` — the panel's own accent, `--color-ui-accent`, 5.63:1 on
 * the card — so a shopkeeper who never touches the control still gets a legible,
 * deliberate button rather than an unstyled one. What the composer owes them is a
 * sentence saying the colour is the panel's rather than their shop's, and it says
 * one. Putting a colour into `/settings` is a backend change on a route this
 * branch does not touch.
 *
 * ## The logo comes from `logo`, not from `logo_id`
 *
 * `store.logo.url` is `wp_get_attachment_url()` and is already absolute, so this
 * needs no second request — see the schema's own note. Branching on the resolved
 * object rather than on the id is what keeps a deleted attachment out of the
 * message: `logo_id` stays non-zero after a delete while `logo` goes null.
 *
 * `width` is `null` because `SettingsService::image()` does not publish one. The
 * generator caps a logo at `LOGO_WIDTH` and uses `width` only to avoid upscaling a
 * small file, so the cost is precisely that a shop logo narrower than 180px is
 * drawn at 180 rather than at its own size.
 *
 * Returns `null` when there is nothing to seed, which is also what a **403** looks
 * like from here: `/settings` is `ac_manage_settings`, Super Admin alone
 * (`SettingsController.php:41-54`), so a reader who is not one gets no prefill and
 * loses nothing else. The caller softens the request rather than letting it take
 * the screen.
 */
export function shopLogo(store: { logo: { url: string; alt: string } | null } | null): EmailImage | null {
  if (store === null || store.logo === null || store.logo.url === "") return null;

  return { src: store.logo.url, alt: store.logo.alt, width: null };
}

/**
 * A blank body, with whatever the shop's branding could fill in.
 *
 * The seed for a campaign whose `body_fields` is `{}` — *"so a client's first
 * campaign already looks like their shop with nothing configured"*. It is a seed
 * and not a binding: once the form has been touched the answers are the answers,
 * and changing the shop's logo afterwards does not reach back into a saved
 * campaign. That is the same reading `EmailValues.direction` gets from
 * `directionFor()` — offered, not imposed.
 */
export function seededValues(direction: EmailDirection, logo: EmailImage | null): EmailValues {
  return { ...emptyValues(direction), logo };
}

/* ------------------------------------------------------- the hand-edit flag --- */

/**
 * Whether the stored bodies still say what the answers say — **derived, not
 * stored**, and this is the branch's largest single decision.
 *
 * ## The choice
 *
 * Sub-task 5 wants a flag that survives a reload, which leaves two implementations:
 * a boolean written into `body_fields` beside the answers, or a comparison run on
 * what is already there. This is the comparison, and the argument is not that it is
 * cheaper — two string builds against a `===`, both negligible — but that **a
 * stored flag can be wrong and a derived one cannot be stale.**
 *
 * A stored flag is a twelfth value to keep in sync with eleven others, and every
 * way it goes wrong is silent:
 *
 *   - **It cannot see an edit made anywhere else.** `PATCH /campaigns/{id}` is a
 *     public route. A body edited by a script, by another tab, or by a future
 *     screen leaves the flag reading `false` over a body nobody generated — and the
 *     next field change would then quietly regenerate over it, which is the exact
 *     act sub-task 5 exists to warn about.
 *   - **It can survive its own reason.** Undo writes `false`; a failed PATCH after
 *     it leaves the stored `false` describing a body that is still hand-written.
 *   - **It is a key inside a document the backend validates.** One more name under
 *     the 64-byte cap, one more thing `readValues()` has to degrade, and a boolean
 *     that reads `"true"` from an older writer is a flag that is simply wrong
 *     rather than absent.
 *
 * The derived flag has none of those states because it has no state. It answers the
 * question that is actually being asked — *would regenerating change what is on
 * screen?* — from the two things the answer depends on.
 *
 * ## What makes the comparison sound, and it is not an assumption
 *
 * A derived flag is only worth anything if the bodies the panel wrote are the bytes
 * that come back. They are, and that is measured rather than hoped: `buildEmail()`'s
 * output **round-trips `EmailHtml::sanitize()` byte-for-byte**, all fourteen
 * fixtures, and `npm run test:email-roundtrip` fails the day one of them drifts.
 * The generator's whole shape — no `<style>`, no `class`, attributes emitted in the
 * order `wp_kses` re-emits them, `style=""` made unreachable because the sanitiser
 * strips it — exists to buy exactly this property, and this is the second thing it
 * buys. Without it the sanitiser would rewrite the panel's own markup on save and
 * every reload would report a hand edit that never happened.
 *
 * ## The one case it calls hand-edited that a person did not type
 *
 * `EmailHtml::sanitizeDocument()` rewrites a **field value** that looks like markup
 * (`EmailHtml.php:222-247`). A paragraph reading `Nos <b>soldes</b> d'été` is
 * stored with the tag gone, so on the next read the answers generate a body the
 * stored one does not match, and this reports `true`.
 *
 * **That is the right answer, not a false positive.** The claim being made is *the
 * stored bodies and the stored answers disagree*, and after that rewrite they
 * genuinely do — the paragraph the shopkeeper reads back is not the paragraph they
 * typed. Reporting it puts the discrepancy in front of them with an Undo that
 * resolves it, which is strictly better than the alternative reading, where the
 * panel silently regenerates and the missing `<b>` becomes something they discover
 * in an inbox. The flag fails toward the warning, which is the direction a warning
 * should fail in.
 */
export function handEdited(
  values: EmailValues,
  html: string,
  text: string,
): boolean {
  const built = buildEmail(values);
  return built.html !== html || built.text !== text;
}

/**
 * The two bodies after a change to the answers, and **the whole of "warns before
 * overwriting manual edits"** on the silent side.
 *
 * Sub-task 5 asks for a warning before Undo overwrites a hand edit. The warning is
 * a dialog and lives in the component; this is the other half, which is easier to
 * get wrong because nothing prompts you to think about it: **a field change must
 * not quietly do what Undo asks permission for.**
 *
 * So the rule is one line — *regenerate only while the bodies still match the
 * answers* — and it needs no "has been edited" flag to arm it, which is the second
 * argument for deriving rather than storing. Read the two branches as a state
 * machine and it closes on itself:
 *
 *   **Not hand-edited.** Every field change regenerates, the bodies keep matching,
 *   and the next change regenerates too. The form and the message stay one thing.
 *
 *   **Hand-edited.** The bodies are left exactly as they are. Editing a field now
 *   changes the answers and not the message, the two stay diverged, and the state
 *   is stable rather than one keystroke from erasing somebody's work. Undo is the
 *   only way back, and it asks first.
 *
 * `previous` is the answers as they were, because the question is whether the
 * bodies on screen match *what produced them* — not whether they match the answers
 * the person is in the middle of typing, which they never do.
 */
export function nextBodies(
  previous: EmailValues,
  next: EmailValues,
  html: string,
  text: string,
): { html: string; text: string } {
  if (handEdited(previous, html, text)) return { html, text };

  return buildEmail(next);
}

/* ---------------------------------------------------- the brand colour's read --- */

/**
 * WCAG 2.1 AA for normal text. The generator's own worst case is 4.1130:1, below
 * this, which is why the form warns at all — see `brandContrast()`.
 */
export const AA_NORMAL_TEXT = 4.5;

/**
 * Whether the call-to-action's label is legible on the chosen brand colour.
 *
 * **A warning and never a refusal**, and the reason is the one thing about this
 * control that is not the panel's to decide: it is the shopkeeper's brand. A shop
 * whose logo is a mid-magenta does not stop being that shop because two candidate
 * text colours both land under 4.5:1, and a form that refused the value would be a
 * panel telling a business its own colours are invalid.
 *
 * So the composer states the consequence — the label on the button is hard to read
 * — draws the button at the size and colours it will actually have, and leaves the
 * decision where it belongs. `furthestStep()` is untouched: this never gates the
 * wizard.
 *
 * Takes the input **as typed** rather than as normalised, and normalises here, so
 * the answer is about the colour that will actually be emitted: a half-typed `#12`
 * falls back to the palette's accent at 5.63:1 and reports no problem, which is
 * true — the message will carry the accent.
 */
export function brandLegible(input: string): boolean {
  return brandContrast(brandColour(input)) >= AA_NORMAL_TEXT;
}

/**
 * The contrast the label will actually get, for the sentence that names the number.
 *
 * Rounded to two decimals here rather than in the component: a ratio is a
 * measurement and the place a measurement is rounded is a decision, not a
 * formatting detail. Two decimals is what `tokens.css` records its own ratios to.
 */
export function brandRatio(input: string): number {
  return Math.round(brandContrast(brandColour(input)) * 100) / 100;
}
