"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import type { CampaignPreview, Segment } from "@/lib/api/schemas/campaign";
import { campaignPreview, segmentList, testResult } from "@/lib/api/schemas/campaign";
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
import { ListGroup, ListRow, ListValueRow } from "@/components/primitives/GroupedList";
import { SelectField, TextAreaField, TextField } from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { SectionError } from "@/components/patterns/States";

/**
 * The composer's five steps, each a module-level component.
 *
 * **Not nested inside `Composer`**, and that is a rule this codebase learned the
 * hard way: a component declared inside another gets a new identity on every
 * parent render, so React remounts it and its `useState` is discarded. The
 * notifications branch shipped that bug in a retry panel and the e2e test caught
 * it only as a race. Three of these steps hold state.
 */

export type Draft = {
  name: string;
  subject: string;
  body_html: string;
  body_text: string;
  audience: { type: string; segment_id: number; customer_ids: number[] };
};

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
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  /** The eligible count from the preview, once it is known. */
  count: number | null;
  countKnown: boolean;
  /** The audience has been edited and not yet saved, so the count is a step behind. */
  stale: boolean;
  disabled: boolean;
}) {
  const t = useTranslations("campaigns");
  const problem = audienceProblem(draft.audience);

  const { data: segments } = useQuery({
    queryKey: ["segments", "picker"],
    queryFn: async () => {
      const { data } = await acRead<Segment[]>("/segments?per_page=100");
      return segmentList.parse(data);
    },
    // Only fetched when it can be used. A Marketing Manager can read the list;
    // it is a segment's *count* that needs the second capability.
    enabled: draft.audience.type === "segment",
  });

  const ids = draft.audience.customer_ids;
  const gap = consentGap(draft.audience.type === "ids" ? ids.length : null, count);

  return (
    <>
      <ListGroup title={t("section.audience")} footnote={t("audienceStep.consentNote")}>
        <SelectField<AudienceType>
          label={t("audienceLabel")}
          value={(AUDIENCE_TYPES as readonly string[]).includes(draft.audience.type)
            ? (draft.audience.type as AudienceType)
            : "all"}
          onChange={(type) =>
            onChange({
              ...draft,
              // Cleared on switch, so a segment left behind cannot travel with an
              // `all` audience and be resurrected by a later edit.
              audience: { type, segment_id: 0, customer_ids: [] },
            })
          }
          options={AUDIENCE_TYPES.map((value) => ({ value, label: t(`audience.${value}`) }))}
          disabled={disabled}
        />

        {draft.audience.type === "segment" ? (
          <SelectField<string>
            label={t("field.segment")}
            value={String(draft.audience.segment_id || "")}
            onChange={(value) =>
              onChange({
                ...draft,
                audience: { ...draft.audience, segment_id: Number(value) || 0 },
              })
            }
            options={[
              { value: "", label: "—" },
              ...(segments ?? []).map((segment) => ({
                value: String(segment.id),
                label: segment.name,
              })),
            ]}
            error={problem === "segment_missing" ? t("audienceStep.segmentMissing") : undefined}
            disabled={disabled}
          />
        ) : null}

        {draft.audience.type === "ids" ? (
          <TextField
            label={t("audience.ids")}
            /*
             * A comma-separated list of ids, `isolate` so it reads left to right
             * in Arabic — it is a sequence of identifiers, not prose.
             *
             * There is no customer picker here, and that is a gap rather than a
             * design: `/customers` is `ac_manage_customers`, which a Marketing
             * Manager does not hold, so a picker would be an empty list for the
             * one role whose job this is. The coupon branch hit the same wall and
             * the backend answered it with two `eligible-*` routes; nothing
             * equivalent exists for customers. Recorded in README.
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
            error={
              problem === "ids_missing"
                ? t("audienceStep.idsMissing")
                : problem === "too_many_ids"
                  ? t("audienceStep.tooManyIds")
                  : undefined
            }
            disabled={disabled}
          />
        ) : null}
      </ListGroup>

      <ListGroup>
        {countKnown ? (
          <>
            <ListRow>
              <span className="text-body text-label-secondary">{t("field.recipients")}</span>
              <span
                className={[
                  "ms-auto text-headline",
                  stale ? "text-label-tertiary" : "text-label",
                ].join(" ")}
                data-testid="eligible"
              >
                <Isolate numeric>{t("audienceStep.eligible", { count: count ?? 0 })}</Isolate>
              </span>
            </ListRow>
            {/*
              The count is of the **saved** audience, so an edit not yet advanced
              past leaves it a step behind. Said rather than hidden — a number
              that silently describes something else is worse than a number
              labelled as old.
            */}
            {stale ? (
              <ListRow>
                <span className="text-caption text-label-tertiary" data-testid="count-stale">
                  {t("audienceStep.stale")}
                </span>
              </ListRow>
            ) : null}
            {/*
              The gap, and only when there is one. For `all` and for a segment the
              panel has no honest "selected" figure — only the server knows the
              pre-consent count — so this appears exactly where it is true.
            */}
            {gap ? (
              <ListRow>
                <span className="text-footnote text-label-secondary" data-testid="consent-gap">
                  <Isolate numeric>{t("audienceStep.gap", gap)}</Isolate>
                </span>
              </ListRow>
            ) : null}
          </>
        ) : (
          /*
            **`audience_count` is null, not zero, for a caller who cannot read
            customers.** Rendering a zero would say "nobody"; this says whose
            permission it is. The rest of the composer still works for them.
          */
          <ListRow>
            <Icon name="lock" className="size-4 shrink-0 text-label-tertiary" />
            <span className="text-footnote text-label-secondary">
              {t("audienceStep.countHidden")}
            </span>
          </ListRow>
        )}
      </ListGroup>
    </>
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
      <ListGroup title={t("section.content")}>
        <TextField
          label={t("field.name")}
          value={draft.name}
          onChange={(name) => onChange({ ...draft, name })}
          hint={t("nameHint")}
          error={fieldErrors.name}
          disabled={disabled}
        />
        <TextField
          label={t("field.subject")}
          value={draft.subject}
          onChange={(subject) => onChange({ ...draft, subject })}
          error={fieldErrors.subject}
          disabled={disabled}
        />
        <TextAreaField
          label={t("field.bodyHtml")}
          value={draft.body_html}
          onChange={(body_html) => onChange({ ...draft, body_html })}
          rows={7}
          error={fieldErrors.body_html}
          disabled={disabled}
        />
        <TextAreaField
          label={t("field.bodyText")}
          value={draft.body_text}
          onChange={(body_text) => onChange({ ...draft, body_text })}
          rows={5}
          /*
            **Authored, never stripped from the HTML.** §85 is explicit, and the
            API requires both parts — so an empty text body is a refusal rather
            than a convenience the panel could fill in.
          */
          hint={t("bodyTextHint")}
          error={fieldErrors.body_text}
          disabled={disabled}
        />
      </ListGroup>

      {/*
        The tokens, listed where they are typed rather than in a help screen.
        They are the only "code" in this editor and the failure mode is a
        misspelling that renders empty — so the correct spellings sit beside the
        field, in a monospace run wrapped `Ltr` because a token is an identifier.
      */}
      <ListGroup title={t("tokensTitle")} footnote={t("tokensNote")}>
        {TOKENS.map((token) => (
          <ListValueRow
            key={token}
            label={t(`token.${token}`)}
            value={
              <Ltr numeric={false} className="font-mono text-footnote text-label">
                {tokenLiteral(token)}
              </Ltr>
            }
          />
        ))}
      </ListGroup>
    </>
  );
}

