"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import type { CampaignPreview, Segment } from "@/lib/api/schemas/campaign";
import { campaignPreview, testResult } from "@/lib/api/schemas/campaign";
import type { CustomerRef } from "@/lib/customers";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import {
  AUDIENCE_TYPES,
  MAX_CUSTOMER_IDS,
  TOKENS,
  audienceProblem,
  consentGap,
  tokenLiteral,
  unsubscribeNote,
  type AudienceType,
} from "@/lib/campaigns";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { FilterTabs } from "@/components/ui/FilterBar";
import { Select, TextArea, TextField } from "@/components/ui/Form";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/States";
import { Skeleton } from "@/components/ui/Skeleton";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { ChosenCustomers, CustomerPicker, useResolvedCustomers } from "./CustomerPicker";

/**
 * The composer's five steps, each a module-level component.
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

export function StepContent({
  draft,
  onChange,
  disabled,
  fieldErrors,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  disabled: boolean;
  fieldErrors: Record<string, string>;
}) {
  const t = useTranslations("campaigns");

  return (
    <>
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
            error={fieldErrors.subject}
            disabled={disabled}
          />
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
              parts empty and answers 201. What the wizard is protecting is a
              campaign advanced past this step with nothing in one half, which
              previews as an empty mail and sends as one. `lib/campaigns.ts`
              carries the correction.
            */
            hint={t("bodyTextHint")}
            error={fieldErrors.body_text}
            disabled={disabled}
          />
        </div>
      </Card>

      {/*
        The tokens, listed where they are typed rather than in a help screen. They
        are the only "code" in this editor and the failure mode is a misspelling
        that renders empty — so the correct spellings sit beside the field, in a
        monospace run wrapped `Ltr` because a token is an identifier.
      */}
      <Card title={t("tokensTitle")} footnote={t("tokensNote")}>
        <DataList>
          {TOKENS.map((token) => (
            <DataRow key={token} label={t(`token.${token}`)}>
              <Ltr numeric={false} className="font-mono">
                {tokenLiteral(token)}
              </Ltr>
            </DataRow>
          ))}
        </DataList>
      </Card>
    </>
  );
}

/* -------------------------------------------------------------- 3. preview --- */

/**
 * The step that exists for one reason: **an unknown token renders empty**, and
 * that is invisible in a preview which has a name in it from another token.
 */
export function StepPreview({
  preview,
  loading,
}: {
  preview: CampaignPreview | null;
  loading: boolean;
}) {
  const t = useTranslations("campaigns");
  const [part, setPart] = useState<"html" | "text">("html");

  if (preview === null) {
    return (
      <Card title={t("step.preview")}>
        {/* The real box: a part switcher over a body block, so the card does not
            change height when the render arrives. */}
        <div className="flex flex-col gap-3" aria-busy={loading || undefined}>
          <Skeleton className="h-9 w-40 rounded-ui-md" />
          <Skeleton className="h-40 w-full rounded-ui-md" />
        </div>
      </Card>
    );
  }

  return (
    <>
      {preview.unknown_tokens.length > 0 ? (
        <Notice
          tone="warning"
          title={t("previewStep.unknownTokens", { count: preview.unknown_tokens.length })}
        >
          <span className="flex flex-wrap gap-1.5" data-testid="unknown-tokens">
            {preview.unknown_tokens.map((token) => (
              <Ltr
                key={token}
                numeric={false}
                className="rounded-ui-sm bg-ui-surface px-1.5 py-0.5 font-mono text-ui-caption text-ui-fg"
              >
                {tokenLiteral(token)}
              </Ltr>
            ))}
          </span>
          <span className="text-ui-label">
            {/*
              **The tokens are passed as values, not written into the message.**
              `{{first_name}}` inside an ICU string parses as a `{first_name}`
              placeholder wrapped in literal braces, so the message throws
              `INVALID_MESSAGE` and next-intl renders the key path — which is what
              this line did until a screenshot showed it. A value is inserted
              verbatim and never re-parsed.
            */}
            {t("previewStep.unknownWhy", {
              correct: tokenLiteral("first_name"),
              wrong: "{{firstname}}",
            })}
          </span>
        </Notice>
      ) : null}

      <Card
        title={t("step.preview")}
        footnote={
          unsubscribeNote(preview) === "appended"
            ? t("previewStep.unsubscribeAppended")
            : t("previewStep.unsubscribeAuthored")
        }
      >
        <div className="flex flex-col gap-3">
          <DataList>
            <DataRow label={t("field.subject")} stacked>
              <span dir="auto">{preview.subject}</span>
            </DataRow>
          </DataList>

          {/* `chips`, not the tab strip: DECISIONS.md §12's panel-wide rule is
              that a full-bleed underlined strip under the header always means
              *which view*, and this is a labelled choice inside a card. */}
          <FilterTabs<"html" | "text">
            tabs={[
              { value: "html", label: t("previewStep.html") },
              { value: "text", label: t("previewStep.text") },
            ]}
            value={part}
            onChange={setPart}
            label={t("previewStep.partLabel")}
            variant="chips"
          />

          {/*
            **The rendered mail, on its own surface and in its own direction.**
            `dir="auto"` because the body is whatever language the campaign was
            written in, which is not necessarily the panel's.

            The HTML is shown as *source*, not injected. It is sanitised on save
            with an email-safe allowlist, so rendering it would be safe — but a
            preview that renders is a preview of how *this browser* draws it,
            which is not how a mail client will, and it invites treating the panel
            as a WYSIWYG it is not.
          */}
          <pre
            dir="auto"
            className="ui-scroll max-h-80 rounded-ui-md bg-ui-surface-2 px-3 py-2 text-ui-caption whitespace-pre-wrap text-ui-fg"
            data-testid="preview-body"
          >
            {part === "html" ? preview.html : preview.text}
          </pre>

          <p className="text-ui-label text-ui-subtle">{t("previewStep.sample")}</p>
        </div>
      </Card>
    </>
  );
}

/* ----------------------------------------------------------------- 4. test --- */

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

/* ----------------------------------------------------------------- 5. send --- */

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
