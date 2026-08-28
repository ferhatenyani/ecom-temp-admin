"use client";

import type { ReactNode } from "react";
import type { Campaign } from "@/lib/api/schemas/campaign";
import { CAMPAIGN_TONE, isCampaignStatus } from "@/lib/campaigns";
import { formatDate } from "@/lib/format/date";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Badge, type Tone } from "@/components/ui/Badge";
import { rowOpenerId, type Column } from "@/components/ui/DataTable";

/**
 * The campaign column definition — one source, two presentations.
 *
 * `DataTable` renders these as a real table at `md` and up and `RecordList`
 * renders the three-line form below it, so a phone and a monitor cannot drift
 * apart about which fields identify a campaign. It replaces the hand-rolled
 * `ListLinkRow` the old screen drew at every width.
 *
 * ## The identifying cell is the row's opener, not an anchor
 *
 * **There is a peek drawer here**, and it is free: `GET /campaigns/{id}` is
 * *value*-identical to the list row — measured 2026-08-28 on all four ids, 16
 * keys, zero diff — which is the condition DECISIONS.md's standing rule makes a
 * preview free under, the same one orders, products and payments meet. It earns
 * its place on `body_html`, `body_text`, the audience and the recipient
 * partition: four facts no column can carry and the only things anybody opens a
 * campaign to check before sending it.
 *
 * So the row does not navigate, and the name is therefore a real `<button>` from
 * `rowOpenerId` rather than a link: a `<tr>` handler is a mouse-only row at `md`+
 * and the drawer needs a named target to hand focus back to. See DECISIONS.md
 * §10. The drawer's own primary is what navigates to the composer.
 *
 * ## Three sortable columns out of six, and `id` is deliberately not one
 *
 * `orderby` takes `created_at`, `updated_at`, `name` and `id`, and all four sort
 * in both directions — measured 2026-08-28 against a positive control that is not
 * the collection's own resting order, which is what `query.ts` records at length.
 * Three of them are columns here and carry a `sortKey`; the list passes
 * `onSortChange`, which is the pair that puts `aria-sort` on those three headers
 * and — just as deliberately — keeps it off `subject`, `audience` and
 * `recipients`, none of which the API can sort.
 *
 * **`id` gets no column and no control.** Four campaigns, each with a name a
 * person typed; a column of primary keys is nothing anybody would scan and adding
 * one purely to hang a sort on it is chrome. It stays reachable by URL, which is
 * how `/products` treats `popularity`.
 *
 * None declares `sortDirections`: all eight combinations were measured, unlike
 * products' `title` where only ascending ever was.
 *
 * ## Status is a badge on the name, not a column
 *
 * The list opens on every status — `?status=` is legal and means all of them — so
 * a draft sits among sent campaigns and is otherwise indistinguishable from one
 * that has already reached customers. That is the coupons argument, and it is
 * stronger here because the difference is *irreversible mail* rather than a
 * discount nobody has used.
 */

export const CAMPAIGN_SCOPE = "campaign";

/** One definition of the opener's DOM id: the cell renders it, the drawer names it. */
export function campaignOpenerId(id: number): string {
  return rowOpenerId(CAMPAIGN_SCOPE, id);
}

export type CampaignColumnContext = {
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  /**
   * A segment's own name, or `null` when this session's segment list does not
   * hold it.
   *
   * The audience cell says "Un segment" without it, which is true and useless on
   * a list where three of four campaigns have one — the whole question a person
   * asks of that column is *which*. `GET /segments` is allowlisted and enumerates
   * all four, so the list already fetches it for the filter picker and this costs
   * no extra request. `null` is a real case rather than a fallback: a campaign can
   * name a segment somebody has since deleted, and inventing a name for it would
   * be worse than admitting the list does not have one.
   */
  segmentName: (id: number) => string | null;
};

/**
 * What the audience *is*, in as many words as the row has.
 *
 * Shared by the table cell, the record list and the peek, so the three cannot
 * disagree about what "Un segment" means on a given row.
 *
 * **The label and the name are two boxes, and that is a bidi fix rather than
 * markup taste.** A single string — "Segment : Clients à plus de 10 000 DA" —
 * takes its direction from its *first strong character*, which inside the Arabic
 * panel is the Arabic word: the whole run becomes RTL, `truncate` puts the
 * ellipsis at the physical left, and the French name is then clipped **from its
 * front**. Seen on the 340px Arabic capture, where the cell read
 * "…lus de 10 000 DA". Splitting them gives the name its own line box, so it
 * truncates at its own end — the fix `coupons/columns.tsx` records for a French
 * description in an Arabic list, arriving here through a label rather than a
 * container.
 */
export function audienceCell(campaign: Campaign, ctx: CampaignColumnContext): ReactNode {
  const { t, segmentName } = ctx;
  const type = campaign.audience.type;

  if (type === "segment") {
    const name = segmentName(campaign.audience.segment_id);
    /* A campaign can name a segment somebody has since deleted, and inventing a
       name for it would be worse than saying only what is known. */
    if (name === null) return <span className="truncate">{t("audience.segment")}</span>;
    return (
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-ui-subtle">{t("audienceSegmentLabel")}</span>
        <span dir="auto" className="min-w-0 truncate">
          {name}
        </span>
      </span>
    );
  }

  return (
    <span className="truncate">
      {type === "ids"
        ? t("audienceIds", { count: campaign.audience.customer_ids.length })
        : t("audience.all")}
    </span>
  );
}

