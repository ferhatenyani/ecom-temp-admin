"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Campaign } from "@/lib/api/schemas/campaign";
import { campaign as campaignSchema, sendResult } from "@/lib/api/schemas/campaign";
import { BrowserApiError, acRead, acWrite, acWriteWithMeta } from "@/lib/api/browser";
import {
  canAdvance,
  canSend,
  classifySendRefusal,
  furthestStep,
  hasAudienceCount,
  nextStep,
  previousStep,
  sendOutcome,
  stepIndex,
  type ComposerStep,
  type SendOutcome,
} from "@/lib/campaigns";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ErrorState } from "@/components/patterns/States";
import { Button } from "@/components/primitives/Button";
import { Sheet } from "@/components/primitives/Sheet";
import { Icon } from "@/components/primitives/Icon";
import { useToast } from "@/components/primitives/Toast";
import { StepIndicator } from "./StepIndicator";
import {
  StepAudience,
  StepContent,
  StepPreview,
  StepSend,
  StepTest,
  usePreview,
  type Draft,
} from "./Steps";

/**
 * The composer: audience → content → preview → test → send.
 *
 * **A stepped wizard, which this panel has nowhere else**, and the argument for
 * it here is specific rather than stylistic. Every other editor in this codebase
 * — the coupon form, the page form — edits a thing that already exists, whose
 * fields are independent, and whose save is reversible. This one ends in an
 * action that **freezes an audience and cannot be undone**, and its correctness
 * depends on every step before it: a person who never opens the preview cannot
 * see that `{{firstname}}` renders empty, and that mistake goes out to everybody.
 *
 * Three properties keep it from being the usual wizard annoyance:
 *
 *   **Backwards is always free.** Any step already reached is one tap away, so
 *   fixing a subject seen wrong in the preview costs nothing.
 *
 *   **The draft is saved, not held.** Each forward move PATCHes, so a closed tab
 *   loses nothing and the preview is of what the server actually holds rather
 *   than of what this browser thinks it sent.
 *
 *   **It is only a wizard while it is a draft.** A sent campaign is a record, and
 *   `SentCampaign` renders it read-only with its counts — walking five steps
 *   through something nobody can change would be a costume.
 */
