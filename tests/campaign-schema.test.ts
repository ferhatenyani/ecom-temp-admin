import { describe, expect, it } from "vitest";
import {
  campaign,
  campaignList,
  campaignPreview,
  emailTemplate,
  emailTemplateList,
  marketingConfig,
  recipient,
  recipientList,
  recipientMeta,
  segment,
  segmentInUseDetails,
  segmentList,
  segmentPreview,
  sendResult,
  testResult,
} from "@/lib/api/schemas/campaign";
import {
  AUDIENCE_TYPES,
  CAMPAIGN_STATUSES,
  CAMPAIGN_TONE,
  COMPOSER_STEPS,
  CRITERION_CONTROL,
  CRITERION_PAIRS,
  MAX_ORDERS,
  MAX_SPENT,
  RECIPIENT_STATUSES,
  REFUSED_CRITERIA,
  SEGMENT_CRITERIA,
  audienceProblem,
  availableCriteria,
  criterionBounds,
  criterionProblem,
  pairProblems,
  canAdvance,
  canCancel,
  canDelete,
  canEdit,
  canSend,
  classifySendRefusal,
  consentGap,
  furthestStep,
  hasAudienceCount,
  hasCriteria,
  nextStep,
  previousStep,
  recipientError,
  recipientSentAt,
  sendOutcome,
  testDelivered,
  unsubscribeNote,
} from "@/lib/campaigns";
import { parseApiDate } from "@/lib/format/date";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import fixtures from "./fixtures-campaigns.json";

/**
 * The campaigns schema, parsed against **captured live payloads**.
 *
 * `tests/fixtures-campaigns.json` is 28 responses verbatim, captured 2026-08-21
 * against the shop `scripts/seed-campaigns.mjs` establishes. Re-capture it, do
 * not hand-edit it. The precedent is `tests/notification-schema.test.ts`.
 *
 * Most of this branch's surface is answerable here rather than in a browser: the
 * status vocabulary, the transition flags, the consent gap, the token warning,
 * the three ways `send` can refuse, and both capability-scoped nulls. What is
 * left for e2e is the wizard actually walking, and the refusal reaching a screen.
 *
 * Every state the shop could not reach on its own is here too. Before the seed,
 * all three collections were empty, **one customer in sixteen had consent**, and
 * `test` and `send` were both 503 — so the composer could be built as far as
 * `preview` and no further.
 */

const data = <T,>(body: unknown) => (body as { data: T }).data;
const meta = (body: unknown) => (body as { meta: Record<string, unknown> }).meta;
const error = (body: unknown) =>
  (body as { error: { code: string; message: string; details: Record<string, unknown> } }).error;

const byName = (name: string) =>
  data<Record<string, unknown>[]>(fixtures.list).find((row) => row.name === name)!;

describe("the campaign list", () => {
  it("parses, across every status the seed establishes", () => {
    const rows = campaignList.parse(data(fixtures.list));
    expect(rows.length).toBeGreaterThan(0);

    // The floor: a fixture that had drifted to one status would satisfy a plain
    // parse and prove nothing about a screen built to tell four apart.
    const statuses = new Set(rows.map((row) => row.status));
    for (const status of ["draft", "sent", "cancelled"]) {
      expect(statuses, `no ${status} campaign in the fixture`).toContain(status);
    }
  });

  it("publishes the transition table rather than making the panel carry one", () => {
    /*
     * The orders branch's rule, one collection over: read the API's own answer,
     * never hard-code which moves are legal. Measured on a sent campaign,
     * `allowed_transitions` is `[]` and `is_editable` is false.
     */
    const draft = campaign.parse(data(fixtures.draft));
    const sent = campaign.parse(data(fixtures.sent));
    const cancelled = campaign.parse(data(fixtures.cancelled));

    expect(canEdit(draft)).toBe(true);
    expect(canSend(draft)).toBe(true);
    expect(canCancel(draft)).toBe(true);
    expect(canDelete(draft)).toBe(true);

    expect(canEdit(sent)).toBe(false);
    expect(canSend(sent)).toBe(false);
    expect(canDelete(sent)).toBe(false);
    expect(sent.allowed_transitions).toEqual([]);

    // A cancelled campaign is not deletable either — "Only a draft can be
    // deleted. Cancel the campaign instead." is about the *draft*, not a
    // suggestion to cancel something already cancelled.
    expect(canDelete(cancelled)).toBe(false);
    expect(canEdit(cancelled)).toBe(false);
  });

  it("keeps an audience a definition and never a list of addresses", () => {
    for (const row of campaignList.parse(data(fixtures.list))) {
      expect(row.audience.customer_ids).toBeInstanceOf(Array);
      // Never null: `0` is the unset segment and `[]` the unset id list.
      expect(typeof row.audience.segment_id).toBe("number");
      expect(row).not.toHaveProperty("emails");
      expect(row).not.toHaveProperty("recipients_total");
    }
  });

  it("refuses a field the API refuses by name, with its reason", () => {
    /*
     * `status` is the sharpest of the fifteen: a payload that could write "sent"
     * would mark a campaign as delivered without anything having been.
     */
    const err = error(fixtures.campaignRefusedField);
    expect(err.code).toBe("invalid_request");
    expect((err.details.fields as Record<string, string>).status).toMatch(/never set directly/);
  });

  it("tones `sending` as ordinary rather than as a warning", () => {
    // It is the normal state between `send` and the drain finishing, which on a
    // five-minute scheduler is most of the time.
    expect(CAMPAIGN_TONE.sending).toBe("accent");
    expect(CAMPAIGN_TONE.sent).toBe("success");
    expect(CAMPAIGN_TONE.draft).toBe("neutral");
    expect(CAMPAIGN_TONE.cancelled).toBe("neutral");
  });
});

