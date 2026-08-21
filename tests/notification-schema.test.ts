import { describe, expect, it } from "vitest";
import {
  notification,
  notificationDetail,
  notificationList,
  notificationMessage,
  retryMeta,
  retryResponse,
  sentConflictDetails,
} from "@/lib/api/schemas/notification";
import {
  AUDIENCES,
  KNOWN_CHANNELS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_STATUSES,
  QUEUE_STATES,
  STATE_TONE,
  eventMessageKey,
  isKnownChannel,
  messageParagraphs,
  queueState,
  retryOutcome,
  sentAt,
  sentConflict,
  stateCounts,
} from "@/lib/notifications";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import fixtures from "./fixtures-notifications.json";

/**
 * The notification schema, parsed against **captured live payloads**.
 *
 * `tests/fixtures-notifications.json` is twelve responses verbatim, captured
 * 2026-08-21 against the queue `scripts/seed-notifications.mjs` establishes.
 * Re-capture it, do not hand-edit it: a fixture somebody tidied is a fixture that
 * no longer describes the API. The precedent is `tests/cms-schema.test.ts`.
 *
 * Both directions, which is the point of pinning a schema rather than a shape:
 *
 *   forward   an **added** key passes through, because `looseObject` is what
 *             keeps an additive server change from breaking a screen that did
 *             not need the new field.
 *   backward  a **retyped** field is refused, because that is the change that
 *             would otherwise surface as a server-render 500 with a Zod trace in
 *             it — `acFetch` parses on the server.
 *
 * The states the queue could not reach on its own are here too. Before the seed,
 * every one of the 39 rows was `pending` with a null `sent_at` and a null
 * `last_error`, so `sent`, `failed`, a second channel and an unreadable payload
 * were all unassertable.
 */

const data = <T,>(body: unknown) => (body as { data: T }).data;
const meta = (body: unknown) => (body as { meta: Record<string, unknown> }).meta;
const error = (body: unknown) =>
  (body as { error: { code: string; message: string; details: Record<string, unknown> } }).error;

describe("the queue list", () => {
  it("parses every row, across every state the seed establishes", () => {
    const rows = notificationList.parse(data(fixtures.list));
    expect(rows.length).toBeGreaterThan(0);

    // The floor. A fixture that had drifted back to one state would satisfy a
    // plain `parse()` and prove nothing about the screen built on it.
    const states = new Set(rows.map(queueState));
    for (const state of QUEUE_STATES) {
      expect(states, `no ${state} row in the fixture`).toContain(state);
    }
  });

  it("keeps `message` out of a list row", () => {
    /*
     * The omission is the contract and it is asserted on both sides of the wire:
     * `NotificationRepository::search()` never selects `payload`, and here.
     * §90's reason is that a support agent scanning a queue must not pull five
     * hundred customers' order contents into one response.
     */
    for (const row of data<Record<string, unknown>[]>(fixtures.list)) {
      expect(row).not.toHaveProperty("message");
    }
  });

  it("is materially smaller per row than the single read", () => {
    /*
     * The size difference verified rather than asserted from the docblock. On
     * this fixture the bodies are two short sentences and the detail is still
     * half again as large; a real order confirmation is where it matters.
     */
    const rows = data<unknown[]>(fixtures.list);
    const perRow = JSON.stringify(fixtures.list).length / rows.length;
    expect(JSON.stringify(fixtures.detail).length).toBeGreaterThan(perRow);
  });

  it("carries both audiences, which are two different questions", () => {
    // 18 of the 39 rows measured before the seed were addressed to the shop
    // rather than to a customer. A screen that renders them identically buries
    // the distinction between "a customer was not told" and "we were not told".
    const audiences = new Set(notificationList.parse(data(fixtures.list)).map((r) => r.audience));
    expect(audiences).toContain("customer");
    expect(audiences).toContain("admin");
  });

  it("carries a second channel, so `?channel=` means something", () => {
    const channels = new Set(notificationList.parse(data(fixtures.list)).map((r) => r.channel));
    expect(channels.size).toBeGreaterThan(1);
    expect([...channels].every(isKnownChannel)).toBe(true);
  });

  it("offsets both timestamps, unlike an order note", () => {
    /*
     * `NotificationPresenter::time()` is `gmdate('c')` for both fields, so both
     * end in an offset — where `notes[].created_at` elsewhere in this API has
     * none and `new Date()` silently reads it as local. Verified on a real sent
     * row rather than inferred from the shared code path.
     */
    const rows = notificationList.parse(data(fixtures.list));
    expect(rows[0].created_at).toMatch(/[+-]\d{2}:\d{2}$/);

    const sent = rows.find((row) => row.status === "sent");
    expect(sent?.sent_at).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(Number.isNaN(new Date(sent!.sent_at!).getTime())).toBe(false);
  });

  it("nulls `sent_at` on everything that has not sent", () => {
    for (const row of notificationList.parse(data(fixtures.list))) {
      expect(sentAt(row)).toBe(row.status === "sent" ? row.sent_at : null);
      if (row.status !== "sent") expect(row.sent_at).toBeNull();
    }
  });
});