export function Composer({
  locale,
  initial,
  canSendCampaigns,
}: {
  locale: string;
  initial: Campaign;
  /**
   * `ac_manage_marketing` **and** `ac_manage_customers`. Measured: a Marketing
   * Manager is 200 on the campaign and the preview and 403 on send — so the
   * button is rendered disabled with the reason, never hidden.
   */
  canSendCampaigns: boolean;
}) {
  const t = useTranslations("campaigns");
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();

  const { data, isError, error, refetch } = useQuery({
    queryKey: ["campaigns", initial.id],
    queryFn: async () => {
      const { data } = await acRead<unknown>(`/campaigns/${initial.id}`);
      return campaignSchema.parse(data);
    },
    initialData: initial,
  });

  const campaign = data;

  const [step, setStep] = useState<ComposerStep>("audience");
  const [draft, setDraft] = useState<Draft>(() => ({
    name: initial.name,
    subject: initial.subject,
    body_html: initial.body_html,
    body_text: initial.body_text,
    audience: {
      type: initial.audience.type,
      segment_id: initial.audience.segment_id,
      customer_ids: [...initial.audience.customer_ids],
    },
  }));
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [refusal, setRefusal] = useState<{ kind: string; message: string; fix?: string } | null>(
    null,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  const furthest = furthestStep(draft);

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setFieldErrors({});
    try {
      await acWrite("PATCH", `/campaigns/${campaign.id}`, {
        name: draft.name,
        subject: draft.subject,
        body_html: draft.body_html,
        body_text: draft.body_text,
        audience_type: draft.audience.type,
        ...(draft.audience.type === "segment" ? { segment_id: draft.audience.segment_id } : {}),
        ...(draft.audience.type === "ids" ? { customer_ids: draft.audience.customer_ids } : {}),
      });
      await refetch();
      await client.invalidateQueries({ queryKey: ["campaigns", campaign.id, "preview"] });
      await client.invalidateQueries({ queryKey: ["campaigns"] });
      return true;
    } catch (thrown) {
      const apiError = thrown as BrowserApiError;
      /*
       * **A 400 lists every bad field at once**, and each binds to its own
       * control — so the errors are kept whole rather than flattened to the
       * first message. `lib/api/browser.ts` preserves `details.fields` for
       * exactly this.
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
      const { data } = await acWriteWithMeta<unknown>(
        "POST",
        `/campaigns/${campaign.id}/send`,
      );
      setOutcome(sendOutcome(sendResult.parse(data)));
      await refetch();
      await client.invalidateQueries({ queryKey: ["campaigns"] });
    } catch (thrown) {
      const apiError = thrown as BrowserApiError;
      const kind = classifySendRefusal(apiError.status, apiError.code, apiError.details);
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
        fix: typeof apiError.details.fix === "string" ? apiError.details.fix : undefined,
      });
      // A refusal is a real state of the campaign, so the row is re-read: the
      // already-sent case means somebody else sent it while this tab was open.
      if (kind === "already") await refetch();
    } finally {
      setSending(false);
    }
  };

  if (isError) {
    return (
      <Scaffold
        title={campaign.name}
        back={{ href: `/${locale}/marketing/campaigns`, label: t("campaigns") }}
      >
        <div className="mx-auto max-w-3xl px-4">
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        </div>
      </Scaffold>
    );
  }

  const atEnd = step === "send";
  const forwardAllowed = canAdvance(step, draft);

  return (
    <Scaffold
      title={draft.name || t("create")}
      back={{ href: `/${locale}/marketing/campaigns`, label: t("campaigns") }}
      trailing={
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          aria-label={t("deleteAction")}
          className="tap-44 press flex size-11 items-center justify-center rounded-full text-danger"
        >
          <Icon name="trash" className="size-5" />
        </button>
      }
      toolbar={<StepIndicator step={step} furthest={furthest} onGoTo={setStep} />}
    >
      <div className="mx-auto max-w-3xl px-4">
        {step === "audience" ? (
          <StepAudience
            draft={draft}
            onChange={setDraft}
            count={count}
            countKnown={countKnown}
            stale={audienceChanged}
            disabled={saving}
          />
        ) : step === "content" ? (
          <StepContent
            draft={draft}
            onChange={setDraft}
            disabled={saving}
            fieldErrors={fieldErrors}
          />
        ) : step === "preview" ? (
          <StepPreview preview={preview.data ?? null} />
        ) : step === "test" ? (
          <StepTest campaignId={campaign.id} />
        ) : (
          <StepSend
            count={count}
            countKnown={countKnown}
            canSendCampaigns={canSendCampaigns && canSend(campaign)}
            pending={sending}
            outcome={outcome}
            refusal={refusal}
            onSend={() => void send()}
          />
        )}

        {/*
          The navigation, at the end of the content rather than pinned.

          A fixed bar would sit on top of the tab bar at the 390px floor — the
          panel already spends that edge — and every step here is short enough to
          reach its own bottom. `Précédent` is always live; `Continuer` is gated
          on the draft being complete enough for the step after.
        */}
        <nav className="mb-8 flex items-center justify-between gap-3">
          <Button
            variant="plain"
            disabled={previousStep(step) === null}
            onClick={() => {
              const target = previousStep(step);
              if (target) setStep(target);
            }}
          >
            <Icon name="back" flipInRtl className="size-4" />
            {t("back")}
          </Button>

          {!atEnd ? (
            <Button
              variant="tinted"
              loading={saving}
              disabled={!forwardAllowed}
              onClick={() => void advance()}
              data-testid="continue"
            >
              {t("continue")}
              <Icon name="chevron" flipInRtl className="size-4" />
            </Button>
          ) : (
            <Button variant="plain" loading={saving} onClick={() => void save()}>
              {t("saveAction")}
            </Button>
          )}
        </nav>
      </div>

      {/*
        A `Sheet`, not `window.confirm` — the panel confirms destructive acts on
        its own surface everywhere else, and a native dialog is unstyled,
        untranslatable in place and ignores the reading direction.
      */}
      <Sheet
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteConfirm")}
        footer={
          <div className="flex gap-3">
            <Button variant="plain" fullWidth onClick={() => setDeleteOpen(false)}>
              {t("sendStep.cancel")}
            </Button>
            <Button variant="destructive" fullWidth onClick={() => void deleteDraft()}>
              {t("deleteAction")}
            </Button>
          </div>
        }
      >
        <p className="px-4 text-body text-label-secondary" dir="auto">
          {draft.name}
        </p>
      </Sheet>
    </Scaffold>
  );

  async function deleteDraft() {
    try {
      await acWrite("DELETE", `/campaigns/${campaign.id}`);
      await client.invalidateQueries({ queryKey: ["campaigns"] });
      router.push(`/${locale}/marketing/campaigns`);
    } catch (thrown) {
      // A cancelled or sent campaign answers 409 here — "Only a draft can be
      // deleted." The button is not offered in those states, but the race is
      // real and the API's own sentence is the right thing to show.
      toast.show((thrown as BrowserApiError).message, "danger");
    } finally {
      setDeleteOpen(false);
    }
  }
}