describe("the schema in both directions", () => {
  it("passes an added key through", () => {
    const row = byName("Rentrée — envoyée");
    const widened = { ...row, open_rate: 0.42, provider: { name: "postmark" } };
    const parsed = campaign.parse(widened);
    expect(parsed).toHaveProperty("open_rate", 0.42);
  });

  it("refuses a retyped field", () => {
    const row = byName("Rentrée — envoyée");
    expect(campaign.safeParse({ ...row, id: String(row.id) }).success).toBe(false);
    expect(campaign.safeParse({ ...row, is_editable: "false" }).success).toBe(false);
    expect(campaign.safeParse({ ...row, allowed_transitions: "sent" }).success).toBe(false);
  });

  it("refuses a status outside the four the API validates", () => {
    // `?status=` names them in its 400, with an empty string for "all".
    const row = byName("Rentrée — envoyée");
    expect(campaign.safeParse({ ...row, status: "scheduled" }).success).toBe(false);
    expect(campaign.safeParse({ ...row, status: "queued" }).success).toBe(false);
  });

  it("keeps `claimed_at` and `completed_at` nullable, because a draft has neither", () => {
    const draft = campaign.parse(data(fixtures.draft));
    expect(draft.claimed_at).toBeNull();
    expect(draft.completed_at).toBeNull();

    const sent = campaign.parse(data(fixtures.sent));
    expect(sent.claimed_at).not.toBeNull();
    expect(sent.completed_at).not.toBeNull();
  });
});

describe("the preview, which is a step of its own for one reason", () => {
  it("names the tokens that rendered empty", () => {
    /*
     * **The trap §85 warns about.** `{{firstname}}` is not `{{first_name}}` and
     * renders as nothing, which is invisible in a preview that has a name in it
     * from another token. The seeded draft carries one on purpose so this is
     * asserted against a real render rather than a hand-written string.
     */
    const preview = campaignPreview.parse(data(fixtures.preview));
    expect(preview.unknown_tokens).toContain("firstname");
    // And the render really is empty where the token was — the reason it hides.
    expect(preview.html).toMatch(/Bonjour\s*,/);
  });

  it("says the unsubscribe link was appended rather than missing", () => {
    // `{{unsubscribe_url}}` absent is correct: the API adds one. A screen that
    // warned here would teach somebody to add a second.
    const preview = campaignPreview.parse(data(fixtures.preview));
    expect(preview.unsubscribe_appended).toBe(true);
    expect(unsubscribeNote(preview)).toBe("appended");
    expect(preview.html).toMatch(/unsubscribe/i);
  });

  it("nulls the audience count for a caller who cannot read customers", () => {
    /*
     * `canSendCampaigns()` showing through on a route that is otherwise a
     * Marketing Manager's. Counting an audience means counting customers, so the
     * count is the second capability's and the rest of the preview is not.
     */
    const mine = campaignPreview.parse(data(fixtures.preview));
    const theirs = campaignPreview.parse(data(fixtures.previewAsMarketer));

    expect(hasAudienceCount(mine)).toBe(true);
    expect(mine.audience_count).toBeGreaterThan(0);

    expect(hasAudienceCount(theirs)).toBe(false);
    expect(theirs.audience_count).toBeNull();
    // Present-and-null, not absent: a screen keyed on `undefined` would render
    // the same as a zero and say "nobody".
    expect(Object.keys(theirs)).toContain("audience_count");
    // The rest of the preview is still theirs to see.
    expect(theirs.html).not.toBe("");
  });
});

