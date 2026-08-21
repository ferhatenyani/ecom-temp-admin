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
  isKnownChannel,
  isNotificationEvent,
  messageParagraphs,
  queueState,
  retryOutcome,
  sentConflict,
  type RetryOutcome,
} from "@/lib/notifications";
import { formatDate } from "@/lib/format/date";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ErrorState, SectionError } from "@/components/patterns/States";
import {
  ListGroup,
  ListLinkRow,
  ListRow,
  ListValueRow,
} from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";

/**
 * One notification: what was queued, what happened to it, and one action.
 *
 * The screen answers three questions in that order, which is the order an
 * operator asks them — *did it send*, *what did we actually say*, *where do I go
 * next* — and the message sits in the middle because it is the thing being
 * evidenced rather than the thing being managed.
 */
export function NotificationDetail({
  locale,
  initial,
}: {
  locale: string;
  initial: Detail;
}) {
  const t = useTranslations("notifications");
  const client = useQueryClient();

  const { data, isError, error, refetch } = useQuery({
    queryKey: ["notification", initial.id],
    queryFn: async () => {
      const { data } = await acRead<unknown>(`/notifications/${initial.id}`);
      return notificationDetail.parse(data);
    },
    initialData: initial,
  });

  const notification = data;
  const state = queueState(notification);

  const eventLabel = isNotificationEvent(notification.event)
    ? t(`event.${eventMessageKey(notification.event)}`)
    : notification.event;

  if (isError) {
    return (
      <Scaffold title={eventLabel} back={{ href: `/${locale}/notifications`, label: t("title") }}>
        <div className="mx-auto max-w-3xl px-4">
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        </div>
      </Scaffold>
    );
  }

  return (
    <Scaffold title={eventLabel} back={{ href: `/${locale}/notifications`, label: t("title") }}>
      <div className="mx-auto max-w-3xl px-4">
        <StatusCard />
        <RetrySection />
        <MessageCard />
        <DeliveryCard />
      </div>
    </Scaffold>
  );

  /* -------------------------------------------------------------- status --- */

  function StatusCard() {
    return (
      <ListGroup
        title={t("section.status")}
        /*
          The footnote states what `sent` actually claims. `wp_mail()` returning
          true means the message was handed to a transport without an error —
          `EmailChannel`'s own docblock says so — and delivery confirmation would
          need a provider with a webhook, which is §29's "potential channels"
          list rather than this one. A screen that says "delivered" here would be
          making a claim the shop cannot support to a customer on the phone.
        */
        footnote={state === "sent" ? t("sentMeans") : undefined}
      >
        <ListRow>
          <span className="text-body text-label-secondary">{t("field.state")}</span>
          <StatusBadge tone={STATE_TONE[state]} className="ms-auto">
            {t(`state.${state}`)}
          </StatusBadge>
        </ListRow>

        <ListValueRow
          label={t("field.created")}
          value={<Isolate>{formatDate(notification.created_at, locale)}</Isolate>}
        />

        {/*
          Only for a row that sent. `sent_at` is null on everything else, and a
          row reading "—" beside "Envoyé le" is a question rather than an answer.
        */}
        {notification.sent_at !== null ? (
          <ListValueRow
            label={t("field.sentAt")}
            value={<Isolate>{formatDate(notification.sent_at, locale)}</Isolate>}
          />
        ) : null}

        {/*
          Attempts, shown only once there have been some.

          It is the field that separates the two pending states — `markFailed()`
          writes `status: pending` for a retryable failure — so on a `retrying`
          row this is the number that explains the badge. Five is the ceiling
          (`MAX_ATTEMPTS`), and naming it is what tells an operator that a row on
          four is one drain from being parked.
        */}
        {notification.attempts > 0 ? (
          <ListValueRow
            label={t("field.attempts")}
            value={<Isolate numeric>{t("attemptsOf", { attempts: notification.attempts })}</Isolate>}
          />
        ) : null}

        {/*
          The error, quoted and never translated. See `NotificationRow` for why
          the set of possible strings is not closed enough to key on.
        */}
        {notification.last_error !== null ? (
          <ListRow className="items-start">
            <span className="shrink-0 text-body text-label-secondary">{t("field.lastError")}</span>
            <span
              dir="auto"
              className="ms-auto min-w-0 text-end text-footnote text-label"
              data-testid="last-error"
            >
              {t("errorQuote", { error: notification.last_error })}
            </span>
          </ListRow>
        ) : null}
      </ListGroup>
    );
  }

  /* --------------------------------------------------------------- retry --- */

  /**
   * The one action, and the one place this screen could mislead.
   *
   * **Retry is a 202 and it mails nothing.** It clears `status`, `attempts` and
   * `last_error` so the next drain picks the row up; the mail leaves when
   * something runs `wp algerian-commerce send-notifications`, which the response
   * names in `meta.drain`. So the confirmation is a persistent panel rather than
   * a toast, and it says what did *not* happen first — a spinner that resolves
   * into a checkmark would read as "sent" to every operator who has ever used
   * software, and they would tell the customer so.
   */
  function RetrySection() {
    const [pending, setPending] = useState(false);
    const [outcome, setOutcome] = useState<RetryOutcome | null>(null);
    const [failure, setFailure] = useState<{ message: string; sentAt: string | null } | null>(null);

    /*
     * A sent row is not offered the action at all — it is a 409 and the API is
     * right to refuse it. The conflict is still *handled* below, because a row
     * that sends between this render and the tap is exactly the race the
     * backend's conditional `UPDATE` exists for, and "read the 409 body" is a
     * house rule rather than a formality.
     */
    if (state === "sent") return null;

    const retry = async () => {
      setPending(true);
      setFailure(null);
      try {
        /*
         * `acWriteWithMeta` and not `acWrite`: `meta` is where the whole answer
         * is — `already_pending` and `drain` — and `data` alone cannot tell a
         * real requeue from a row that was already in the queue, since both are
         * 202. The first draft of this called `acWrite` and then fetched the
         * route again for the meta, which retried the notification twice.
         */
        const { meta } = await acWriteWithMeta<unknown>(
          "POST",
          `/notifications/${notification.id}/retry`,
        );
        const parsed = retryMeta.safeParse(meta);

        setOutcome(
          parsed.success
            ? retryOutcome(parsed.data)
            : // The 202 is the success; a meta the panel cannot parse does not
              // turn it into a failure, it just costs the sentence its detail.
              { requeued: true, drain: "" },
        );

        /*
         * Re-read rather than rebind. The retry answers a **list row** — no
         * `message` key on it, measured — so binding the screen to the response
         * would blank the quoted record on a screen that was working a moment
         * ago.
         */
        await refetch();
        await client.invalidateQueries({ queryKey: ["notifications"] });
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

    return (
      <ListGroup
        title={t("section.retry")}
        footnote={state === "queued" ? t("retry.alreadyQueuedNote") : undefined}
      >
        <ListRow className="flex-col items-stretch gap-3">
          <p className="text-footnote text-label-secondary">{t("retry.explain")}</p>
          <Button
            variant="tinted"
            loading={pending}
            onClick={() => void retry()}
            data-testid="retry"
          >
            {t("retry.action")}
          </Button>
        </ListRow>

        {outcome ? (
          <ListRow className="items-start">
            <div
              className="tone-warning tonal flex w-full flex-col gap-2 rounded-md px-3 py-3"
              role="status"
              data-testid="retry-result"
            >
              <span className="flex items-center gap-2 text-subhead font-medium">
                <Icon name="clock" className="size-4 shrink-0" />
                {/* The headline is the negative, deliberately. */}
                {t("retry.nothingSent")}
              </span>
              <span className="text-footnote">
                {outcome.requeued ? t("retry.requeued") : t("retry.alreadyPending")}
              </span>
              {outcome.drain !== "" ? (
                <>
                  <span className="text-caption text-label-secondary">{t("retry.drainLabel")}</span>
                  {/*
                    A shell command is an identifier, not prose: it must not
                    reorder in Arabic, and it is the string somebody copies.
                  */}
                  <Ltr
                    numeric={false}
                    className="overflow-x-auto rounded-sm bg-surface-2 px-2 py-1 font-mono text-caption text-label"
                  >
                    {outcome.drain}
                  </Ltr>
                </>
              ) : null}
            </div>
          </ListRow>
        ) : null}

        {failure ? (
          <ListRow className="items-start">
            <div className="flex w-full flex-col gap-1" data-testid="retry-failure">
              <SectionError>
                <span className="text-label">{failure.message}</span>
              </SectionError>
              {/*
                The 409 names `sent_at`, and that date is the whole reason the
                refusal is correct: re-queueing would deliver a body frozen when
                it was queued, so an order refunded since would still send the
                confirmation that was true when it was placed.
              */}
              {failure.sentAt !== null ? (
                <p className="px-4 text-caption text-label-secondary">
                  <Isolate>
                    {t("retry.alreadySentOn", { date: formatDate(failure.sentAt, locale) })}
                  </Isolate>
                </p>
              ) : null}
            </div>
          </ListRow>
        ) : null}
      </ListGroup>
    );
  }

  /* ------------------------------------------------------------- message --- */

  function MessageCard() {
    const message = notification.message;

    /*
     * **`readable: false` is what the drain saw, not an empty message.**
     *
     * `NotificationPresenter::message()` reports it when the stored payload will
     * not decode, and `drain()` marks exactly that row permanently failed without
     * attempting a send. So the screen states the shape of the problem in the
     * reader's language and does not pretend to quote anything — the same
     * treatment the homepage's drop report gets.
     */
    if (!message.readable) {
      return (
        <ListGroup title={t("section.message")} footnote={t("message.unreadableNote")}>
          <ListRow className="items-start">
            <Icon name="alert" className="tone-danger tonal-fg size-5 shrink-0" />
            <span className="text-body text-label-secondary">{t("message.unreadable")}</span>
          </ListRow>
        </ListGroup>
      );
    }

    const paragraphs = messageParagraphs(message.body);

    return (
      <ListGroup
        title={t("section.message")}
        /*
          **The footnote is what keeps this card honest.** The body is a record
          of what was queued, frozen at queue time, and it is bilingual by
          accident — a French salutation over an English sentence, straight out
          of `NotificationMessages`. It renders verbatim because translating it
          would show something the customer never received. Saying so is what
          stops it reading as panel copy that somebody forgot to translate.
        */
        footnote={t("message.frozenNote")}
      >
        <ListRow className="items-start">
          <blockquote
            /*
              `dir="auto"` on the quote and on every paragraph inside it: this is
              the one block on the screen that is not in the page's language, and
              its direction is a property of the text rather than of the panel.
              A future Arabic template would then lay out correctly inside a
              French UI without another line of code.

              **Set apart by surface, not by a leading rule.** The first version
              gave it a two-pixel inline-start border and `check-design.sh`
              refused it, correctly: a coloured leading border is the banned
              accent bar, and the rule does not care that this one marks a
              quotation rather than a status. The house grammar for "this block
              is not the surrounding surface" is a surface step — which is also
              the better answer here, because a quote that is visibly its own
              material reads as a record rather than as chrome, which is the
              whole point of the framing.

              (The check greps source text, so naming that utility literally in
              this comment failed the run a second time. Worth knowing before
              documenting a banned class anywhere in this codebase.)
            */
            dir="auto"
            className="flex w-full min-w-0 flex-col gap-3 rounded-md bg-surface-2 px-3 py-3"
            data-testid="message"
          >
            <p className="text-headline text-label">{message.subject}</p>
            {paragraphs.map((paragraph, index) => (
              <p
                key={index}
                dir="auto"
                /* `whitespace-pre-line` keeps a single newline inside a
                   paragraph — an address block in a shipping notification is
                   several lines and one of them is a wilaya. */
                className="whitespace-pre-line text-footnote text-label-secondary"
              >
                {paragraph}
              </p>
            ))}
          </blockquote>
        </ListRow>
      </ListGroup>
    );
  }

  /* ------------------------------------------------------------ delivery --- */

  function DeliveryCard() {
    const subjectId = notification.subject_id;

    return (
      <ListGroup title={t("section.delivery")}>
        <ListValueRow
          label={t("field.recipient")}
          value={<Ltr numeric={false}>{notification.recipient}</Ltr>}
        />
        {/*
          The audience, always. Unlike the row, where it is shown only when it is
          `admin`, the detail states it either way: this is the screen where
          somebody decides whether a failure is a customer's problem or the
          shop's, and an unstated default is not an answer.
        */}
        <ListValueRow
          label={t("field.audience")}
          value={t(`audience.${notification.audience === "admin" ? "admin" : "customer"}`)}
        />
        <ListValueRow
          label={t("field.channel")}
          value={
            isKnownChannel(notification.channel)
              ? t(`channel.${notification.channel}`)
              : /* A channel this build has no name for is shown as itself. §29's
                   other four are one class and one `add()` away on the backend. */
                <Ltr numeric={false}>{notification.channel}</Ltr>
          }
        />
        {/*
          **No `Événement` row.** It printed `order.placed` directly above a
          `Clé` row reading `order.placed:4579` — the same string twice in a
          hundred pixels, which is the defect the inventory branch found with a
          product name and the customers branch avoids by dropping a username
          equal to the email. The key carries the event, and the page title
          already names it in the reader's language.
        */}

        {/*
          The dedupe key, which is the string an operator quotes in a ticket and
          the one filter that answers "this event, for this order" exactly.
          Tapping it filters the list rather than copying — the panel has no
          clipboard affordance anywhere and inventing one here would be a gesture
          nobody has been taught.
        */}
        <ListLinkRow
          href={`/${locale}/notifications?dedupe_key=${encodeURIComponent(notification.dedupe_key)}`}
          ariaLabel={t("field.dedupeKey")}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="shrink-0 text-body text-label-secondary">{t("field.dedupeKey")}</span>
            <Ltr numeric={false} className="ms-auto min-w-0 truncate text-end text-body text-label">
              {notification.dedupe_key}
            </Ltr>
          </span>
        </ListLinkRow>

        {/*
          The join back to what this is about. `subject_type` is `order` on every
          row this queue writes today, so the link is built for that and a future
          `product` subject — `stock.low` addresses one — renders as a value row
          rather than as a link to a screen that would 404.
        */}
        {subjectId !== null && notification.subject_type === "order" ? (
          <ListLinkRow href={`/${locale}/orders/${subjectId}`} ariaLabel={t("field.order")}>
            <span className="flex min-w-0 items-center gap-3">
              <span className="shrink-0 text-body text-label-secondary">{t("field.order")}</span>
              <Ltr className="ms-auto shrink-0 text-body text-label">#{subjectId}</Ltr>
            </span>
          </ListLinkRow>
        ) : subjectId !== null ? (
          <ListValueRow
            label={t("field.subject")}
            value={
              <Ltr numeric={false}>
                {notification.subject_type} #{subjectId}
              </Ltr>
            }
          />
        ) : null}

        {/*
          Everything else about this order, both audiences at once. This is the
          query `?subject_id=` was added to the API for on
          `feat/notification-filters` — before it, it was one request per event
          name.
        */}
        {subjectId !== null ? (
          <ListLinkRow
            href={`/${locale}/notifications?subject_id=${subjectId}`}
            ariaLabel={t("field.siblings")}
          >
            <span className="flex min-w-0 items-center gap-3">
              <Icon name="list" className="size-4 shrink-0 text-label-tertiary" />
              <span className="truncate text-body text-label">{t("field.siblings")}</span>
            </span>
          </ListLinkRow>
        ) : null}
      </ListGroup>
    );
  }
}
