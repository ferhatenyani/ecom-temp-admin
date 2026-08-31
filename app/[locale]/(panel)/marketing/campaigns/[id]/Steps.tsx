"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import type { Segment } from "@/lib/api/schemas/campaign";
import { campaignPreview, testResult } from "@/lib/api/schemas/campaign";
import type { CustomerRef } from "@/lib/customers";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import {
  AUDIENCE_TYPES,
  MAX_CUSTOMER_IDS,
  audienceProblem,
  consentGap,
  type AudienceType,
} from "@/lib/campaigns";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Select, TextArea, TextField } from "@/components/ui/Form";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { Notice } from "@/components/ui/States";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { ChosenCustomers, CustomerPicker, useResolvedCustomers } from "./CustomerPicker";
/*
 * The token vocabulary comes from the **generator** rather than from
 * `lib/campaigns.ts` directly, and that is the generator's own instruction: it
 * re-exports `TOKENS` as `MERGE_TOKENS` beside `insertToken()` so the list a person
 * can insert and the list the renderer substitutes cannot drift apart. A sixth name
 * offered here would produce a token that renders *empty* and a warning nobody
 * caused.
 */
import {
  MERGE_TOKENS,
  buildEmail,
  insertToken,
  tokenLiteral,
  type EmailValues,
} from "./email-body";
import { handEdited, nextBodies } from "./body-fields";
import { BODY_IDS, BodyForm } from "./BodyForm";
import { MailPreview, type MailPreviewState } from "./MailPreview";

/**
 * The composer's four steps, each a module-level component.
 *
 * **Four, and it was five.** `StepPreview` is gone — item 8 folds the render into
 * the compose step, where the body it is a render *of* is being written. The call
 * it made is untouched and so is everything the call answers: the token warning,
 * the resolved subject, the unsubscribe note and the sample recipient all moved
 * across into `MailPreview.tsx`, which also carries the retired step's own
 * argument for showing source rather than a render, and the reason that argument
 * no longer wins.
 *
 * **Not nested inside `Composer`**, and that is a rule this codebase learned the
 * hard way: a component declared inside another gets a new identity on every
 * parent render, so React remounts it and its `useState` is discarded. The
 * notifications branch shipped that bug in a retry panel and the e2e test caught
 * it only as a race. Three of these steps hold state.
 *
 * Every field carries a DOM `id`, because a 400 lists every bad field at once and
 * `ErrorSummary` in `Composer` links each failure to the control it belongs to —
 * §3.4, and the reason the ids are literals rather than generated.
 */

export type Draft = {
  name: string;
  subject: string;
  body_html: string;
  body_text: string;
  /**
   * The composer form's answers, or `null` for *this campaign has no answers*.
   *
   * The `body_fields` branch, carried in the draft rather than re-read from the
   * campaign on every render: `null` opens the two text areas and anything else
   * opens the form. `body-fields.ts` argues both states; the short version is that
   * `null` means hand-written HTML the panel must never regenerate over, and `{}`
   * means the form was used and every answer is blank.
   */
  body: EmailValues | null;
  audience: { type: string; segment_id: number; customer_ids: number[] };
};

/** One place naming the controls, so `Composer`'s summary and these agree. */
export const FIELD_IDS = {
  name: "campaign-name",
  subject: "campaign-subject",
  body_html: "campaign-body-html",
  body_text: "campaign-body-text",
  segment_id: "campaign-segment",
  customer_ids: "campaign-ids",
} as const;

/* ------------------------------------------------------------- 1. audience --- */

/**
 * Who the campaign goes to — a **definition**, never a list of addresses.
 *
 * The consent note is the point of the step. Every audience is filtered to
 * consenting customers *by the resolver*, including a list named id by id, so the
 * number chosen and the number mailed are different and the second is the only
 * one that matters. Saying it here rather than at the send is deliberate: at the
 * send it reads as an excuse for a small number.
 */
