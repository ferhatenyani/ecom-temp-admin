"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationDetail as Detail } from "@/lib/api/schemas/notification";
import {
  notificationDetail,
  retryMeta,
  sentConflictDetails,
} from "@/lib/api/schemas/notification";
import { BrowserApiError, acRead, acWriteWithMeta } from "@/lib/api/browser";
import {
  STATE_TONE,
  eventMessageKey,
  isAudience,
  isKnownChannel,
  isNotificationEvent,
  messageParagraphs,
  queueState,
  retryOutcome,
  sentConflict,
  type RetryOutcome,
} from "@/lib/notifications";
import { useOnline } from "@/lib/use-online";
import { formatDate, formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card, DataList, DataRow, NavList, NavRow } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorState, Notice, StaleBanner } from "@/components/ui/States";
import { Ltr, Isolate } from "@/components/primitives/Ltr";

/**
 * One notification: what was queued, what happened to it, and one action.
 *
 * The screen answers three questions in that order, which is the order an
 * operator asks them — *did it send*, *what did we actually say*, *where do I go
 * next* — and the message sits in the middle because it is the thing being
 * evidenced rather than the thing being managed.
 *
 * **Single column, 768.** `PageBody width="detail"`, and §2.3's table names
 * "notification" in that row by name. No `DetailGrid`: there is no unboundedly
 * growing body here beside a fixed block of reference material — the record is
 * four short cards, and a 360px aside would only take the message quote's width
 * away from it.
 *
 * ## The poll is gated on the state, and that is how a retry becomes visible
 *
 * `refetchInterval: 30_000` with `refetchIntervalInBackground: false` — orders'
 * numbers — while the row is `queued` or `retrying`, and **off** otherwise. A
 * `sent` or `failed` row is parked and nothing but this screen's own action can
 * move it, so asking again would be a request per half-minute for an answer that
 * cannot change. Marketing's gated poll, and its reason: the gate is read off the
 * *answer* rather than off `initial`, because the read that reports the new state
 * is the one that has to close it.
 *
 * ## The three things in here that are recorded bug fixes
 *
 * 1. **The retry's state lives in a component whose identity survives a
 *    refetch.** It used to live in a `RetrySection` declared *inside* this
 *    function, which gives React a new component identity on every parent render
 *    — so the successful retry's own `refetch()` remounted it and discarded the
 *    result panel it had just set. The e2e test caught it as a race that passed
 *    four runs before failing. `useRetry` is declared at module scope and called
 *    from `NotificationDetail`, which is itself a module-level component, so the
 *    state is held one level *higher* than the fix that closed this originally.
 *    That is forced rather than chosen: the control is now the `PageHeader`
 *    primary and the outcome is a `Notice` in the body, so no single subtree can
 *    own both and the state has to sit above them.
 * 2. **The retry uses `acWriteWithMeta`, not `acWrite`** — the whole answer is in
 *    `meta`, and the first draft fetched the route again for it, which retried the
 *    notification twice.
 * 3. **After a retry the screen re-reads rather than rebinding to the response.**
 *    The 202 answers a *list row* with no `message` key on it — measured — so
 *    binding to it would blank the quoted record on a screen that was working a
 *    moment ago.
 */