describe("the test send", () => {
  it("is a 200 that reports the send failed", () => {
    /*
     * Not a 503 and not a 500: the request succeeded and the transport did not,
     * which are different facts. On this stack the transport is a dead port, so
     * `sent` is always false — and the screen says "we tried" rather than "we
     * cannot try", which is what the 503 used to force.
     */
    const result = testResult.parse(data(fixtures.test));
    expect(result.sent).toBe(false);
    expect(testDelivered(result)).toBe(false);
    expect(result.to).toBe("ops@example.test");
    // It renders too, so the token warning is available here as well.
    expect(result.unknown_tokens).toContain("firstname");
  });

  it("refuses an address that is not one — in `params`, not `fields`", () => {
    /*
     * **The one-endpoint-two-shapes trap, and the order matters.**
     * `CampaignService::test()` has its own check that answers `details.fields`
     * with "Must be an email address." — but the route declares `to` with an
     * email format, so WordPress's argument validation fires **first** and
     * answers `details.params` instead. The service's version is unreachable
     * from outside.
     *
     * `lib/api/browser.ts` reads both, so nothing on this branch has to. Pinned
     * because a form binding this to a field by looking only in `fields` would
     * show the generic message on the one input it has.
     */
    const err = error(fixtures.testBadAddress);
    expect(err.details).toHaveProperty("params");
    expect(err.details).not.toHaveProperty("fields");
    expect((err.details.params as Record<string, string>).to).toMatch(/email address/i);
  });
});

describe("send, and the three ways it refuses", () => {
  it("answers 202 with a count and the command that will do the sending", () => {
    /*
     * **`send` sends nothing.** It freezes the audience and returns. The mail
     * leaves when a deployment runs the command — a progress bar implying live
     * delivery is a lie the operator will act on.
     */
    const result = sendResult.parse({
      campaign_id: 1,
      status: "sending",
      recipients: 9,
      next: { action: "drain", command: "wp algerian-commerce send-campaigns" },
    });
    expect(sendOutcome(result)).toEqual({
      recipients: 9,
      command: "wp algerian-commerce send-campaigns",
    });
  });

  it("distinguishes already-sent from nobody-matches, which share a code", () => {
    /*
     * Both are 409 `conflict`, so they are told apart by which keys the details
     * carry rather than by the message, which is prose. Measured: already-sent
     * carries `status`; nobody-matches carries `audience_type` and a `hint`
     * naming consent. They point at different things — one at the campaign, one
     * at the segment — so they cannot share a sentence.
     */
    const already = error(fixtures.sendAgain);
    expect(already.code).toBe("conflict");
    expect(classifySendRefusal(409, already.code, already.details)).toBe("already");
    expect(already.details.status).toBe("sent");

    expect(
      classifySendRefusal(409, "conflict", {
        audience_type: "ids",
        hint: "Only customers who have given marketing consent are ever included.",
      }),
    ).toBe("nobody");

    expect(classifySendRefusal(503, "mail_not_configured", {})).toBe("mail");
    expect(classifySendRefusal(403, "forbidden", {})).toBe("forbidden");
  });

  it("refuses a Marketing Manager at send, while they may draft and preview", () => {
    /*
     * **The compound rule, and the fixture the two-tier collapse was said to have
     * taken away.** Part V records that "drafts but cannot send is a state no role
     * reaches" — measured today it *is* reachable: the retired
     * `ac_marketing_manager` that `test.sh` already mints is 200 on the campaign
     * and the preview and 403 on send, recipients and a segment count.
     */
    expect(error(fixtures.sendAsMarketer).code).toBe("forbidden");
    expect(error(fixtures.recipientsAsMarketer).code).toBe("forbidden");
    expect(error(fixtures.segmentPreviewAsMarketer).code).toBe("forbidden");
    // The positive control: the same credential renders a whole preview.
    expect(campaignPreview.safeParse(data(fixtures.previewAsMarketer)).success).toBe(true);
  });

  it("refuses to edit or delete a campaign that is no longer a draft", () => {
    for (const body of [fixtures.editSent, fixtures.deleteSent]) {
      const err = error(body);
      expect(err.code).toBe("conflict");
      expect(err.details.status).toBe("sent");
    }
  });
});

