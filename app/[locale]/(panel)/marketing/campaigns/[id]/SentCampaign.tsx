"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Campaign, Recipient } from "@/lib/api/schemas/campaign";
import { campaign as campaignSchema, recipientList } from "@/lib/api/schemas/campaign";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import {
  CAMPAIGN_TONE,
  RECIPIENT_STATUSES,
  RECIPIENT_TONE,
  canCancel,
  isCampaignStatus,
  isPurged,
  recipientError,
  recipientSentAt,
  type RecipientStatus,
} from "@/lib/campaigns";
import { formatDate } from "@/lib/format/date";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, SectionError } from "@/components/patterns/States";
import { ListGroup, ListRow, ListValueRow } from "@/components/primitives/GroupedList";
import { Segmented } from "@/components/primitives/Segmented";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Button } from "@/components/primitives/Button";
import { Sheet } from "@/components/primitives/Sheet";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { RECIPIENTS_PER_PAGE, recipientParams, recipientsKey } from "../query";

/**
 * A campaign that is no longer a draft: the record of what went out.
 *
 * **Not the composer with its fields greyed out.** A sent campaign is not a form
 * somebody might still edit — it is evidence, and the questions asked of it are
 * different: *who got this*, *how many failed*, *what did we actually say*. So it
 * is a detail screen, and the wizard does not appear at all.
 *
 * `sending` lands here too. It is mid-flight — the audience is frozen and the
 * drain is working through it — so it is equally not editable, and the one action
 * it still has is cancel.
 */
