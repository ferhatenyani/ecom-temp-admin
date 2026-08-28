/**
 * The notification queue's vocabulary, and the six facts about it that decide
 * how the screen is built.
 *
 * No dependencies, so a client component can import a value from here without
 * pulling Zod into the browser — the split `lib/cms.ts` and `lib/coupon-status.ts`
 * already make. `lib/api/schemas/notification.ts` imports this, never the reverse.
 *
 * Measured against the live API on 2026-08-21, and the measurements are in the
 * comments rather than in a changelog because the comment is what somebody reads
 * before changing the value under it.
 */

/* ------------------------------------------------------------- statuses --- */

/**
 * Three, and `?status=` refuses a fourth by name.
 *
 *   ?status=nonsense → 400 invalid_request
 *                      details.params.status: "status is not one of pending,
 *                      sent, and failed."
 *
 * Note **`details.params`, not `details.fields`** — the same one-endpoint-two-
 * shapes trap the analytics branch found. `lib/api/browser.ts` already reads
 * both; nothing here has to.
 */
export const NOTIFICATION_STATUSES = ["pending", "sent", "failed"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export function isNotificationStatus(value: string): value is NotificationStatus {
  return (NOTIFICATION_STATUSES as readonly string[]).includes(value);
}

/**
 * **`status` alone does not say what happened, and this is the screen's central
 * problem.**
 *
 * A retryable failure leaves the row `pending` with the attempt counted and the
 * error recorded — `markFailed()` writes `status = pending` whenever the failure
 * is retryable and `attempts` is still under five. So a queue read as three
 * statuses shows a row that has been tried and failed as though it were a row
 * that has never been touched, which is the one distinction an operator opens
 * this screen to make.
 *
 * Measured: after one real drain, every row read `status: "pending"`,
 * `attempts: 1`, `last_error: "wp_mail() did not accept the message."`.
 *
 * So the panel derives four states from three fields, and `status` is only the
 * first of them:
 *
 *   queued     pending, never attempted — or reset by a retry, which is the
 *              same row: `requeue()` zeroes `attempts` and clears `last_error`.
 *   retrying   pending, but it has been tried and there is an error on it. The
 *              drain will pick it up again.
 *   sent       handed to the transport. Not *delivered* — see `sent_at` below.
 *   failed     parked. Either five attempts, or one permanent refusal.
 */
export const QUEUE_STATES = ["queued", "retrying", "sent", "failed"] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

export function queueState(row: {
  status: string;
  attempts: number;
  last_error: string | null;
}): QueueState {
  if (row.status === "sent") return "sent";
  if (row.status === "failed") return "failed";

  // `attempts` alone is the test, not `last_error`. They move together today —
  // every path that increments one writes the other — but `attempts` is the
  // field that means "tried", and a failure whose error string was empty would
  // otherwise read as untouched.
  return row.attempts > 0 ? "retrying" : "queued";
}

/**
 * The tone each state carries, in the panel's four-tone vocabulary.
 *
 * `retrying` is **warning and not danger**, deliberately: the row is still in
 * the queue and the next drain will try it again. Painting it the same red as a
 * parked row would send an operator to press retry on something that does not
 * need it — and retry on a row that is already pending answers 202
 * `already_pending: true`, so the panel would be teaching a gesture that does
 * nothing.
 */
export const STATE_TONE: Record<QueueState, "neutral" | "success" | "warning" | "danger"> = {
  queued: "neutral",
  retrying: "warning",
  sent: "success",
  failed: "danger",
};

/* -------------------------------------------------------------- channels --- */

/**
 * Not an enum, and this one is a design decision rather than an omission.
 *
 *   ?channel=email     39 rows        honoured
 *   ?channel=sms        0 rows        honoured
 *   ?channel=nonsense   0 rows        **200, not 400**
 *
 * `status` is validated against its three and `channel` is not — the route
 * declares it as a key pattern rather than an enum, because §29's other four
 * channels are one class plus one `add()` away and a filter that had to be
 * edited to see them would be found the hard way.
 *
 * So the panel labels the channels it knows and renders an unknown one as
 * itself, the way `unknownSectionTypes()` does for the homepage. It must never
 * refuse to display a row because it has no label for its channel.
 *
 * **And there is no channel filter, which is this list's own doing.** Added
 * 2026-08-28, because this is the file somebody reads before building one. The
 * parameter works; the standing rule is that a picker over a working filter
 * ships only when the *allowlisted enumeration* is complete, and there is no
 * route anywhere in this API that enumerates channels. What is below is a copy
 * of a server-side constant with nothing keeping the two in step — the sentence
 * above says so — so a picker built from it cannot offer the value that matters
 * the day a fifth channel is registered, and `?channel=nonsense` being a silent
 * 200 means free text cannot keep a typo unreachable either.
 * `app/[locale]/(panel)/notifications/query.ts` carries the argument in full and
 * names the one request that would make the control buildable.
 */
export const KNOWN_CHANNELS = ["email", "sms"] as const;
export type KnownChannel = (typeof KNOWN_CHANNELS)[number];

export function isKnownChannel(value: string): value is KnownChannel {
  return (KNOWN_CHANNELS as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------- events --- */

/**
 * The eight `NotificationEvent` constants, and the two that are not about a
 * customer at all.
 *
 * There is no endpoint publishing this vocabulary — it was read out of
 * `NotificationEvent::ALL` on the backend, so this is a copy of a server-side
 * constant with nothing keeping the two in step. So a caller checks
 * `isNotificationEvent()` first and renders an event this build has no name for
 * as its own key rather than as a blank row.
 */
export const NOTIFICATION_EVENTS = [
  "order.placed",
  "payment.received",
  "shipment.shipped",
  "shipment.delivered",
  "order.cancelled",
  "order.refunded",
  "stock.low",
  "admin.new_order",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export function isNotificationEvent(value: string): value is NotificationEvent {
  return (NOTIFICATION_EVENTS as readonly string[]).includes(value);
}

/**
 * The message key for an event, with the dots removed.
 *
 * **`next-intl` resolves a `.` as a path separator, so an event name cannot be a
 * message key.** Found by running the suite rather than by reading it:
 * `t("event.order.placed")` looks for `notifications` → `event` → `order` →
 * `placed`, and a flat `"order.placed"` key never matches. The dev log carried
 *
 *   MISSING_MESSAGE: Could not resolve `notifications.event.order.placed`
 *
 * for all eight events in both locales, while **seven of eight e2e tests still
 * passed** — the raw key path renders as text, so every row had a plausible
 * amount of writing on it and only the test that matched a label exactly
 * noticed. The log is the authority, not the exit code.
 *
 * Underscored rather than nested (`event: {order: {placed}}`), which would also
 * resolve: nesting makes the message file's shape depend on how event names
 * happen to be punctuated, so `stock.low` and a future `stock` would collide,
 * and the file would stop being greppable for the string the API actually sends.
 */
export function eventMessageKey(event: string): string {
  return event.replace(/\./g, "_");
}

/* -------------------------------------------------------------- audience --- */

/**
 * **Eighteen of the thirty-nine rows measured were addressed to the shop, not to
 * a customer** — `admin@example.test`, event `admin.new_order`. The brief for
 * this screen did not name `audience`, and the column is published on every row.
 *
 * It matters because "did it send?" means two different things on one list. A
 * customer row is *did this person get their confirmation*; an admin row is *did
 * the shop find out it had an order*. The second failing is an operational
 * problem for the shop and not a support problem, and a screen that renders them
 * identically buries that.
 *
 * `?audience=` is **not a filter** — measured, it returns all 39 rows, the same
 * accepted-and-ignored behaviour as `?wilaya=`. So this is a label and a
 * grouping the panel derives, never a query parameter.
 */
export const AUDIENCES = ["customer", "admin"] as const;
export type Audience = (typeof AUDIENCES)[number];

export function isAudience(value: string): value is Audience {
  return (AUDIENCES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------ dedupe_key --- */

/* ----------------------------------------------------------------- dates --- */

/**
 * **Both timestamps carry `+00:00`, and that is not the panel's usual luck.**
 *
 * `NotificationPresenter::time()` runs `gmdate('c')` over both `created_at` and
 * `sent_at`, so both are offset-qualified — unlike `notes[].created_at`
 * elsewhere in this API, which has no offset and which `new Date()` silently
 * reads as local time. Verified on a real sent row rather than assumed from the
 * shared code path: `sent_at: "2026-08-21T14:34:23+00:00"`.
 *
 * So `formatDate()` is safe on both, and this note exists to stop somebody
 * "fixing" it by appending a Z.
 */

/**
 * Whether a `sent` row can say when.
 *
 * `sent_at` is null on every row that has not sent, and the presenter maps
 * `0000-00-00` to null as well, so the null check is the only safe test.
 */
export function sentAt(row: { status: string; sent_at: string | null }): string | null {
  return row.status === "sent" ? row.sent_at : null;
}

/* --------------------------------------------------------- what retry is --- */

/**
 * **A 202 that mails nothing**, and the confirmation has to say so.
 *
 *   POST /notifications/{id}/retry
 *   → 202 meta { queued: true, already_pending: bool,
 *                drain: "wp algerian-commerce send-notifications" }
 *
 * Measured on both branches: a `failed` row answers `already_pending: false` and
 * a `pending` row answers `already_pending: true`. Both are 202 and both are
 * successes — the §90 zero-affected-rows fix is what makes the second one not a
 * 409, and it is worth knowing that this once shipped the other way.
 *
 * The panel distinguishes them because they are different sentences: one put a
 * row back in the queue, the other found it already there. Neither sent anything,
 * and `meta.drain` names the command that will. A progress bar implying live
 * delivery would be a lie an operator acts on.
 */
export type RetryOutcome = { requeued: boolean; drain: string };

export function retryOutcome(meta: Record<string, unknown>): RetryOutcome {
  return {
    // `already_pending: true` means the row was in the queue before the request.
    requeued: meta.already_pending !== true,
    drain: typeof meta.drain === "string" ? meta.drain : "",
  };
}

/**
 * **A `sent` row refuses retry with a 409, and the body names when it sent.**
 *
 *   409 conflict
 *   "That notification has already been sent. Re-sending would deliver a message
 *    frozen when it was queued."
 *   details { status: "sent", sent_at: "2026-08-21T14:34:23+00:00" }
 *
 * Measured. The panel does not offer retry on a sent row at all — but it renders
 * this if it arrives, because a row that sent between the render and the tap is
 * exactly the race the conditional `UPDATE` on the backend exists for, and
 * "read the 409 body" is a house rule.
 */
export function sentConflict(details: Record<string, unknown>): string | null {
  return typeof details.sent_at === "string" ? details.sent_at : null;
}

/* ----------------------------------------------------- the frozen message --- */

/**
 * `message.readable` is a fact about the stored payload, not about the panel.
 *
 * `NotificationPresenter::message()` returns `readable: false` with three empty
 * fields when the payload will not `json_decode`. That is **the row the drain
 * marks permanently failed** — `drain()` calls `markFailed($id, 'The stored
 * payload is not readable.', false)` without ever attempting a send — so an
 * unreadable message and a failed status arrive together, and the screen says
 * what the drain saw rather than showing an empty quote.
 *
 * It cannot be produced through the API: `notify()` writes the payload with
 * `wp_json_encode()` and no route writes a payload at all. `seed-notifications.mjs`
 * writes one underneath, which is the `seed-cms.mjs` drop-report precedent.
 */
export function isReadable(message: { readable: boolean }): boolean {
  return message.readable;
}

/**
 * **The body is a record, not panel copy, and it is bilingual by accident.**
 *
 * Measured verbatim:
 *
 *   subject: "Algerian Commerce — payment received for order 4529"
 *   body:    "Bonjour Yacine,\n\nWe have received your payment of 2000.00 DZD
 *             for order 4529.\n\nAlgerian Commerce"
 *
 * A French salutation over an English sentence, from `NotificationMessages`,
 * which is plain text by design. It renders **verbatim** — it is evidence of what
 * was queued, and a panel that translated it would be showing something the
 * customer never received.
 *
 * That is the analytics branch's hazard arriving from the opposite direction:
 * there, English prose leaked into an Arabic sheet and was a defect; here the
 * English is correct and must stay. The resolution is presentation, not content —
 * it is framed as a quoted record with its own direction, so it never reads as
 * chrome. See `MessageQuote` on the detail screen.
 *
 * Splitting on the blank line is what makes that framing possible without
 * touching a character of it: the paragraphs are rendered as separate blocks so
 * the quote has structure, and `\n` inside a paragraph is preserved.
 */
export function messageParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

/* --------------------------------------------------------------- summary --- */

/**
 * A per-state tally of the rows in hand.
 *
 * Derived from the rows on the page rather than requested: there is no
 * `meta.summary` on `GET /notifications` — the `--summary` counts exist only on
 * the CLI drain — so a total per state would cost one request per state. The
 * count is therefore scoped to the page, and the label has to say so rather than
 * implying it counted the queue.
 *
 * **Corrected 2026-08-28: this used to say "what the list says above itself",
 * and the queue list no longer says it.** The redesign gives the state its own
 * column and its own filter tabs, so a strip of tallies above the table restated
 * what every row already carries — and the header's subtitle is a queue-wide
 * `total`, which a page-scoped breakdown cannot stand beside without inviting the
 * arithmetic §5 and §9 both record as the panel's recurring defect.
 *
 * The one caller left is the customer detail's section, where it still earns its
 * place: that card has no filter, no badge column and at most ten rows, so the
 * tally is the only thing on it that says *how this person's queue is doing*.
 */
export function stateCounts(
  rows: readonly { status: string; attempts: number; last_error: string | null }[],
): Record<QueueState, number> {
  const counts: Record<QueueState, number> = { queued: 0, retrying: 0, sent: 0, failed: 0 };
  for (const row of rows) counts[queueState(row)] += 1;
  return counts;
}