/* -------------------------------------------------------------- 3. preview --- */

/**
 * The step that exists for one reason: **an unknown token renders empty**, and
 * that is invisible in a preview which has a name in it from another token.
 */
export function StepPreview({ preview }: { preview: CampaignPreview | null }) {
  const t = useTranslations("campaigns");
  const [part, setPart] = useState<"html" | "text">("html");

  if (!preview) {
    return (
      <ListGroup title={t("step.preview")}>
        <ListRow>
          <div className="skeleton h-24 w-full rounded-md" />
        </ListRow>
      </ListGroup>
    );
  }

  return (
    <>
      {preview.unknown_tokens.length > 0 ? (
        <ListGroup>
          <ListRow className="items-start">
            <div
              className="tone-warning tonal flex w-full flex-col gap-2 rounded-md px-3 py-3"
              data-testid="unknown-tokens"
            >
              <span className="flex items-center gap-2 text-subhead font-medium">
                <Icon name="alert" className="size-4 shrink-0" />
                <Isolate numeric>
                  {t("previewStep.unknownTokens", { count: preview.unknown_tokens.length })}
                </Isolate>
              </span>
              <span className="flex flex-wrap gap-2">
                {preview.unknown_tokens.map((token) => (
                  <Ltr
                    key={token}
                    numeric={false}
                    className="rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-caption text-label"
                  >
                    {tokenLiteral(token)}
                  </Ltr>
                ))}
              </span>
              <span className="text-caption text-label-secondary">
                {/*
                  **The tokens are passed as values, not written into the
                  message.** `{{first_name}}` inside an ICU string parses as a
                  `{first_name}` placeholder wrapped in literal braces, so the
                  message throws `INVALID_MESSAGE` and next-intl renders the key
                  path — which is what this line did until a screenshot showed
                  it. A value is inserted verbatim and never re-parsed.
                */}
                {t("previewStep.unknownWhy", {
                  correct: tokenLiteral("first_name"),
                  wrong: "{{firstname}}",
                })}
              </span>
            </div>
          </ListRow>
        </ListGroup>
      ) : null}

      <ListGroup
        title={t("step.preview")}
        footnote={
          unsubscribeNote(preview) === "appended"
            ? t("previewStep.unsubscribeAppended")
            : t("previewStep.unsubscribeAuthored")
        }
      >
        <ListValueRow
          label={t("field.subject")}
          value={<span dir="auto">{preview.subject}</span>}
        />
        <ListRow className="flex-col items-stretch gap-3">
          <div className="flex gap-2">
            {(["html", "text"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPart(value)}
                aria-pressed={part === value}
                className={[
                  "press min-h-9 rounded-full px-3 text-subhead",
                  part === value ? "tone-accent tonal font-medium" : "bg-surface-2 text-label-secondary",
                ].join(" ")}
              >
                {t(`previewStep.${value}`)}
              </button>
            ))}
          </div>

          {/*
            **The rendered mail, on its own surface and in its own direction.**
            `dir="auto"` because the body is whatever language the campaign was
            written in, which is not necessarily the panel's — the notifications
            branch made the same argument about a frozen message.

            The HTML is shown as *source*, not injected. It is sanitised on save
            with an email-safe allowlist, so rendering it would be safe — but a
            preview that renders is a preview of how *this browser* draws it,
            which is not how a mail client will, and it invites treating the
            panel as a WYSIWYG it is not.
          */}
          <pre
            dir="auto"
            className="max-h-80 overflow-auto rounded-md bg-surface-2 px-3 py-3 text-caption whitespace-pre-wrap text-label"
            data-testid="preview-body"
          >
            {part === "html" ? preview.html : preview.text}
          </pre>
          <p className="text-caption text-label-tertiary">{t("previewStep.sample")}</p>
        </ListRow>
      </ListGroup>
    </>
  );
}

