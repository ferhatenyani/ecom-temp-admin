import { z } from "zod";
import { CAMPAIGN_STATUSES } from "@/lib/campaigns";

/**
 * Shapes measured against the live API on 2026-08-21.
 *
 * The vocabulary lives in `lib/campaigns.ts`, which has no dependencies, and this
 * module imports it — the split every other resource in this panel makes.
 *
 * `looseObject` throughout: the API adds keys to `meta` and to resources between
 * branches, and a strict object turns an additive server change into a parse
 * failure on a screen that did not need the new field.
 */

/* ------------------------------------------------------------- campaigns --- */

/**
 * A campaign's audience — a **definition**, never a list of addresses.
 *
 * `emails`, `to`, `bcc` and `recipients` are all refused by name on write, each
 * with its own reason, because a caller-supplied address list would bypass the
 * consent filter that lives in the resolver. `segment_id` is `0` rather than
 * null when unused, and `customer_ids` is `[]`.
 */
export const audience = z.looseObject({
  type: z.string(),
  segment_id: z.number(),
  customer_ids: z.array(z.number()),
});

/**
 * The recipient counts, which are **stored columns and not a live query**.
 *
 * §85 keeps them as columns so they survive the purge — after it the addresses
 * are gone and these are what remains. So they can legitimately disagree with
 * `GET /campaigns/{id}/recipients`, and only in that direction.
 */
export const recipientCounts = z.looseObject({
  total: z.number(),
  sent: z.number(),
  failed: z.number(),
  purged: z.boolean(),
});

export const campaign = z.looseObject({
  id: z.number(),
  name: z.string(),
  /** Carries `{{tokens}}` verbatim as authored. Rendered only by the preview. */
  subject: z.string(),
  /** `0` when the campaign has its own body. A campaign's body wins where both exist. */
  template_id: z.number(),
  /**
   * Sanitised **on save** with an email-safe `wp_kses` allowlist — no `<script>`,
   * no `on*`, no `javascript:`. Measured: `<script>alert(1)</script>` comes back
   * as `alert(1)`, the tag stripped and the text kept. The panel renders it into
   * a preview, so this is the property that makes that safe.
   */
  body_html: z.string(),
  /** Authored, never stripped from the HTML. Both parts are required on write. */
  body_text: z.string(),
  /**
   * **The composer form's own answers, and `null` is a claim rather than a gap.**
   *
   * A nullable `mediumtext` column added on this branch —
   * `migrations/014_add_campaign_body_fields.php:109` — emitted on every campaign
   * read, present-and-`null` rather than absent (`Campaigns/Campaign.php:355`). The
   * two states mean different things and the panel branches on both:
   *
   *   `null` — no answers were ever recorded. Hand-written HTML, a template, a
   *   campaign that predates the column, or a column that would not parse. The
   *   composer opens the **HTML editor**, so it can never regenerate an empty
   *   message over a body somebody wrote by hand.
   *
   *   `{}` — the form was used and every answer is blank. The composer opens the
   *   **form**. `CampaignsList.tsx` sends `body_fields: {}` on create so a campaign
   *   the panel makes lands on this side.
   *
   * `z.unknown()` and not a modelled object, deliberately. The shape is
   * `body-fields.ts`'s to know and `readValues()` there degrades field by field
   * rather than throwing — a document written by an older shape of that file, or one
   * whose value the backend's sanitiser rewrote, must open the campaign rather than
   * blank the screen. Typing it here would move that decision to the boundary, where
   * the only outcome available is a thrown parse.
   *
   * **`.optional()`, even though the branch's backend emits it on every read.**
   * `Campaign::toArray()` always includes the key — so against a shop running this
   * branch it is never absent — but the column arrives with a migration, and a shop
   * that has not run it answers without the key at all. Requiring it here would turn
   * a deployment ordering into a thrown parse on every campaign screen, which is the
   * failure this file's header opens by refusing. The captured fixtures in
   * `tests/campaign-schema.test.ts` are exactly that shop, and they still parse.
   *
   * Absent and `null` are the same claim to the panel — *no answers were ever
   * recorded* — and `readValues()` answers `null` for both, so the degradation needs
   * no second branch anywhere.
   */
  body_fields: z.unknown().optional(),
  audience: audience,
  status: z.enum(CAMPAIGN_STATUSES),
  /** Published, so the panel never carries its own transition table. */
  is_editable: z.boolean(),
  allowed_transitions: z.array(z.string()),
  recipients: recipientCounts,
  created_by: z.number(),
  /** ISO with an offset — unlike a recipient's `sent_at`. See `recipientSentAt()`. */
  created_at: z.string(),
  updated_at: z.string(),
  /** Set when `send` claimed the campaign. Null on a draft. */
  claimed_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});