export function StepAudience({
  draft,
  onChange,
  count,
  countKnown,
  stale,
  disabled,
  fieldErrors,
  canManageCustomers,
  known,
  onLearn,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  /** The eligible count from the preview, once it is known. */
  count: number | null;
  countKnown: boolean;
  /** The audience has been edited and not yet saved, so the count is a step behind. */
  stale: boolean;
  disabled: boolean;
  fieldErrors: Record<string, string>;
  /**
   * `ac_manage_customers`, passed down rather than re-derived here — the
   * arrangement `page.tsx` already uses for `canSendCampaigns`.
   *
   * It decides whether the `ids` audience gets a **picker** or the
   * comma-separated field. §3.3: a control that cannot act is not rendered, and
   * `/customers` is a 403 without it. Not a workaround — the same reader is 403 on
   * `send` too, so nobody who could finish this task loses anything.
   */
  canManageCustomers: boolean;
  /** The one id → customer map, held by `Composer` so it survives a step change. */
  known: ReadonlyMap<number, CustomerRef>;
  onLearn: (rows: readonly CustomerRef[]) => void;
}) {
  const t = useTranslations("campaigns");
  const problem = audienceProblem(draft.audience);

  const { data: segments } = useQuery({
    queryKey: ["segments", "picker"],
    queryFn: async () => (await acRead<Segment[]>("/segments?per_page=100")).data,
    // Only fetched when it can be used. A Marketing Manager can read the list;
    // it is a segment's *count* that needs the second capability.
    enabled: draft.audience.type === "segment",
  });

  const ids = draft.audience.customer_ids;
  const gap = consentGap(draft.audience.type === "ids" ? ids.length : null, count);

  return (
    <>
      <Card title={t("section.audience")} footnote={t("audienceStep.consentNote")}>
        <div className="flex flex-col gap-4">
          <Select<AudienceType>
            label={t("audienceLabel")}
            value={
              (AUDIENCE_TYPES as readonly string[]).includes(draft.audience.type)
                ? (draft.audience.type as AudienceType)
                : "all"
            }
            onChange={(type) =>
              onChange({
                ...draft,
                // Cleared on switch, so a segment left behind cannot travel with
                // an `all` audience and be resurrected by a later edit.
                audience: { type, segment_id: 0, customer_ids: [] },
              })
            }
            options={AUDIENCE_TYPES.map((value) => ({ value, label: t(`audience.${value}`) }))}
            disabled={disabled}
          />

          {draft.audience.type === "segment" ? (
            <Select<string>
              id={FIELD_IDS.segment_id}
              label={t("field.segment")}
              value={String(draft.audience.segment_id || "")}
              onChange={(value) =>
                onChange({
                  ...draft,
                  audience: { ...draft.audience, segment_id: Number(value) || 0 },
                })
              }
              options={[
                { value: "", label: t("segmentNone") },
                ...(segments ?? []).map((segment) => ({
                  value: String(segment.id),
                  label: segment.name,
                })),
              ]}
              error={
                fieldErrors.segment_id ??
                (problem === "segment_missing" ? t("audienceStep.segmentMissing") : undefined)
              }
              disabled={disabled}
            />
          ) : null}

          {/*
            **Two controls for one value, and the capability picks between them.**

            §15 recorded the picker as unbuildable because `/customers` needs
            `ac_manage_customers`, "so it would be empty for the one role whose job
            this is". That was wrong: `canSendCampaigns()` is *both* capabilities,
            so the reader who lacks the second is 403 on `send` as well and could
            never have finished the task either way. The reader who *can* finish it
            necessarily holds it and can read `/customers`.

            So the picker ships, and §3.3 decides who sees it — a control that
            cannot act is not rendered. Without the capability the comma-separated
            field stays exactly as it was, hint and all: it is not a downgrade,
            it is the only control that reader could ever have used.
          */}
          {draft.audience.type === "ids" ? (
            canManageCustomers ? (
              <AudienceIds
                ids={ids}
                known={known}
                onLearn={onLearn}
                onChange={(customer_ids) =>
                  onChange({ ...draft, audience: { ...draft.audience, customer_ids } })
                }
                disabled={disabled}
                error={
                  fieldErrors.customer_ids ??
                  (problem === "ids_missing"
                    ? t("audienceStep.idsMissing")
                    : problem === "too_many_ids"
                      ? t("audienceStep.tooManyIds")
                      : undefined)
                }
              />
            ) : (
              <TextField
                id={FIELD_IDS.customer_ids}
                label={t("audience.ids")}
                /*
                 * A comma-separated list of ids, `isolate` so it reads left to
                 * right in Arabic — it is a sequence of identifiers, not prose.
                 */
                value={ids.join(", ")}
                onChange={(value) =>
                  onChange({
                    ...draft,
                    audience: {
                      ...draft.audience,
                      customer_ids: value
                        .split(",")
                        .map((part) => Number.parseInt(part.trim(), 10))
                        .filter((id) => Number.isFinite(id) && id > 0)
                        .slice(0, MAX_CUSTOMER_IDS + 1),
                    },
                  })
                }
                isolate
                inputMode="numeric"
                /*
                 * **The reader of this field cannot look a customer up**, and the
                 * copy says so without naming a screen they cannot open. It is the
                 * same sentence it has always been; what changed is that it is now
                 * scoped to the one reader it is true for.
                 */
                hint={t("audienceStep.idsHint")}
                error={
                  fieldErrors.customer_ids ??
                  (problem === "ids_missing"
                    ? t("audienceStep.idsMissing")
                    : problem === "too_many_ids"
                      ? t("audienceStep.tooManyIds")
                      : undefined)
                }
                disabled={disabled}
              />
            )
          ) : null}
        </div>
      </Card>

      <Card
        title={t("field.recipients")}
        /*
          The count is of the **saved** audience, so an edit not yet advanced past
          leaves it a step behind. Said rather than hidden — a number that silently
          describes something else is worse than a number labelled as old.
        */
        footnote={stale ? t("audienceStep.stale") : undefined}
      >
        {countKnown ? (
          <DataList>
            <DataRow label={t("audienceStep.eligibleLabel")}>
              <span
                className={stale ? "text-ui-subtle" : "text-ui-fg"}
                data-testid="eligible"
              >
                <Isolate numeric>{t("audienceStep.eligible", { count: count ?? 0 })}</Isolate>
              </span>
            </DataRow>
            {/*
              The gap, and only when there is one. For `all` and for a segment the
              panel has no honest "selected" figure — only the server knows the
              pre-consent count — so this appears exactly where it is true.
            */}
            {gap ? (
              <DataRow label={t("audienceStep.gapLabel")} stacked>
                <span data-testid="consent-gap">
                  <Isolate numeric>{t("audienceStep.gap", gap)}</Isolate>
                </span>
              </DataRow>
            ) : null}
          </DataList>
        ) : (
          /*
            **`audience_count` is null, not zero, for a caller who cannot read
            customers.** Rendering a zero would say "nobody"; this says whose
            permission it is. The rest of the composer still works for them.
          */
          <p className="flex items-start gap-2 text-ui-label text-ui-muted">
            <Icon name="lock" className="mt-0.5 size-4 shrink-0 text-ui-subtle" />
            {t("audienceStep.countHidden")}
          </p>
        )}
      </Card>
    </>
  );
}