export function NotificationDetail({
  locale,
  initial,
}: {
  locale: string;
  initial: Detail;
}) {
  const t = useTranslations("notifications");
  const tStates = useTranslations("states");
  const client = useQueryClient();

  const online = useOnline();

  const { data, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["notification", initial.id],
    queryFn: async () => {
      const { data } = await acRead<unknown>(`/notifications/${initial.id}`);
      return notificationDetail.parse(data);
    },
    initialData: initial,
    /*
     * **Read off the answer, not off `initial`.** A row that arrived `retrying`
     * and has since been drained must stop being asked about, and the only thing
     * that knows it has is the response this poll just received. TanStack v5
     * hands the query in for exactly this, and `false` ends the interval.
     */
    refetchInterval: (query) => (isMoving(query.state.data ?? initial) ? 30_000 : false),
    // A background tab is not watching a queue drain. Orders' pair, and its reason.
    refetchIntervalInBackground: false,
  });

  const notification = data;
  const state = queueState(notification);

  const eventLabel = isNotificationEvent(notification.event)
    ? t(`event.${eventMessageKey(notification.event)}`)
    : notification.event;

  const retry = useRetry({
    id: notification.id,
    onRetried: async () => {
      await refetch();
      await client.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const back = { href: `/${locale}/notifications`, label: t("title") };

  if (isError) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader title={eventLabel} back={back} divided={false} />
        <PageBody width="detail">
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        </PageBody>
      </div>
    );
  }

  /* §3.7's fifth state, both halves. This screen holds a client cache, polls, and
     **writes** — so the marker reports the age and the one write control is
     disabled with that same sentence. The list next door carries the marker and
     says in its own docblock why its half of the rule has nothing to bite on. */
  const blocked = online ? null : tStates("offlineWrites");
  const stale = !online && dataUpdatedAt > 0;

  const subjectId = notification.subject_id;

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={eventLabel}
        back={back}
        /* A detail page omits the rule and lets the first card do the separating
           — §2.4. */
        divided={false}
        /*
         * **The one action, and it is the header's primary** — the standing rule
         * for every detail screen in this run.
         *
         * **Not behind a `ConfirmDialog`**, and that is a judgement rather than an
         * oversight: retry is neither destructive nor irreversible. It queues a
         * row and mails nothing; the mail leaves when something runs the drain,
         * which is a command in the 202's own `meta`. A modal here would confirm
         * an act whose entire risk is that people think it does more than it does,
         * and the answer to that is the sentence the `Notice` prints afterwards,
         * not a second press.
         *
         * **Not rendered at all on a `sent` row**, with one line in the status
         * card saying why — shipping's terminal-parcel precedent. The 409 is still
         * handled below, because a row that sends between this render and the tap
         * is exactly the race the backend's conditional `UPDATE` exists for.
         */
        actions={
          state === "sent" ? undefined : (
            <Button
              variant="primary"
              icon="refresh"
              loading={retry.pending}
              disabled={blocked !== null}
              title={blocked ?? undefined}
              onClick={() => void retry.run()}
              data-testid="retry"
            >
              {t("retry.action")}
            </Button>
          )
        }
      />

      <PageBody width="detail" className="flex flex-col gap-4">
        {stale ? (
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
        ) : null}

        <RetryNotice outcome={retry.outcome} failure={retry.failure} locale={locale} />

        {/* ------------------------------------------------------ status --- */}
        <Card
          title={t("section.status")}
          /*
            The footnote states what `sent` actually claims. `wp_mail()` returning
            true means the message was handed to a transport without an error —
            `EmailChannel`'s own docblock says so — and delivery confirmation would
            need a provider with a webhook, which is §29's "potential channels"
            list rather than this one. A screen that said "delivered" here would be
            making a claim the shop cannot support to a customer on the phone.

            On a queued row the footnote is the other measured fact: retrying
            something that is already waiting is a 202 `already_pending: true`, so
            it zeroes the attempts and sends nothing.
          */
          footnote={
            state === "sent"
              ? t("sentMeans")
              : state === "queued"
                ? t("retry.alreadyQueuedNote")
                : undefined
          }
        >
          <DataList>
            <DataRow label={t("field.state")}>
              <Badge tone={STATE_TONE[state]}>{t(`state.${state}`)}</Badge>
            </DataRow>

            <DataRow label={t("field.created")}>
              <Isolate>{formatDate(notification.created_at, locale)}</Isolate>
            </DataRow>

            {/* Only for a row that sent. `sent_at` is null on everything else, and
                a row reading "—" beside "Transmise le" is a question rather than
                an answer. */}
            {notification.sent_at !== null ? (
              <DataRow label={t("field.sentAt")}>
                <Isolate>{formatDate(notification.sent_at, locale)}</Isolate>
              </DataRow>
            ) : null}

            {/*
              Attempts, shown only once there have been some.

              It is the field that separates the two pending states —
              `markFailed()` writes `status: pending` for a retryable failure — so
              on a `retrying` row this is the number that explains the badge. Five
              is the ceiling (`MAX_ATTEMPTS`), and naming it is what tells an
              operator that a row on four is one drain from being parked.
            */}
            {notification.attempts > 0 ? (
              <DataRow label={t("field.attempts")}>
                <Isolate numeric>
                  {t("attemptsOf", { attempts: notification.attempts })}
                </Isolate>
              </DataRow>
            ) : null}

            {/*
              The error, quoted and never translated, and `stacked` because it is
              prose: `markFailed()` truncates at 500 bytes on the way in, and a
              sentence that long beside its own label pushes the label off the
              baseline every other row on this card shares.

              `dir="auto"`: the API's three sentences are English inside a French
              or Arabic card, and their direction is a property of the text rather
              than of the panel.
            */}
            {notification.last_error !== null ? (
              <DataRow label={t("field.lastError")} stacked>
                <span dir="auto" className="block" data-testid="last-error">
                  {t("errorQuote", { error: notification.last_error })}
                </span>
              </DataRow>
            ) : null}
          </DataList>

          {/*
            The reason there is no control, in the place the control would have
            been — one line, not a disabled button. On every other state this slot
            says what the control in the header does *not* do, which is the one
            thing about it somebody could get wrong before pressing it.
          */}
          <p className="mt-3 text-ui-label text-ui-muted">
            {state === "sent" ? (
              <>
                <span className="text-ui-fg">{t("retry.sentTitle")}</span>
                <span aria-hidden="true"> · </span>
                {t("retry.sentNote")}
              </>
            ) : (
              t("retry.explain")
            )}
          </p>
        </Card>

        {/* ----------------------------------------------------- message --- */}
        <MessageCard notification={notification} />

        {/* ---------------------------------------------------- delivery --- */}
        <Card title={t("section.delivery")}>
          <DataList>
            <DataRow label={t("field.recipient")}>
              {/* An address is an identifier and reorders inside Arabic text
                  without isolation — a recipient read back wrong is a mail to a
                  stranger. `numeric={false}` because it is not a figure. */}
              <Ltr numeric={false}>{notification.recipient}</Ltr>
            </DataRow>

            {/*
              The audience, always. Unlike the list, where it qualifies a row, the
              record states it either way: this is the screen where somebody
              decides whether a failure is a customer's problem or the shop's, and
              an unstated default is not an answer.
            */}
            <DataRow label={t("field.audience")}>
              {isAudience(notification.audience)
                ? t(`audience.${notification.audience}`)
                : notification.audience}
            </DataRow>

            <DataRow label={t("field.channel")}>
              {isKnownChannel(notification.channel) ? (
                t(`channel.${notification.channel}`)
              ) : (
                /* A channel this build has no name for is shown as itself. §29's
                   other four are one class and one `add()` away on the backend,
                   which is also why no filter is built on this field. */
                <Ltr numeric={false}>{notification.channel}</Ltr>
              )}
            </DataRow>

            {/*
              A subject that is not an order gets a value row rather than a link:
              `stock.low` addresses a product, and there is no product route this
              panel would not 404 on for an id it has not checked.
            */}
            {subjectId !== null && notification.subject_type !== "order" ? (
              <DataRow label={t("field.subject")}>
                <Ltr numeric={false}>
                  {notification.subject_type} #{subjectId}
                </Ltr>
              </DataRow>
            ) : null}
          </DataList>

          {/*
            **No `Événement` row.** It printed `order.placed` directly above a
            `Clé` row reading `order.placed:4579` — the same string twice in a
            hundred pixels, which is the defect the inventory branch found with a
            product name and the customers branch avoids by dropping a username
            equal to the email. The key carries the event, and the page title
            already names it in the reader's language.
          */}
        </Card>

        {/* ------------------------------------------------------- links --- */}
        <Card title={t("section.links")}>
          <NavList>
            {/*
              The dedupe key, which is the string an operator quotes in a ticket
              and the one filter that answers "this event, for this order" exactly.
              Following it filters the list rather than copying — the panel has no
              clipboard affordance anywhere, and inventing one here would be a
              gesture nobody has been taught.
            */}
            <NavRow
              href={`/${locale}/notifications?dedupe_key=${encodeURIComponent(
                notification.dedupe_key,
              )}`}
              label={t("field.dedupeKey")}
              icon="link"
              meta={<Ltr numeric={false}>{notification.dedupe_key}</Ltr>}
            />

            {/*
              The join back to what this is about. `subject_type` is `order` on
              every row this queue writes today, so the link is built for that and
              a future subject renders as a value row on the card above instead.
            */}
            {subjectId !== null && notification.subject_type === "order" ? (
              <NavRow
                href={`/${locale}/orders/${subjectId}`}
                label={t("field.order")}
                icon="orders"
                meta={<Ltr>{`#${subjectId}`}</Ltr>}
              />
            ) : null}

            {/*
              Everything else about this order, both audiences at once. This is the
              query `?subject_id=` was added to the API for on
              `feat/notification-filters` — before it, it was one request per event
              name.
            */}
            {subjectId !== null ? (
              <NavRow
                href={`/${locale}/notifications?subject_id=${subjectId}`}
                label={t("field.siblings")}
                icon="list"
              />
            ) : null}
          </NavList>
        </Card>
      </PageBody>
    </div>
  );
}

