"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Campaign } from "@/lib/api/schemas/campaign";
import { campaign as campaignSchema, sendResult } from "@/lib/api/schemas/campaign";
import { BrowserApiError, acRead, acWrite, acWriteWithMeta } from "@/lib/api/browser";
import {
  COMPOSER_STEPS,
  canAdvance,
  canDelete,
  canSend,
  classifySendRefusal,
  furthestStep,
  hasAudienceCount,
  mergeRepairs,
  nextStep,
  previousStep,
  repairTokens,
  sendOutcome,
  stepIndex,
  type ComposerStep,
  type SendOutcome,
  type TokenRepair,
} from "@/lib/campaigns";
import type { CustomerRef } from "@/lib/customers";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ErrorSummary, StepIndicator, type FormFailure } from "@/components/ui/Form";
import { ErrorState, StaleBanner } from "@/components/ui/States";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { Menu } from "@/components/ui/Menu";
import { Button, IconButton } from "@/components/ui/Button";
import { useToast } from "@/components/primitives/Toast";
import {
  FIELD_IDS,
  StepAudience,
  StepContent,
  StepSend,
  StepTest,
  usePreview,
  type Draft,
} from "./Steps";
import {
  buildEmail,
  directionFor,
  repairValues,
  type EmailImage,
  type EmailValues,
} from "./email-body";
import { nextBodies, readValues, seededValues, writeValues } from "./body-fields";

/**
 * The composer: audience → content → test → send.
 *
 * ## A stepped form, which is the panel's *other* long-form shape
 *
 * DESIGN.md §3.4 as amended on the campaigns branch: **a form built as steps saves
 * per step and ships no `SaveBar` at all.** The rule the amendment carves out of
 * was written about a coupon and a page — one screen of independent fields, saved
 * once at the end, every save reversible by saving again. This is none of those,
 * and the two properties that make it different are measured rather than
 * stylistic:
 *
 *   **The last step is irreversible.** `send` freezes an audience as one row per
 *   recipient and mail leaves the building. Nothing un-sends it.
 *
 *   **The render is of the *server's* copy.** `GET /campaigns/{id}/preview`
 *   resolves the tokens against what is stored, which only exists because a save
 *   already happened. One long form with a sticky bar would preview the client's
 *   draft against that irreversible act — and the reason the render is worth
 *   having at all is that an unknown token renders *empty*, which is invisible in
 *   a body that has a name in it from another token.
 *
 * Three properties keep it from being the usual wizard annoyance. **Backwards is
 * always free** — any step already reached is one press away, at the keyboard as
 * well as the pointer, so fixing a subject seen wrong in the render costs
 * nothing. **The draft is saved, not held**, so a closed tab loses nothing. And
 * **it is only a wizard while it is a draft**: a sent campaign is a record and
 * `SentCampaign` renders it read-only, because walking four steps through
 * something nobody can change would be a costume.
 *
 * ## Four steps, and the third used to be the preview
 *
 * Item 8 folds it into `content`. `usePreview` is unchanged and is still fetched
 * from the **first** step, because `audience_count` lives on that response and no
 * other route answers "how many people is this?" for an `all` or an `ids`
 * audience; what changed is that the same response now also draws a frame on the
 * compose step instead of a page of its own. `MailPreview.tsx` argues the fold and
 * keeps the retired step's reasoning intact.
 *
 * The one new obligation it creates is `contentChanged` below: a render of the
 * saved campaign now sits under a live form, so the panel owes an honest word
 * about which of the two the frame is showing, and a control that closes the gap
 * without leaving the step.
 *
 * ## The stale marker, and every write carrying its reason
 *
 * §3.7 bites here in both halves: a client component over a react-query cache
 * that writes on every forward move. When the browser is certain it is offline
 * the banner says how old the draft on screen is, and **advance, send and test
 * are all disabled with that same sentence** rather than failing on click.
 */