describe("the schema in both directions", () => {
  it("passes an added key through", () => {
    /*
     * `looseObject` is deliberate. The API gains keys between branches — `meta`
     * grew `facets` on products and `money_visible` on analytics — and a strict
     * object would turn a purely additive change into a parse failure on a
     * screen that never asked for the new field.
     */
    const row = data<Record<string, unknown>[]>(fixtures.list)[0];
    const widened = { ...row, delivery_receipt_id: "abc-123", provider: { name: "postmark" } };

    const parsed = notification.parse(widened);
    expect(parsed.id).toBe(row.id);
    // Present on the parsed value, not silently dropped.
    expect(parsed).toHaveProperty("delivery_receipt_id", "abc-123");
  });

  it("refuses a retyped field", () => {
    const row = data<Record<string, unknown>[]>(fixtures.list)[0];

    // `attempts` as a string is the shape a hand-written fixture drifts into,
    // and the one that renders as `NaN` three components away from the cause.
    expect(notification.safeParse({ ...row, attempts: "1" }).success).toBe(false);
    // `id` as a string is what a JSON serialiser does to a bigint column.
    expect(notification.safeParse({ ...row, id: String(row.id) }).success).toBe(false);
    // `last_error` is nullable, never absent-as-undefined.
    expect(notification.safeParse({ ...row, last_error: 0 }).success).toBe(false);
  });

  it("refuses a status outside the three the API validates", () => {
    // `?status=delivered` is a 400 naming the three, so a row carrying a fourth
    // would mean the vocabulary moved and the filter control is now wrong.
    const row = data<Record<string, unknown>[]>(fixtures.list)[0];
    expect(notification.safeParse({ ...row, status: "delivered" }).success).toBe(false);
    expect(notification.safeParse({ ...row, status: "queued" }).success).toBe(false);
  });

  it("accepts a channel it has no name for, which is not the same thing", () => {
    /*
     * The asymmetry is the API's: `status` is an enum and answers 400, `channel`
     * is a key pattern and answers 200 with zero rows. A schema that enum-ed the
     * channel would blank a screen the day WhatsApp is added — which is one
     * class and one `add()` away by design.
     */
    const row = data<Record<string, unknown>[]>(fixtures.list)[0];
    expect(notification.safeParse({ ...row, channel: "whatsapp" }).success).toBe(true);
  });

  it("accepts a null subject_id, which is a row about nothing addressable", () => {
    const row = data<Record<string, unknown>[]>(fixtures.list)[0];
    expect(notification.safeParse({ ...row, subject_id: null }).success).toBe(true);
    expect(notification.safeParse({ ...row, subject_id: "4579" }).success).toBe(false);
  });
});