describe("recipients", () => {
  it("parses, with empty strings where the notification queue uses null", () => {
    /*
     * Two routes in one API, two conventions. `CampaignService::recipientList()`
     * casts to string, so `last_error` is `""` and never null — a check for
     * `!== null` is true on every row and only emptiness tells them apart.
     */
    const rows = recipientList.parse(data(fixtures.recipients));
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.last_error).not.toBeNull();
      expect(row.sent_at).not.toBeNull();
      expect(typeof row.last_error).toBe("string");
    }

    const sent = rows.find((row) => row.status === "sent")!;
    const failed = rows.find((row) => row.status === "failed")!;
    expect(recipientError(sent)).toBeNull();
    expect(recipientError(failed)).not.toBeNull();
    expect(recipientSentAt(sent)).not.toBeNull();
    expect(recipientSentAt(failed)).toBeNull();
  });

  it("carries a `sent_at` with no offset, which `new Date()` reads wrong", () => {
    /*
     * The `notes[].created_at` trap one table over: `"2026-08-21 17:31:12"`, no
     * `T` and no offset, on a response whose campaign timestamps have both.
     * `parseApiDate` reads an offsetless stamp as UTC, which is what the API
     * means; `new Date()` reads it as local and is silently wrong by the host's
     * offset.
     */
    const rows = recipientList.parse(data(fixtures.recipients));
    const sent = rows.find((row) => row.status === "sent")!;

    expect(sent.sent_at).not.toMatch(/[+-]\d{2}:\d{2}$/);
    expect(sent.sent_at).not.toContain("T");

    const parsed = parseApiDate(sent.sent_at)!;
    expect(parsed).not.toBeNull();
    // Read as UTC, so the hour on the wire is the hour in UTC.
    expect(parsed.getUTCHours()).toBe(Number(sent.sent_at.slice(11, 13)));

    // And the campaign's own stamps are the other convention, on the same branch.
    expect(campaign.parse(data(fixtures.sent)).created_at).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it("reports a total that follows the filter, which it once did not", () => {
    /*
     * **`feat/campaign-recipient-counts`.** Measured before it: `?status=failed`
     * answered 0 rows with `meta.total: 9`, because the rows were filtered by the
     * repository and the total came from the unfiltered counts. A paginating
     * client showed "9 recipients" over an empty table.
     *
     * Asserted as the sum, so it holds whatever the fixture's split happens to
     * be, plus a floor that the split is real.
     */
    const whole = recipientMeta.parse(meta(fixtures.recipients));
    const failed = recipientMeta.parse(meta(fixtures.recipientsFailed));
    const sent = recipientMeta.parse(meta(fixtures.recipientsSent));

    expect(failed.total).toBe(data<unknown[]>(fixtures.recipientsFailed).length);
    expect(sent.total).toBe(data<unknown[]>(fixtures.recipientsSent).length);
    expect(failed.total + sent.total).toBe(whole.total);

    // The floor. All-one-status would satisfy everything above against a filter
    // that does nothing.
    expect(failed.total).toBeGreaterThan(0);
    expect(sent.total).toBeGreaterThan(0);
  });

  it("agrees with the campaign's stored columns before a purge", () => {
    /*
     * They are different things — the campaign's block is columns written by the
     * drain, the list is a live query — and they may only diverge *after* the
     * purge, when the rows are gone and the columns are what remains. A seed that
     * wrote rows directly once put them out of step, which is why
     * `seed-campaigns.mjs` drives the real drain.
     */
    const counts = campaign.parse(data(fixtures.sent)).recipients;
    const whole = recipientMeta.parse(meta(fixtures.recipients));

    expect(counts.purged).toBe(false);
    expect(counts.total).toBe(whole.total);
    expect(counts.sent).toBe(recipientMeta.parse(meta(fixtures.recipientsSent)).total);
    expect(counts.failed).toBe(recipientMeta.parse(meta(fixtures.recipientsFailed)).total);
  });
});