/**
 * A campaign as the form holds it — **what the server stored, and nothing the
 * panel decided.**
 *
 * Extracted on item 12's branch so that the first paint and every save bind the
 * same way. It was inline in `useState` before, which is why the rebind was easy
 * to leave out: there was no function to call, only an initialiser that had
 * already run.
 *
 * Two properties are load-bearing and both are absences:
 *
 * **No seeding.** The shop's logo reaches a campaign that has never been saved,
 * once, at mount — see the branch in `useState` below. A `draftOf()` that seeded
 * would restore a logo the operator had just cleared, on the save that cleared
 * it, and the form would appear to refuse the edit.
 *
 * **No generation.** `body_html` and `body_text` are copied, never rebuilt from
 * `body_fields`. `handEdited()` exists to compare the two, and a binding that
 * regenerated would make them equal by construction and the flag always false.
 * What comes back from the API is what the API holds, markup stripped and all;
 * that disagreement is the thing this screen now shows rather than hides.
 *
 * `customer_ids` is copied rather than aliased: the draft's array is mutated by
 * the audience picker and the query's row must not move under the cache.
 */
export function draftOf(campaign: Campaign, locale: string): Draft {
  return {
    name: campaign.name,
    subject: campaign.subject,
    body_html: campaign.body_html,
    body_text: campaign.body_text,
    body: readValues(campaign.body_fields, directionFor(locale)),
    audience: {
      type: campaign.audience.type,
      segment_id: campaign.audience.segment_id,
      customer_ids: [...campaign.audience.customer_ids],
    },
  };
}

