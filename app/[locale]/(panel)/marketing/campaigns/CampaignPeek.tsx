"use client";

import { useTranslations } from "next-intl";
import type { Campaign } from "@/lib/api/schemas/campaign";
import { formatWhen } from "@/lib/format/date";
import { Drawer, useLatchedOpener } from "@/components/ui/Overlay";
import { DataList, DataRow } from "@/components/ui/Card";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import {
  audienceCell,
  campaignOpenerId,
  statusTone,
  type CampaignColumnContext,
} from "./columns";

/**
 * One campaign, previewed without leaving the list.
 *
 * ## It costs no request, and that is the whole licence for it
 *
 * `GET /campaigns/{id}` is **value-identical to the list row** — measured
 * 2026-08-28 on all four ids, sixteen keys, zero diff — so this renders from the
 * row already in memory, exactly as the payments and shipping drawers do. The
 * standing rule in DECISIONS.md makes a peek free under precisely that condition
 * and a judgement otherwise; here it is free.
 *
 * ## What it earns its place on
 *
 * Four facts no column can carry, and every one of them is something a person
 * checks *before* an irreversible act:
 *
 *   `body_text` and `body_html`  what this will actually say. The table can show
 *                                a subject and nothing else.
 *   the audience                 which segment, or how many named customers.
 *   the recipient partition      total / sent / failed, which are **stored
 *                                columns** and survive the thirty-day purge, so
 *                                after it they are the whole answer.
 *
 * The bodies are shown as **source**, never injected. They are sanitised on save
 * with an email-safe allowlist so rendering would be safe — but a rendered
 * preview is a preview of how *this browser* draws it, which is not how a mail
 * client will, and it invites treating the panel as a WYSIWYG it is not. The
 * composer's own preview step makes the same choice for the same reason.
 *
 * ## The primary navigates, and its label comes off the record
 *
 * `is_editable` is published on every row, so the panel carries no transition
 * table: a draft opens the composer to be *edited*, and anything else opens the
 * record to be *read*. Two different screens behind one route, and the button
 * says which before the person spends a navigation on it.
 *
 * `returnFocusTo` is **latched** — Radix fires `onCloseAutoFocus` *after*
 * `onOpenChange`, and this peek comes from a URL parameter, which is the case
 * that needs it most: closing clears `?peek=` and the component re-renders with a
 * null record before focus is restored. DECISIONS.md §10.
 */
export function CampaignPeek({
  campaign,
  ctx,
  locale,
  onOpenChange,
}: {
  campaign: Campaign | null;
  ctx: CampaignColumnContext;
  locale: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("campaigns");

  const returnFocusTo = useLatchedOpener(campaign && campaignOpenerId(campaign.id));

  return (
    <Drawer
      open={campaign !== null}
      onOpenChange={onOpenChange}
      /* The record's own name, `dir="auto"` inside `OverlayFrame`. Unlike the
         media drawer — where the title is an editable field in the body and a
         header built from it would draw a stale second copy — nothing here is
         editable, so the record names its own preview. */
      title={campaign?.name ?? ""}
      size="md"
      returnFocusTo={returnFocusTo}
      footer={
        campaign === null ? null : (
          <ButtonLink
            href={`/${locale}/marketing/campaigns/${campaign.id}`}
            variant="primary"
            iconEnd="chevron"
          >
            {campaign.is_editable ? t("peek.edit") : t("peek.open")}
          </ButtonLink>
        )
      }
    >
      {campaign === null ? null : (
        <div className="flex flex-col gap-4">
          <DataList>
            <DataRow label={t("field.status")}>
              <Badge tone={statusTone(campaign.status)}>
                {t(`status.${campaign.status}`)}
              </Badge>
            </DataRow>
            <DataRow label={t("field.subject")} stacked>
              <span dir="auto">{campaign.subject}</span>
            </DataRow>
            <DataRow label={t("audienceLabel")}>{audienceCell(campaign, ctx)}</DataRow>
            {/*
              The partition, and **only once there is one**. A draft's counts are
              all zero, which means "not yet" rather than "nobody" — three rows of
              `0` would report an unsent campaign as having failed to reach
              anybody. The audience row above is what a draft's preview answers.
            */}
            {campaign.recipients.total > 0 ? (
              <>
                <DataRow label={t("field.recipients")} hint={t("peek.countsScope")}>
                  <Ltr>{campaign.recipients.total.toLocaleString(locale)}</Ltr>
                </DataRow>
                <DataRow label={t("recipient.sent")}>
                  <Ltr>{campaign.recipients.sent.toLocaleString(locale)}</Ltr>
                </DataRow>
                <DataRow label={t("recipient.failed")}>
                  <Ltr>{campaign.recipients.failed.toLocaleString(locale)}</Ltr>
                </DataRow>
              </>
            ) : null}
            <DataRow label={t("field.created")}>
              <Isolate>{formatWhen(campaign.created_at, locale)}</Isolate>
            </DataRow>
            <DataRow label={t("field.updated")}>
              <Isolate>{formatWhen(campaign.updated_at, locale)}</Isolate>
            </DataRow>
          </DataList>

          <BodyBlock title={t("field.bodyText")} body={campaign.body_text} empty={t("peek.noBody")} />
          <BodyBlock title={t("field.bodyHtml")} body={campaign.body_html} empty={t("peek.noBody")} />

          <p className="text-ui-label text-ui-subtle">{t("peek.sourceNote")}</p>
        </div>
      )}
    </Drawer>
  );
}

/**
 * One part of the mail, quoted.
 *
 * `dir="auto"` because the body is whatever language the campaign was written in,
 * which is not necessarily the panel's — the same argument the composer's preview
 * makes about a rendered mail inside an Arabic screen.
 *
 * **An empty part is stated rather than left blank.** `POST /campaigns` accepts
 * both bodies empty — a 201, measured — so a campaign with nothing in it is a
 * real record, and an empty box would read as a failed fetch.
 */
function BodyBlock({
  title,
  body,
  empty,
}: {
  title: string;
  body: string;
  empty: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <h3 className="text-ui-subheading text-ui-fg">{title}</h3>
      {body.trim() === "" ? (
        <p className="text-ui-label text-ui-subtle">{empty}</p>
      ) : (
        <pre
          dir="auto"
          className="ui-scroll max-h-64 rounded-ui-md bg-ui-surface-2 px-3 py-2 text-ui-caption whitespace-pre-wrap text-ui-fg"
        >
          {body}
        </pre>
      )}
    </div>
  );
}