describe("segments", () => {
  it("parses, and a preview counts only consenting customers", () => {
    const rows = segmentList.parse(data(fixtures.segments));
    expect(rows.length).toBeGreaterThan(0);

    const preview = segmentPreview.parse(data(fixtures.segmentPreview));
    expect(preview.matches).toBeGreaterThan(0);
    expect(preview.problems).toEqual([]);
    // The API's own note is an English sentence, so the panel renders its own.
    expect(preview.note).toMatch(/consent/i);
  });

  it("counts zero for a criterion that comes off the shipment", () => {
    /*
     * `wilaya_id` is read from the **shipment**, never the address, so an order
     * nobody has shipped cannot match. Measured: 0 against an order-count segment
     * matching 8 on the same shop. Correct, and indistinguishable from a broken
     * filter unless the form says so — which is why it is seeded.
     */
    const empty = segmentPreview.parse(data(fixtures.segmentPreviewEmpty));
    expect(empty.matches).toBe(0);
    expect(empty.criteria).toHaveProperty("wilaya_id");
  });

  it("refuses empty criteria, and says which are supported", () => {
    /*
     * Empty criteria would match every customer, and "everyone eligible" already
     * has its own `audience_type`. The refusal publishes the whole supported
     * vocabulary, which is where `SEGMENT_CRITERIA` came from.
     */
    const err = error(fixtures.segmentEmptyCriteria);
    expect((err.details.fields as Record<string, string>).criteria).toMatch(/audience_type/);
    expect(err.details.supported).toEqual([...SEGMENT_CRITERIA]);
    expect(hasCriteria({})).toBe(false);
    expect(hasCriteria({ min_orders: 1 })).toBe(true);
  });

  it("refuses the eight the panel never offers, by name", () => {
    const err = error(fixtures.segmentRefusedCriterion);
    expect((err.details.fields as Record<string, string>).sql).toBeTypeOf("string");
    // Every refused name is one the criteria form has no control for.
    for (const name of REFUSED_CRITERIA) {
      expect(SEGMENT_CRITERIA).not.toContain(name as never);
    }
  });

  /**
   * **Sub-task 4 of item 6, as a property rather than as a list.**
   *
   * The item asks that the screen stay *structurally incapable* of offering
   * `consent` or `email_contains` — not that it happen not to offer them today,
   * which is a thing a later edit removes without noticing.
   *
   * The compiler carries the first half: `CRITERION_CONTROL` is a
   * `Record<SegmentCriterion, …>`, so a twelfth key is an excess-property error
   * and a missing one is a missing-property error, and `CriterionField`'s switch
   * over its values is exhaustive. A refused name therefore has no control to be
   * drawn with, and adding one does not compile. That is not assertable from a
   * test — `tsc --noEmit` is what asserts it — so this asserts the runtime half:
   * the two vocabularies do not intersect, the option list is drawn from
   * `SEGMENT_CRITERIA` alone, and every one of the eleven resolves to a control
   * while none of the eight does.
   *
   * `REFUSED_CRITERIA` grew from seven to eight on this branch, read out of
   * `SegmentCriteria::REFUSED` rather than counted from the note that said seven
   * — `marketing_consent` is `consent`'s twin and both lists had missed it.
   */
  it("cannot offer a refused criterion, because none of them has a control", () => {
    expect(REFUSED_CRITERIA).toHaveLength(8);
    expect(REFUSED_CRITERIA).toContain("marketing_consent");

    const controls = Object.keys(CRITERION_CONTROL);
    // Exactly the eleven, in the same set — no more and no fewer.
    expect(controls.toSorted()).toEqual([...SEGMENT_CRITERIA].toSorted());

    for (const refused of REFUSED_CRITERIA) {
      expect(controls, `${refused} has a control`).not.toContain(refused);
      // And the picker, whose options are this function's answer and nothing else.
      expect(availableCriteria([]), `${refused} is offered`).not.toContain(refused as never);
    }

    // Every criterion the picker offers can actually be drawn.
    for (const key of availableCriteria([])) {
      expect(CRITERION_CONTROL[key], `${key} has no control`).toBeTypeOf("string");
    }
  });

  /**
   * **A criterion appears at most once, and that is the wire's shape.**
   *
   * `criteria` is a JSON object keyed by criterion name — `fromPayload()`
   * iterates `foreach ($payload as $field => $value)` and `Segment::toRow()`
   * persists the result with `json_encode` — so two `min_spent` entries are not
   * something the API refuses but something JSON cannot express. The UI's job is
   * therefore not to reject a duplicate but to stop offering one whose value
   * would silently replace the first.
   */
  it("stops offering a criterion the draft already holds", () => {
    expect(availableCriteria(["min_spent"])).not.toContain("min_spent");
    expect(availableCriteria([...SEGMENT_CRITERIA])).toEqual([]);
    // An unknown key on a stored record consumes nothing.
    expect(availableCriteria(["zzz"])).toHaveLength(SEGMENT_CRITERIA.length);
  });

  /**
   * **Money and counts are not one rule**, which is what the shared
   * `inputMode="decimal"` field made them look like.
   *
   * Each clause below is a line of `SegmentCriteria::parse()`: `^\d+(\.\d{1,2})?$`
   * against `ctype_digit`, `MAX_SPENT = '99999999.99'` against
   * `MAX_ORDERS = 100_000`, and the ceiling naming the two count fields so that
   * the three id fields have none.
   */
  it("holds money and counts to the two different grammars the API has", () => {
    // Money: two decimal places, no more, and no sign.
    expect(criterionProblem("min_spent", "5000")).toBeNull();
    expect(criterionProblem("min_spent", "5000.00")).toBeNull();
    expect(criterionProblem("min_spent", "5000.5")).toBeNull();
    expect(criterionProblem("min_spent", "10.999")).toBe("money");
    expect(criterionProblem("min_spent", "-1")).toBe("money");
    expect(criterionProblem("min_spent", MAX_SPENT)).toBeNull();
    expect(criterionProblem("min_spent", "100000000")).toBe("range");

    // A count: digits only. The decimal point money accepts is a 400 here.
    expect(criterionProblem("min_orders", "3")).toBeNull();
    expect(criterionProblem("min_orders", "3.0")).toBe("count");
    expect(criterionProblem("min_orders", "-5")).toBe("count");
    expect(criterionProblem("min_orders", String(MAX_ORDERS))).toBeNull();
    expect(criterionProblem("min_orders", String(MAX_ORDERS + 1))).toBe("range");

    // An id shares the count's shape and has **no ceiling** — `parse()`'s range
    // clause names `min_orders` and `max_orders` and nothing else.
    expect(criterionProblem("wilaya_id", "16")).toBeNull();
    expect(criterionProblem("wilaya_id", "16.5")).toBe("id");
    expect(criterionProblem("bought_product_id", String(MAX_ORDERS * 99))).toBeNull();

    /* A date is the API's own `^\d{4}-\d{2}-\d{2}$` and nothing looser — no
       `T`, no offset, no unpadded month. `parse()`'s second gate, `checkdate`,
       is `DateField`'s: `parseEntry` reports `""` for 31 February, so a value
       that reaches here has already been through a `Date.UTC` round trip. */
    expect(criterionProblem("ordered_after", "2026-08-31")).toBeNull();
    expect(criterionProblem("ordered_after", "2026-8-31")).toBe("date");
    expect(criterionProblem("ordered_after", "2026-08-31T00:00:00Z")).toBe("date");
    expect(criterionProblem("ordered_after", "31/08/2026")).toBe("date");

    // Empty is not a problem: it is how a criterion is left unfilled, and
    // `fromPayload()` skips a blank rather than refusing it.
    for (const key of SEGMENT_CRITERIA) expect(criterionProblem(key, "  ")).toBeNull();
  });

  /**
   * The five cross-field refusals, mirrored from `checkRanges()` — refusals the
   * panel had no idea existed and that a form of individually perfect fields can
   * still earn.
   */
  it("refuses an inverted range and a product bought and not bought", () => {
    expect(CRITERION_PAIRS).toHaveLength(4);

    expect(pairProblems({ min_spent: "500", max_spent: "100" })).toEqual({
      max_spent: { rule: "order", other: "min_spent" },
    });
    expect(pairProblems({ min_spent: "100", max_spent: "500" })).toEqual({});
    expect(pairProblems({ min_orders: "9", max_orders: "2" })).toEqual({
      max_orders: { rule: "order", other: "min_orders" },
    });
    // Dates compare as fixed-width text, which is what `checkRanges()` does.
    expect(pairProblems({ ordered_after: "2026-08-31", ordered_before: "2026-01-01" })).toEqual({
      ordered_before: { rule: "order", other: "ordered_after" },
    });
    expect(
      pairProblems({ registered_after: "2026-01-01", registered_before: "2026-08-31" }),
    ).toEqual({});
    expect(pairProblems({ bought_product_id: "2481", not_bought_product_id: "2481" })).toEqual({
      not_bought_product_id: { rule: "same", other: "bought_product_id" },
    });

    // Half a pair is a perfectly good segment, and a malformed value is the
    // *value's* problem — a range check over one is noise on top of a refusal.
    expect(pairProblems({ min_spent: "500" })).toEqual({});
    expect(pairProblems({ min_spent: "abc", max_spent: "100" })).toEqual({});
  });

  /**
   * The bounds one half of a date pair puts on the other's calendar. They stop
   * the grid drawing days `checkRanges()` would refuse; the refusal itself still
   * comes from `pairProblems`, because `DatePicker` bounds a pointer and never
   * the keyboard.
   */
  it("bounds a date criterion by the other end of its pair", () => {
    const draft = { ordered_after: "2026-01-01", ordered_before: "2026-08-31" };
    expect(criterionBounds("ordered_after", draft)).toEqual({ max: "2026-08-31" });
    expect(criterionBounds("ordered_before", draft)).toEqual({ min: "2026-01-01" });
    // Pairs do not cross: a registration date is not bounded by an order date.
    expect(criterionBounds("registered_after", draft)).toEqual({});
    expect(criterionBounds("ordered_after", {})).toEqual({});
    // Nothing that is not a date has bounds at all.
    expect(criterionBounds("min_spent", { max_spent: "500" })).toEqual({});
  });

  it("refuses to delete a segment a campaign uses, naming how many", () => {
    const err = error(fixtures.segmentInUse);
    expect(err.code).toBe("conflict");
    const details = segmentInUseDetails.parse(err.details);
    expect(details.campaigns).toBeGreaterThan(0);
    expect(details.fix).toBeTypeOf("string");
  });
});