export type Campaign = z.infer<typeof campaign>;

export const campaignList = z.array(campaign);

/**
 * `GET /campaigns/{id}/preview` — rendered for a sample recipient.
 *
 * **`audience_count` is `null` for a caller who cannot read customers**, not
 * absent and not zero. Measured: a Marketing Manager gets the HTML, the text and
 * `audience_count: null`, because counting an audience means counting customers
 * and that is the second capability. `.nullable()` and not `.optional()` — the
 * key is always present, and the backend's own suite asserts that distinction
 * with `array_key_exists`.
 */
export const campaignPreview = z.looseObject({
  campaign_id: z.number(),
  /** Tokens resolved. `{{shop_name}}` becomes the shop's name. */
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  /**
   * Tokens the renderer did not recognise, which render **empty**. The whole
   * reason the preview is a step of its own: `<p>Bonjour ,</p>` is easy to skim
   * past, and this names what caused it.
   */
  unknown_tokens: z.array(z.string()),
  /** True when the API added the unsubscribe link because the body had none. */
  unsubscribe_appended: z.boolean(),
  sample_recipient: z.looseObject({}),
  audience_count: z.number().nullable(),
});
export type CampaignPreview = z.infer<typeof campaignPreview>;

/**
 * `POST /campaigns/{id}/test` — **a 200 that may report a failed send.**
 *
 * `sent: false` is not an error: the request succeeded and the transport did
 * not. It writes no recipient row, so a test never appears in the recipient list.
 */
export const testResult = z.looseObject({
  sent: z.boolean(),
  to: z.string(),
  subject: z.string(),
  unknown_tokens: z.array(z.string()),
});
export type TestResult = z.infer<typeof testResult>;

/**
 * `POST /campaigns/{id}/send` — **202, and nothing has been sent.**
 *
 * It resolves the audience, freezes it as one row per recipient, and names the
 * command that will do the sending.
 */
export const sendResult = z.looseObject({
  campaign_id: z.number(),
  status: z.string(),
  recipients: z.number(),
  next: z.looseObject({ action: z.string(), command: z.string() }),
});
export type SendResult = z.infer<typeof sendResult>;

/**
 * One frozen recipient.
 *
 * **`last_error` and `sent_at` are empty strings, never null** — this route
 * stringifies where the notification queue nulls, so `!== null` is true on every
 * row and only emptiness tells them apart. And **`sent_at` has no offset**
 * (`"2026-08-21 17:31:12"`), unlike every timestamp on the campaign itself, which
 * is the `notes[].created_at` trap one table over.
 *
 * ## `status` is a **string**, and that is a deliberate loosening
 *
 * It was `z.enum(RECIPIENT_STATUSES)` — the panel's own three — which made this
 * schema assert a claim nobody measured: that the drain will never write a fourth.
 * The mail path is the part of this shop most likely to move, and a `delivered` or
 * a `bounced` arriving one day would not degrade a cell, it would throw inside
 * `recipientList.parse()` and blank the **whole recipient table** on a campaign
 * that had sent perfectly well.
 *
 * That is `consentSource`'s correction one collection over, and the homepage's
 * `unknownSectionTypes()` before it: **a vocabulary copied from the other side of
 * the wire must degrade, not blank the page.** So the three stay as the values the
 * *filter* offers — `?status=` is the route's own enum and the panel only ever
 * sends what it has seen — and a fourth renders as itself, `neutral`, through
 * `recipientTone()` and `recipientLabel()`.
 */
