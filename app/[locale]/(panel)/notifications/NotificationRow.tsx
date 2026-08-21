"use client";

import { useTranslations } from "next-intl";
import type { Notification } from "@/lib/api/schemas/notification";
import {
  STATE_TONE,
  isKnownChannel,
  eventMessageKey,
  isNotificationEvent,
  queueState,
} from "@/lib/notifications";
import { formatDate, formatWhen } from "@/lib/format/date";
import { useHydrated } from "@/lib/use-hydrated";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Ltr, Isolate } from "@/components/primitives/Ltr";

/**
 * One row of the queue.
 *
 * **The badge is the derived state, not `status`.** A row that has been tried
 * and failed retryably is still `status: "pending"` — `markFailed()` writes it —
 * so a list badged on `status` alone shows a row the drain has already choked on
 * as though nothing had happened to it. That distinction is the entire reason an
 * operator opens this screen, so it is the most prominent thing on the row.
 *
 * Three lines at the 390px floor, and the third only exists when something went
 * wrong:
 *
 *   Paiement reçu                              [Échec]
 *   karim.mansouri@example.test    ·     il y a 2 heures
 *   « wp_mail() did not accept the message. »
 */
export function NotificationRow({
  notification,
  locale,
  now,
}: {
  notification: Notification;
  locale: string;
  /** One clock for the list, taken on render — not `new Date()` per row. */
  now: Date;
}) {
  const t = useTranslations("notifications");
  const state = queueState(notification);

  /**
   * **Relative time cannot be server-rendered, and this is the screen where that
   * finally bites.**
   *
   * `formatWhen` is relative under 24 hours, so a row queued a minute ago renders
   * "il y a une minute" on the server and "il y a 2 minutes" on the client a
   * moment later. React reported it as a hydration mismatch and regenerated the
   * whole tree — found in the dev log after **all eight e2e tests passed**, since
   * nothing on screen looks wrong afterwards.
   *
   * `formatWhen` is used unguarded on a dozen other screens and none of them show
   * it, because their rows are hours or days old and `formatWhen` falls back to
   * the absolute form past 24 hours. This queue is the only screen whose rows are
   * minutes old — the seed writes them at run time. The latent version elsewhere
   * is recorded in README rather than fixed here.
   *
   * So the server renders the absolute date, which is stable, and the client
   * upgrades to relative once it owns the DOM. `useSyncExternalStore` is what
   * makes that exact rather than approximate — it is specified to return the
   * server snapshot during SSR and the client one from the first client render,
   * with no frame in between.
   */
  const hydrated = useHydrated();

  /*
   * An event this build has no name for renders as its own key rather than as a
   * blank. `NOTIFICATION_EVENTS` is a copy of a server-side constant with no
   * contract keeping the two in step — the same argument `unknownSectionTypes()`
   * makes for the homepage — and a ninth event must not produce an empty row.
   */
  const event = isNotificationEvent(notification.event)
    ? t(`event.${eventMessageKey(notification.event)}`)
    : notification.event;

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <div className="flex min-h-6 items-center gap-2">
        <span className="truncate text-body text-label">{event}</span>
        <StatusBadge tone={STATE_TONE[state]} className="ms-auto">
          {t(`state.${state}`)}
        </StatusBadge>
      </div>

      <div className="flex min-w-0 items-baseline gap-2">
        {/*
          An address is an identifier and reorders inside Arabic text without
          isolation — a recipient read back wrong is a mail to a stranger.
          `numeric={false}` because it is not a figure.
        */}
        <Ltr numeric={false} className="min-w-0 truncate text-footnote text-label-secondary">
          {notification.recipient}
        </Ltr>
        <span className="ms-auto shrink-0 text-footnote text-label-secondary">
          {/* `Intl` formatted, so `Isolate` and never `Ltr`. */}
          <Isolate>
            {hydrated
              ? formatWhen(notification.created_at, locale, now)
              : formatDate(notification.created_at, locale)}
          </Isolate>
        </span>
      </div>

      {/*
        The two facts that qualify the badge, and only when they say something.

        `audience: "admin"` is 18 of the 39 rows measured and means the *shop* was
        being told, not the customer — a different question with a different
        owner, and a row that renders it identically buries that. A channel the
        panel has no label for is shown raw for the same reason an unknown event
        is.
      */}
      {(notification.audience === "admin" || notification.channel !== "email") ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {notification.audience === "admin" ? (
            <span className="text-caption text-label-tertiary">{t("audience.admin")}</span>
          ) : null}
          {notification.channel !== "email" ? (
            <span className="text-caption text-label-tertiary">
              {isKnownChannel(notification.channel)
                ? t(`channel.${notification.channel}`)
                : notification.channel}
            </span>
          ) : null}
        </div>
      ) : null}

      {/*
        The error, quoted rather than translated.

        `NotificationPresenter` calls this "whatever the SMTP server said". It is
        not — measured, `EmailChannel` only ever sees `wp_mail()` return a
        boolean, so the column holds one of three sentences this codebase wrote.
        But the set is not closed: a mail plugin filtering `wp_mail` can put
        anything here, and `markFailed()` truncates at 500 bytes on the way in.
        So it is presented as a quotation with its own direction — never as the
        panel's own sentence, and never keyed for translation.
      */}
      {notification.last_error !== null && state !== "sent" ? (
        <p
          dir="auto"
          className="line-clamp-2 text-caption text-label-tertiary"
          data-testid="row-error"
        >
          {t("errorQuote", { error: notification.last_error })}
        </p>
      ) : null}
    </div>
  );
}
