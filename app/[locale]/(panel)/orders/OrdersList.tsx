"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Order, Wilaya } from "@/lib/api/schemas/order";
import { SEGMENT_STATUSES } from "@/lib/order-status";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/patterns/States";
import { ListGroup, ListLinkRow } from "@/components/primitives/GroupedList";
import { Segmented, type Segment } from "@/components/primitives/Segmented";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { OrderRow } from "./OrderRow";
import { PER_PAGE, fetchOrders, ordersKey, type OrdersQuery } from "./query";

type StatusFilter = "" | (typeof SEGMENT_STATUSES)[number];

export function OrdersList({
  locale,
  initialQuery,
  initialOrders,
  initialTotal,
  wilayas,
}: {
  locale: string;
  initialQuery: OrdersQuery;
  initialOrders: Order[] | null;
  initialTotal: number | null;
  wilayas: Wilaya[];
}) {
  const t = useTranslations("orders");
  const tShort = useTranslations("statusShort");
  const tA11y = useTranslations("a11y");
  const router = useRouter();
  const searchParams = useSearchParams();

  const status = (searchParams.get("status") ?? "") as StatusFilter;
  const search = searchParams.get("search") ?? "";
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState(search);

  const query: OrdersQuery = { status, search, page };

  const wilayasByCode = useMemo(
    () => new Map(wilayas.map((w) => [w.code, w])),
    [wilayas],
  );

  /**
   * This is the one list that polls: 30 s, paused when the document is hidden.
   * Nothing below 30 s, because reads are 600/min per credential and shared
   * across every tab this person has open.
   */
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ordersKey(query),
    queryFn: () => fetchOrders(query),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    // The server already fetched exactly this page, so first paint carries data.
    initialData:
      query.status === initialQuery.status &&
      query.search === initialQuery.search &&
      query.page === 1 &&
      initialOrders !== null
        ? { orders: initialOrders, total: initialTotal ?? initialOrders.length }
        : undefined,
    // Keeps the previous page on screen while the next one loads, so changing a
    // filter does not flash a skeleton over content that is still valid.
    placeholderData: keepPreviousData,
  });

  function setParam(next: Partial<{ status: string; search: string }>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setPage(1);
    /**
     * `push`, not `replace`. Filter state living in the URL is only half the
     * promise; the other half is that the back button works, and `replace`
     * overwrites the current entry so going back from a filtered list skips the
     * unfiltered one entirely and lands wherever the user was before the screen.
     *
     * Safe to push here because this runs on a segment change or a submitted
     * search — never per keystroke, which would fill the history with prefixes.
     */
    router.push(`/${locale}/orders${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  /*
    Short labels here, full ones everywhere else. Four segments share 390px minus
    the page gutters — about 88px each — and "En traitement" does not fit that,
    so it would truncate mid-word on the panel's most-used control. The badge on
    each row still carries the full status name.
  */
  const segments: Segment<StatusFilter>[] = [
    { value: "", label: t("all") },
    ...SEGMENT_STATUSES.map((s) => ({
      value: s as StatusFilter,
      label: tShort(s),
    })),
  ];

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;
  const hasFilter = status !== "" || search !== "";

  return (
    <Scaffold
      title={t("title")}
      trailing={
        <button
          type="button"
          onClick={() => void refetch()}
          aria-label={t("refreshed")}
          className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
        >
          <Icon name="refresh" className={isFetching ? "size-5 spin" : "size-5"} />
        </button>
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <Segmented
            segments={segments}
            value={status}
            onChange={(value) => setParam({ status: value })}
            label={t("status")}
          />

          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              setParam({ search: searchDraft.trim() });
            }}
            className="flex items-center gap-2 rounded-md bg-surface-2 px-3"
          >
            <Icon name="search" className="size-4 shrink-0 text-label-secondary" />
            <input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchLabel")}
              enterKeyHint="search"
              className="min-h-11 min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-tertiary"
            />
            {searchDraft ? (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft("");
                  setParam({ search: "" });
                }}
                /* Not "Effacer le filtre": that is the empty state's action, which
                   clears the status too. Two controls with one accessible name is
                   ambiguous to a screen reader and to a test. */
                aria-label={t("clearSearch")}
                className="press flex size-8 items-center justify-center rounded-full text-label-secondary"
              >
                <Icon name="close" className="size-4" />
              </button>
            ) : null}
          </form>
        </div>
      }
    >
      {/* Mobile-first, then allowed to grow — but not without limit. A grouped
          inset list stretched to 1400px puts the badge and the total a hand's
          width from the name they belong to, which is how iPadOS caps its own. */}
      <div className="mx-auto max-w-3xl px-4">
        {/* The count is a live region: a filter that changes the result count must
            announce it, or a screen-reader user has no idea anything happened. */}
        <p
          aria-live="polite"
          className="mb-2 px-1 text-footnote text-label-secondary"
          data-testid="orders-count"
        >
          <Isolate numeric>{t("count", { total })}</Isolate>
        </p>

        {isPending && orders.length === 0 ? (
          <SkeletonRows />
        ) : isError ? (
          <ErrorState
            message={(error as Error).message}
            onRetry={() => void refetch()}
          />
        ) : orders.length === 0 ? (
          <EmptyState
            message={hasFilter ? t("empty.noResults") : t("empty.noneYet")}
            action={
              hasFilter
                ? {
                    label: t("empty.clear"),
                    onClick: () => {
                      setSearchDraft("");
                      setParam({ status: "", search: "" });
                    },
                  }
                : undefined
            }
          />
        ) : (
          <>
            <ListGroup>
              {orders.map((order) => (
                <ListLinkRow
                  key={order.id}
                  href={`/${locale}/orders/${order.id}`}
                  ariaLabel={tA11y("orderNumber", { number: order.number })}
                >
                  <OrderRow order={order} locale={locale} wilayasByCode={wilayasByCode} />
                </ListLinkRow>
              ))}
            </ListGroup>

            {/* Pagination as "load more" would need an accumulating cache; page
                stepping keeps the query key honest and the URL shareable. */}
            {total > PER_PAGE ? (
              <nav className="mb-8 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
                >
                  <Icon name="back" flipInRtl className="size-5" />
                </button>
                <span className="text-footnote text-label-secondary">
                  <Ltr numeric>
                    {page} / {Math.max(1, Math.ceil(total / PER_PAGE))}
                  </Ltr>
                </span>
                <button
                  type="button"
                  disabled={page >= Math.ceil(total / PER_PAGE)}
                  onClick={() => setPage((p) => p + 1)}
                  className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
                >
                  <Icon name="chevron" flipInRtl className="size-5" />
                </button>
              </nav>
            ) : null}
          </>
        )}
      </div>
    </Scaffold>
  );
}
