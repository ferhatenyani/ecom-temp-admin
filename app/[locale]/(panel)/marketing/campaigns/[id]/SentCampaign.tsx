"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Campaign, Recipient, Segment } from "@/lib/api/schemas/campaign";
import { campaign as campaignSchema, recipientList } from "@/lib/api/schemas/campaign";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import {
  RECIPIENT_STATUSES,
  canCancel,
  isCampaignStatus,
  isDraining,
  isPurged,
  sendProgress,
  type RecipientStatus,
  type SendProgress,
} from "@/lib/campaigns";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import {
  DataTable,
  TableFooter,
  useTablePreferences,
} from "@/components/ui/DataTable";
import { FilterTabs } from "@/components/ui/FilterBar";
import { EmptyState, ErrorState, Notice, StaleBanner } from "@/components/ui/States";
import { RecordListSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { Menu } from "@/components/ui/Menu";
import { IconButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { statusTone, audienceCell, type CampaignColumnContext } from "../columns";
import { buildRecipientColumns, recipientRecord } from "./recipient-columns";
import { RECIPIENTS_PER_PAGE, recipientParams, recipientsKey } from "../query";

/**
 * A campaign that is no longer a draft: the record of what went out.
 *
 * **Not the composer with its fields greyed out.** A sent campaign is not a form
 * somebody might still edit — it is evidence, and the questions asked of it are
 * different: *who got this*, *how many failed*, *what did we actually say*. So the
 * wizard does not appear at all.
 *
 * `sending` lands here too. It is mid-flight — the audience is frozen and the
 * drain is working through it — so it is equally not editable, and the one action
 * it still has is cancel. That action lives in `PageHeader` per §2.4: the body
 * below is as long as the *recipient list*, so a campaign with nine addresses and
 * one with nine hundred would otherwise put the same button at two very different
 * scroll offsets.
 *
 * ## Three cards over a full-width table, not a `DetailGrid`
 *
 * §2.3's two-column detail is a `1fr` main beside a 360px aside, and that is
 * right for an order: prose rows beside a block of metadata. A first draft used
 * it here and the capture is what showed it wrong — `DetailGrid` opens the aside
 * at `lg`, so at 1024 the recipient table would have had **352px** for five
 * columns, and even at 1440 its last column fell off the end of its own scroll
 * container. The record's own facts are three small cards; the recipient list is
 * the thing this screen is opened for. §9 made the same call in the other
 * direction when it put the COD report below the ledger rather than into a 360px
 * aside.
 *
 * ## The recipient list is a real list and takes the whole contract
 *
 * `DataTable` at `md`+, `RecordList` below, one `columns.tsx`, `FilterTabs` over
 * the three statuses and a `TableFooter` — and **no sorting and no `aria-sort`
 * anywhere**, because the route publishes no `orderby` at all. `recipient-columns.tsx`
 * carries the measurement.
 *
 * ## No stale marker on the record, one on the list
 *
 * §3.7 as amended: this screen holds a react-query cache and it writes — cancel —
 * so both halves bite and the marker is honest. The cancel item goes off with the
 * same sentence rather than failing on click.
 *
 * ## It polls while it is draining, and only while it is draining
 *
 * §15 shipped this screen readable and **not live**: nothing under
 * `marketing/campaigns/` had a `refetchInterval` anywhere, so the counts never
 * moved on their own and a campaign stuck at *2 sent, 4 pending* was
 * indistinguishable from one mid-flight. Both queries now poll on
 * `OrdersList.tsx:95`'s numbers — `refetchInterval: 30_000`,
 * `refetchIntervalInBackground: false` — gated on `isDraining()`.
 *
 * **Both, and that is the point of the gate rather than an afterthought.** The
 * counts live on the campaign and the rows live one route down, and the two are
 * computed from the same recipients — a screen polling only the first would show
 * *6 of 6 done* over a table still listing four as queued. Two reads per thirty
 * seconds against a 600/min budget is nothing.
 *
 * **It stops the moment the status leaves `sending`.** A `sent` or `cancelled`
 * campaign is a record whose counts cannot move again; polling one forever spends
 * a shared budget on a row already in hand. A `draft` never reaches this screen.
 *
 * ## What it shows, and the number it refuses to invent
 *
 * There is no stall threshold anywhere here, and there will not be one: a shop
 * whose drain is a five-minute cron and one whose drain is hand-run have nothing
 * in common, so *"stalled after N minutes"* would be the panel inventing a fact —
 * this run's oldest rule. `sendProgress()` returns published facts and the reader
 * draws the conclusion. It also declines to publish a last-movement time it cannot
 * prove: see its docblock.
 *
 * **And no drain command.** `send`'s 202 names it in `next.command` and the
 * composer renders *that string*; `GET /campaigns/{id}` publishes nothing of the
 * kind, so this screen has no honest way to name a command and does not try.
 */
/**
 * A send in flight, said in published facts only.
 *
 * **There is no progress bar and no percentage**, and that is §15's own rule kept
 * rather than reversed: `send` writes rows and returns, the mail leaves when a
 * deployment runs the drain, and a filling bar implies a rate this panel cannot
 * observe. What was missing was never a bar — it was that the counts sat still, so
 * a stalled campaign and a working one looked the same. Polling fixes that; the
 * facts below are what makes the difference *readable*.
 *
 * Three rows, each straight off the API, and **none of them repeated anywhere
 * else on this screen**:
 *
 *   remaining     `total − sent − failed`. Not "pending" — `pending` is one status
 *                 among an open set, and this arithmetic survives a `delivered`
 *                 arriving next year.
 *   claimed       `claimed_at`, when `send` handed it over
 *   last movement `max(sent_at)`, **and only when the whole recipient list is on
 *                 screen** — otherwise the row is absent rather than approximate.
 *
 * `sent` and `failed` are deliberately *not* here, and the first capture is what
 * showed why: they already sit in the recipients card six inches below, so a
 * progress block carrying them printed the same two figures twice on one screen —
 * the shape §15 rejected when it refused a chip row that restated three controls
 * just above it. This card answers *is it moving*; the card below answers *what
 * happened*. Two questions, two blocks, no number in both.
 *
 * The reader draws the conclusion. "Claimed at 09:02, last movement 09:04, four
 * remaining" at 11:30 says *stalled* to a human without the panel ever having
 * invented a threshold — and a shop whose drain is a nightly cron reads the same
 * two timestamps and correctly concludes nothing is wrong.
 */
function SendProgressCard({ progress, locale }: { progress: SendProgress; locale: string }) {
  const t = useTranslations("campaigns");

  return (
    <Card title={t("progress.title")} footnote={t("progress.note")}>
      {/*
        Capped rather than stretched. The card is full width because it is the
        headline of a draining campaign, but a `DataList` is a label at one end
        and a figure at the other — across 1440 that puts eleven hundred pixels
        between "Restants" and "2", which is exactly the scanning distance the
        three cards below avoid by being 360 wide.
      */}
      <div className="max-w-md" data-testid="send-progress">
        <DataList>
          <DataRow label={t("progress.remaining")}>
            <span data-testid="remaining">
              <Ltr>{progress.remaining.toLocaleString(locale)}</Ltr>
            </span>
          </DataRow>
          {progress.claimedAt !== null ? (
            <DataRow label={t("progress.claimed")}>
              <Isolate>{formatWhen(progress.claimedAt, locale)}</Isolate>
            </DataRow>
          ) : null}
          {/*
            **Absent rather than approximate.** `GET /campaigns/{id}/recipients`
            publishes no `orderby`, so "the most recently sent" is not a question
            this API answers; the maximum is exact only when every row is on
            screen. A campaign with more recipients than one page shows the two
            facts above and no third.
          */}
          {progress.movedAt !== null ? (
            <DataRow label={t("progress.lastMovement")}>
              <span data-testid="last-movement">
                <Isolate>{formatWhen(progress.movedAt, locale)}</Isolate>
              </span>
            </DataRow>
          ) : null}
        </DataList>
      </div>
    </Card>
  );
}

export function SentCampaign({
  locale,
  initial,
  canReadRecipients,
  segments,
}: {
  locale: string;
  initial: Campaign;
  /**
   * `ac_manage_customers`, the second half of `canSendCampaigns()`. The recipient
   * list **is** the customer list in the form of addresses, so a Marketing
   * Manager is 403 on it — measured — while seeing every count on this screen.
   */
  canReadRecipients: boolean;
  /** For naming the audience's segment. Empty when the list request failed. */
  segments: Segment[];
}) {
  const t = useTranslations("campaigns");
  const tStates = useTranslations("states");
  const tA11y = useTranslations("a11y");
  const client = useQueryClient();
  const toast = useToast();
  const menuTriggerId = useId();

  const [status, setStatus] = useState<RecipientStatus | "">("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number>(RECIPIENTS_PER_PAGE);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const online = useOnline();

  const { data: campaign, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["campaigns", initial.id],
    queryFn: async () => {
      const { data } = await acRead<unknown>(`/campaigns/${initial.id}`);
      return campaignSchema.parse(data);
    },
    initialData: initial,
    /*
     * **Read off the answer, not off `initial`.** The gate has to close when the
     * drain finishes, and the only thing that knows it has is the response this
     * poll just received — a campaign that arrived `sending` and is now `sent`
     * must stop being asked about. TanStack v5 hands the query in for exactly
     * this, and `false` ends the interval.
     */
    refetchInterval: (query) => (isDraining(query.state.data ?? initial) ? 30_000 : false),
    // A background tab is not watching a send. Orders' pair, and its reason.
    refetchIntervalInBackground: false,
  });

  const purged = isPurged(campaign);
  const draining = isDraining(campaign);

  const recipients = useQuery({
    queryKey: recipientsKey(campaign.id, status, page, perPage),
    queryFn: async () => {
      const { data, meta } = await acRead<unknown[]>(
        `/campaigns/${campaign.id}/recipients?${recipientParams(status, page, perPage)}`,
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
    /*
     * §3.6 mechanism 3, and it is what makes the poll invisible: the rows already
     * on screen stay there across every refetch, marked refreshing rather than
     * replaced by a skeleton. The render below only reaches a skeleton when
     * `rows.length === 0`, which a background poll never is.
     */
    placeholderData: keepPreviousData,
    /* The same gate as the campaign above, driven by the campaign's own status —
       so the two stop together and the table can never disagree with the counts
       over it. */
    refetchInterval: draining ? 30_000 : false,
    refetchIntervalInBackground: false,
  });

  /*
   * **One last read of the recipients when the drain finishes**, and it is a
   * defect found by driving the poll rather than by reading the code.
   *
   * Both queries stop on the same gate, and the campaign read that reports `sent`
   * is by definition the *first one after the drain finished* — so the recipient
   * list stops one interval behind it. The screen settled showing "6 inscrits, 5
   * envoyés, 1 échec" over a table with a row still marked *En attente*, and
   * stayed that way until somebody reloaded: exactly the disagreement between the
   * counts and the rows this screen's docblock says cannot happen.
   *
   * A ref rather than a state pair, because the transition has to be observed
   * *after* the render that carries the new status — state adjusted during render
   * would have equalised before the effect ever ran.
   */
  const wasDraining = useRef(draining);
  const refetchRecipients = recipients.refetch;
  useEffect(() => {
    if (wasDraining.current && !draining) void refetchRecipients();
    wasDraining.current = draining;
  }, [draining, refetchRecipients]);

  const blocked = online ? null : tStates("offlineWrites");

  const cancel = async () => {
    setCancelling(true);
    try {
      await acWrite("POST", `/campaigns/${campaign.id}/cancel`);
      await refetch();
      await client.invalidateQueries({ queryKey: ["campaigns", "list"] });
      toast.show(t("cancelled"));
    } catch (thrown) {
      // A terminal campaign answers 409 naming the state. The action is not
      // offered there, but the race is real and the API's own sentence is what to
      // show — there is no mirror for a status this panel did not predict.
      toast.show((thrown as BrowserApiError).message, "danger");
    } finally {
      setCancelling(false);
      setCancelOpen(false);
    }
  };

  const counts = campaign.recipients;

  /*
   * **Whether the screen is holding every recipient**, which is the condition
   * `sendProgress()` will only publish a last-movement time under.
   *
   * `?status=` narrows the rows *and* the reported total, so an unfiltered page
   * whose row count equals its total is the whole list and nothing else is. A
   * maximum over page one of a filtered list is not the campaign's last movement
   * and would be a number the panel made up.
   */
  const wholeList =
    status === "" &&
    recipients.data !== undefined &&
    recipients.data.rows.length === recipients.data.total;

  const progress = sendProgress(campaign, wholeList ? recipients.data.rows : null);

  const segmentName = (id: number) => segments.find((s) => s.id === id)?.name ?? null;
  const ctx: CampaignColumnContext = { locale, t, segmentName };

  const columns = buildRecipientColumns({ locale, t });
  const preferences = useTablePreferences("campaign-recipients", columns);

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={campaign.name}
        back={{ href: `/${locale}/marketing/campaigns`, label: t("campaigns") }}
        divided={false}
        subtitle={
          isCampaignStatus(campaign.status) ? (
            <Badge tone={statusTone(campaign.status)}>{t(`status.${campaign.status}`)}</Badge>
          ) : undefined
        }
        actions={
          canCancel(campaign) ? (
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
                  key: "cancel",
                  label: t("cancelAction"),
                  icon: "close",
                  destructive: true,
                  disabled: blocked !== null,
                  onSelect: () => setCancelOpen(true),
                },
              ]}
            />
          ) : null
        }
      />

      <PageBody width="full">
        {!online && dataUpdatedAt > 0 ? (
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
        ) : null}

        <div className="flex flex-col gap-6">
          {/*
            **The drain, while it is running.** Full width above the record's own
            three cards, because for a `sending` campaign this *is* what the screen
            was opened for — and gone the moment the status leaves `sending`, since
            every fact in it is about a thing in motion.
          */}
          {draining ? <SendProgressCard progress={progress} locale={locale} /> : null}

          {/*
            **Three cards in a row rather than a `DetailGrid`, and the recipient
            table below them at full width.** §2.3 gives a two-column detail a
            `1fr` main and a 360px aside, and that is right for an order — a body
            of prose rows beside a block of metadata. It is wrong here, and the
            capture is what showed it: `DetailGrid` puts the aside beside main
            from `lg`, so at 1024 the recipient table would get **352px** for five
            columns, and even at 1440 the "sent at" column fell off the end of its
            own scroll container. A table is not a body of prose.

            This is §9's judgement in the other direction: payments put its COD
            report *below* the ledger rather than in a 360px aside, because for
            that reader the report was the page. Here the recipient list is the
            page — *who got this, how many failed* — so the record's own facts sit
            above it as three equal cards and the table gets the whole width.
          */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {/* The frozen message, quoted as the record it is. */}
            <Card title={t("section.content")} footnote={t("readOnly.body")}>
              <div className="flex flex-col gap-3">
                <DataList>
                  <DataRow label={t("field.subject")} stacked>
                    <span dir="auto">{campaign.subject}</span>
                  </DataRow>
                </DataList>
                <pre
                  dir="auto"
                  className="ui-scroll max-h-72 rounded-ui-md bg-ui-surface-2 px-3 py-2 text-ui-caption whitespace-pre-wrap text-ui-fg"
                  data-testid="sent-body"
                >
                  {campaign.body_text}
                </pre>
              </div>
            </Card>

            <Card
              title={t("section.record")}
              /*
                Which record this is, in the reader's language. Three different
                sentences because they are three different facts: a sent campaign
                is closed, a cancelled one was stopped by somebody, and a sending
                one is still going with its audience already frozen.
              */
              footnote={
                campaign.status === "sent"
                  ? t("readOnly.sent")
                  : campaign.status === "cancelled"
                    ? t("readOnly.cancelled")
                    : t("readOnly.sending")
              }
            >
              <DataList>
                <DataRow label={t("audienceLabel")}>{audienceCell(campaign, ctx)}</DataRow>
                <DataRow label={t("field.created")}>
                  <Isolate>{formatWhen(campaign.created_at, locale)}</Isolate>
                </DataRow>
                {campaign.completed_at !== null ? (
                  <DataRow label={t("field.sentAt")}>
                    <Isolate>{formatWhen(campaign.completed_at, locale)}</Isolate>
                  </DataRow>
                ) : null}
              </DataList>
            </Card>

            {/*
              The counts, which are **stored columns and survive the purge**. That
              is why they are their own block rather than a header on the
              recipient list: after thirty days the list is gone and these are the
              whole answer.

              Scope-labelled rows rather than a `StatGroup`, which is the
              customers lesson and then the payments one: `total` beside `sent` is
              a partition, and three figures at `--text-display` on one line
              invite the reader to add two of them up and get the third wrong.
            */}
            <Card title={t("field.recipients")} footnote={t("recipients.countsScope")}>
              <DataList>
                <DataRow label={t("recipients.total")}>
                  <Ltr>{counts.total.toLocaleString(locale)}</Ltr>
                </DataRow>
                <DataRow label={t("recipient.sent")}>
                  <Ltr>{counts.sent.toLocaleString(locale)}</Ltr>
                </DataRow>
                <DataRow label={t("recipient.failed")}>
                  <Ltr>{counts.failed.toLocaleString(locale)}</Ltr>
                </DataRow>
              </DataList>
            </Card>
          </div>

          <RecipientsCard />
        </div>
      </PageBody>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={(next) => {
          if (!next) setCancelOpen(false);
        }}
        title={t("cancelConfirm")}
        body={
          <span className="flex flex-col gap-2">
            <span dir="auto" className="text-ui-fg">
              {campaign.name}
            </span>
            <span>{t("cancelConfirmBody")}</span>
          </span>
        }
        confirmLabel={t("cancelAction")}
        loading={cancelling}
        onConfirm={() => void cancel()}
        returnFocusTo={menuTriggerId}
      />
    </div>
  );

  function RecipientsCard() {
    if (!canReadRecipients) {
      return (
        <Card title={t("section.recipients")}>
          <p className="text-ui-label text-ui-muted">{t("recipients.hidden")}</p>
        </Card>
      );
    }

    if (purged) {
      /*
        **"4 812 destinataires — adresses purgées", never an empty table.** The
        addresses are deleted thirty days after a campaign completes and the counts
        are kept, so an empty list here would say "nobody got this" about a
        campaign that reached thousands.
      */
      return (
        <Card title={t("section.recipients")} footnote={t("recipients.purgedWhy")}>
          <Notice tone="info" title={t("recipients.purged")}>
            <p className="text-ui-label">
              <Isolate numeric>{t("recipients.count", { total: counts.total })}</Isolate>
            </p>
          </Notice>
        </Card>
      );
    }

    const rows = recipients.data?.rows ?? [];
    const total = recipients.data?.total ?? 0;
    const filtered = status !== "";

    /*
     * **Not inside a `Card`, and that is §1.6 rather than a layout preference.**
     * `DataTable` brings its own card — border, radius, the almost-nothing shadow
     * — and a card inside a card is forbidden: "a card that needs a card inside it
     * is a card whose child should be a bordered section". So this section carries
     * its own heading and its filter above the table, exactly as a list screen's
     * `PageHeader` does, and the table is the card.
     */
    return (
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-ui-heading text-ui-fg">{t("section.recipients")}</h2>
          <span className="text-ui-label text-ui-muted" data-testid="recipients-count">
            {/*
              **The total follows the filter**, which it did not before
              `feat/campaign-recipient-counts`: `?status=failed` answered 0 rows
              with a total of 9, so this line said "9 destinataires" over an empty
              table and the pager below offered a page that did not exist.
            */}
            <Isolate>{t("recipients.count", { total })}</Isolate>
          </span>
        </div>

        {/* `chips`, not the strip: §12's rule is that a full-bleed underlined
            strip under the header always means *which view*, and this is a filter
            over one section of a detail screen. */}
        <FilterTabs<RecipientStatus | "">
          tabs={[
            { value: "", label: t("recipients.filterAll") },
            ...RECIPIENT_STATUSES.map((value) => ({
              value,
              label: t(`recipient.${value}`),
            })),
          ]}
          value={status}
          onChange={(next) => {
            setStatus(next);
            setPage(1);
          }}
          label={t("statusLabel")}
          variant="chips"
        />

        {recipients.isPending && rows.length === 0 ? (
          <>
            <div className="hidden md:block">
              <TableSkeleton rows={6} cols={4} label={t("loading")} />
            </div>
            <div className="ui-card p-2 md:hidden">
              <RecordListSkeleton rows={5} label={t("loading")} />
            </div>
          </>
        ) : recipients.isError ? (
          <ErrorState
            message={(recipients.error as Error).message}
            onRetry={() => void recipients.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={filtered ? "search" : "mail"}
            /*
              Two states, and both are reachable: the status filter can empty the
              list, and a campaign whose audience resolved to nobody has no rows at
              all. §3.7's distinction, with a real producer for each.
            */
            message={filtered ? t("recipients.noneForFilter") : t("recipients.none")}
            action={
              filtered
                ? {
                    label: t("recipients.filterAll"),
                    onClick: () => {
                      setStatus("");
                      setPage(1);
                    },
                  }
                : undefined
            }
          />
        ) : (
          <DataTable
            preferences={preferences}
            rows={rows}
            columns={columns}
            rowKey={(row) => String(row.id)}
            rowLabel={(row) => tA11y("recipientEmail", { email: row.email })}
            record={(row: Recipient) => recipientRecord(row, { locale, t })}
            footer={
              <TableFooter
                page={page}
                perPage={perPage}
                total={total}
                onPageChange={setPage}
                /* Held in state rather than in the URL, because nothing on this
                   screen is: the campaign is the address and a position inside its
                   recipient list is not a view anybody links to. A new page size
                   resets to page one, as it does on every other list. */
                onPerPageChange={(next) => {
                  setPerPage(next);
                  setPage(1);
                }}
              />
            }
          />
        )}
      </section>
    );
  }
}