export function SentCampaign({
  locale,
  initial,
  canReadRecipients,
}: {
  locale: string;
  initial: Campaign;
  /**
   * `ac_manage_customers`, the second half of `canSendCampaigns()`. The recipient
   * list **is** the customer list in the form of addresses, so a Marketing
   * Manager is 403 on it — measured — while seeing every count on this screen.
   */
  canReadRecipients: boolean;
}) {
  const t = useTranslations("campaigns");
  const client = useQueryClient();
  const toast = useToast();

  const [status, setStatus] = useState<RecipientStatus | "">("");
  const [page, setPage] = useState(1);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const { data: campaign, refetch } = useQuery({
    queryKey: ["campaigns", initial.id],
    queryFn: async () => {
      const { data } = await acRead<unknown>(`/campaigns/${initial.id}`);
      return campaignSchema.parse(data);
    },
    initialData: initial,
  });

  const purged = isPurged(campaign);

  const recipients = useQuery({
    queryKey: recipientsKey(campaign.id, status, page),
    queryFn: async () => {
      const { data, meta } = await acRead<unknown[]>(
        `/campaigns/${campaign.id}/recipients?${recipientParams(status, page)}`,
      );
      return {
        rows: recipientList.parse(data),
        total: typeof meta.total === "number" ? meta.total : 0,
      };
    },
    // Nothing to fetch once the addresses are gone: the counts on the campaign
    // are what remains, and asking would return an empty page that reads as
    // "nobody" rather than as "not any more".
    enabled: canReadRecipients && !purged,
    placeholderData: keepPreviousData,
  });

  const cancel = async () => {
    setCancelling(true);
    try {
      await acWrite("POST", `/campaigns/${campaign.id}/cancel`);
      await refetch();
      await client.invalidateQueries({ queryKey: ["campaigns"] });
    } catch (thrown) {
      toast.show((thrown as BrowserApiError).message, "danger");
    } finally {
      setCancelling(false);
      setCancelOpen(false);
    }
  };

  const counts = campaign.recipients;
  const pageCount = Math.max(1, Math.ceil((recipients.data?.total ?? 0) / RECIPIENTS_PER_PAGE));

  return (
    <Scaffold
      title={campaign.name}
      back={{ href: `/${locale}/marketing/campaigns`, label: t("campaigns") }}
    >
      <div className="mx-auto max-w-3xl px-4">
        <ListGroup
          title={t("section.record")}
          /*
            Which record this is, in the reader's language. Three different
            sentences because they are three different facts: a sent campaign is
            closed, a cancelled one was stopped by somebody, and a sending one is
            still going and its audience is already frozen.
          */
          footnote={
            campaign.status === "sent"
              ? t("readOnly.sent")
              : campaign.status === "cancelled"
                ? t("readOnly.cancelled")
                : t("readOnly.sending")
          }
        >
          <ListRow>
            <span className="text-body text-label-secondary">{t("statusLabel")}</span>
            {isCampaignStatus(campaign.status) ? (
              <StatusBadge tone={CAMPAIGN_TONE[campaign.status]} className="ms-auto">
                {t(`status.${campaign.status}`)}
              </StatusBadge>
            ) : null}
          </ListRow>
          <ListValueRow
            label={t("field.subject")}
            value={<span dir="auto">{campaign.subject}</span>}
          />
          <ListValueRow
            label={t("audienceLabel")}
            value={t(`audience.${campaign.audience.type === "segment" ? "segment" : campaign.audience.type === "ids" ? "ids" : "all"}`)}
          />
          <ListValueRow
            label={t("field.created")}
            value={<Isolate>{formatDate(campaign.created_at, locale)}</Isolate>}
          />
          {campaign.completed_at !== null ? (
            <ListValueRow
              label={t("field.sentAt")}
              value={<Isolate>{formatDate(campaign.completed_at, locale)}</Isolate>}
            />
          ) : null}
        </ListGroup>

        {/*
          The counts, which are **stored columns and survive the purge**. That is
          why they are shown as their own block rather than as a header on the
          recipient list: after thirty days the list is gone and these are the
          whole answer.
        */}
        <ListGroup title={t("field.recipients")}>
          <ListRow className="gap-4">
            {(["total", "sent", "failed"] as const).map((key) => (
              <span key={key} className="flex flex-1 flex-col gap-0.5">
                <Ltr className="text-title-3 text-label">{counts[key].toLocaleString(locale)}</Ltr>
                <span className="text-caption text-label-secondary">
                  {key === "total" ? t("field.recipients") : t(`recipient.${key}`)}
                </span>
              </span>
            ))}
          </ListRow>
        </ListGroup>

        {/* The frozen message, quoted as the record it is. */}
        <ListGroup title={t("section.content")}>
          <ListRow className="items-start">
            <pre
              dir="auto"
              className="max-h-72 w-full overflow-auto rounded-md bg-surface-2 px-3 py-3 text-caption whitespace-pre-wrap text-label"
              data-testid="sent-body"
            >
              {campaign.body_text}
            </pre>
          </ListRow>
        </ListGroup>

        <RecipientsSection />

        {canCancel(campaign) ? (
          <ListGroup>
            <ListRow>
              <Button variant="destructive" fullWidth onClick={() => setCancelOpen(true)}>
                {t("cancelAction")}
              </Button>
            </ListRow>
          </ListGroup>
        ) : null}
      </div>

      <Sheet
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t("cancelConfirm")}
        footer={
          <div className="flex gap-3">
            <Button variant="plain" fullWidth onClick={() => setCancelOpen(false)}>
              {t("sendStep.cancel")}
            </Button>
            <Button
              variant="destructive"
              fullWidth
              loading={cancelling}
              onClick={() => void cancel()}
            >
              {t("cancelAction")}
            </Button>
          </div>
        }
      >
        <p className="px-4 text-body text-label-secondary" dir="auto">
          {campaign.name}
        </p>
      </Sheet>
    </Scaffold>
  );

  function RecipientsSection() {
    if (!canReadRecipients) {
      return (
        <ListGroup title={t("section.recipients")}>
          <ListRow>
            <Icon name="lock" className="size-4 shrink-0 text-label-tertiary" />
            <span className="text-footnote text-label-secondary">{t("recipients.hidden")}</span>
          </ListRow>
        </ListGroup>
      );
    }

    if (purged) {
      /*
        **"4 812 destinataires — adresses purgées", never an empty table.**
        The addresses are deleted thirty days after a campaign completes and the
        counts are kept, so an empty list here would say "nobody got this" about
        a campaign that reached thousands.
      */
      return (
        <ListGroup title={t("section.recipients")} footnote={t("recipients.purgedWhy")}>
          <ListRow className="flex-col items-start gap-1">
            <span className="text-body text-label">
              <Isolate numeric>{t("recipients.count", { total: counts.total })}</Isolate>
            </span>
            <span className="text-footnote text-label-secondary">{t("recipients.purged")}</span>
          </ListRow>
        </ListGroup>
      );
    }

    const rows = recipients.data?.rows ?? [];
    const total = recipients.data?.total ?? 0;

    return (
      <ListGroup title={t("section.recipients")}>
        <ListRow>
          <Segmented<RecipientStatus | "">
            segments={[
              { value: "" as const, label: t("recipients.filterAll") },
              ...RECIPIENT_STATUSES.map((value) => ({ value, label: t(`recipient.${value}`) })),
            ]}
            value={status}
            onChange={(next) => {
              setStatus(next);
              setPage(1);
            }}
            label={t("section.recipients")}
          />
        </ListRow>

        <ListRow>
          <span className="text-footnote text-label-secondary" data-testid="recipients-count">
            {/*
              **The total follows the filter**, which it did not before
              `feat/campaign-recipient-counts`: `?status=failed` answered 0 rows
              with a total of 9, so this line said "9 destinataires" over an empty
              table and the pager below offered a page that did not exist.
            */}
            <Isolate numeric>{t("recipients.count", { total })}</Isolate>
          </span>
        </ListRow>

        {recipients.isError ? (
          <ListRow>
            <SectionError>{(recipients.error as Error).message}</SectionError>
          </ListRow>
        ) : rows.length === 0 ? (
          <ListRow>
            <EmptyState message={t("recipients.count", { total: 0 })} />
          </ListRow>
        ) : (
          rows.map((row) => <RecipientRow key={row.id} row={row} />)
        )}

        {total > RECIPIENTS_PER_PAGE ? (
          <ListRow className="justify-between gap-3">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label={t("previousPage")}
              className="press min-h-11 rounded-md px-2 text-footnote text-accent disabled:opacity-40"
            >
              <Icon name="back" flipInRtl className="size-4" />
            </button>
            <span className="text-caption text-label-secondary">
              <Ltr numeric>
                {page} / {pageCount}
              </Ltr>
            </span>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
              aria-label={t("nextPage")}
              className="press min-h-11 rounded-md px-2 text-footnote text-accent disabled:opacity-40"
            >
              <Icon name="chevron" flipInRtl className="size-4" />
            </button>
          </ListRow>
        ) : null}
      </ListGroup>
    );
  }

  function RecipientRow({ row }: { row: Recipient }) {
    const error = recipientError(row);
    const sentAt = recipientSentAt(row);

    return (
      <ListRow className="flex-col items-stretch gap-1">
        <div className="flex min-w-0 items-center gap-2">
          {/* An address is an identifier and reorders inside Arabic without it. */}
          <Ltr numeric={false} className="min-w-0 truncate text-footnote text-label">
            {row.email}
          </Ltr>
          <StatusBadge tone={RECIPIENT_TONE[row.status]} className="ms-auto">
            {t(`recipient.${row.status}`)}
          </StatusBadge>
        </div>

        {sentAt !== null || error !== null ? (
          <div className="flex min-w-0 items-baseline gap-2">
            {error !== null ? (
              /* The transport's own words, quoted rather than translated. */
              <span dir="auto" className="min-w-0 truncate text-caption text-label-tertiary">
                {error}
              </span>
            ) : null}
            {sentAt !== null ? (
              <span className="ms-auto shrink-0 text-caption text-label-tertiary">
                {/*
                  **No offset on this one.** `"2026-08-21 17:31:12"` where the
                  campaign's own stamps carry `+00:00` — `formatDate` reads it as
                  UTC through `parseApiDate`, which is what the API means;
                  `new Date()` would read it as local and be silently wrong.
                */}
                <Isolate>{formatDate(sentAt, locale)}</Isolate>
              </span>
            ) : null}
          </div>
        ) : null}
      </ListRow>
    );
  }
}
