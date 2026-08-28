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

/** The same three the notification queue has, and the same meaning. */
export const RECIPIENT_STATUSES = ["pending", "sent", "failed"] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export function isRecipientStatus(value: string): value is RecipientStatus {
  return (RECIPIENT_STATUSES as readonly string[]).includes(value);
}

export const RECIPIENT_TONE: Record<RecipientStatus, "neutral" | "success" | "danger"> = {
  pending: "neutral",
  sent: "success",
  failed: "danger",
};

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
 * The seven refused **by name, with a reason**, and the reasons are worth
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
 */
export const REFUSED_CRITERIA = [
  "consent",
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
 * The sequence, as §85 writes it: audience → content → preview → test → send.
 *
 * Built as a **stepped wizard**, one step at a time, which is a control grammar
 * this panel has nowhere else. The argument for it here and not on the coupon or
 * page forms: those edit a thing that already exists and whose fields are
 * independent, while this one *ends in an irreversible action* whose correctness
 * depends on every step before it. A person who skips the preview cannot see that
 * `{{firstname}}` renders empty, and the send freezes the audience.
 *
 * `preview` and `test` are reads, so they are safe to revisit; `send` is the only
 * step that changes anything outside the draft.
 */
export const COMPOSER_STEPS = ["audience", "content", "preview", "test", "send"] as const;
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
 * who got to `preview` and wants to fix the subject must not be trapped.
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
