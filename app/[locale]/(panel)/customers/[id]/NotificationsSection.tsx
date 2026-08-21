"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Notification } from "@/lib/api/schemas/notification";
import { acRead } from "@/lib/api/browser";
import { STATE_TONE, QUEUE_STATES, stateCounts } from "@/lib/notifications";
import { EmptyState, SectionError } from "@/components/patterns/States";
import { ListGroup, ListLinkRow } from "@/components/primitives/GroupedList";
import { Dot } from "@/components/primitives/StatusBadge";
import { Isolate } from "@/components/primitives/Ltr";
import { NotificationRow } from "../../notifications/NotificationRow";
import {
  CUSTOMER_PER_PAGE,
  customerNotificationsKey,
  customerNotificationsParams,
} from "../../notifications/query";

/**
 * This customer's own queue, on their detail screen.
 *
 * **One request, and it took a backend branch to make that true.** Measured
 * 2026-08-21 before `feat/notification-filters`: `?recipient=`, `?subject_id=`,
 * `?event=` and `?audience=` were all accepted and silently ignored, and
 * `?dedupe_key=` is exact-match-only (`?dedupe_key=payment.received` answers 0
 * rows). So the only way to build this was one request per order per event name
 * — four guesses per order on names the panel would have had to hard-code,
 * around thirty requests for an eight-order customer, most of them 200s with
 * nothing in them.
 *
 * `feat/cms-page-index` is the precedent and `feat/coupon-pickers` before it:
 * when a screen is not buildable as specified, the read goes into the API rather
 * than being assembled out of fan-out here.
 *
 * **It shares a reader with the top-level screen** — `NotificationRow` and the
 * `query.ts` beside it — rather than growing a second row shape. The list and
 * this section answer the same question about the same object; the only
 * difference is which rows and how many.
 *
 * Two things this section deliberately does not do:
 *
 *   No retry. The action lives on the notification's own screen, where the
 *   frozen message it would re-queue is visible. Retrying from a summary row is
 *   re-sending something you have not read.
 *
 *   No admin rows. It filters on `recipient`, which is this customer's address,
 *   so a `admin.new_order` about their order — addressed to the shop — is
 *   correctly absent. That is a fact worth knowing when a count here disagrees
 *   with the count on the order.
 */
export function NotificationsSection({
  locale,
  email,
}: {
  locale: string;
  /** The join. `recipient` on every `audience: "customer"` row is this address. */
  email: string;
}) {
  const t = useTranslations("notifications");
  const tCustomers = useTranslations("customers");
  const [page, setPage] = useState(1);
  const now = new Date();

  const { data, isPending, isError, error } = useQuery({
    queryKey: customerNotificationsKey(email, page),
    queryFn: async () => {
      const { data, total } = await acRead<Notification[]>(
        `/notifications?${customerNotificationsParams(email, page)}`,
      );
      return { notifications: data, total };
    },
    // A customer with no email cannot be joined on at all — `recipient` is the
    // key and an empty one would filter nothing and return the whole queue.
    enabled: email !== "",
    placeholderData: keepPreviousData,
  });

  if (email === "") {
    return (
      <ListGroup title={t("customerSection")}>
        <EmptyState message={t("customer.noEmail")} />
      </ListGroup>
    );
  }

  if (isPending) {
    return (
      <ListGroup title={t("customerSection")}>
        <div role="status" aria-busy="true" aria-label={tCustomers("title")}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="list-row flex items-center gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-h-6 items-center gap-2">
                  <div className="skeleton h-5 w-28 rounded-sm" />
                  <div className="skeleton ms-auto h-6 w-20 rounded-full" />
                </div>
                <div className="skeleton h-4.5 w-40 rounded-sm" />
              </div>
            </div>
          ))}
        </div>
      </ListGroup>
    );
  }

  if (isError) {
    return (
      <ListGroup title={t("customerSection")}>
        <SectionError>{(error as Error).message}</SectionError>
      </ListGroup>
    );
  }

  const notifications = data?.notifications ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / CUSTOMER_PER_PAGE));
  const counts = stateCounts(notifications);

  if (notifications.length === 0) {
    return (
      <ListGroup title={t("customerSection")} footnote={t("customer.noneNote")}>
        <EmptyState message={t("customer.none")} />
      </ListGroup>
    );
  }

  return (
    <ListGroup
      title={t("customerSection")}
      /*
        Says which rows these are, because the answer is not all of them: the
        filter is this person's address, so the shop's own alerts about their
        orders are not here. A count that quietly disagreed with the order screen
        would be read as a bug.
      */
      footnote={t("customer.scopeNote")}
    >
      <div className="list-row flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        {QUEUE_STATES.filter((state) => counts[state] > 0).map((state) => (
          <span key={state} className="flex items-center gap-1 text-caption text-label-tertiary">
            <Dot tone={STATE_TONE[state]} />
            <Isolate numeric>{t(`pageSummary.${state}`, { count: counts[state] })}</Isolate>
          </span>
        ))}
      </div>

      {notifications.map((notification) => (
        <ListLinkRow
          key={notification.id}
          href={`/${locale}/notifications/${notification.id}`}
          ariaLabel={notification.dedupe_key}
        >
          <NotificationRow notification={notification} locale={locale} now={now} />
        </ListLinkRow>
      ))}

      {total > CUSTOMER_PER_PAGE ? (
        <div className="list-row flex items-center justify-between gap-3 px-4 py-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="press min-h-11 rounded-md px-2 text-footnote text-accent disabled:opacity-40"
          >
            {t("previous")}
          </button>
          <span className="text-caption text-label-secondary">
            <Isolate numeric>{`${page} / ${pageCount}`}</Isolate>
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            className="press min-h-11 rounded-md px-2 text-footnote text-accent disabled:opacity-40"
          >
            {t("next")}
          </button>
        </div>
      ) : null}
    </ListGroup>
  );
}