describe("the frozen message", () => {
  it("parses, and reads back as the record it is rather than as panel copy", () => {
    const detail = notificationDetail.parse(data(fixtures.detail));

    expect(detail.message.readable).toBe(true);
    expect(detail.message.subject).not.toBe("");
    expect(detail.message.body).not.toBe("");
  });

  it("is bilingual, and that is the fixture doing its job", () => {
    /*
     * A French salutation over an English sentence, from `NotificationMessages`.
     * It renders verbatim because it is evidence of what was queued — a panel
     * that translated it would be showing something the customer never received.
     * Pinned so nobody "fixes" the seed into monolingual copy and removes the
     * only case the detail screen's quoting exists for.
     */
    const detail = notificationDetail.parse(data(fixtures.detail));
    expect(detail.message.body).toMatch(/Bonjour/);
    expect(detail.message.body).toMatch(/[A-Za-z]{4,} [a-z]{2,} [a-z]{2,}/);
  });

  it("splits into paragraphs without touching a character", () => {
    const detail = notificationDetail.parse(data(fixtures.detail));
    const paragraphs = messageParagraphs(detail.message.body);

    expect(paragraphs.length).toBeGreaterThan(1);

    /*
     * The property, stated once: the paragraphs are the body with its blank
     * lines removed and nothing else. Comparing against a re-implementation of
     * the split would assert that the function equals itself.
     */
    const strippedBody = detail.message.body.replace(/\s+/g, "");
    expect(paragraphs.join("").replace(/\s+/g, "")).toBe(strippedBody);
    for (const paragraph of paragraphs) {
      expect(detail.message.body).toContain(paragraph);
    }

    // A single-paragraph body stays one paragraph — the admin rows are one line.
    expect(messageParagraphs("Order 4595 was placed for 0.00 DZD.")).toHaveLength(1);
    expect(messageParagraphs("")).toHaveLength(0);
  });

  it("reports an unreadable payload rather than an empty message", () => {
    /*
     * The row `drain()` marks permanently failed without ever attempting a send.
     * Unreachable through the API — `notify()` writes the payload with
     * `wp_json_encode()` — so `seed-notifications.mjs` writes one underneath,
     * the `seed-cms.mjs` drop-report precedent.
     */
    const detail = notificationDetail.parse(data(fixtures.detailUnreadable));

    expect(detail.message.readable).toBe(false);
    expect(detail.message.subject).toBe("");
    expect(detail.message.body).toBe("");
    // And it arrives already parked, which is what makes the screen's sentence
    // "the drain could not read this" rather than "this is empty".
    expect(detail.status).toBe("failed");
    expect(detail.last_error).toBe("The stored payload is not readable.");
  });

  it("carries `context: []` on the unreadable row, not an object", () => {
    // PHP's empty array serialises as a JSON array, so the union in the schema
    // is load-bearing rather than defensive.
    const raw = data<{ message: { context: unknown } }>(fixtures.detailUnreadable);
    expect(Array.isArray(raw.message.context)).toBe(true);
    expect(notificationMessage.safeParse(raw.message).success).toBe(true);
  });

  it("carries a message on a channel the panel has no transport for", () => {
    // The `sms` row is hand-written by the seed because no `sms` channel exists
    // to queue one. Its message still has to parse, or the detail screen cannot
    // open a row the list is willing to show.
    const detail = notificationDetail.parse(data(fixtures.detailSms));
    expect(detail.channel).toBe("sms");
    expect(detail.message.readable).toBe(true);
    // A phone number, which is why `recipient` is not validated as an email.
    expect(detail.recipient).not.toContain("@");
  });
});

describe("retry", () => {
  it("answers a list row, not a detail, so the screen must re-read", () => {
    /*
     * The obvious implementation rebinds the detail to the retry's own payload
     * and silently loses the message block. Pinned because the failure is a
     * blank quote on a screen that was working a moment earlier.
     */
    const body = data<Record<string, unknown>>(fixtures.retryRequeued);
    expect(body).not.toHaveProperty("message");
    expect(retryResponse.safeParse(body).success).toBe(true);
  });

  it("distinguishes a real requeue from a row already in the queue", () => {
    const requeued = retryMeta.parse(meta(fixtures.retryRequeued));
    const already = retryMeta.parse(meta(fixtures.retryAlreadyPending));

    expect(retryOutcome(requeued)).toEqual({
      requeued: true,
      drain: "wp algerian-commerce send-notifications",
    });
    expect(retryOutcome(already).requeued).toBe(false);

    // **Both are 202 and both are successes.** The §90 zero-affected-rows fix is
    // what makes the second one not a 409: MySQL reports rows it changed, not
    // rows it matched, so retrying an already-pending row once answered "already
    // sent" about something that had never been sent.
    expect(requeued.queued).toBe(true);
    expect(already.queued).toBe(true);
  });

  it("clears the row it requeued", () => {
    // `attempts` back to zero and `last_error` gone — the point of a retry is a
    // fresh set of tries, and the error described an attempt that is no longer
    // the latest one.
    const row = retryResponse.parse(data(fixtures.retryRequeued));
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBeNull();
    expect(queueState(row)).toBe("queued");
  });

  it("names the command that will actually send, because nothing here does", () => {
    const { drain } = retryOutcome(retryMeta.parse(meta(fixtures.retryRequeued)));
    expect(drain).toBe("wp algerian-commerce send-notifications");
  });

  it("refuses a sent row with a 409 naming when it sent", () => {
    /*
     * A record of something that left the building. Re-queueing it would deliver
     * a body frozen weeks ago — an order refunded since would still send the
     * confirmation that was true when it was placed.
     */
    const err = error(fixtures.retrySent);
    expect(err.code).toBe("conflict");

    const details = sentConflictDetails.parse(err.details);
    expect(details.status).toBe("sent");
    expect(sentConflict(details)).toBe(details.sent_at);
    expect(details.sent_at).toMatch(/[+-]\d{2}:\d{2}$/);
  });
});