describe("templates and config", () => {
  it("parses, and flags a template whose token is not a token", () => {
    const rows = emailTemplateList.parse(data(fixtures.templates));
    expect(rows.length).toBeGreaterThan(0);

    const typo = rows.find((row) => row.unknown_tokens.length > 0);
    expect(typo, "no template carries an unknown token").toBeDefined();
    expect(typo!.unknown_tokens).toContain("firstname");
  });

  it("treats a missing unsubscribe token as correct rather than missing", () => {
    const rows = emailTemplateList.parse(data(fixtures.templates));
    const without = rows.find((row) => !row.has_unsubscribe_token);
    expect(without, "no template exercises the appended case").toBeDefined();
  });

  it("parses a single template, and it is read-only through this API", () => {
    const parsed = emailTemplate.parse(data(fixtures.template));
    expect(parsed.body_html).not.toBe("");
    expect(parsed.body_text).not.toBe("");
    // Authored in wp-admin; the panel has no editor and says so.
    expect(parsed.status).toBe("publish");
  });

  it("publishes no token in the marketing config, ever", () => {
    const config = marketingConfig.parse(data(fixtures.marketingConfig));
    expect(config.enabled).toBe(false);
    expect(config.providers).toEqual([]);
    expect(config.browser_events.length).toBeGreaterThan(0);
    // The property this screen exists to state: nothing secret is in the body.
    const serialised = JSON.stringify(data(fixtures.marketingConfig));
    expect(serialised).not.toMatch(/token|secret|access/i);
  });

  it("answers a missing campaign with its own sentence", () => {
    expect(error(fixtures.notFound).code).toBe("not_found");
  });
});