/** Whether the drain can still move this row on its own. The poll's gate. */
function isMoving(notification: { status: string; attempts: number; last_error: string | null }) {
  const state = queueState(notification);
  return state === "queued" || state === "retrying";
}

/* --------------------------------------------------------------- message --- */

/**
 * The frozen record, and the one block on this screen that is not in the page's
 * language.
 *
 * Declared at module scope rather than nested, for the reason the file docblock
 * gives about `RetrySection`: a function component defined inside a render is a
 * new component identity on every render of its parent. This one holds no state,
 * so it would not have shown the defect — which is exactly why it is worth not
 * writing the shape that does.
 */
function MessageCard({ notification }: { notification: Detail }) {
  const t = useTranslations("notifications");
  const message = notification.message;

  /*
   * **`readable: false` is what the drain saw, not an empty message.**
   *
   * `NotificationPresenter::message()` reports it when the stored payload will
   * not decode, and `drain()` marks exactly that row permanently failed without
   * ever attempting a send. So the screen states the shape of the problem in the
   * reader's language and does not pretend to quote anything — the same treatment
   * the homepage's drop report gets.
   */
  if (!message.readable) {
    return (
      <Card title={t("section.message")} footnote={t("message.unreadableNote")}>
        <Notice tone="warning" title={t("message.unreadable")} />
      </Card>
    );
  }

  const paragraphs = messageParagraphs(message.body);

  return (
    <Card
      title={t("section.message")}
      /*
        **The footnote is what keeps this card honest.** The body is a record of
        what was queued, frozen at queue time, and it is bilingual by accident — a
        French salutation over an English sentence, straight out of
        `NotificationMessages`. It renders verbatim because translating it would
        show something the customer never received. Saying so is what stops it
        reading as panel copy somebody forgot to translate.
      */
      footnote={t("message.frozenNote")}
    >
      <blockquote
        /*
          `dir="auto"` on the quote and on every paragraph inside it: this is the
          one block on the screen that is not in the page's language, and its
          direction is a property of the text rather than of the panel. A future
          Arabic template would then lay out correctly inside a French UI without
          another line of code.

          **Set apart by a surface step, never by a leading coloured rule.** The
          first version gave it a two-pixel inline-start border and
          `check-design.sh` refused it, correctly: a coloured leading border is the
          banned accent bar, and the rule does not care that this one marks a
          quotation rather than a status. The house grammar for "this block is not
          the surrounding surface" is a change of material — which is also the
          better answer here, because a quote that is visibly its own material
          reads as a record rather than as chrome, which is the whole point of the
          framing.

          (The check greps source *text*, so naming that banned utility literally
          in this comment failed the run a second time. Worth knowing before
          documenting a banned class anywhere in this codebase.)
        */
        dir="auto"
        className="flex w-full min-w-0 flex-col gap-3 rounded-ui-md bg-ui-surface-2 px-3 py-3"
        data-testid="message"
      >
        <p className="text-ui-subheading text-ui-fg">{message.subject}</p>
        {paragraphs.map((paragraph, index) => (
          <p
            key={index}
            dir="auto"
            /* `whitespace-pre-line` keeps a single newline inside a paragraph — an
               address block in a shipping notification is several lines and one of
               them is a wilaya. */
            className="whitespace-pre-line text-ui-compact text-ui-muted"
          >
            {paragraph}
          </p>
        ))}
      </blockquote>
    </Card>
  );
}