export const recipient = z.looseObject({
  id: z.number(),
  customer_id: z.number(),
  email: z.string(),
  status: z.string(),
  attempts: z.number(),
  last_error: z.string(),
  sent_at: z.string(),
});
export type Recipient = z.infer<typeof recipient>;

export const recipientList = z.array(recipient);

/** `meta` on the recipient list. `purged` once the addresses are gone. */
export const recipientMeta = z.looseObject({
  total: z.number(),
  page: z.number(),
  per_page: z.number(),
  total_pages: z.number(),
  purged: z.boolean(),
});

/* -------------------------------------------------------------- segments --- */

/**
 * A stored **query**, not a stored membership list — edit it and every campaign
 * naming it follows.
 *
 * `is_resolvable` is published so a segment whose criteria no longer make sense
 * can be shown as such rather than silently matching nobody.
 */
export const segment = z.looseObject({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  /** Only the eleven supported keys survive a write; the rest are 400s by name. */
  criteria: z.record(z.string(), z.unknown()),
  is_resolvable: z.boolean(),
  created_by: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Segment = z.infer<typeof segment>;

export const segmentList = z.array(segment);

/**
 * `GET /segments/{id}/preview` — a live count, and the note that explains it.
 *
 * `note` is an **English sentence from the API** ("Only customers who have given
 * marketing consent are counted."), so the panel renders its own translated
 * version rather than the string — the analytics branch's rule. `problems` is the
 * same shape as the homepage's drop report and is empty on a healthy segment.
 */
export const segmentPreview = z.looseObject({
  segment_id: z.number(),
  matches: z.number(),
  criteria: z.record(z.string(), z.unknown()),
  problems: z.array(z.string()),
  note: z.string(),
});
export type SegmentPreview = z.infer<typeof segmentPreview>;

/** `details` on the 409 a segment in use answers. Names how many campaigns. */
export const segmentInUseDetails = z.looseObject({
  campaigns: z.number(),
  fix: z.string(),
});

/* ------------------------------------------------------------- templates --- */

/**
 * An `ac_email_template` post, read-only through this API.
 *
 * §85 makes them a post type authored in wp-admin, where revisions and the media
 * library already are, and the API reads them — so the panel has no editor and
 * says where to author one instead of offering a form that cannot save.
 *
 * `unknown_tokens` and `has_unsubscribe_token` are computed on the template
 * itself, not only on a preview, so an author sees a typo before a campaign
 * does.
 */
export const emailTemplate = z.looseObject({
  id: z.number(),
  name: z.string(),
  /** Falls back to the post title when the subject meta is empty. */
  subject: z.string(),
  status: z.string(),
  body_html: z.string(),
  body_text: z.string(),
  unknown_tokens: z.array(z.string()),
  /** False is **correct**: the API appends one. Never render it as "missing". */
  has_unsubscribe_token: z.boolean(),
  modified_at: z.string().nullable(),
});
export type EmailTemplate = z.infer<typeof emailTemplate>;

export const emailTemplateList = z.array(emailTemplate);

/* --------------------------------------------------------------- config --- */

/**
 * `GET /marketing/config` — the **public** pixel configuration.
 *
 * The Conversions API token appears in no response, ever, which is the property
 * this screen exists to state rather than to display. `providers` is `[]` on a
 * shop with no pixel configured, and `enabled` is false — which is this shop.
 */
export const marketingConfig = z.looseObject({
  enabled: z.boolean(),
  providers: z.array(z.unknown()),
  /** The events the storefront reports, which the panel never sends. */
  browser_events: z.array(z.string()),
  /** The events the backend witnesses and sends server-side. */
  server_events: z.array(z.string()),
});
export type MarketingConfig = z.infer<typeof marketingConfig>;