describe("the composer's own rules", () => {
  const draft = (over: Partial<Parameters<typeof furthestStep>[0]> = {}) => ({
    audience: { type: "all", segment_id: 0, customer_ids: [] as number[] },
    subject: "S",
    body_html: "<p>x</p>",
    body_text: "x",
    ...over,
  });

  it("refuses to advance past an audience that cannot resolve", () => {
    expect(audienceProblem({ type: "segment", segment_id: 0, customer_ids: [] })).toBe(
      "segment_missing",
    );
    expect(audienceProblem({ type: "ids", segment_id: 0, customer_ids: [] })).toBe("ids_missing");
    expect(
      audienceProblem({
        type: "ids",
        segment_id: 0,
        customer_ids: Array.from({ length: 1001 }, (_, i) => i),
      }),
    ).toBe("too_many_ids");
    expect(audienceProblem({ type: "all", segment_id: 0, customer_ids: [] })).toBeNull();

    expect(furthestStep(draft({ audience: { type: "segment", segment_id: 0, customer_ids: [] } })))
      .toBe("audience");
  });

  it("requires both body parts, because the text one is authored", () => {
    // §85 is explicit that the text part is not stripped from the HTML, so an
    // empty one is a refusal rather than a convenience.
    expect(furthestStep(draft({ body_text: "" }))).toBe("content");
    expect(furthestStep(draft({ body_html: "" }))).toBe("content");
    expect(furthestStep(draft({ subject: "  " }))).toBe("content");
    expect(furthestStep(draft())).toBe("send");
  });

  it("lets a complete draft reach every step, and never traps a person", () => {
    const complete = draft();
    for (const step of COMPOSER_STEPS.slice(0, -1)) {
      expect(canAdvance(step, complete), `stuck at ${step}`).toBe(true);
    }
    // Backwards is always available, which is what makes a wizard safe here.
    expect(previousStep("audience")).toBeNull();
    expect(previousStep("send")).toBe("test");
    expect(nextStep("send")).toBeNull();
    expect(nextStep("audience")).toBe("content");
  });

  it("shows the consent gap only when there is one to show", () => {
    /*
     * The number the composer exists to make legible: "1 000 sélectionnés → 412
     * destinataires". It is a real pair only for an explicit id list — for `all`
     * and for a segment the panel has no honest "selected" figure, since only the
     * server knows the pre-consent count.
     */
    expect(consentGap(1000, 412)).toEqual({ selected: 1000, eligible: 412, excluded: 588 });
    expect(consentGap(null, 412)).toBeNull();
    expect(consentGap(5, 5)).toBeNull();
    expect(consentGap(3, 9)).toBeNull();
  });
});