export function Composer({
  locale,
  initial,
  shopLogo,
  canSendCampaigns,
  canManageCustomers,
}: {
  locale: string;
  initial: Campaign;
  /**
   * The shop's logo, from `GET /settings`, or null.
   *
   * Fetched on the server and softened there, because `/settings` is
   * `ac_manage_settings` — **Super Admin alone**, measured: a Manager holding ten
   * other management capabilities is 403 on both verbs. So this is null for a
   * reader who is not one, and the consequence is exactly that their first campaign
   * starts without the shop's logo in it. Nothing else on the screen changes, which
   * is `page.tsx`'s existing rule for the segment list one fetch below: a failed
   * read costs one field, never the screen.
   *
   * There is no brand colour beside it and none was invented — see `shopLogo()`.
   */
  shopLogo: EmailImage | null;
  /**
   * `ac_manage_marketing` **and** `ac_manage_customers`. Measured: a Marketing
   * Manager is 200 on the campaign and the preview and 403 on send — so the
   * button is rendered disabled with the reason, never hidden.
   */
  canSendCampaigns: boolean;
  /**
   * The second half of the rule above, on its own — because the audience step
   * needs it separately from the send.
   *
   * It decides whether the `ids` audience gets a customer picker or the
   * comma-separated field, and it is **passed down rather than re-derived**, the
   * arrangement `page.tsx` already uses for `canSendCampaigns` and the one
   * ADMIN_PANEL.md asks for.
   */
  canManageCustomers: boolean;
}) {
  const t = useTranslations("campaigns");
  const tStates = useTranslations("states");
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const menuTriggerId = useId();

  const online = useOnline();

  const { data, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["campaigns", initial.id],
    queryFn: async () => {
      const { data } = await acRead<unknown>(`/campaigns/${initial.id}`);
      return campaignSchema.parse(data);
    },
    initialData: initial,
  });

  const campaign = data;

  const [step, setStep] = useState<ComposerStep>("audience");

  /**
   * A blank body for this campaign, and the two things the panel can honestly put
   * in one.
   *
   * `directionFor(locale)` is the direction the form *offers*; it becomes a stored
   * decision the moment the answers are saved, so switching the panel to Arabic
   * afterwards never reflows a body somebody already laid out. `shopLogo` is the
   * other half of sub-task 3 and the only half that exists — the shop publishes no
   * brand colour, so the colour stays empty and `brandColour("")` answers the
   * panel's accent, with the form saying in words that it did.
   *
   * `useMemo` because it seeds `useState` below *and* is handed to `StepContent` for
   * the campaign that composes a form for the first time; a fresh object per render
   * would make the second one a new prop every time.
   */
  const seed = useMemo<EmailValues>(
    () => seededValues(directionFor(locale), shopLogo),
    [locale, shopLogo],
  );

  const [draft, setDraft] = useState<Draft>(() => {
    /*
     * **`null` and `{}` are different claims, and this is the branch.**
     *
     * `readValues()` answers `null` for a campaign whose `body_fields` is null —
     * hand-written HTML, a template, a draft older than the column, or a column that
     * would not parse — and the content step then renders the two text areas, so the
     * panel can never regenerate an empty message over a body somebody wrote. A
     * campaign whose answers are `{}` gets `emptyValues()`, which is the form, blank.
     *
     * The seed's branding is applied only to the *blank* case, and only when the
     * campaign has no body yet. A saved campaign's answers are its answers: a logo
     * cleared on purpose must not come back because the shop still has one.
     *
     * **The seeding is this branch and never `draftOf()`'s**, which is what makes
     * the rebind below safe. `draftOf()` states what the server holds and nothing
     * else; branding a campaign the shop has never saved is a decision taken once,
     * at the first paint, by the reader who opened an empty draft. A rebind that
     * re-seeded would put a cleared logo back every time somebody pressed save.
     */
    const bound = draftOf(initial, locale);
    const blank =
      bound.body !== null &&
      initial.body_html.trim() === "" &&
      initial.body_text.trim() === "";

    if (!blank) return bound;

    /*
     * The seeded body is **generated as well as seeded**, and skipping that is a
     * bug rather than an optimisation: `handEdited()` compares the stored bodies
     * against what the answers generate, so a seed carrying a logo beside two empty
     * bodies would report a hand edit on a campaign nobody has touched. Generating
     * here keeps the two sides equal from the first paint. With no shop logo the
     * seed is `emptyValues()` and `buildEmail()` answers two empty strings, so this
     * changes nothing and `furthestStep()` still holds the wizard at `content`.
     */
    const seeded = buildEmail(seed);

    return { ...bound, body: seed, body_html: seeded.html, body_text: seeded.text };
  });
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /**
   * What the last save corrected, for the sentence item 9 owes the operator.
   *
   * **Reset on every save, including to `[]`.** The notice describes the save the
   * person just made, not a correction accumulated across a session — a sentence
   * about a repair still standing three saves later, after the text it named has
   * been rewritten twice, is a claim about a state nobody is in.
   *
   * Not derived the way `handEdited()` is, and the difference is instructive.
   * That flag can be recomputed because the answers and the bodies are both
   * stored and disagreeing is a property of the pair. A repair leaves *no*
   * disagreement behind — that is the point of it — so once it lands there is
   * nothing left to recompute from. It is an event, and an event has to be held.
   */
  const [repairs, setRepairs] = useState<TokenRepair[]>([]);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [refusal, setRefusal] = useState<{ kind: string; message: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /**
   * **One `id → {email, name, consent}` map**, and coupons' defect #2 is why it is
   * here rather than inside the audience step.
   *
   * That form rendered its ids from the draft and their names from the last
   * *saved* response, so adding a product to a coupon that already had one showed
   * the old name beside the new count. The fix was one map, seeded from what was
   * saved and extended by every picker commit — and the lesson beside it: **a flag
   * is an API fact, never a fallback.** An id in neither source renders as its id
   * and claims nothing.
   *
   * It lives in this component because `StepAudience` unmounts on every step
   * change, and a person who picks nine customers, walks to the preview and comes
   * back must not watch nine addresses resolve again — the per-id query cache
   * would answer without a request, but the map is the thing that is rendered and
   * it has to survive.
   *
   * `learn` returns the previous map **by identity** when it is handed nothing
   * new, so React bails out of the re-render. That is what keeps the effect that
   * feeds it from being a loop.
   */
  const [known, setKnown] = useState<ReadonlyMap<number, CustomerRef>>(() => new Map());

  const learn = useCallback((rows: readonly CustomerRef[]) => {
    setKnown((previous) => {
      const next = new Map(previous);
      let changed = false;
      for (const row of rows) {
        const held = previous.get(row.id);
        if (
          held === undefined ||
          held.email !== row.email ||
          held.name !== row.name ||
          held.consent !== row.consent
        ) {
          next.set(row.id, row);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, []);

  /*
   * The preview is a server render of the **saved** campaign, and it is fetched
   * from the first step rather than the third — because `audience_count` lives on
   * it and there is no other route that answers "how many people is this?" for an
   * `all` or an `ids` audience. (`/segments/{id}/preview` counts a segment, which
   * is only one of the three.)
   *
   * The first version gated this to `preview` onwards and the audience step had
   * no count at all — the one number that step exists to show. The e2e test found
   * it; nothing in the types could have.
   *
   * The consequence is that the count describes the **saved** audience, so a
   * change made and not yet advanced past leaves it a step behind. That is stated
   * rather than hidden: `audienceChanged` marks it, and advancing saves and
   * refetches.
   */
  const preview = usePreview(campaign.id, true);
  const count = preview.data?.audience_count ?? null;
  const countKnown = preview.data ? hasAudienceCount(preview.data) : false;

  const audienceChanged =
    draft.audience.type !== campaign.audience.type ||
    draft.audience.segment_id !== campaign.audience.segment_id ||
    draft.audience.customer_ids.join(",") !== campaign.audience.customer_ids.join(",");

  /*
   * The same claim `audienceChanged` makes, about the three fields the **render**
   * is built from.
   *
   * `name` is deliberately not among them: it is the shop's label for the campaign
   * and reaches no part of the message, so a renamed draft is not a stale preview.
   * The subject is, because `TemplateRenderer::render()` substitutes it alongside
   * both bodies and the frame shows the resolved result.
   *
   * Compared against `campaign` — the row the preview was rendered from — and not
   * against a snapshot taken at the last save. `MailPreviewState.stale` argues the
   * difference; the short version is that this answers *does the frame show what
   * the form says*, which is the question somebody looking at the frame is asking.
   */
  const contentChanged =
    draft.subject !== campaign.subject ||
    draft.body_html !== campaign.body_html ||
    draft.body_text !== campaign.body_text;

  /* The fifth state's second half: when the browser is certain it is offline the
     draft on screen is as old as the last fetch, and every write control says so
     rather than failing on click. */
  const blocked = online ? null : tStates("offlineWrites");

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setFieldErrors({});

    /*
     * **Item 9: `{{first name}}` is corrected here, before anything is sent, and
     * the operator is told.**
     *
     * `TemplateRenderer::PATTERN` requires `[a-z0-9_]` between the braces, so a
     * space makes the pair match nothing — not substituted, and *not reported in
     * `unknown_tokens` either*, because that list is built by scanning with the
     * same pattern. It mails verbatim, braces and all. `repairTokens()` argues
     * the rule at length; the short version is that it only ever corrects onto
     * one of the five real tokens and leaves everything else exactly as typed.
     *
     * **Both sides, in one act.** The bodies and the answers are repaired
     * together — `repairValues()` says why: repairing only the HTML would lose
     * the fix on the next regeneration and would make `handEdited()` report an
     * edit nobody made. The two stay consistent because generating a repaired
     * answer and repairing a generated body produce the same bytes, which
     * `email-body.test.ts` pins rather than assumes.
     *
     * **On save rather than on keystroke**, which is decision 4's "automatic, not
     * silent" read the way the rest of this panel reads it: rewriting somebody's
     * text while they are still typing it is how a form fights its user, and
     * `{{first` is malformed at every intermediate keystroke of a token being
     * typed correctly.
     *
     * The draft is set to the repaired values **before** the request rather than
     * after it, so a save that then fails leaves the correction on screen. The
     * correction is right whether or not the write landed.
     */
    const subject = repairTokens(draft.subject);
    const body = draft.body === null ? null : repairValues(draft.body);

    /*
     * **Regenerate where regenerating is allowed, then repair what is left**, and
     * the order is not interchangeable — a test pins the one case that proves it.
     *
     * Repairing the two bodies as *text* is not equivalent to repairing the
     * answers and generating from them, because one field is validated on the way
     * through rather than copied: `safeHref()` drops a call-to-action whose href
     * is not `http(s)`, `mailto:` or a **well formed** merge token. So a CTA
     * pointing at `{{unsubscribe url}}` is not a button with a broken link — the
     * whole block is absent from the generated HTML. Text-repairing that HTML
     * finds nothing to fix and the button stays gone, while the answers now hold
     * a good href. The two disagree, and `handEdited()` correctly reports an edit
     * nobody made: item 12's defect, manufactured by item 9.
     *
     * `nextBodies()` is the existing rule and it is exactly the one needed here —
     * *regenerate only while the bodies still match the answers.* A form-driven
     * campaign nobody has hand-edited gets its bodies rebuilt from the repaired
     * answers, which is the only thing that can bring that button back. A
     * hand-edited one keeps its bodies untouched, because a repair must not do
     * what Undo asks permission for.
     *
     * The `repairTokens()` pass after it is then a no-op on anything regenerated
     * — repairs are a fixed point, which `merge-tags.test.ts` asserts — and is
     * the actual correction for the two cases regeneration cannot reach: a
     * hand-edited body, and a campaign with no answers at all whose HTML somebody
     * wrote themselves.
     */
    const regenerated =
      draft.body === null || body === null
        ? { html: draft.body_html, text: draft.body_text }
        : nextBodies(draft.body, body.values, draft.body_html, draft.body_text);

    const html = repairTokens(regenerated.html);
    const text = repairTokens(regenerated.text);

    const repaired: Draft = {
      ...draft,
      subject: subject.text,
      body_html: html.text,
      body_text: text.text,
      body: body?.values ?? null,
    };
    const madeRepairs = mergeRepairs([
      ...subject.repairs,
      ...(body?.repairs ?? []),
      ...html.repairs,
      ...text.repairs,
    ]);

    if (madeRepairs.length > 0) setDraft(repaired);
    setRepairs(madeRepairs);

    try {
      await acWrite("PATCH", `/campaigns/${campaign.id}`, {
        name: repaired.name,
        subject: repaired.subject,
        body_html: repaired.body_html,
        body_text: repaired.body_text,
        /*
         * **Only ever an object, never `null`.**
         *
         * `null` on this field means *clear the answers*, and the composer has no
         * act that means that: a campaign that reaches the form keeps its answers
         * for good, and one that never had any is left alone rather than written
         * with an empty document it did not ask for. Omitting the key leaves the
         * column untouched — `Campaign::with()` uses `array_key_exists` rather than
         * `??` for exactly this, `Campaign.php:228` — so a hand-written campaign
         * being edited on this screen keeps reading `null` and keeps opening the
         * HTML editor on the next visit.
         *
         * Only write fields go on the wire. Campaigns have no silently-dropped
         * read-only list the way products do; `CampaignInput::REFUSED` is fifteen
         * keys that answer **400**, and everything unknown answers 400 too — so
         * echoing the read body back would be a refusal rather than a no-op.
         */
        ...(repaired.body === null ? {} : { body_fields: writeValues(repaired.body) }),
        audience_type: repaired.audience.type,
        ...(repaired.audience.type === "segment"
          ? { segment_id: repaired.audience.segment_id }
          : {}),
        ...(repaired.audience.type === "ids"
          ? { customer_ids: repaired.audience.customer_ids }
          : {}),
      });

      /*
       * **The draft is rebound to what the server stored**, and until this round
       * it was not — which is the defect step 7 recorded and item 12 is here to
       * close.
       *
       * `CampaignInput` sanitises on the way in. `body_fields` string values that
       * look like markup come back with the markup gone (`EmailHtml::sanitize()`,
       * read from source at `Campaigns/EmailHtml.php`), so a paragraph containing
       * `<b>` was stored one way and held in the form another. Nothing on screen
       * said so. The disagreement surfaced only on the *next* load — where
       * `handEdited()` correctly reported a hand edit nobody had made, because it
       * regenerates from the answers and compares against the stored bodies, and
       * the stored bodies were no longer what these answers generate.
       *
       * ## Rebound to the re-read, not to the PATCH response
       *
       * `SettingsForm.save()` rebinds to the response and says why; this rebinds
       * to the `refetch()` that was already here, and the reason is `MailPreview`
       * rather than a preference. `contentChanged` compares this draft against
       * `campaign` — the query's row, which is also the row the preview was
       * rendered from — and the frame's stale marker is that comparison. Binding
       * the form to one read and the marker's other side to a different one makes
       * "the frame shows what the form says" a claim about two fetches that can
       * disagree. One read, both sides, and the marker cannot lie.
       *
       * It costs nothing that was not already being spent: the `GET` was here
       * before this change, and `PATCH /campaigns/{id}` answering the whole
       * campaign (`CampaignController::update()` returns `->toArray()`, read from
       * source) is what makes either option available at all.
       *
       * ## A failed re-read leaves the draft alone
       *
       * `refetch()` can answer without data — offline, or a 403 arriving between
       * the write and the read. The write still succeeded, so this returns `true`
       * either way; what it must not do is blank the form on a read that failed.
       * The draft then still holds what was sent, which is the state this screen
       * was in before this change and is honest rather than empty.
       */
      const { data: stored } = await refetch();
      if (stored) setDraft(draftOf(stored, locale));

      await client.invalidateQueries({ queryKey: ["campaigns", campaign.id, "preview"] });
      await client.invalidateQueries({ queryKey: ["campaigns", "list"] });
      return true;
    } catch (thrown) {
      const apiError = thrown as BrowserApiError;
      /*
       * **A 400 lists every bad field at once**, and each binds to its own
       * control — so the errors are kept whole rather than flattened to the first
       * message. `lib/api/browser.ts` preserves `details.fields` for exactly this.
       */
      setFieldErrors(apiError.fields ?? {});
      if (!apiError.fields) toast.show(apiError.message, "danger");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const advance = async () => {
    const target = nextStep(step);
    if (!target) return;
    // Saved before moving on, so the preview two steps later is of what the
    // server holds. A failed save keeps the person on the step that failed.
    if (await save()) setStep(target);
  };

  const send = async () => {
    setSending(true);
    setRefusal(null);
    try {
      const { data } = await acWriteWithMeta<unknown>("POST", `/campaigns/${campaign.id}/send`);
      setOutcome(sendOutcome(sendResult.parse(data)));
      await refetch();
      await client.invalidateQueries({ queryKey: ["campaigns", "list"] });
    } catch (thrown) {
      const apiError = thrown as BrowserApiError;
      const kind = classifySendRefusal(apiError.status, apiError.code, apiError.details);
      /*
       * **The panel's own sentence wherever the panel has one**, and the API's
       * English only where it does not. All four named refusals are mirrored in
       * `campaigns.sendStep.*`, so the fifth — a refusal nobody has seen — is the
       * only path that renders the provider's words, and `Notice` carries them as
       * its title rather than as a translated generic that throws the actionable
       * half away. That is the analytics branch's rule, arriving here for the
       * sixth time in this run.
       */
      setRefusal({
        kind,
        message:
          kind === "mail"
            ? t("sendStep.refusedMail")
            : kind === "already"
              ? t("sendStep.refusedAlready")
              : kind === "nobody"
                ? t("sendStep.refusedNobody")
                : kind === "forbidden"
                  ? t("sendStep.refusedForbidden")
                  : apiError.message,
      });
      // A refusal is a real state of the campaign, so the row is re-read: the
      // already-sent case means somebody else sent it while this tab was open.
      if (kind === "already") await refetch();
    } finally {
      setSending(false);
    }
  };

  const deleteDraft = async () => {
    setDeleting(true);
    try {
      await acWrite("DELETE", `/campaigns/${campaign.id}`);
      await client.invalidateQueries({ queryKey: ["campaigns"] });
      router.push(`/${locale}/marketing/campaigns`);
    } catch (thrown) {
      // A cancelled or sent campaign answers 409 here — "Only a draft can be
      // deleted." The action is not offered in those states, but the race is real
      // and the API's own sentence is the right thing to show.
      toast.show((thrown as BrowserApiError).message, "danger");
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const back = { href: `/${locale}/marketing/campaigns`, label: t("campaigns") };

  if (isError) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader title={campaign.name} back={back} divided={false} />
        <PageBody width="detail">
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        </PageBody>
      </div>
    );
  }

  const current = stepIndex(step);
  const furthest = stepIndex(furthestStep(draft));
  const atEnd = step === "send";
  const forwardAllowed = canAdvance(step, draft);

  /*
   * The summary, and the reason every control in `Steps.tsx` names its own id.
   *
   * A 400 can name a field this form does not render on the step somebody is
   * standing on — or one the API grew — and an orphan still has to be readable,
   * or a person sees a refusal with no cause anywhere on screen. Those render as
   * **text** rather than as a link, per §3.4: there is nowhere to send them.
   */
  const LABELLED: Record<string, { id: string; label: string }> = {
    name: { id: FIELD_IDS.name, label: t("field.name") },
    subject: { id: FIELD_IDS.subject, label: t("field.subject") },
    body_html: { id: FIELD_IDS.body_html, label: t("field.bodyHtml") },
    body_text: { id: FIELD_IDS.body_text, label: t("field.bodyText") },
    /*
      Four of the five refusals on this field are unreachable from a form that
      emits eight fixed short keys nested three deep — see `body-fields.ts`. The
      fifth is not: `paragraphs` is unbounded and the cap is 65_536 bytes of
      encoded JSON, so the failure is a person pasting something very large. It
      binds to the HTML body's control, which is the nearest thing on screen to
      "the message is too big"; there is no single control the whole document
      belongs to.
    */
    body_fields: { id: FIELD_IDS.body_html, label: t("field.bodyFields") },
    segment_id: { id: FIELD_IDS.segment_id, label: t("field.segment") },
    customer_ids: { id: FIELD_IDS.customer_ids, label: t("audience.ids") },
  };

  const failures: FormFailure[] = Object.entries(fieldErrors).map(([key, message]) => {
    const known = LABELLED[key];
    return known === undefined ? { message } : { id: known.id, label: known.label, message };
  });

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        /* `dir="auto"` is `PageHeader`'s — the title is the record's own name. */
        title={draft.name || t("create")}
        back={back}
        divided={false}
        actions={
          canDelete(campaign) ? (
            <Menu
              label={t("actionsFor", { name: campaign.name })}
              trigger={
                <IconButton
                  id={menuTriggerId}
                  label={t("actionsFor", { name: campaign.name })}
                  icon="more"
                  variant="secondary"
                />
              }
              actions={[
                {
                  key: "delete",
                  label: t("deleteAction"),
                  icon: "trash",
                  destructive: true,
                  disabled: blocked !== null,
                  onSelect: () => setDeleteOpen(true),
                },
              ]}
            />
          ) : null
        }
        toolbar={
          <StepIndicator
            steps={COMPOSER_STEPS.map((key) => ({ key, label: t(`step.${key}`) }))}
            current={current}
            furthest={furthest}
            onGoTo={(index) => setStep(COMPOSER_STEPS[index])}
            label={t("stepsLabel")}
          />
        }
      />

      <PageBody width="detail">
        {!online && dataUpdatedAt > 0 ? (
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
        ) : null}

        <div className="flex flex-col gap-4">
          <ErrorSummary failures={failures} />

          {step === "audience" ? (
            <StepAudience
              draft={draft}
              onChange={setDraft}
              count={count}
              countKnown={countKnown}
              stale={audienceChanged}
              disabled={saving}
              fieldErrors={fieldErrors}
              canManageCustomers={canManageCustomers}
              known={known}
              onLearn={learn}
            />
          ) : step === "content" ? (
            <StepContent
              draft={draft}
              onChange={setDraft}
              disabled={saving}
              fieldErrors={fieldErrors}
              seed={seed}
              repairs={repairs}
              preview={{
                preview: preview.data ?? null,
                loading: preview.isPending,
                stale: contentChanged,
                refreshing: saving,
                blocked,
                /*
                 * **Refresh is `save()` and nothing else**, which is the whole
                 * reason this is honest rather than a second write path: the
                 * render is of what the server holds, so the only way to move it
                 * is to store what is on screen. `save()` already PATCHes,
                 * refetches the campaign and invalidates the preview query — the
                 * exact three things a forward move does, minus the move.
                 *
                 * A control that saves without advancing is not the `SaveBar`
                 * §3.4 refuses this form: that rule is about a *sticky* bar
                 * reporting accumulated dirty state across a whole screen, and
                 * this is one card's action with one visible effect, in the card
                 * whose contents it changes.
                 */
                onRefresh: () => void save(),
              }}
            />
          ) : step === "test" ? (
            <StepTest campaignId={campaign.id} blocked={blocked} />
          ) : (
            <StepSend
              count={count}
              countKnown={countKnown}
              canSendCampaigns={canSendCampaigns && canSend(campaign)}
              pending={sending}
              outcome={outcome}
              refusal={refusal}
              blocked={blocked}
              onSend={() => void send()}
            />
          )}

          {/*
            The step navigation, at the end of the content rather than pinned.
            §3.4's *first* footer — "actions pin to the bottom of the form" —
            because there is no accumulated dirty state for the sticky one to
            report: each forward move is itself the save.

            `Précédent` is always live and never saves; `Continuer` is gated on
            the draft being complete enough for the step after, and says which of
            the two reasons is stopping it.
          */}
          <nav className="flex items-center justify-between gap-3" aria-label={t("stepsLabel")}>
            <Button
              variant="ghost"
              icon="back"
              disabled={previousStep(step) === null}
              title={previousStep(step) === null ? t("atFirstStep") : undefined}
              onClick={() => {
                const target = previousStep(step);
                if (target) setStep(target);
              }}
            >
              {t("back")}
            </Button>

            {!atEnd ? (
              <Button
                variant="primary"
                iconEnd="chevron"
                loading={saving}
                disabled={!forwardAllowed || blocked !== null}
                title={blocked ?? (forwardAllowed ? undefined : t("incompleteStep"))}
                onClick={() => void advance()}
                data-testid="continue"
              >
                {t("continue")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                loading={saving}
                disabled={blocked !== null}
                title={blocked ?? undefined}
                onClick={() => void save()}
              >
                {t("saveAction")}
              </Button>
            )}
          </nav>
        </div>
      </PageBody>

      {/*
        **No type-to-confirm, and §3.1 as amended on the shipping branch is why.**
        The rule asks for the record's identifier on an irreversible act, and a
        campaign's delete is exactly that — there is no trash, the row is gone —
        so the guard would be right if the string were typeable. It is not: a
        campaign's only identifier is its free-text name, and this shop's own
        drafts are called "Soldes d'août — brouillon", with an em dash nobody can
        produce from a keyboard. The content branch's lesson stands — a guard
        nobody can satisfy is a dead end with a text box in it — so the dialog
        names the record instead, the tone stays `danger`, and Cancel takes focus.
      */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(next) => {
          if (!next) setDeleteOpen(false);
        }}
        title={t("deleteConfirm")}
        body={
          <span className="flex flex-col gap-2">
            <span dir="auto" className="text-ui-fg">
              {campaign.name}
            </span>
            <span>{t("deleteConfirmBody")}</span>
          </span>
        }
        confirmLabel={t("deleteAction")}
        loading={deleting}
        onConfirm={() => void deleteDraft()}
        returnFocusTo={menuTriggerId}
      />
    </div>
  );
}