/* ----------------------------------------------------------------- retry --- */

type RetryFailure = { message: string; sentAt: string | null };

/**
 * The one action, and the one place this screen could mislead.
 *
 * **Retry is a 202 and it mails nothing.** It clears `status`, `attempts` and
 * `last_error` so the next drain picks the row up; the mail leaves when something
 * runs `wp algerian-commerce send-notifications`, which the response names in
 * `meta.drain`.
 *
 * **Declared at module scope, and that is a bug fix rather than a tidy-up.** The
 * state below used to live in a component declared *inside* `NotificationDetail`,
 * which gives React a new component identity on every parent render — so the
 * successful retry's own `refetch()` remounted it and discarded the result it had
 * just set. The e2e test caught it as a race: the assertion beat the refetch on a
 * warm dev server and lost on a cold one, so it passed four runs before failing.
 *
 * A hook rather than a component, because the control and its answer are no longer
 * in one subtree: the button is the `PageHeader` primary and the `Notice` is in
 * the body. `NotificationDetail` is itself a module-level component, so holding
 * the state there is the same guarantee one level up.
 */
function useRetry({ id, onRetried }: { id: number; onRetried: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<RetryOutcome | null>(null);
  const [failure, setFailure] = useState<RetryFailure | null>(null);

  const run = async () => {
    setPending(true);
    setFailure(null);
    try {
      /*
       * `acWriteWithMeta` and not `acWrite`: `meta` is where the whole answer is —
       * `already_pending` and `drain` — and `data` alone cannot tell a real requeue
       * from a row that was already in the queue, since both are 202. The first
       * draft of this called `acWrite` and then fetched the route again for the
       * meta, which retried the notification twice.
       */
      const { meta } = await acWriteWithMeta<unknown>("POST", `/notifications/${id}/retry`);
      const parsed = retryMeta.safeParse(meta);

      setOutcome(
        parsed.success
          ? retryOutcome(parsed.data)
          : // The 202 is the success; a meta the panel cannot parse does not turn
            // it into a failure, it just costs the sentence its detail.
            { requeued: true, drain: "" },
      );

      /*
       * Re-read rather than rebind. The retry answers a **list row** — no `message`
       * key on it, measured — so binding the screen to the response would blank the
       * quoted record on a screen that was working a moment ago.
       */
      await onRetried();
    } catch (thrown) {
      const apiError = thrown as BrowserApiError;
      const details = sentConflictDetails.safeParse(apiError.details ?? {});
      setFailure({
        message: apiError.message,
        sentAt: details.success ? sentConflict(details.data) : null,
      });
    } finally {
      setPending(false);
    }
  };

  return { pending, outcome, failure, run };
}

/**
 * What the retry answered, and why it is a `Notice` rather than a `Toast`.
 *
 * §3.1: "an error a person must act on is not a toast" — and that rule is really
 * about *acting*. The 202's `meta.drain` names **the command that actually sends
 * the mail**, so the confirmation carries a string somebody has to read, copy and
 * run, and four seconds would take it away mid-sentence. That is the campaign
 * composer's `send` reasoning one screen over.
 *
 * **The headline is the negative.** A spinner resolving into a checkmark would
 * read as "sent" to every operator who has ever used software, and they would tell
 * the customer so. So: nothing has been sent, *then* requeued-versus-already-
 * pending, *then* the command.
 */
function RetryNotice({
  outcome,
  failure,
  locale,
}: {
  outcome: RetryOutcome | null;
  failure: RetryFailure | null;
  locale: string;
}) {
  const t = useTranslations("notifications");

  return (
    <>
      {outcome ? (
        <div data-testid="retry-result">
          {/* `warning`, not `success`: the row is back in the queue and the work
              is not done. `role="status"` — it is polite, because the person
              caused it. */}
          <Notice tone="warning" title={t("retry.nothingSent")}>
            <p className="text-ui-label">
              {outcome.requeued ? t("retry.requeued") : t("retry.alreadyPending")}
            </p>
            {outcome.drain !== "" ? (
              <>
                <p className="text-ui-label">{t("retry.drainLabel")}</p>
                {/* A shell command is an identifier, not prose: it must not
                    reorder in Arabic, and it is the string somebody copies. */}
                <Ltr
                  numeric={false}
                  className="ui-scroll rounded-ui-sm bg-ui-surface px-2 py-1 font-mono text-ui-caption text-ui-fg"
                >
                  {outcome.drain}
                </Ltr>
              </>
            ) : null}
          </Notice>
        </div>
      ) : null}

      {failure ? (
        <div data-testid="retry-failure">
          {/*
            The API's own sentence as the headline, because a 409 is the one class
            §3.7 says to surface verbatim — it says what to do instead. `role`
            stays `alert`: this one interrupts.
          */}
          <Notice tone="danger" role="alert" title={failure.message}>
            {/*
              The 409 names `sent_at`, and that date is the whole reason the
              refusal is correct: re-queueing would deliver a body frozen when it
              was queued, so an order refunded since would still send the
              confirmation that was true when it was placed.
            */}
            {failure.sentAt !== null ? (
              <p className="text-ui-label">
                <Isolate>
                  {t("retry.alreadySentOn", { date: formatDate(failure.sentAt, locale) })}
                </Isolate>
              </p>
            ) : null}
          </Notice>
        </div>
      ) : null}
    </>
  );
}
