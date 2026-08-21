import { z } from "zod";
import { NOTIFICATION_STATUSES } from "@/lib/notifications";

/**
 * Shapes measured against the live API on 2026-08-21.
 *
 * The vocabulary lives in `lib/notifications.ts`, which has no dependencies, and
 * this module imports it — the split every other resource in this panel makes,
 * so a client component can hold `QUEUE_STATES` as a value without Zod arriving
 * in the browser with it.
 *
 * `looseObject` throughout, as everywhere else here: the API adds keys to `meta`
 * and to resources between branches, and a strict object turns an additive server
 * change into a parse failure on a screen that did not need the new field.
 */

/**
 * A row from `GET /notifications`.
 *
 * **`message` is absent, and the absence is the contract.** §90 draws the line so
 * a support agent scanning a queue does not pull five hundred customers' order
 * contents into one response, and `NotificationRepository::search()` enforces it
 * a layer down by never selecting `payload` at all — the rows do not exist in
 * that process. Verified here by size as well as by key: a one-row list is 390
 * bytes against 630 for the same row's single read, on a fixture whose body is
 * two short sentences. A real order confirmation is the difference that matters.
 */
export const notification = z.looseObject({
  id: z.number(),
  /**
   * Not an enum. `?channel=nonsense` is a **200 with 0 rows** while
   * `?status=nonsense` is a 400 — the route declares a key pattern here because
   * §29's other four channels are one class away. A row whose channel this build
   * has no label for still renders; see `isKnownChannel()`.
   */
  channel: z.string(),
  /** One of `NotificationEvent::ALL`, but not validated as one — same argument. */
  event: z.string(),
  /** `event:subject_id`. Exact-match as a filter; never a prefix. */
  dedupe_key: z.string(),
  /**
   * `customer` or `admin`, and **18 of the 39 rows measured were `admin`** —
   * the shop being told it had an order, not a customer being confirmed. Left as
   * a string rather than an enum for the reason `channel` is: it is a column with
   * a default, not a validated request parameter, and a third audience would
   * blank the screen rather than appear on it.
   */
  audience: z.string(),
  /**
   * Whatever the channel addresses. An email today; the API deliberately does
   * **not** validate it as one, because §29's other four would put a phone
   * number here — and `seed-notifications.mjs` writes exactly that on its `sms`
   * row, so this is not hypothetical in the fixtures.
   */
  recipient: z.string(),
  subject_type: z.string(),
  /** Nullable: a notification with no subject stores NULL, never 0. */
  subject_id: z.number().nullable(),
  status: z.enum(NOTIFICATION_STATUSES),
  attempts: z.number(),
  /**
   * **A plain string, and it is the panel's own side of the wire that names it.**
   *
   * `NotificationPresenter` calls this "a provider string — whatever the SMTP
   * server said". Measured, it is not: `EmailChannel` only ever sees `wp_mail()`
   * return a boolean, so the column holds one of three sentences this codebase
   * wrote — `"wp_mail() did not accept the message."`, `"Not a deliverable email
   * address."`, `"The stored payload is not readable."`. The transport's own text
   * (`sendmail: can't connect to remote host`) goes to stderr and never arrives.
   *
   * It is still rendered as a quoted diagnostic rather than translated: the set
   * is not closed, a mail plugin that filters `wp_mail` can return anything, and
   * `markFailed()` truncates at 500 bytes on the way in.
   */
  last_error: z.string().nullable(),
  /** `gmdate('c')` — offset-qualified, `+00:00`. Safe for `new Date()`. */
  created_at: z.string(),
  /** Null on everything that has not sent. Same formatting as `created_at`. */
  sent_at: z.string().nullable(),
});
export type Notification = z.infer<typeof notification>;

export const notificationList = z.array(notification);

/**
 * The frozen message, published only by the single read.
 *
 * Read **out of** the payload by allowlist rather than being the payload with
 * keys removed, so a key a future channel adds is not published by accident.
 *
 * `readable: false` comes with three empty fields rather than with nothing —
 * `{readable: false, subject: "", body: "", context: []}` — so the shape is
 * constant and only the flag varies. Note `context` arrives as `[]` and not `{}`
 * in that case, which is PHP's empty array serialising as a JSON array: hence
 * the union below rather than `z.record()`.
 */
export const notificationMessage = z.looseObject({
  readable: z.boolean(),
  subject: z.string(),
  /** Plain text with `\n\n` between paragraphs. Never HTML — `NotificationMessages` is text by design. */
  body: z.string(),
  context: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]),
});
export type NotificationMessage = z.infer<typeof notificationMessage>;

/** `GET /notifications/{id}` — the list row plus the message and nothing else. */
export const notificationDetail = notification.extend({
  message: notificationMessage,
});
export type NotificationDetail = z.infer<typeof notificationDetail>;

/**
 * `POST /notifications/{id}/retry` answers **202 with a list row**, not a detail.
 *
 * Measured: the response body carries no `message` key, so the detail screen
 * cannot rebind itself to it — it re-reads. Worth pinning, because the obvious
 * implementation replaces the detail with the retry's own payload and silently
 * loses the message block.
 */
export const retryResponse = notification;

/**
 * The retry's `meta`.
 *
 * `drain` names the command that will actually send, which is the whole reason
 * the response is a 202 rather than a 200 — see `retryOutcome()`.
 */
export const retryMeta = z.looseObject({
  queued: z.boolean(),
  already_pending: z.boolean(),
  drain: z.string(),
});
export type RetryMeta = z.infer<typeof retryMeta>;

/**
 * `details` on the 409 a `sent` row answers.
 *
 *   { status: "sent", sent_at: "2026-08-21T14:34:23+00:00" }
 *
 * Both keys, because the panel renders the date and the house rule is to read
 * the 409 body rather than hard-code what a conflict means.
 */
export const sentConflictDetails = z.looseObject({
  status: z.string(),
  sent_at: z.string(),
});