/* ----------------------------------------------------------------- 4. test --- */

/**
 * One copy to one address. **Writes no recipient row**, so a test never appears
 * in the recipient list and cannot be mistaken for a send.
 */
export function StepTest({ campaignId }: { campaignId: number }) {
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

  return (
    <ListGroup title={t("step.test")} footnote={t("testStep.explain")}>
      <TextField
        label={t("testStep.to")}
        value={to}
        onChange={setTo}
        isolate
        inputMode="text"
        error={failure ?? undefined}
      />
      <ListRow>
        <Button
          variant="tinted"
          loading={pending}
          disabled={to.trim() === ""}
          onClick={() => void send()}
          data-testid="send-test"
          fullWidth
        >
          {t("testStep.action")}
        </Button>
      </ListRow>

      {/*
        **A 200 that may report a failed send.** `sent: false` is not an error —
        the request succeeded and the transport did not — so this is two
        different sentences rather than an error state. On a shop with no
        reachable mail server it is always the second, and saying why is what
        stops it reading as a broken button.
      */}
      {result ? (
        <ListRow className="items-start">
          <div
            className={[
              "tonal flex w-full flex-col gap-1 rounded-md px-3 py-3",
              result.sent ? "tone-success" : "tone-warning",
            ].join(" ")}
            role="status"
            data-testid="test-result"
          >
            <span className="flex items-center gap-2 text-subhead font-medium">
              <Icon name={result.sent ? "check" : "alert"} className="size-4 shrink-0" />
              {result.sent ? t("testStep.delivered") : t("testStep.refused")}
            </span>
            {!result.sent ? (
              <span className="text-caption text-label-secondary">{t("testStep.refusedWhy")}</span>
            ) : null}
          </div>
        </ListRow>
      ) : null}
    </ListGroup>
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
  onSend,
}: {
  count: number | null;
  countKnown: boolean;
  canSendCampaigns: boolean;
  pending: boolean;
  outcome: { recipients: number; command: string } | null;
  refusal: { kind: string; message: string; fix?: string } | null;
  onSend: () => void;
}) {
  const t = useTranslations("campaigns");

  return (
    <>
      <ListGroup title={t("sendStep.title")} footnote={t("sendStep.frozen")}>
        {countKnown ? (
          <ListRow>
            <span className="text-body text-label-secondary">{t("field.recipients")}</span>
            <span className="ms-auto text-title-3 text-label">
              <Isolate numeric>{t("audienceStep.eligible", { count: count ?? 0 })}</Isolate>
            </span>
          </ListRow>
        ) : null}

        <ListRow className="flex-col items-stretch gap-2">
          <span className="flex items-center gap-2 text-subhead font-medium text-label">
            <Icon name="clock" className="size-4 shrink-0 text-label-secondary" />
            {t("sendStep.nothingSent")}
          </span>
          <span className="text-footnote text-label-secondary">{t("sendStep.explain")}</span>
          {/* A shell command is an identifier and must not reorder in Arabic. */}
          <Ltr
            numeric={false}
            className="overflow-x-auto rounded-sm bg-surface-2 px-2 py-1 font-mono text-caption text-label"
          >
            wp algerian-commerce send-campaigns
          </Ltr>
        </ListRow>

        <ListRow>
          <Button
            variant="filled"
            loading={pending}
            disabled={!canSendCampaigns || outcome !== null}
            onClick={onSend}
            data-testid="send"
            fullWidth
          >
            {t("sendStep.action")}
          </Button>
        </ListRow>

        {/*
          **Disabled with the reason, never hidden.** ADMIN_PANEL.md says it
          outright: a hidden button makes a Marketing Manager think the feature is
          broken. Sending reaches every customer record, so it is the capability
          that already reads them.
        */}
        {!canSendCampaigns ? (
          <ListRow className="items-start">
            <div className="flex w-full flex-col gap-1" data-testid="send-forbidden">
              <span className="flex items-center gap-2 text-footnote text-label">
                <Icon name="lock" className="size-4 shrink-0 text-label-tertiary" />
                {t("sendStep.refusedForbidden")}
              </span>
              <span className="text-caption text-label-secondary">
                {t("sendStep.forbiddenNote")}
              </span>
            </div>
          </ListRow>
        ) : null}
      </ListGroup>

      {outcome ? (
        <ListGroup>
          <ListRow className="items-start">
            <div
              className="tone-success tonal flex w-full flex-col gap-2 rounded-md px-3 py-3"
              role="status"
              data-testid="send-result"
            >
              <span className="flex items-center gap-2 text-subhead font-medium">
                <Icon name="check" className="size-4 shrink-0" />
                <Isolate numeric>{t("sendStep.queued", { count: outcome.recipients })}</Isolate>
              </span>
              {/* The negative, again, because this is the moment it is believed. */}
              <span className="text-footnote">{t("sendStep.nothingSent")}</span>
              {outcome.command !== "" ? (
                <Ltr
                  numeric={false}
                  className="overflow-x-auto rounded-sm bg-surface-2 px-2 py-1 font-mono text-caption text-label"
                >
                  {outcome.command}
                </Ltr>
              ) : null}
            </div>
          </ListRow>
        </ListGroup>
      ) : null}

      {/*
        The three refusals, each pointing somewhere different: the mail one at the
        deployment, the nobody one at the segment, the already one at nothing at
        all — it changed nothing and must not be retried.
      */}
      {refusal ? (
        <ListGroup>
          <ListRow className="items-start">
            <div className="flex w-full flex-col gap-2" data-testid="send-refusal">
              <SectionError>
                <span className="text-label">{refusal.message}</span>
              </SectionError>
              {refusal.kind === "mail" && refusal.fix ? (
                <div className="flex flex-col gap-1 px-4">
                  <span className="text-caption text-label-secondary">
                    {t("sendStep.refusedMailFix")}
                  </span>
                  <Ltr
                    numeric={false}
                    className="overflow-x-auto rounded-sm bg-surface-2 px-2 py-1 font-mono text-caption text-label"
                  >
                    wp algerian-commerce mail-check
                  </Ltr>
                </div>
              ) : null}
              {refusal.kind === "nobody" ? (
                <p className="px-4 text-caption text-label-secondary">
                  {t("sendStep.refusedNobodyWhy")}
                </p>
              ) : null}
            </div>
          </ListRow>
        </ListGroup>
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