/**
 * The `ids` audience for a reader who **can** look a customer up.
 *
 * A module-level component rather than a branch inside `StepAudience`, for this
 * file's own stated reason and one more: a component declared inside another gets
 * a new identity on every parent render, and this one holds the picker's open
 * state — but also, the per-id resolution below is a `useQueries` whose length
 * follows the audience, and it must not run at all for an `all` or a `segment`
 * campaign. Rendering it only under `type === "ids"` is what guarantees that.
 *
 * The list of chosen people is the control. The comma-separated field is gone for
 * this reader — a text box of primary keys beside a picker that can express every
 * value it can is two controls for one field, and the panel has spent three
 * branches removing exactly that shape.
 */
function AudienceIds({
  ids,
  known,
  onLearn,
  onChange,
  disabled,
  error,
}: {
  ids: readonly number[];
  known: ReadonlyMap<number, CustomerRef>;
  onLearn: (rows: readonly CustomerRef[]) => void;
  onChange: (ids: number[]) => void;
  disabled: boolean;
  error: string | undefined;
}) {
  const t = useTranslations("campaigns");
  const [open, setOpen] = useState(false);

  /*
   * The saved ids, resolved one request each — there is no batch route, and
   * `query.ts` beside `RESOLVED_CUSTOMER_LIMIT` carries the measurement. The
   * results feed the one map rather than being rendered from directly, so the
   * rows the *picker* just handed over and the rows the API answered are the same
   * source by the time anything draws them.
   */
  const resolved = useResolvedCustomers(ids, !disabled);

  /*
   * `onLearn` merges and returns the previous map unchanged when it learns
   * nothing new, so React bails out of the re-render and this cannot loop. Keyed
   * on the row count rather than on the array, which is fresh every render.
   */
  useEffect(() => {
    if (resolved.rows.length > 0) onLearn(resolved.rows);
  }, [resolved.rows, onLearn]);

  return (
    <div className="flex flex-col gap-2">
      {/*
        **`audienceIds`, not `audience.ids`.** The first draft labelled this list
        "Des clients choisis" — which is the word the `Select` directly above it
        is already showing as its own value, so the screen said the same phrase
        twice in forty pixels. `audienceIds` is the plural count the campaigns
        list already uses for this audience ("17 clients choisis"), so the heading
        names the group *and* carries the number, and its `=0` case is the empty
        state: "Aucun client choisi", with the button under it.
      */}
      <p className="text-ui-label text-ui-fg">
        <Isolate numeric>{t("audienceIds", { count: ids.length })}</Isolate>
      </p>

      {ids.length === 0 ? null : (
        <ChosenCustomers
          ids={ids}
          known={known}
          dropped={resolved.dropped}
          pending={resolved.pending}
          disabled={disabled}
          onRemove={(id) => onChange(ids.filter((value) => value !== id))}
        />
      )}

      <div>
        <Button
          /*
            **The id `ErrorSummary` links `customer_ids` to.** A 400 names the
            field and the summary sends focus to `document.getElementById` — so
            when the picker replaces the text field, the *trigger* has to inherit
            the id or a refusal on this field would link nowhere. It is also what
            focus returns to when the drawer closes.
          */
          id={FIELD_IDS.customer_ids}
          variant="secondary"
          icon="customers"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {t("audienceStep.choose")}
        </Button>
      </div>

      {/* The field's own refusal, in the place a `TextField`'s error would be —
          `audienceProblem()`'s two, or whatever the 400 named. */}
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-ui-label text-ui-danger-fg">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{error}</span>
        </p>
      ) : null}

      <CustomerPicker
        open={open}
        onOpenChange={setOpen}
        selected={ids}
        returnFocusTo={FIELD_IDS.customer_ids}
        onCommit={(next, learned) => {
          /* Learned **before** the ids change, so the rows are already in the map
             when the list re-renders against the new audience. Otherwise a
             freshly-picked customer flashes as a bare id for one paint. */
          onLearn(learned);
          onChange(next);
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------- 2. content --- */

/**
 * The step the branch rebuilt: a form that writes the message, with the message
 * still editable underneath it.
 *
 * ## Two shapes behind one step, chosen by `body_fields` and never by a preference
 *
 * `draft.body === null` is a campaign whose answers were never recorded — hand
 * written HTML, a template, or a draft older than the column — and it gets the two
 * text areas it always had. Anything else gets the form. The panel does not
 * remember a "mode" and offers no switch back to HTML, because there is nothing to
 * switch back *to*: the bodies are editable in both shapes, and in the form shape
 * editing them is exactly what the hand-edit flag is for.
 *
 * The one crossing that *is* offered is the other direction — `composeWithForm`,
 * on a campaign that has no answers — and it asks first, because it replaces a body
 * somebody wrote with one generated from nothing.
 *
 * ## The caret, and why this component owns it
 *
 * Sub-task 6 wants merge tokens "offered as a list to insert rather than typed".
 * Insertion needs a field and a caret, and both belong to controls scattered across
 * two child components — so the step tracks them once, from the `focus` and `blur`
 * events that bubble up through this wrapper, rather than every field taking an
 * `onCaret` prop it has no other use for. `insertToken()` does the string work and
 * says where the caret lands; `TOKEN_FIELDS` below says which ids are targets.
 *
 * ## And now the render, which is what item 8 folded in
 *
 * `MailPreview` goes **after the bodies and before the token list**, which is two
 * decisions rather than an ordering. Sub-task 3 puts `unknown_tokens` "next to the
 * body it belongs to", and the warning is the first thing that component draws —
 * so it lands directly under the text areas whose contents caused it. And the
 * token list stays last because it is a reference and an insert bar for every
 * field above it, including the two bodies; putting the render below it would put
 * the result of the form underneath the form's own toolbox.
 *
 * The step is long now — six cards in the form shape, four when the body was
 * written by hand. That is the trade the fold makes and it is the right way
 * round: scrolling is free, and a second page cost two presses and a save, which
 * is what let somebody reach a send having never seen the warning.
 */
export function StepContent({
  draft,
  onChange,
  disabled,
  fieldErrors,
  seed,
  preview,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  disabled: boolean;
  fieldErrors: Record<string, string>;
  /**
   * Everything the render needs, as one prop.
   *
   * Grouped rather than spread into six, because it is one subsystem with one
   * owner: `Composer` holds the query, knows whether the draft has moved away from
   * what the server rendered, and owns the `save()` that refreshes it. A step that
   * took `previewLoading`, `previewStale`, `previewRefreshing` … would be six
   * chances to pass five of them.
   */
  preview: MailPreviewState;
  /**
   * A blank body for this campaign: the locale's direction, and the shop's logo
   * when `/settings` published one.
   *
   * Passed in rather than built here because both of its halves are the server's to
   * know — `directionFor(locale)` and a `/settings` read that is Super Admin only —
   * and because it is used twice, once by `Composer` when the answers are `{}` and
   * once here when a campaign with no answers is composed for the first time.
   */
  seed: EmailValues;
}) {
  const t = useTranslations("campaigns");

  /**
   * The last token-accepting field to hold focus, and where its caret was.
   *
   * **Remembered at `blur` rather than read at click**, which is what makes the
   * keyboard path work: tabbing from a text area to a token button moves focus, so
   * a control that read `document.activeElement` when pressed would find the button
   * and have nowhere to insert. `blur` fires before `click` and carries the
   * selection as it stood, so both the pointer and the keyboard land on the same
   * two numbers.
   */
  const [caret, setCaret] = useState<Caret | null>(null);
  /**
   * Set by an insert, consumed by the effect below once React has painted.
   *
   * A **ref** rather than a second piece of state, and not for tidiness: writing
   * state inside an effect to clear it is a cascading render, which the lint rule
   * names outright. Nothing renders from this value — it is a message from the
   * click handler to the paint that follows it — so a ref is what it actually is.
   */
  const restore = useRef<Caret | null>(null);

  const remember = (target: EventTarget) => {
    const element = target as HTMLInputElement | HTMLTextAreaElement;
    if (typeof element.id !== "string" || !TOKEN_FIELDS.has(fieldKind(element.id))) return;
    if (typeof element.selectionStart !== "number") return;

    setCaret({
      id: element.id,
      start: element.selectionStart,
      end: element.selectionEnd ?? element.selectionStart,
    });
  };

  /*
   * Focus and the caret are restored **after** React has painted the new value,
   * because setting a selection on a control whose value is about to be replaced
   * puts the caret back at the end. `restore` is cleared in the same pass so this
   * cannot fight a person who has since clicked somewhere else.
   */
  useEffect(() => {
    const target = restore.current;
    if (target === null) return;
    restore.current = null;

    const element = document.getElementById(target.id);
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.focus();
      element.setSelectionRange(target.start, target.end);
    }
  });

  const insert = (token: string) => {
    if (caret === null) return;

    const target = tokenField(draft, caret.id);
    if (target === null) return;

    const { value, caret: at } = insertToken(target.value, caret.start, caret.end, token);
    onChange(target.write(value));
    setCaret({ id: caret.id, start: at, end: at });
    restore.current = { id: caret.id, start: at, end: at };
  };

  return (
    /*
       `onFocus`/`onBlur` on a container, and they reach here because React maps
       them to `focusin`/`focusout`, which bubble — the DOM's own `focus` and `blur`
       do not. That is what lets one listener serve every field in two children
       without threading a callback through both.
    */
    <div
      className="contents"
      onFocus={(event) => remember(event.target)}
      onBlur={(event) => remember(event.target)}
    >
      <Card title={t("section.content")}>
        <div className="flex flex-col gap-4">
          <TextField
            id={FIELD_IDS.name}
            label={t("field.name")}
            value={draft.name}
            onChange={(name) => onChange({ ...draft, name })}
            hint={t("nameHint")}
            error={fieldErrors.name}
            disabled={disabled}
          />
          <TextField
            id={FIELD_IDS.subject}
            label={t("field.subject")}
            value={draft.subject}
            onChange={(subject) => onChange({ ...draft, subject })}
            /*
              **A merge token works here too**, and that is the API's behaviour
              rather than a courtesy: `TemplateRenderer::render()` substitutes the
              subject alongside both bodies, and the preview step already renders a
              resolved one. It is the reason the token list is a step-level control
              rather than a control of the body form.
            */
            hint={t("subjectHint")}
            error={fieldErrors.subject}
            disabled={disabled}
          />
        </div>
      </Card>

      {draft.body === null ? (
        <NoAnswers
          draft={draft}
          onChange={onChange}
          disabled={disabled}
          fieldErrors={fieldErrors}
          seed={seed}
        />
      ) : (
        <>
          <BodyForm
            values={draft.body}
            onChange={(values) => onChange(withValues(draft, values))}
            disabled={disabled}
          />
          <GeneratedBodies
            draft={draft}
            values={draft.body}
            onChange={onChange}
            disabled={disabled}
            fieldErrors={fieldErrors}
          />
        </>
      )}

      {/* The warning and the render, under whichever of the two body shapes is on
          screen — a hand-written body needs the token warning at least as much as
          a generated one, since nothing inserted its tokens for it. */}
      <MailPreview {...preview} />

      {/*
        The tokens. Still listed with their correct spellings — the failure mode is
        a misspelling that renders *empty*, which is invisible in a body that has a
        name in it from another token — and now with the button that makes typing
        one unnecessary, which is what item 8 leans on when it folds the preview
        away.
      */}
      <Card title={t("tokensTitle")} footnote={t("tokensNote")}>
        <DataList>
          {MERGE_TOKENS.map((token) => (
            <DataRow key={token} label={t(`token.${token}`)}>
              <span className="flex flex-wrap items-center justify-end gap-2">
                <Ltr numeric={false} className="font-mono">
                  {tokenLiteral(token)}
                </Ltr>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="plus"
                  disabled={disabled || caret === null}
                  /*
                    §3.3: a disabled control says why. There is no honest default
                    target — see `tokenField()` — so the reason names the fix.
                  */
                  title={caret === null ? t("tokenStep.noField") : undefined}
                  onClick={() => insert(token)}
                  data-testid={`insert-${token}`}
                >
                  {t("tokenStep.insert")}
                </Button>
              </span>
            </DataRow>
          ))}
        </DataList>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------- the token caret --- */

type Caret = { id: string; start: number; end: number };

/**
 * A field id reduced to the thing it names, so a paragraph's index falls out.
 *
 * `campaign-body-paragraph-3` is not a member of a fixed set and cannot be, because
 * the list grows — so the membership test is on the stem and the index is read back
 * out of the tail.
 */
function fieldKind(id: string): string {
  return /^campaign-body-paragraph-\d+$/.test(id) ? "paragraph" : id;
}

/**
 * Every field a merge token may be inserted into.
 *
 * The subject and both bodies, because `TemplateRenderer::render()` substitutes all
 * three; the four body fields that carry prose; and `cta.href`, which is **not** an
 * oversight — a button reading "Se désabonner" pointing at `{{unsubscribe_url}}` is
 * a real campaign and `safeHref()` passes a token through untouched, because `{{` is
 * not a protocol.
 *
 * Alt text is deliberately absent. It is read aloud to somebody who cannot see the
 * picture, and a token that resolves empty there is a description that silently
 * becomes nothing.
 */
const TOKEN_FIELDS = new Set([
  FIELD_IDS.subject,
  FIELD_IDS.body_html,
  FIELD_IDS.body_text,
  BODY_IDS.title,
  "paragraph",
  BODY_IDS.ctaLabel,
  BODY_IDS.ctaHref,
  BODY_IDS.footer,
]);

/**
 * The field behind an id: what it holds now, and the draft that holds the next
 * value.
 *
 * A lookup rather than a `ref` per control, because the values live in the draft and
 * not in the DOM — the element is only ever consulted for its selection. It returns
 * `null` for an id it does not recognise, which is how a stale caret from a control
 * that has since unmounted (a removed paragraph) fails: nothing happens, rather than
 * a token appearing in the wrong field.
 */
function tokenField(
  draft: Draft,
  id: string,
): { value: string; write: (next: string) => Draft } | null {
  if (id === FIELD_IDS.subject) {
    return { value: draft.subject, write: (subject) => ({ ...draft, subject }) };
  }
  if (id === FIELD_IDS.body_html) {
    return { value: draft.body_html, write: (body_html) => ({ ...draft, body_html }) };
  }
  if (id === FIELD_IDS.body_text) {
    return { value: draft.body_text, write: (body_text) => ({ ...draft, body_text }) };
  }

  const values = draft.body;
  if (values === null) return null;

  const paragraph = /^campaign-body-paragraph-(\d+)$/.exec(id);
  if (paragraph) {
    const index = Number(paragraph[1]);
    if (index >= values.paragraphs.length) return null;

    return {
      value: values.paragraphs[index] ?? "",
      write: (next) =>
        withValues(draft, {
          ...values,
          paragraphs: values.paragraphs.map((one, at) => (at === index ? next : one)),
        }),
    };
  }

  if (id === BODY_IDS.title) {
    return { value: values.title, write: (title) => withValues(draft, { ...values, title }) };
  }
  if (id === BODY_IDS.footer) {
    return { value: values.footer, write: (footer) => withValues(draft, { ...values, footer }) };
  }
  if (id === BODY_IDS.ctaLabel || id === BODY_IDS.ctaHref) {
    const label = values.cta?.label ?? "";
    const href = values.cta?.href ?? "";
    const isLabel = id === BODY_IDS.ctaLabel;

    return {
      value: isLabel ? label : href,
      write: (next) =>
        withValues(draft, {
          ...values,
          cta: isLabel ? { label: next, href } : { label, href: next },
        }),
    };
  }

  return null;
}

/**
 * A draft carrying new answers, with the two bodies regenerated **only while they
 * still match the old ones**.
 *
 * The whole of "a field change must not do silently what Undo asks permission for",
 * and it is one call because `nextBodies()` in `body-fields.ts` owns the rule and is
 * tested there rather than through this component.
 */
function withValues(draft: Draft, values: EmailValues): Draft {
  const bodies =
    draft.body === null
      ? { html: draft.body_html, text: draft.body_text }
      : nextBodies(draft.body, values, draft.body_html, draft.body_text);

  return { ...draft, body: values, body_html: bodies.html, body_text: bodies.text };
}

/* ----------------------------------------------------- the two bodies, twice --- */

/**
 * The generated bodies, still editable, with the flag and the Undo beside them.
 *
 * **Sub-task 5 in one card.** The bodies are not read-only and were never going to
 * be: the generator covers the message this form can describe and not the one a
 * shop occasionally needs, and a form that locked the output would make itself the
 * ceiling. So they stay text areas, editing one is a supported act, and the only
 * thing the panel owes is honesty about what that costs — which is that the answers
 * above no longer describe what will be sent.
 *
 * `handEdited()` derives that by regenerating and comparing. It is sound because the
 * generator's output survives `EmailHtml::sanitize()` **byte for byte** — fourteen
 * fixtures, `npm run test:email-roundtrip` — so a difference is a person's doing and
 * never the sanitiser's. Its docblock argues derived against stored at length.
 */
function GeneratedBodies({
  draft,
  values,
  onChange,
  disabled,
  fieldErrors,
}: {
  draft: Draft;
  values: EmailValues;
  onChange: (next: Draft) => void;
  disabled: boolean;
  fieldErrors: Record<string, string>;
}) {
  const t = useTranslations("campaigns");
  const [confirming, setConfirming] = useState(false);
  const undoId = useId();

  const edited = handEdited(values, draft.body_html, draft.body_text);

  const regenerate = () => {
    const built = buildEmail(values);
    onChange({ ...draft, body_html: built.html, body_text: built.text });
    setConfirming(false);
  };

  return (
    <>
      <Card
        title={t("bodyForm.generated")}
        footnote={t("bodyForm.generatedNote")}
        actions={
          <Button
            id={undoId}
            variant="secondary"
            icon="refresh"
            size="sm"
            disabled={disabled || !edited}
            /* Nothing to undo is a reason, not a mystery. */
            title={edited ? undefined : t("bodyForm.undoClean")}
            onClick={() => setConfirming(true)}
            data-testid="undo-body"
          >
            {t("bodyForm.undo")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {edited ? (
            <div data-testid="hand-edited">
              <Notice tone="warning" title={t("bodyForm.handEdited")}>
                <p className="text-ui-label">{t("bodyForm.handEditedWhy")}</p>
              </Notice>
            </div>
          ) : null}

          <TextArea
            id={FIELD_IDS.body_html}
            label={t("field.bodyHtml")}
            value={draft.body_html}
            onChange={(body_html) => onChange({ ...draft, body_html })}
            rows={7}
            error={fieldErrors.body_html}
            disabled={disabled}
          />
          <TextArea
            id={FIELD_IDS.body_text}
            label={t("field.bodyText")}
            value={draft.body_text}
            onChange={(body_text) => onChange({ ...draft, body_text })}
            rows={5}
            /*
              **Authored, never stripped from the HTML**, and that is §85's
              editorial rule rather than the API's: `POST /campaigns` accepts both
              parts empty and answers 201. It is generated from the same answers in
              a second pass rather than derived from the HTML, for the three reasons
              `email-body.ts` records.
            */
            hint={t("bodyTextHint")}
            error={fieldErrors.body_text}
            disabled={disabled}
          />
        </div>
      </Card>

      {/*
        **The warning sub-task 5 asks for, and it is a dialog rather than a
        `title`.** Undo is not destructive in the trash sense — nothing leaves the
        shop — but it is the one control on this step that discards work the person
        cannot get back by pressing it again, and §3.1 puts that behind a
        confirmation. `tone="primary"`: it is a regeneration, not a delete, and
        dressing it in `danger` would spend the colour that a real delete needs two
        cards away.
      */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!next) setConfirming(false);
        }}
        title={t("bodyForm.undoConfirm")}
        body={t("bodyForm.undoConfirmBody")}
        confirmLabel={t("bodyForm.undo")}
        tone="primary"
        onConfirm={regenerate}
        returnFocusTo={undoId}
      />
    </>
  );
}

/**
 * A campaign whose `body_fields` is `null`: the editor it always had, and the one
 * door into the form.
 *
 * The door matters more than it looks. Without it the form would be reachable only
 * by campaigns created after this branch, so every draft this shop already has —
 * and every campaign built from a template — would be permanently on the old
 * screen. With it, `null` stops meaning "you cannot have the form" and starts
 * meaning what the column actually says: nobody has recorded answers for this
 * campaign *yet*.
 *
 * It asks first, and the sentence is specific rather than generic: the body is
 * replaced by one generated from an empty form, so what is on screen now is gone.
 * That is the same act Undo performs and it gets the same guard.
 */
function NoAnswers({
  draft,
  onChange,
  disabled,
  fieldErrors,
  seed,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  disabled: boolean;
  fieldErrors: Record<string, string>;
  seed: EmailValues;
}) {
  const t = useTranslations("campaigns");
  const [confirming, setConfirming] = useState(false);
  const composeId = useId();

  /* The blank body has nothing in it, so `buildEmail()` answers two empty strings
     — which is what keeps `furthestStep()` meaningful, and why the person lands on
     a form that has stopped them advancing rather than on a filled one. */
  const compose = () => {
    const built = buildEmail(seed);
    onChange({ ...draft, body: seed, body_html: built.html, body_text: built.text });
    setConfirming(false);
  };

  const empty = draft.body_html.trim() === "" && draft.body_text.trim() === "";

  return (
    <>
      <Card
        title={t("bodyForm.written")}
        footnote={t("bodyForm.writtenNote")}
        actions={
          <Button
            id={composeId}
            variant="secondary"
            icon="list"
            size="sm"
            disabled={disabled}
            onClick={() => (empty ? compose() : setConfirming(true))}
            data-testid="compose-with-form"
          >
            {t("bodyForm.compose")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <TextArea
            id={FIELD_IDS.body_html}
            label={t("field.bodyHtml")}
            value={draft.body_html}
            onChange={(body_html) => onChange({ ...draft, body_html })}
            rows={7}
            error={fieldErrors.body_html}
            disabled={disabled}
          />
          <TextArea
            id={FIELD_IDS.body_text}
            label={t("field.bodyText")}
            value={draft.body_text}
            onChange={(body_text) => onChange({ ...draft, body_text })}
            rows={5}
            hint={t("bodyTextHint")}
            error={fieldErrors.body_text}
            disabled={disabled}
          />
        </div>
      </Card>

      {/* Skipped entirely when both bodies are blank — a confirmation that guards
          nothing is a dialog somebody learns to dismiss without reading. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!next) setConfirming(false);
        }}
        title={t("bodyForm.composeConfirm")}
        body={t("bodyForm.composeConfirmBody")}
        confirmLabel={t("bodyForm.compose")}
        tone="primary"
        onConfirm={compose}
        returnFocusTo={composeId}
      />
    </>
  );
}

/* ----------------------------------------------------------------- 3. test --- */

/**
 * One copy to one address. **Writes no recipient row**, so a test never appears
 * in the recipient list and cannot be mistaken for a send.
 */
export function StepTest({
  campaignId,
  blocked,
}: {
  campaignId: number;
  /** The offline reason, or null. §3.7's second half: a write says why it cannot. */
  blocked: string | null;
}) {
  const t = useTranslations("campaigns");
  const [to, setTo] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ sent: boolean } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const send = async () => {
    setPending(true);
    setFailure(null);
    setResult(null);
    try {
      const data = await acWrite<unknown>("POST", `/campaigns/${campaignId}/test`, { to });
      setResult(testResult.parse(data));
    } catch (thrown) {
      setFailure((thrown as BrowserApiError).message);
    } finally {
      setPending(false);
    }
  };

  const empty = to.trim() === "";

  return (
    <Card title={t("step.test")} footnote={t("testStep.explain")}>
      <div className="flex flex-col gap-4">
        <TextField
          id="campaign-test-to"
          label={t("testStep.to")}
          value={to}
          onChange={setTo}
          isolate
          inputMode="text"
          error={failure ?? undefined}
        />

        <div>
          <Button
            variant="secondary"
            loading={pending}
            disabled={empty || blocked !== null}
            /* §3.3: a disabled control says why. Two different reasons, and the
               offline one wins because it is the one the person cannot fix by
               typing. */
            title={blocked ?? (empty ? t("testStep.needsAddress") : undefined)}
            onClick={() => void send()}
            data-testid="send-test"
          >
            {t("testStep.action")}
          </Button>
        </div>

        {/*
          **A 200 that may report a failed send.** `sent: false` is not an error —
          the request succeeded and the transport did not — so this is two
          different sentences rather than an error state. On a shop with no
          reachable mail server it is always the second, and saying why is what
          stops it reading as a broken button.
        */}
        {result ? (
          <div data-testid="test-result">
            <Notice
              tone={result.sent ? "success" : "warning"}
              title={result.sent ? t("testStep.delivered") : t("testStep.refused")}
            >
              {result.sent ? null : (
                <p className="text-ui-label">{t("testStep.refusedWhy")}</p>
              )}
            </Notice>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------------- 4. send --- */

/**
 * The irreversible step, and the one place this screen could mislead.
 *
 * **`send` sends nothing.** It resolves the audience, freezes it as one row per
 * recipient, and returns 202 naming the command that will do the sending. The
 * confirmation therefore leads with what did *not* happen — the same rule the
 * notification queue's retry follows, for the same reason: a spinner resolving
 * into a checkmark reads as "sent" to everybody who has ever used software.
 */
export function StepSend({
  count,
  countKnown,
  canSendCampaigns,
  pending,
  outcome,
  refusal,
  blocked,
  onSend,
}: {
  count: number | null;
  countKnown: boolean;
  canSendCampaigns: boolean;
  pending: boolean;
  outcome: { recipients: number; command: string } | null;
  refusal: { kind: string; message: string } | null;
  blocked: string | null;
  onSend: () => void;
}) {
  const t = useTranslations("campaigns");

  const reason = !canSendCampaigns
    ? t("sendStep.refusedForbidden")
    : outcome !== null
      ? t("sendStep.alreadyQueued")
      : blocked;

  return (
    <>
      <Card title={t("sendStep.title")} footnote={t("sendStep.frozen")}>
        <div className="flex flex-col gap-4">
          {countKnown ? (
            <DataList>
              <DataRow label={t("audienceStep.eligibleLabel")}>
                <Isolate numeric>{t("audienceStep.eligible", { count: count ?? 0 })}</Isolate>
              </DataRow>
            </DataList>
          ) : null}

          <div className="flex flex-col gap-1.5 rounded-ui-md bg-ui-surface-2 px-3 py-2.5">
            <span className="flex items-center gap-2 text-ui-compact text-ui-fg">
              <Icon name="clock" className="size-4 shrink-0 text-ui-muted" />
              {t("sendStep.nothingSent")}
            </span>
            <span className="text-ui-label text-ui-muted">{t("sendStep.explain")}</span>
            {/* A shell command is an identifier and must not reorder in Arabic. */}
            <Ltr
              numeric={false}
              className="ui-scroll rounded-ui-sm bg-ui-surface px-2 py-1 font-mono text-ui-caption text-ui-fg"
            >
              wp algerian-commerce send-campaigns
            </Ltr>
          </div>

          <div>
            <Button
              variant="primary"
              loading={pending}
              disabled={reason !== null}
              title={reason ?? undefined}
              onClick={onSend}
              data-testid="send"
            >
              {t("sendStep.action")}
            </Button>
          </div>

          {/*
            **Disabled with the reason, never hidden.** ADMIN_PANEL.md says it
            outright: a hidden button makes a Marketing Manager think the feature
            is broken. Sending reaches every customer record, so it is the
            capability that already reads them.
          */}
          {!canSendCampaigns ? (
            <div className="flex flex-col gap-1" data-testid="send-forbidden">
              <span className="flex items-center gap-2 text-ui-label text-ui-fg">
                <Icon name="lock" className="size-4 shrink-0 text-ui-subtle" />
                {t("sendStep.refusedForbidden")}
              </span>
              <span className="text-ui-label text-ui-muted">
                {t("sendStep.forbiddenNote")}
              </span>
            </div>
          ) : null}
        </div>
      </Card>

      {outcome ? (
        <div data-testid="send-result">
          <Notice
            tone="success"
            title={t("sendStep.queued", { count: outcome.recipients })}
          >
            {/* The negative, again, because this is the moment it is believed. */}
            <p className="text-ui-label">{t("sendStep.nothingSent")}</p>
            {outcome.command !== "" ? (
              <Ltr
                numeric={false}
                className="ui-scroll rounded-ui-sm bg-ui-surface px-2 py-1 font-mono text-ui-caption text-ui-fg"
              >
                {outcome.command}
              </Ltr>
            ) : null}
          </Notice>
        </div>
      ) : null}

      {/*
        The four refusals, each pointing somewhere different: the mail one at the
        deployment, the nobody one at the segment, the already one at nothing at
        all — it changed nothing and must not be retried — and the forbidden one
        at a capability.
      */}
      {refusal ? (
        <div data-testid="send-refusal">
          <Notice tone="danger" role="alert" title={refusal.message}>
            {refusal.kind === "mail" ? (
              <>
                <p className="text-ui-label">{t("sendStep.refusedMailFix")}</p>
                <Ltr
                  numeric={false}
                  className="ui-scroll rounded-ui-sm bg-ui-surface px-2 py-1 font-mono text-ui-caption text-ui-fg"
                >
                  wp algerian-commerce mail-check
                </Ltr>
              </>
            ) : null}
            {refusal.kind === "nobody" ? (
              <p className="text-ui-label">{t("sendStep.refusedNobodyWhy")}</p>
            ) : null}
          </Notice>
        </div>
      ) : null}
    </>
  );
}

/** Shared by the composer: fetch a preview for the saved campaign. */
export function usePreview(campaignId: number, enabled: boolean) {
  return useQuery({
    queryKey: ["campaigns", campaignId, "preview"],
    queryFn: async () => {
      const { data } = await acRead<unknown>(`/campaigns/${campaignId}/preview`);
      return campaignPreview.parse(data);
    },
    enabled,
  });
}
