"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Coupon } from "@/lib/api/schemas/coupon";
import { acRead } from "@/lib/api/browser";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState, StaleBanner } from "@/components/patterns/States";
import { ListGroup, ListLinkRow } from "@/components/primitives/GroupedList";
import { Segmented } from "@/components/primitives/Segmented";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { CouponRow } from "./CouponRow";
import { RowSkeleton } from "../inventory/RowSkeleton";
import {
  PER_PAGE,
  STATUS_FILTERS,
  couponsKey,
  isFiltered,
  listParams,
  queryFromParams,
  toUrlParams,
  type CouponsQuery,
  type StatusFilter,
} from "./query";

async function fetchCoupons(query: CouponsQuery) {
  const { data, total } = await acRead<Coupon[]>(`/coupons?${listParams(query)}`);
  return { coupons: data, total };
}

/**
 * The coupon list.
 *
 * **The status segments are three, and the first sends no parameter at all.**
 * Measured: with no `?status=`, the list returns publish *and* draft together —
 * so "all" is the absence of the filter rather than a value, and a segmented
 * control whose first segment sends `?status=` with an empty string would put a
 * meaningless parameter in every URL for the same result.
 *
 * A draft coupon sitting among live ones is the reason the row badges it: nothing
 * else on the row distinguishes them, and a draft does not discount anything.
 */
export function CouponsList({
  locale,
  currency,
  initialQuery,
  initialCoupons,
  initialTotal,
}: {
  locale: string;
  currency: string;
  initialQuery: CouponsQuery;
  initialCoupons: Coupon[] | null;
  initialTotal: number | null;
}) {
  const t = useTranslations("coupons");
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = queryFromParams(new URLSearchParams(searchParams.toString()));
  const [searchDraft, setSearchDraft] = useState(query.search);

  /*
   * One clock for the whole list, taken on render rather than per row.
   *
   * Every row asks whether its expiry has passed, and `new Date()` inside a row
   * would give twenty slightly different answers and re-derive on every keystroke
   * in the search box. It also makes the expiry rendering testable, which a
   * `Date` created inside a leaf component is not.
   */
  const now = new Date();

  const commit = (next: CouponsQuery, options: { resetPage?: boolean } = {}) => {
    const target = options.resetPage === false ? next : { ...next, page: 1 };
    const params = toUrlParams(target);
    router.push(`/${locale}/coupons${params.size > 0 ? `?${params}` : ""}`, { scroll: false });
  };

  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: couponsKey(query),
    queryFn: () => fetchCoupons(query),
    initialData:
      initialCoupons !== null &&
      couponsKey(query).join("|") === couponsKey(initialQuery).join("|")
        ? { coupons: initialCoupons, total: initialTotal ?? initialCoupons.length }
        : undefined,
    placeholderData: keepPreviousData,
  });

  const coupons = data?.coupons ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = isFiltered(query);

  return (
    <Scaffold
      title={t("title")}
      trailing={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void refetch()}
            aria-label={t("refresh")}
            className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
          >
            <Icon name="refresh" className={isFetching ? "size-5 spin" : "size-5"} />
          </button>
          {/*
            Create is a nav-bar action rather than a floating button: the tab bar
            already owns the bottom edge at the 390px floor, and a FAB over a list
            covers the last row.
          */}
          <a
            href={`/${locale}/coupons/new`}
            aria-label={t("create")}
            className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
          >
            <Icon name="plus" className="size-5" />
          </a>
        </div>
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              commit({ ...query, search: searchDraft.trim() });
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
                  commit({ ...query, search: "" });
                }}
                aria-label={t("clearSearch")}
                className="press flex size-8 items-center justify-center rounded-full text-label-secondary"
              >
                <Icon name="close" className="size-4" />
              </button>
            ) : null}
          </form>

          <Segmented<StatusFilter>
            segments={STATUS_FILTERS.map((value) => ({
              value,
              label: value === "" ? t("status.all") : t(`status.${value}`),
            }))}
            value={query.status}
            onChange={(status) => commit({ ...query, status })}
            label={t("statusLabel")}
          />
        </div>
      }
    >
      {!online && dataUpdatedAt > 0 ? (
        <div className="mx-auto max-w-3xl">
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
        </div>
      ) : null}

      <div className="mx-auto max-w-3xl px-4">
        <p
          aria-live="polite"
          className="mb-2 px-1 text-footnote text-label-secondary"
          data-testid="coupons-count"
        >
          <Isolate numeric>{t("count", { total })}</Isolate>
        </p>

        {isPending && coupons.length === 0 ? (
          <RowSkeleton rows={5} />
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : coupons.length === 0 ? (
          <EmptyState
            message={filtered ? t("empty.noResults") : t("empty.none")}
            action={
              filtered
                ? {
                    label: t("empty.clear"),
                    onClick: () => {
                      setSearchDraft("");
                      commit({ ...query, search: "", status: "" });
                    },
                  }
                : undefined
            }
          />
        ) : (
          <>
            <ListGroup>
              {coupons.map((coupon) => (
                <ListLinkRow
                  key={coupon.id}
                  href={`/${locale}/coupons/${coupon.id}`}
                  ariaLabel={coupon.code}
                >
                  <CouponRow
                    coupon={coupon}
                    currency={currency}
                    locale={locale}
                    now={now}
                  />
                </ListLinkRow>
              ))}
            </ListGroup>

            {total > PER_PAGE ? (
              <nav className="mb-8 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={query.page <= 1}
                  onClick={() =>
                    commit({ ...query, page: Math.max(1, query.page - 1) }, { resetPage: false })
                  }
                  aria-label={t("previousPage")}
                  className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
                >
                  <Icon name="back" flipInRtl className="size-5" />
                </button>
                <span className="text-footnote text-label-secondary">
                  <Ltr numeric>
                    {query.page} / {pageCount}
                  </Ltr>
                </span>
                <button
                  type="button"
                  disabled={query.page >= pageCount}
                  onClick={() => commit({ ...query, page: query.page + 1 }, { resetPage: false })}
                  aria-label={t("nextPage")}
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
