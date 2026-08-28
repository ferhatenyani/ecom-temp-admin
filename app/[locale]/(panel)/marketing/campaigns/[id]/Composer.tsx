"use client";

import { useCallback, useId, useState } from "react";
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
  nextStep,
  previousStep,
  sendOutcome,
  stepIndex,
  type ComposerStep,
  type SendOutcome,
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
  StepPreview,
  StepSend,
  StepTest,
  usePreview,
  type Draft,
} from "./Steps";

/**
 * The composer: audience → content → preview → test → send.
 *
 * ## A stepped form, which is the panel's *other* long-form shape
 *
 * DESIGN.md §3.4 as amended on this branch: **a form built as steps saves per
 * step and ships no `SaveBar` at all.** The rule the amendment carves out of was
 * written about a coupon and a page — one screen of independent fields, saved
 * once at the end, every save reversible by saving again. This is none of those,
 * and the two properties that make it different are measured rather than
 * stylistic:
 *
 *   **The last step is irreversible.** `send` freezes an audience as one row per
 *   recipient and mail leaves the building. Nothing un-sends it.
 *
 *   **The third step is a render of the *server's* copy.** `GET
 *   /campaigns/{id}/preview` resolves the tokens against what is stored, which
 *   only exists because the second step already PATCHed. One long form with a
 *   sticky bar would preview the client's draft against that irreversible act —
 *   and the whole reason the preview is a step is that an unknown token renders
 *   *empty*, which is invisible in a body that has a name in it from another
 *   token.
 *
 * Three properties keep it from being the usual wizard annoyance. **Backwards is
 * always free** — any step already reached is one press away, at the keyboard as
 * well as the pointer, so fixing a subject seen wrong in the preview costs
 * nothing. **The draft is saved, not held**, so a closed tab loses nothing. And
 * **it is only a wizard while it is a draft**: a sent campaign is a record and
 * `SentCampaign` renders it read-only, because walking five steps through
 * something nobody can change would be a costume.
 *
 * ## The stale marker, and every write carrying its reason
 *
 * §3.7 bites here in both halves: a client component over a react-query cache
 * that writes on every forward move. When the browser is certain it is offline
 * the banner says how old the draft on screen is, and **advance, send and test
 * are all disabled with that same sentence** rather than failing on click.
 */
export function Composer({
  locale,
  initial,
  canSendCampaigns,
  canManageCustomers,
}: {
  locale: string;
  initial: Campaign;
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

  /* The fifth state's second half: when the browser is certain it is offline the
     draft on screen is as old as the last fetch, and every write control says so
     rather than failing on click. */
  const blocked = online ? null : tStates("offlineWrites");

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
            />
          ) : step === "preview" ? (
            <StepPreview preview={preview.data ?? null} loading={preview.isPending} />
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