/**
 * The recipient count, and **only once it means something.**
 *
 * A draft's `recipients.total` is `0`, which is "not yet" rather than "nobody" —
 * printing it would report every unsent campaign as having reached no one, and
 * `0` in a numeric column is a figure people act on. The counts become real when
 * `send` freezes the audience, so the cell is empty until then and the audience
 * column beside it is what a draft's row is read for.
 *
 * A **cancelled** campaign is the interesting case and it is why this reads the
 * counts rather than the status: 320 was cancelled before it ever sent, so its
 * totals are genuinely zero, while a campaign cancelled mid-drain carries the
 * rows it had already written. `total > 0` is the honest test.
 */
function recipientsText(campaign: Campaign, ctx: CampaignColumnContext): ReactNode {
  if (campaign.recipients.total === 0) return null;
  return <Ltr>{campaign.recipients.total.toLocaleString(ctx.locale)}</Ltr>;
}

export function statusTone(status: string): Tone {
  /* `CAMPAIGN_TONE` predates `Badge` and speaks `accent`, which is not one of
     §3.5's five. `sending` is not a warning — it is the ordinary state between a
     send and the drain finishing — so it reads as `info`. */
  if (!isCampaignStatus(status)) return "neutral";
  const tone = CAMPAIGN_TONE[status];
  return tone === "accent" ? "info" : tone;
}

export function buildColumns(ctx: CampaignColumnContext): Column<Campaign>[] {
  const { locale, t } = ctx;

  return [
    {
      key: "name",
      header: t("columns.name"),
      required: true,
      /* Alphabetical over the folded name, both directions measured, and it is
         the one axis whose ascending answer is not the resting order. */
      sortKey: "name",
      cell: (campaign) => (
        <span className="flex min-w-0 items-center gap-2">
          {/* A campaign's name is what somebody typed, so `dir="auto"` — a French
              name inside the Arabic panel would otherwise be clipped from the
              front rather than the end. Capped, because `.ui-td` is `nowrap` and
              an auto-layout table sizes a column to its widest cell. */}
          <span dir="auto" className="block max-w-64 truncate">
            {campaign.name}
          </span>
          {isCampaignStatus(campaign.status) ? (
            <Badge tone={statusTone(campaign.status)}>{t(`status.${campaign.status}`)}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "subject",
      header: t("columns.subject"),
      /* The line the customer reads, carrying `{{tokens}}` verbatim as authored —
         they resolve only in the preview. `dir="auto"` for the same reason the
         name has it.

         `max-w-56` rather than something roomier, and it is measured: `.ui-td` is
         `nowrap` and an auto-layout table sizes a column to its widest cell, so at
         1440 the six columns summed past the card and the *created* column — the
         one carrying the resting order — fell off the end of its own scroll
         container. The full subject is one press away in the peek. */
      cell: (campaign) => (
        <span dir="auto" className="block max-w-56 truncate">
          {campaign.subject}
        </span>
      ),
    },
    {
      key: "audience",
      header: t("columns.audience"),
      cell: (campaign) => (
        <span className="flex min-w-0 max-w-48 items-baseline">
          {audienceCell(campaign, ctx)}
        </span>
      ),
    },
    {
      key: "recipients",
      header: t("columns.recipients"),
      align: "end",
      cell: (campaign) => recipientsText(campaign, ctx),
    },
    {
      key: "updated",
      header: t("columns.updated"),
      sortKey: "updated_at",
      /* `Isolate`, never `Ltr`: a formatted date is not an identifier, and ICU
         puts RTL marks inside the Arabic form on purpose. */
      cell: (campaign) => <Isolate>{formatDate(campaign.updated_at, locale, false)}</Isolate>,
    },
    {
      key: "created",
      header: t("columns.created"),
      /* The resting order, so its header is the one that reads `aria-sort="none"`
         while the list is in fact ordered by it — true, because the *default*
         sends no `orderby` and the third header click returns to it. */
      sortKey: "created_at",
      cell: (campaign) => <Isolate>{formatDate(campaign.created_at, locale, false)}</Isolate>,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * Which three is editorial rather than "the first three columns": on a phone
 * somebody is identifying the campaign (its name, with the status that changes
 * what it means), reading what it says (the subject), and answering *who and
 * when* — the audience while it is a draft, the count once there is one.
 */
export function campaignRecord(
  campaign: Campaign,
  ctx: CampaignColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { locale, t } = ctx;

  return {
    primary: (
      <>
        <span
          dir="auto"
          className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg"
        >
          {campaign.name}
        </span>
        {isCampaignStatus(campaign.status) ? (
          <Badge tone={statusTone(campaign.status)}>{t(`status.${campaign.status}`)}</Badge>
        ) : null}
      </>
    ),
    secondary: (
      <span dir="auto" className="min-w-0 flex-1 truncate">
        {campaign.subject}
      </span>
    ),
    meta: (
      <>
        <span className="flex min-w-0 items-baseline">
          {campaign.recipients.total > 0 ? (
            <Isolate numeric>
              {t("recipients.count", { total: campaign.recipients.total })}
            </Isolate>
          ) : (
            audienceCell(campaign, ctx)
          )}
        </span>
        <span className="ms-auto shrink-0 text-ui-compact text-ui-fg">
          <Isolate>{formatDate(campaign.updated_at, locale, false)}</Isolate>
        </span>
      </>
    ),
  };
}