describe("the filters this branch paid for", () => {
  it("narrows to one person's notifications in one request", () => {
    /*
     * `?recipient=` did not exist when this branch started — measured, it was
     * accepted and silently ignored, along with `?subject_id=`, `?event=` and
     * `?audience=`. It was added to the backend on `feat/notification-filters`,
     * because the alternative was one request per order per event name.
     */
    const all = notificationList.parse(data(fixtures.list));
    const mine = notificationList.parse(data(fixtures.byRecipient));

    expect(mine.length).toBeGreaterThan(0);
    // The floor: an ignored filter returns everything and looks identical to a
    // working one on a shop where one customer happens to own every row.
    expect(mine.length).toBeLessThan(all.length);
    expect(new Set(mine.map((row) => row.recipient)).size).toBe(1);
  });

  it("gathers every event about one order, the shop's included", () => {
    const rows = notificationList.parse(data(fixtures.bySubject));

    expect(rows.length).toBeGreaterThan(1);
    expect(new Set(rows.map((row) => row.subject_id))).toEqual(new Set([4579]));
    // Both sides of one order: the customer's confirmation and the shop's alert.
    // This is the query `dedupe_key` cannot express, and the reason it was added.
    expect(new Set(rows.map((row) => row.audience))).toEqual(new Set(["customer", "admin"]));
  });

  it("puts an invalid status in `details.params`, not `details.fields`", () => {
    /*
     * The one-endpoint-two-shapes trap. `lib/api/browser.ts` reads both, so
     * nothing on this branch has to — but pinned, because the useful sentence is
     * in `params` and a reader that only knows `fields` shows the generic
     * message instead.
     */
    const err = error(fixtures.invalidStatus);
    expect(err.code).toBe("invalid_request");
    expect(err.details).toHaveProperty("params");
    expect(err.details).not.toHaveProperty("fields");
    expect((err.details.params as Record<string, string>).status).toMatch(/pending, sent, and failed/);
  });

  it("answers a missing row with its own sentence, not a generic 404", () => {
    const err = error(fixtures.notFound);
    expect(err.code).toBe("not_found");
    expect(err.message).toBe("No notification with that id.");
  });
});