describe("every value these screens render has a label in both locales", () => {
  /*
   * The floor `feat/notifications` added after `next-intl`'s dotted-key defect
   * let eight missing labels through a green e2e run. None of this branch's
   * vocabulary carries a dot, but the check costs milliseconds and the next
   * vocabulary might.
   */
  const namespaces = [
    ["fr", fr.campaigns as Record<string, unknown>],
    ["ar", ar.campaigns as Record<string, unknown>],
  ] as const;

  const label = (ns: Record<string, unknown>, group: string, key: string) => {
    const node = ns[group];
    return typeof node === "object" && node !== null
      ? (node as Record<string, unknown>)[key]
      : undefined;
  };

  it.each(namespaces)("%s labels every status, audience, step and criterion", (_locale, ns) => {
    for (const status of CAMPAIGN_STATUSES) {
      expect(label(ns, "status", status), `no label for status ${status}`).toBeTypeOf("string");
    }
    for (const type of AUDIENCE_TYPES) {
      expect(label(ns, "audience", type), `no label for audience ${type}`).toBeTypeOf("string");
    }
    for (const step of COMPOSER_STEPS) {
      expect(label(ns, "step", step), `no label for step ${step}`).toBeTypeOf("string");
    }
    for (const criterion of SEGMENT_CRITERIA) {
      expect(label(ns, "criterion", criterion), `no label for ${criterion}`).toBeTypeOf("string");
    }
    for (const status of RECIPIENT_STATUSES) {
      expect(label(ns, "recipient", status), `no label for recipient ${status}`).toBeTypeOf("string");
    }
    for (const token of ["customer_name", "first_name", "shop_name", "order_number", "unsubscribe_url"]) {
      expect(label(ns, "token", token), `no label for token ${token}`).toBeTypeOf("string");
    }
  });

  it("carries no dotted key anywhere in the namespace", () => {
    const dotted = (node: Record<string, unknown>, path = ""): string[] =>
      Object.entries(node).flatMap(([key, value]) =>
        key.includes(".")
          ? [`${path}${key}`]
          : typeof value === "object" && value !== null
            ? dotted(value as Record<string, unknown>, `${path}${key}.`)
            : [],
      );

    for (const [locale, ns] of namespaces) {
      expect(dotted(ns), `${locale} has an unreachable dotted key`).toEqual([]);
    }
  });

  it("writes no `{{token}}` into a message, because ICU reads it as a placeholder", () => {
    /*
     * **The defect this branch shipped and a screenshot caught.**
     *
     * `{{first_name}}` in an ICU message is a literal `{`, the placeholder
     * `{first_name}`, and a literal `}`. next-intl cannot resolve the argument,
     * throws `INVALID_MESSAGE`, and renders the **key path** as visible text —
     * `campaigns.previewStep.unknownWhy` appeared on screen inside the token
     * warning, which is the one place on this branch that talks about tokens.
     *
     * The existing floor could not see it: every key was present and every value
     * was a string. Presence is not validity.
     *
     * The fix is to pass a token as a **value** — inserted verbatim, never
     * re-parsed — rather than to escape the braces, which ICU allows (`'{{'`) and
     * which no translator would survive.
     */
    const offenders = (node: Record<string, unknown>, path = ""): string[] =>
      Object.entries(node).flatMap(([key, value]) =>
        typeof value === "object" && value !== null
          ? offenders(value as Record<string, unknown>, `${path}${key}.`)
          : typeof value === "string" && value.includes("{{")
            ? [`${path}${key}`]
            : [],
      );

    for (const [locale, ns] of namespaces) {
      expect(offenders(ns), `${locale} embeds a token literal in an ICU message`).toEqual([]);
    }
  });
});
