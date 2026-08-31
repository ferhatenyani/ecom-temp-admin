/**
 * The campaigns vocabulary, and the facts that decide how the composer is built.
 *
 * No dependencies, so a client component can import a value from here without
 * pulling Zod into the browser — the split `lib/cms.ts` and `lib/notifications.ts`
 * already make. `lib/api/schemas/campaign.ts` imports this, never the reverse.
 *
 * Measured against the live API on 2026-08-21, and the measurements are in the
 * comments rather than in a changelog because the comment is what somebody reads
 * before changing the value under it.
 */

/* ------------------------------------------------------------- statuses --- */

/**
 * Four, and `?status=` refuses a fifth by name — with an **empty string in the
 * enum**, which is how "all" is spelled:
 *
 *   ?status=nonsense → 400  "status is not one of , draft, sending, sent, and
 *                            cancelled."
 *
 * Note the leading comma. `?status=` with no value is legal and means every
 * status, so the segmented control's first segment sends nothing rather than an
 * empty parameter.
 */
export const CAMPAIGN_STATUSES = ["draft", "sending", "sent", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export function isCampaignStatus(value: string): value is CampaignStatus {
  return (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

/**
 * The tone each status carries.
 *
 * `sending` is **accent and not warning**: nothing is wrong with it, it is the
 * ordinary state of a campaign between `send` and the drain finishing, and a shop
 * whose scheduler runs every five minutes will see it constantly. `cancelled` is
 * neutral rather than danger for the same reason — somebody chose it.
 */
export const CAMPAIGN_TONE: Record<
  CampaignStatus,
  "neutral" | "accent" | "success" | "warning" | "danger"
> = {
  draft: "neutral",
  sending: "accent",
  sent: "success",
  cancelled: "neutral",
};

/**
 * **`is_editable` and `allowed_transitions` are published, so nothing here
 * hard-codes the transition table.** Measured on a sent campaign:
 * `is_editable: false`, `allowed_transitions: []`. On a draft: `true` and
 * `["sending", "cancelled"]`. The panel reads them, exactly as the orders screen
 * reads the 409 body rather than carrying its own table.
 *
 * These helpers exist so the *reason* can be shown, which the flags alone cannot
 * say: "only a draft can be edited" is the sentence, and the API says it in a 409
 * the panel would otherwise have to provoke to find out.
 */
export function canEdit(campaign: { is_editable: boolean }): boolean {
  return campaign.is_editable;
}

/** Only a draft can be deleted. A cancelled one answers 409 naming the status. */
export function canDelete(campaign: { status: string }): boolean {
  return campaign.status === "draft";
}

export function canCancel(campaign: { allowed_transitions: readonly string[] }): boolean {
  return campaign.allowed_transitions.includes("cancelled");
}

export function canSend(campaign: { allowed_transitions: readonly string[] }): boolean {
  return campaign.allowed_transitions.includes("sending");
}

/* -------------------------------------------------------------- audience --- */

/**
 * Three kinds, and the panel never sends a fourth.
 *
 * `ids` carries `customer_ids` (at most 1 000), `segment` carries `segment_id`,
 * `all` carries neither.
 *
 * **`audience_type: "segment"` with no `segment_id` is a 400 on *create only*.**
 * Corrected 2026-08-28: this said "a 400 on that field" without qualifying the
 * verb, and the two verbs disagree. `POST /campaigns` refuses it — and refuses it
 * even when `audience_type` is absent, because absent behaves as `"segment"`.
 * `PATCH /campaigns/{id}` answers **200** and stores `segment_id: 0`, which is a
 * campaign pointed at a segment that is not one.
 *
 * So `audienceProblem()` below is the *panel's* rule on the edit path rather than
 * a mirror of the API's, and that is the reason it exists: the composer refuses
 * to advance rather than letting a person walk to a send whose audience resolves
 * to nothing. On create it happens to agree with the API.
 */
export const AUDIENCE_TYPES = ["all", "segment", "ids"] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

export function isAudienceType(value: string): value is AudienceType {
  return (AUDIENCE_TYPES as readonly string[]).includes(value);
}

/** At most a thousand ids. The API refuses the 1001st. */
export const MAX_CUSTOMER_IDS = 1000;

/**
 * Whether an audience is complete enough to send.
 *
 * Not a guess at the API's rules — each clause is a 400 that was measured — and
 * it exists so the wizard can refuse to advance rather than advancing into a
 * refusal.
 */
export function audienceProblem(audience: {
  type: string;
  segment_id: number;
  customer_ids: readonly number[];
}): "segment_missing" | "ids_missing" | "too_many_ids" | null {
  if (audience.type === "segment" && audience.segment_id <= 0) return "segment_missing";
  if (audience.type === "ids" && audience.customer_ids.length === 0) return "ids_missing";
  if (audience.type === "ids" && audience.customer_ids.length > MAX_CUSTOMER_IDS) {
    return "too_many_ids";
  }
  return null;
}

/* --------------------------------------------------------------- consent --- */

/**
 * **The number the composer exists to make legible.**
 *
 * Every audience is filtered to consenting customers *by the resolver*, including
 * an explicit list of ids — there is no argument that turns it off. So the count
 * a person chose and the count that will be mailed are different numbers, and the
 * spec asks for both: "1 000 clients sélectionnés → 412 destinataires".
 *
 * Measured on this shop before the seed: **1 of 16 customers had consent**, so
 * the gate was there and illegible. `scripts/seed-campaigns.mjs` grants it to
 * eight, which is what makes a segment's count differ from `all`'s and from zero.
 *
 * `selected` is null for `all` and for `segment` — the panel has no honest number
 * to put there, since only the server knows how many a segment matches before the
 * consent filter. It is a real count only for `ids`, where the person picked them.
 */
export function consentGap(
  selected: number | null,
  eligible: number | null,
): { selected: number; eligible: number; excluded: number } | null {
  if (selected === null || eligible === null) return null;
  if (selected <= eligible) return null;
  return { selected, eligible, excluded: selected - eligible };
}

/**
 * `audience_count` is **null for a caller who cannot read customers**, not
 * absent and not zero.
 *
 * Measured: a Marketing Manager previewing a campaign gets the rendered HTML and
 * text, and `audience_count: null`. That is `canSendCampaigns()` showing through
 * on a route that is otherwise theirs — counting an audience means counting
 * customers. The panel renders the preview and says the count is not theirs to
 * see, rather than printing a zero that would read as "nobody".
 */
export function hasAudienceCount(preview: { audience_count: number | null }): boolean {
  return preview.audience_count !== null;
}

/* ------------------------------------------------------------ the tokens --- */

/**
 * The five placeholders, and the trap.
 *
 * **An unknown token renders empty**, which is invisible in a preview that has a
 * name in it from another token — `{{firstname}}` is not `{{first_name}}`, and a
 * preview reading "Bonjour ," is easy to skim past. So `unknown_tokens` is
 * surfaced as a warning with the tokens named, on the composer *and* on the
 * template, which is where §85 asks for it.
 *
 * Measured on a seeded draft: `unknown_tokens: ["firstname"]`, and the rendered
 * HTML was `<p>Bonjour ,</p>`.
 */
export const TOKENS = [
  "customer_name",
  "first_name",
  "shop_name",
  "order_number",
  "unsubscribe_url",
] as const;
export type Token = (typeof TOKENS)[number];

/** `{{token}}` as it is written in a body. */
export function tokenLiteral(token: string): string {
  return `{{${token}}}`;
}

/* ------------------------------------------------- the malformed ones --- */

/**
 * `TemplateRenderer::PATTERN`, mirrored — **the shape a token has to have before
 * the API will look at it at all.**
 *
 * Read from source: `Campaigns/TemplateRenderer.php:78`,
 * `/\{\{\s*([a-z0-9_]{1,40})\s*\}\}/i`. Whitespace *around* the name is
 * tolerated and the `i` flag plus `strtolower()` mean `{{First_Name}}` already
 * works — those two are why this is not simply "the token, spelled exactly".
 * Anchored here because this asks *is this whole brace pair well formed*, where
 * the API scans for occurrences.
 */
const WELL_FORMED = /^\s*[a-z0-9_]{1,40}\s*$/i;

/** Any `{{…}}` pair with no braces inside it, well formed or not. */
const BRACE_PAIR = /\{\{([^{}]*)\}\}/g;

/** One correction, for the sentence the operator is shown. */
export type TokenRepair = { from: string; to: Token };

/**
 * Correct `{{first name}}` to `{{first_name}}`, and say what was corrected.
 *
 * ## The defect, which is worse than a misspelling
 *
 * `TemplateRenderer::PATTERN` requires `[a-z0-9_]` between the braces, so
 * `{{first name}}` **matches nothing**. It is not substituted, and — the part
 * that makes it worth a separate check — it is not reported in `unknown_tokens`
 * either, because that list is built from the same `preg_match_all` over the
 * same pattern (`TemplateRenderer.php:133-145`, read from source). So the
 * existing warning cannot see it. It is mailed to every recipient verbatim, with
 * the braces showing.
 *
 * That makes this the *second* check on this screen and not a replacement for
 * the first. `unknown_tokens` catches `{{firstname}}` — well formed, spelled
 * wrong, renders **empty**. This catches `{{first name}}` — malformed, and
 * renders as itself. Neither sees the other's case.
 *
 * ## Only ever onto a token that exists, and that is the whole safety argument
 *
 * A repair fires when the normalised name is one of the five in `TOKENS`, and
 * never otherwise. The temptation is to normalise everything that looks like a
 * placeholder, and it makes things strictly worse: `{{numéro de suivi}}` mails
 * verbatim today, which is visible and embarrassing and fixable by the person
 * who reads the test send. Rewritten to `{{numero_de_suivi}}` it becomes a well
 * formed unknown token, which renders **empty** — the failure this whole
 * subsystem exists to prevent, manufactured by the thing meant to prevent it.
 *
 * So a name that does not land on a real token is left exactly as typed. It then
 * mails verbatim, as it did before, and that is the honest outcome rather than
 * the tidy one.
 *
 * ## What counts as normalising
 *
 * Trim, lower-case, and every run of characters outside `[a-z0-9]` becomes one
 * `_`, with leading and trailing underscores dropped. That covers the three ways
 * this is actually mistyped — a space, a hyphen, and a capital with a space —
 * and it is deliberately not accent-folding: all five tokens are ASCII words, so
 * somebody who typed `{{prénom}}` typed a different word, not a damaged one, and
 * the membership gate above will decline it.
 *
 * A well formed pair is returned untouched, including one whose name is unknown.
 * `{{firstname}}` is `unknown_tokens`' to report and this must not silently
 * "fix" it into `{{first_name}}`: the API can see that one, and guessing which
 * of five words somebody meant is a different and much larger claim than
 * repairing punctuation.
 *
 * @returns the corrected text, and one entry per distinct correction made.
 */
export function repairTokens(text: string): { text: string; repairs: TokenRepair[] } {
  const repairs: TokenRepair[] = [];

  const corrected = text.replace(BRACE_PAIR, (whole, inner: string) => {
    if (WELL_FORMED.test(inner)) return whole;

    const slug = inner
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    const token = TOKENS.find((known) => known === slug);
    if (token === undefined) return whole;

    const from = inner.trim();
    if (!repairs.some((made) => made.from === from)) repairs.push({ from, to: token });

    return tokenLiteral(token);
  });

  return { text: corrected, repairs };
}

/**
 * `repairTokens()` over several strings at once, with the corrections merged.
 *
 * The composer repairs a subject, two bodies and every string inside the form's
 * answers in one act, and the operator is owed **one** sentence about it rather
 * than four. Merged on `from`, because the same mistyped token in the subject and
 * in a paragraph is one mistake made twice.
 */
export function mergeRepairs(all: readonly TokenRepair[]): TokenRepair[] {
  const merged: TokenRepair[] = [];
  for (const made of all) {
    if (!merged.some((held) => held.from === made.from)) merged.push(made);
  }
  return merged;
}

/**
 * **`{{unsubscribe_url}}` absent is correct, not missing.**
 *
 * The API appends one when it is not there — measured, `unsubscribe_appended:
 * true` on a preview of a body that never mentioned it — so the screen says "we
 * added one" rather than warning about an omission. Adding a second by hand is
 * the mistake this note exists to prevent.
 */
export function unsubscribeNote(preview: { unsubscribe_appended: boolean }): "appended" | "authored" {
  return preview.unsubscribe_appended ? "appended" : "authored";
}

/* ------------------------------------------------------------- recipients --- */

/**
 * The three the notification queue has, and the same meaning — but **an open
 * vocabulary rather than a closed one**, which is a correction made on the gaps
 * branch rather than a widening for its own sake.
 *
 * These three are every value this shop's drain writes *today*. They are not a
 * contract: nothing in the API publishes the set, no refusal enumerates it the way
 * `?status=` on `/campaigns` enumerates its four, and the mail path is the part of
 * this shop most likely to change — §15 records that it is "likely moving to a
 * different mail path". A `delivered` or a `bounced` is the ordinary next value.
 *
 * So the three are what the **filter** offers, because `?status=` is the route's
 * own argument and the panel must only send values it has seen work. Everything
 * that *reads* a status goes through the two functions below and degrades: an
 * unknown value keeps its own name and takes the neutral tone. `z.enum` on the
 * schema would instead have thrown inside the list parse and blanked the table.
 */
export const RECIPIENT_STATUSES = ["pending", "sent", "failed"] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export function isRecipientStatus(value: string): value is RecipientStatus {
  return (RECIPIENT_STATUSES as readonly string[]).includes(value);
}

const RECIPIENT_TONE: Record<RecipientStatus, "neutral" | "success" | "danger"> = {
  pending: "neutral",
  sent: "success",
  failed: "danger",
};

/** Neutral for a status this build has no opinion about — never a missing badge. */
export function recipientTone(status: string): "neutral" | "success" | "danger" {
  return isRecipientStatus(status) ? RECIPIENT_TONE[status] : "neutral";
}

/**
 * The word beside the colour. A status with no message key renders **as itself**
 * rather than as the key path next-intl would otherwise print, which is what
 * `consentRecord`'s source line does one collection over.
 *
 * `has` is passed rather than imported so this module keeps its no-dependency
 * property — a client component imports values from here without pulling in
 * next-intl's server half.
 */
export function recipientLabel(
  status: string,
  t: { (key: string): string; has: (key: string) => boolean },
): string {
  return t.has(`recipient.${status}`) ? t(`recipient.${status}`) : status;
}

/**
 * **`last_error` and `sent_at` are empty strings here, not null.**
 *
 * The notification queue nulls both; this route stringifies them —
 * `(string) ($row['last_error'] ?? '')` in `CampaignService::recipientList()`. So
 * a check for `!== null` passes on every row and a check for truthiness is the
 * only one that works. Two routes in one API, two conventions, and the schema
 * pins both.
 */
export function recipientError(row: { last_error: string }): string | null {
  return row.last_error === "" ? null : row.last_error;
}

/**
 * **And a recipient's `sent_at` has no offset**, where a campaign's `created_at`
 * does. Measured, on the same response:
 *
 *   campaign.created_at   "2026-08-21T17:24:53+00:00"   ISO, offset-qualified
 *   recipient.sent_at     "2026-08-21 17:31:12"         no `T`, no offset
 *
 * The second is the `notes[].created_at` trap from the orders branch, one table
 * over: `new Date("2026-08-21 17:31:12")` is parsed as **local** time and is
 * silently wrong by the host's offset. `parseApiDate()` already reads an
 * offsetless stamp as UTC, which is what the API means by it — so every date on
 * these screens goes through `formatDate`, never through `new Date()`.
 */
export function recipientSentAt(row: { sent_at: string }): string | null {
  return row.sent_at === "" ? null : row.sent_at;
}

/**
 * The counts on the campaign are **stored columns**, not a live query.
 *
 * §85 keeps them as columns precisely so they survive the purge, when the rows
 * they describe are gone. That is why the recipient list and the campaign can
 * legitimately show different things after a purge — and why a seed that writes
 * rows without going through the drain puts them out of step, which
 * `seed-campaigns.mjs` records having done once.
 */
export function isPurged(campaign: { recipients: { purged: boolean } }): boolean {
  return campaign.recipients.purged;
}

/* --------------------------------------------------------------- segments --- */

/**
 * The eleven criteria, read out of a **400** rather than from documentation:
 * `POST /segments` with empty criteria answers `details.supported` with the whole
 * list. So this is a copy of a server-side constant that the server itself
 * publishes on refusal — better than the homepage's section types, which have no
 * such door.
 */
export const SEGMENT_CRITERIA = [
  "min_spent",
  "max_spent",
  "min_orders",
  "max_orders",
  "ordered_after",
  "ordered_before",
  "registered_after",
  "registered_before",
  "wilaya_id",
  "bought_product_id",
  "not_bought_product_id",
] as const;
export type SegmentCriterion = (typeof SEGMENT_CRITERIA)[number];

/** Money is a decimal string, dates are `Y-m-d`, the rest are ids or counts. */
export const CRITERION_KIND: Record<SegmentCriterion, "money" | "date" | "count" | "id"> = {
  min_spent: "money",
  max_spent: "money",
  min_orders: "count",
  max_orders: "count",
  ordered_after: "date",
  ordered_before: "date",
  registered_after: "date",
  registered_before: "date",
  wilaya_id: "id",
  bought_product_id: "id",
  not_bought_product_id: "id",
};

export function isSegmentCriterion(value: string): value is SegmentCriterion {
  return (SEGMENT_CRITERIA as readonly string[]).includes(value);
}

/**
 * Which **control** draws each criterion — and this map is the whole of what
 * makes the refused names structurally unreachable rather than merely unoffered.
 *
 * `CRITERION_KIND` above says what the *wire* wants and is unchanged: it is what
 * decides whether a value is sent as a number or as a string, and three
 * criteria share the kind `id` because the wire cannot tell them apart. A screen
 * keyed on it can only ever draw one id field three times, which is the state
 * this item was opened to fix, so the rendering question gets its own map rather
 * than a widened version of that one. Two maps, two questions, neither guessing
 * at the other's answer.
 *
 * **`Record<SegmentCriterion, …>` is load-bearing and not a type annotation for
 * its own sake.** TypeScript requires this object to have *exactly* the eleven
 * keys: a twelfth is an excess-property error and a missing one is a
 * missing-property error. `SegmentModal` reaches its control through this map
 * and through nothing else, so `consent`, `marketing_consent`, `email_contains`
 * and the five beside them have no control to be drawn with — not "no option is
 * offered for them today", which is a property a later edit can quietly remove,
 * but *no code path exists that could draw one*. Adding one would not compile.
 * `tests/campaign-schema.test.ts` asserts the runtime half of the same claim.
 *
 *   money     a decimal field. `NumberField`.
 *   count     a whole number with a ceiling. `NumberField` under a different rule
 *             — see `criterionProblem`, the two are genuinely different grammars.
 *   date      `DateField`, item 5's drawn calendar. `Y-m-d` in, `Y-m-d` out.
 *   wilaya    a `Select` over the 69, showing the name and storing the id.
 *   product   a search that shows a product's name and stores its id.
 */
export const CRITERION_CONTROL: Record<
  SegmentCriterion,
  "money" | "count" | "date" | "wilaya" | "product"
> = {
  min_spent: "money",
  max_spent: "money",
  min_orders: "count",
  max_orders: "count",
  ordered_after: "date",
  ordered_before: "date",
  registered_after: "date",
  registered_before: "date",
  wilaya_id: "wilaya",
  bought_product_id: "product",
  not_bought_product_id: "product",
};

/**
 * Which criteria may still be added, given the ones a draft already holds.
 *
 * **A criterion can appear at most once, and that is the wire's shape rather
 * than a rule this panel invented.** `criteria` is a JSON *object keyed by
 * criterion name* — `SegmentCriteria::fromPayload()` iterates
 * `foreach ($payload as $field => $value)` and writes `$fields[$field]`, and
 * `Segment::toRow()` persists the result with `json_encode`. Two `min_spent`
 * entries are therefore not something the API refuses; they are something JSON
 * cannot express, and a body carrying both is collapsed to the last by the
 * decoder before any of the plugin's code runs. Read from source rather than
 * measured, because the measurement cannot be constructed.
 *
 * So the UI does not need a duplicate rule — it needs to not *offer* a second
 * copy of a criterion whose value would silently replace the first, which is
 * what this does. The draft is a `Record` for the same reason: the state and the
 * wire have the same shape, so a duplicate is unrepresentable in both.
 */
export function availableCriteria(used: readonly string[]): SegmentCriterion[] {
  return SEGMENT_CRITERIA.filter((key) => !used.includes(key));
}

/* ------------------------------------------------- what a value has to be --- */

/**
 * The two ceilings, read from `Campaigns/SegmentCriteria.php:93-96`.
 *
 * They are the plugin's own constants — `MAX_ORDERS = 100_000` under the comment
 * *"A segment asking for a million orders is a typo, not a query"*, and
 * `MAX_SPENT = '99999999.99'`. Neither was reachable from this screen before,
 * because nothing here validated anything.
 *
 * **The order ceiling applies to `min_orders`/`max_orders` and to nothing
 * else.** `parse()`'s range clause names those two fields explicitly, so
 * `wilaya_id`, `bought_product_id` and `not_bought_product_id` are unbounded
 * above — which is correct, since a product id is not a quantity.
 */
export const MAX_ORDERS = 100_000;
export const MAX_SPENT = "99999999.99";

/**
 * **Money and counts are not one rule wearing two labels**, and this function is
 * where that stops being true of the panel.
 *
 * Both were a `TextField` with `inputMode="decimal"` and no validation at all,
 * so the screen offered the same grammar for an amount and for a quantity and
 * refused neither. The API has never agreed — `SegmentCriteria::parse()`:
 *
 *   money   `preg_match('/^\d+(\.\d{1,2})?$/', $raw)`, then `> MAX_SPENT`.
 *           **At most two decimal places**, which is the part no message in this
 *           panel said: `10.999` is a 400 reading "Must be a decimal amount".
 *           Returned as the **string** it arrived as, never a float.
 *   count   `ctype_digit($raw)`, then `> MAX_ORDERS`. No decimal point at all,
 *           and **no sign** — `-1` fails at `ctype_digit`, which is why the
 *           `$number < 0` line beneath it is unreachable. Cast to `int`.
 *   id      `ctype_digit` and nothing more. Existence is **not** checked: the
 *           class is documented "Pure — no WordPress, no database", so
 *           `wilaya_id: 999` and a product id naming nothing are both stored.
 *
 * The panel's own controls now produce well-formed values for all three, so this
 * exists for what a person can still type into them — and for the ceiling, which
 * a picker cannot enforce because there is nothing to pick.
 *
 * Returns a key rather than a sentence: the words are the message files' and the
 * hint under the field has to say the same thing before the refusal as after it.
 */
export function criterionProblem(
  key: SegmentCriterion,
  raw: string,
): "money" | "count" | "id" | "date" | "range" | null {
  const value = raw.trim();
  if (value === "") return null;

  const kind = CRITERION_KIND[key];

  if (kind === "date") {
    /*
     * `parse()`'s date arm is two gates and this is only the first of them —
     * `^\d{4}-\d{2}-\d{2}$`, then `checkdate($m, $d, $y)` so that `2026-02-31`
     * is *"Not a real date."* rather than a pattern that MySQL would quietly
     * read as March.
     *
     * The second gate lives one layer up rather than here, and deliberately:
     * `DateField` reports `parseEntry(text) ?? ""` and `parseEntry` goes through
     * `makeYmd`, whose whole method is a `Date.UTC` round trip compared back
     * against what was asked — which is `checkdate` in JavaScript. So a caller
     * of this function cannot be holding 31 February, because the control that
     * produced the value already refused it in the reader's own words. Repeating
     * the calendar arithmetic here would make `lib/campaigns.ts` import
     * `lib/calendar.ts` for a case that cannot arrive, and this module's first
     * line is that it has no dependencies.
     */
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "date";
  }

  if (kind === "money") {
    if (!/^\d+(\.\d{1,2})?$/.test(value)) return "money";
    /* `(float) $raw > (float) self::MAX_SPENT` — a float comparison on the
       plugin's side too, so this mirrors it rather than comparing strings. */
    return Number(value) > Number(MAX_SPENT) ? "range" : null;
  }

  /* `ctype_digit`, for a count and for an id alike. The two differ below it. */
  if (!/^\d+$/.test(value)) return kind === "count" ? "count" : "id";

  return kind === "count" && Number(value) > MAX_ORDERS ? "range" : null;
}

/**
 * The four cross-field rules, mirrored from `SegmentCriteria::checkRanges()`.
 *
 * **These are refusals the panel had no idea existed**, and every one of them is
 * reachable from a form whose fields are individually perfect:
 *
 *   max_spent              `Must be at least min_spent.`
 *   max_orders             `Must be at least min_orders.`
 *   ordered_before         `Must not be earlier than ordered_after.`
 *   registered_before      the same, for the registration pair
 *   not_bought_product_id  `Cannot be the same product as bought_product_id.`
 *
 * The plugin refuses an inverted range rather than resolving it to an empty
 * audience, and says why in its own docblock: *"an audience of nobody looks
 * exactly like a segment whose customers have not shopped yet"*. That is the
 * same argument this screen already makes about `wilaya_id`, so the panel says
 * it in its own words **before** the request rather than surfacing the API's
 * English after it.
 *
 * The date comparison is lexical and that is safe rather than lucky: the format
 * is a fixed-width `Y-m-d` the API validates with `^\d{4}-\d{2}-\d{2}$`, so
 * lexical order *is* chronological order — the same property `sendProgress`
 * relies on for an offsetless stamp, one collection over.
 *
 * Keyed by the field the API blames, so the message lands on the control the
 * API would have named. A pair with a hole in it is not a conflict: one endpoint
 * of a range is a perfectly good segment.
 */
export const CRITERION_PAIRS = [
  ["min_spent", "max_spent"],
  ["min_orders", "max_orders"],
  ["ordered_after", "ordered_before"],
  ["registered_after", "registered_before"],
] as const;

/** The verdict, and **the other field it is about** — the message names it. */
export type PairProblem = { rule: "order" | "same"; other: SegmentCriterion };

export function pairProblems(
  criteria: Readonly<Record<string, string>>,
): Partial<Record<SegmentCriterion, PairProblem>> {
  const problems: Partial<Record<SegmentCriterion, PairProblem>> = {};

  const read = (key: SegmentCriterion) => {
    const value = criteria[key]?.trim() ?? "";
    return value === "" || criterionProblem(key, value) !== null ? null : value;
  };

  for (const [lower, upper] of CRITERION_PAIRS) {
    const low = read(lower);
    const high = read(upper);
    if (low === null || high === null) continue;

    /* Numbers compare as numbers and dates as text, which is the same split
       `checkRanges()` makes — `(float)`/`(int)` for the first two pairs and a
       bare `>` on two fixed-width strings for the other two. */
    const inverted =
      CRITERION_KIND[lower] === "date" ? low > high : Number(low) > Number(high);
    if (inverted) problems[upper] = { rule: "order", other: lower };
  }

  const bought = read("bought_product_id");
  if (bought !== null && bought === read("not_bought_product_id")) {
    problems.not_bought_product_id = { rule: "same", other: "bought_product_id" };
  }

  return problems;
}

/**
 * The bounds one half of a date pair puts on the other, for `DateField`'s grid.
 *
 * `DatePicker` refuses an out-of-range day to a **pointer** and never to the
 * keyboard, and its own docblock says why: a typed value has to reach the
 * field's rule and the API's message, and a control that silently clamped what
 * was typed would hide both. So this makes the calendar stop drawing days the
 * pair above has already ruled out, while `pairProblems` stays the thing that
 * actually speaks. `RangeControl` and the filter rows pass bounds on exactly
 * that understanding.
 */
export function criterionBounds(
  key: SegmentCriterion,
  criteria: Readonly<Record<string, string>>,
): { min?: string; max?: string } {
  for (const [after, before] of CRITERION_PAIRS) {
    if (CRITERION_KIND[after] !== "date") continue;
    if (key === after) {
      const upper = criteria[before]?.trim();
      return upper ? { max: upper } : {};
    }
    if (key === before) {
      const lower = criteria[after]?.trim();
      return lower ? { min: lower } : {};
    }
  }
  return {};
}

/**
 * The **eight** refused by name, with a reason, and the reasons are worth
 * reading rather than paraphrasing:
 *
 *   consent  "Consent is applied to every audience by the resolver and is never
 *             a criterion — a criterion that could set it…"
 *   sql      "No."
 *   limit    "A segment is a definition, not a page of results."
 *
 * The panel offers none of them, so none of these 400s should ever be provoked
 * from the UI. They are listed because a person reading this file will wonder why
 * `email_contains` is not a criterion, and because the criteria form's help text
 * says so.
 *
 * **`marketing_consent` was the eighth and this list did not have it**, found on
 * the segment-pickers branch by reading `SegmentCriteria::REFUSED` rather than by
 * trusting the count. It is `consent`'s twin — the same refusal under the name a
 * client is more likely to reach for, since `consent` is what the *resolver*
 * calls the flag and `marketing_consent` is what the customer record calls it —
 * and the plugin refuses both with near-identical sentences. Nothing on screen
 * changed: the panel offered neither before and offers neither now. What changed
 * is that this list is a **complete** copy of a server-side constant again, which
 * is the only thing that makes the test beneath it worth running. `scripts/
 * mock-api.mjs` carried the same gap and is corrected with it.
 *
 * These are refused **explicitly and by name**, not merely by being absent from
 * `FIELDS`: `fromPayload()` walks `REFUSED` first and answers each one with its
 * own bespoke reason, where an unrecognised name gets the generic "Unknown
 * criterion. Supported: …". Two different 400 bodies for two different mistakes.
 */
export const REFUSED_CRITERIA = [
  "consent",
  "marketing_consent",
  "email",
  "email_contains",
  "role",
  "commune_id",
  "limit",
  "sql",
] as const;

/**
 * **Empty criteria are refused**, and that is not an oversight to work around:
 * they would match every customer, and "everyone eligible" already has its own
 * `audience_type`. So the segment form cannot save an empty definition and says
 * why, pointing at the audience choice.
 */
export function hasCriteria(criteria: Record<string, unknown>): boolean {
  return Object.keys(criteria).length > 0;
}

/**
 * **`wilaya_id` comes off the shipment, never the address.**
 *
 * So an order nobody has shipped has no wilaya and cannot match — measured on
 * this shop, a `wilaya_id: 16` segment matches **0** while an order-count segment
 * matches 8. That is correct behaviour and looks exactly like a broken filter, so
 * the criteria form says it beside the field rather than leaving somebody to
 * discover it.
 */
export const SHIPMENT_DERIVED_CRITERIA = ["wilaya_id"] as const;

/* ----------------------------------------------------------- the composer --- */

/**
 * The sequence: audience → content → test → send.
 *
 * Built as a **stepped wizard**, one step at a time, which is a control grammar
 * this panel has nowhere else. The argument for it here and not on the coupon or
 * page forms: those edit a thing that already exists and whose fields are
 * independent, while this one *ends in an irreversible action* whose correctness
 * depends on every step before it. The send freezes the audience.
 *
 * `test` is a read of the campaign and a write of exactly one message to an
 * address the operator typed, so it is safe to revisit; `send` is the only step
 * that changes anything about the shop.
 *
 * ## Four, and `preview` is the one that left
 *
 * §85 writes five — *audience → content → preview → test → send* — and the third
 * was a page of its own for the whole of this run. It is folded into `content` at
 * item 8, and the fold is a **deletion of the page and not of the check**:
 * `GET /campaigns/{id}/preview` is still fetched (from the first step, for
 * `audience_count`), still renders subject, HTML and text for a sample recipient,
 * and still reports `unknown_tokens` — which is the one fact the step existed for,
 * because an unknown token renders *empty* and nothing else on any screen would
 * say so. All of it now sits on the compose step, beside the bodies it is about;
 * `MailPreview.tsx` argues the move and keeps the retired step's own reasoning
 * where the render replaced it.
 *
 * The wizard is shorter by a page and no shorter by a guarantee. What it costs is
 * that a person can no longer be *made* to walk past the token warning on their
 * way to the send — and that was always the weaker half of the guard, since a step
 * can be walked past with two presses and a warning next to the field cannot be
 * scrolled past without seeing the field.
 */
export const COMPOSER_STEPS = ["audience", "content", "test", "send"] as const;
export type ComposerStep = (typeof COMPOSER_STEPS)[number];

export function stepIndex(step: ComposerStep): number {
  return COMPOSER_STEPS.indexOf(step);
}

export function nextStep(step: ComposerStep): ComposerStep | null {
  return COMPOSER_STEPS[stepIndex(step) + 1] ?? null;
}

export function previousStep(step: ComposerStep): ComposerStep | null {
  return stepIndex(step) === 0 ? null : COMPOSER_STEPS[stepIndex(step) - 1];
}

/**
 * How far a draft may be taken, given what it currently holds.
 *
 * The wizard gates forward movement rather than disabling the step buttons: a
 * step you cannot yet reach is reachable *backwards*, always, because a person
 * who got to the send and wants to fix the subject must not be trapped.
 *
 * **This is the guard, and it is not `campaignBlocker()`.** `email-body.ts` cites
 * a function by that name and no such function has ever existed; the behaviour it
 * describes is this one's `content` branch. Named here because item 8 is the third
 * branch in a row to check the name before trusting it.
 *
 * `content` needs a subject and both bodies, and **that is this wizard's rule
 * rather than the API's.** Corrected 2026-08-28: this said "an empty `body_text`
 * is a refusal", and it is not — `POST /campaigns` with `body_html: ""` and
 * `body_text: ""` is a **201**, measured. What is true is §85's editorial rule,
 * that the text part is *authored* rather than stripped from the HTML, and the
 * consequence the panel actually cares about: a campaign advanced past this step
 * with an empty part would preview as an empty mail and send as one.
 *
 * The subject half **is** the API's: `subject` is `Required` on create and
 * `Cannot be blank.` on edit, two sentences for one field chosen by the verb.
 */
export function furthestStep(draft: {
  audience: { type: string; segment_id: number; customer_ids: readonly number[] };
  subject: string;
  body_html: string;
  body_text: string;
}): ComposerStep {
  if (audienceProblem(draft.audience) !== null) return "audience";
  if (draft.subject.trim() === "") return "content";
  if (draft.body_html.trim() === "" || draft.body_text.trim() === "") return "content";
  return "send";
}

/** Whether the wizard may move from `step` to the one after it. */
export function canAdvance(
  step: ComposerStep,
  draft: Parameters<typeof furthestStep>[0],
): boolean {
  return stepIndex(step) < stepIndex(furthestStep(draft));
}

/* -------------------------------------------------------------- the send --- */

/**
 * **`send` sends nothing**, and the confirmation has to lead with that.
 *
 *   POST /campaigns/{id}/send
 *   → 202 { campaign_id, status: "sending", recipients: 9,
 *           next: { action: "drain", command: "wp algerian-commerce send-campaigns" } }
 *
 * It resolves the audience, writes one row per recipient, marks the campaign
 * `sending` and returns. The mail leaves when a deployment runs the command in
 * `next`. A progress bar implying live delivery is a lie the operator will act
 * on — the same rule the notification queue's retry follows.
 */
export type SendOutcome = { recipients: number; command: string };

export function sendOutcome(data: {
  recipients: number;
  next?: { command?: string };
}): SendOutcome {
  return {
    recipients: data.recipients,
    command: typeof data.next?.command === "string" ? data.next.command : "",
  };
}

/* ------------------------------------------------------- watching a drain --- */

/**
 * Whether the campaign is mid-flight, which is the only state worth polling.
 *
 * `sent` and `cancelled` are records: their counts cannot move again, so a panel
 * still asking every thirty seconds is spending a read budget on a row it already
 * holds. `draft` has no recipients at all.
 */
export function isDraining(campaign: { status: string }): boolean {
  return campaign.status === "sending";
}

/**
 * **What the API publishes about a send in flight, and nothing more.**
 *
 * §15 shipped the sent campaign readable and not live, and the gap that left is
 * not "there is no progress bar" — it is that a campaign stuck at *2 sent, 4
 * pending* looks exactly like one mid-flight. The temptation is a threshold
 * ("stalled after 10 minutes"), and that would be the panel inventing a fact,
 * which is this run's oldest rule. There is no such number anywhere in the API and
 * no way to derive one: a shop whose drain is a five-minute cron and one whose
 * drain is hand-run have nothing in common.
 *
 * So this returns **published facts** and the reader draws the conclusion:
 *
 *   `remaining`  `total − sent − failed`, off the campaign's own stored counts.
 *                Named *remaining* rather than *pending* deliberately — `pending`
 *                is one recipient status among an open set (see
 *                `RECIPIENT_STATUSES`), and this arithmetic stays true whatever
 *                else the drain learns to write.
 *   `claimedAt`  when `send` handed the campaign to the drain. Measured: null on a
 *                draft, set on `sending` and on `sent`.
 *   `movedAt`    the most recent `sent_at` across the recipients — the last time
 *                anything actually happened.
 *
 * **`movedAt` is null unless every recipient is on screen**, and that restraint is
 * the whole honesty of this function. `GET /campaigns/{id}/recipients` publishes no
 * `orderby` at all, so "the most recently sent" is not a question this API can be
 * asked; a maximum taken over page one of a filtered list is not the campaign's
 * last movement and must not be labelled as one. When the list is complete and
 * unfiltered the maximum is exact, and when it is not the screen shows the two
 * facts it does have rather than a third it would be guessing at.
 */
export type SendProgress = {
  remaining: number;
  claimedAt: string | null;
  movedAt: string | null;
};

export function sendProgress(
  campaign: { recipients: { total: number; sent: number; failed: number }; claimed_at: string | null },
  /** Every recipient of this campaign, or null when the screen holds only some. */
  everyRecipient: readonly { sent_at: string }[] | null,
): SendProgress {
  const { total, sent, failed } = campaign.recipients;

  return {
    remaining: Math.max(0, total - sent - failed),
    claimedAt: campaign.claimed_at,
    movedAt:
      everyRecipient === null
        ? null
        : (everyRecipient
            .map((row) => recipientSentAt(row))
            .filter((at): at is string => at !== null)
            /* String comparison, and it is safe **because these stamps have no
               offset**: `"2026-08-21 17:31:12"` is fixed-width UTC, so lexical
               order is chronological order. A campaign's own `created_at` carries
               `+00:00` and would not have this property. */
            .sort()
            .at(-1) ?? null),
  };
}

/**
 * The three refusals `send` has, each of which needs its own sentence.
 *
 *   503 mail_not_configured  the shop cannot send at all. `details.fix` names
 *                            `wp algerian-commerce mail-check`. Points at the
 *                            deployment, not at the campaign.
 *   409 conflict             already sent or cancelled. `details.status` says
 *                            which. A second send changes nothing — do not retry.
 *   409 conflict             the audience matches nobody. `details.hint` names
 *                            consent. Points at the segment, not at the mail.
 *
 * Both 409s share a code, so the panel distinguishes them by which keys the
 * details carry. Measured: the nobody-matches case carries `audience_type` and
 * `hint`; the already-sent case carries `status`.
 */
export type SendRefusal = "mail" | "already" | "nobody" | "forbidden" | "other";

export function classifySendRefusal(
  status: number,
  code: string | undefined,
  details: Record<string, unknown>,
): SendRefusal {
  if (status === 503 || code === "mail_not_configured") return "mail";
  if (status === 403) return "forbidden";
  if (status === 409) {
    // `audience_type` is present only on the nobody-matches refusal; the
    // already-sent one carries `status`. Keyed on presence rather than on the
    // message, which is prose and is not a contract.
    return "audience_type" in details ? "nobody" : "already";
  }
  return "other";
}

/**
 * **A test send is a 200 that may report failure.**
 *
 * Measured: `{sent: false, to, subject, unknown_tokens}` on a stack whose
 * transport refuses. It is not a 503 and not a 500 — the request succeeded and
 * the send did not, which are different facts and the screen shows both. `sent:
 * true` here means the transport accepted it, not that it arrived; the same
 * claim `wp_mail()` returning true makes anywhere else in this API.
 *
 * It writes **no recipient row**, so a test does not appear in the recipient
 * list and cannot be confused for one.
 */
export function testDelivered(result: { sent: boolean }): boolean {
  return result.sent;
}