describe("the four states the screen derives from three fields", () => {
  it("reads a tried-and-still-queued row as retrying, not as queued", () => {
    /*
     * **The distinction the whole screen turns on.** `markFailed()` writes
     * `status = pending` for a retryable failure, so a row that has been tried
     * and failed is indistinguishable from an untouched one by status alone —
     * and that is the one thing an operator opens this screen to know.
     */
    const rows = notificationList.parse(data(fixtures.list));
    const tried = rows.find((row) => row.status === "pending" && row.attempts > 0);

    expect(tried, "the fixture has no attempted-but-still-pending row").toBeDefined();
    expect(tried!.last_error).not.toBeNull();
    expect(queueState(tried!)).toBe("retrying");

    const clean = rows.find((row) => row.status === "pending" && row.attempts === 0);
    expect(clean, "the fixture has no untouched pending row").toBeDefined();
    expect(queueState(clean!)).toBe("queued");
  });

  it("tones a retrying row as warning rather than danger", () => {
    // It is still in the queue and the next drain will try it again. Painting it
    // the same red as a parked row teaches a retry gesture that answers 202
    // `already_pending: true` and does nothing.
    expect(STATE_TONE.retrying).toBe("warning");
    expect(STATE_TONE.failed).toBe("danger");
    expect(STATE_TONE.sent).toBe("success");
    expect(STATE_TONE.queued).toBe("neutral");
  });

  it("counts the page rather than claiming to count the queue", () => {
    const rows = notificationList.parse(data(fixtures.list));
    const counts = stateCounts(rows);

    expect(counts.queued + counts.retrying + counts.sent + counts.failed).toBe(rows.length);
    for (const state of QUEUE_STATES) expect(counts[state]).toBeGreaterThan(0);
  });

  it("derives the state of every fixture row without falling through", () => {
    for (const row of notificationList.parse(data(fixtures.list))) {
      expect(QUEUE_STATES).toContain(queueState(row));
    }
  });
});

describe("every value this screen renders has a label in both locales", () => {
  /*
   * **This suite exists because the e2e run did not catch it.**
   *
   * `next-intl` resolves a `.` in a key as a path separator, so `event.order.placed`
   * looks for `notifications` → `event` → `order` → `placed` and a flat
   * `"order.placed"` key never matches. Every one of the eight event labels was
   * missing in both locales, and **seven of the eight e2e tests still passed** —
   * `t()` renders the unresolved key path as text, so each row carried a
   * plausible amount of writing and only the test matching a label exactly
   * noticed. The dev log had `MISSING_MESSAGE` for all sixteen the whole time.
   *
   * So the fix is `eventMessageKey()`, and this is the floor that keeps it: a
   * label that resolves to nothing is caught here, in milliseconds, without a
   * browser and without anyone reading a log.
   */
  const namespaces = [
    ["fr", fr.notifications as Record<string, unknown>],
    ["ar", ar.notifications as Record<string, unknown>],
  ] as const;

  const label = (namespace: Record<string, unknown>, group: string, key: string) => {
    const groupValue = namespace[group];
    if (typeof groupValue !== "object" || groupValue === null) return undefined;
    return (groupValue as Record<string, unknown>)[key];
  };

  it.each(namespaces)("%s labels every event", (_locale, namespace) => {
    for (const event of NOTIFICATION_EVENTS) {
      const key = eventMessageKey(event);
      // The assertion that would have failed: `order.placed` is not a key.
      expect(key, `${event} still carries a dot`).not.toContain(".");
      expect(label(namespace, "event", key), `no label for ${event}`).toBeTypeOf("string");
    }
  });

  it.each(namespaces)("%s labels every state, status, channel and audience", (_locale, ns) => {
    for (const state of QUEUE_STATES) {
      expect(label(ns, "state", state), `no label for state ${state}`).toBeTypeOf("string");
      expect(label(ns, "pageSummary", state), `no summary for ${state}`).toBeTypeOf("string");
    }
    for (const status of NOTIFICATION_STATUSES) {
      expect(label(ns, "status", status), `no label for status ${status}`).toBeTypeOf("string");
    }
    for (const channel of KNOWN_CHANNELS) {
      expect(label(ns, "channel", channel), `no label for channel ${channel}`).toBeTypeOf("string");
    }
    for (const audience of AUDIENCES) {
      expect(label(ns, "audience", audience), `no label for ${audience}`).toBeTypeOf("string");
    }
  });

  it("carries no dotted key anywhere in the namespace", () => {
    /*
     * The general form of the same defect, since `event` is not the only group
     * that could grow one: `dedupe_key`, `subject_type` and a future channel
     * name are all API vocabulary that could end up as a message key.
     */
    const dotted = (node: Record<string, unknown>, path = ""): string[] =>
      Object.entries(node).flatMap(([key, value]) =>
        key.includes(".")
          ? [`${path}${key}`]
          : typeof value === "object" && value !== null
            ? dotted(value as Record<string, unknown>, `${path}${key}.`)
            : [],
      );

    for (const [locale, namespace] of namespaces) {
      expect(dotted(namespace), `${locale} has an unreachable dotted key`).toEqual([]);
    }
  });
});
