"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Customer } from "@/lib/api/schemas/customer";
import { acRead } from "@/lib/api/browser";
import { customerName } from "@/lib/customers";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState, StaleBanner } from "@/components/patterns/States";
import { ListGroup, ListLinkRow } from "@/components/primitives/GroupedList";
import { Segmented } from "@/components/primitives/Segmented";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { CustomerRow } from "./CustomerRow";
import { RowSkeleton } from "../inventory/RowSkeleton";
import {
  ORDERBY,
  PER_PAGE,
  customersKey,
  isFiltered,
  listParams,
  queryFromParams,
  toUrlParams,
  type CustomersQuery,
  type OrderBy,
} from "./query";

async function fetchCustomers(query: CustomersQuery) {
  const { data, total } = await acRead<Customer[]>(`/customers?${listParams(query)}`);
  return { customers: data, total };
}

/**
 * The customer list.
 *
 * **There is no filter sheet, and its absence is the design.** `/customers` takes
 * `search`, `orderby`, `order` and pagination — measured one parameter at a time
 * against the live router — and nothing else. No paying-customer filter, no date
 * range, no consent. So the screen carries a search field and a sort control and
 * stops, because this API's failure mode is that **an unknown parameter answers
 * 200 with the full result set**: `?role=administrator` returns all 16 rows,
 * identical to no filter at all. A control that silently does nothing is
 * indistinguishable, on screen, from one that works.
 *
 * The consequence worth stating out loud: 4 of the 16 are `is_paying_customer`
 * and there is no way to ask the API for them, so "our best customers" is not a
 * screen this endpoint can produce. The rows are badged and that is the whole of
 * what the panel can honestly offer.
 */
export function CustomersList({
  locale,
  initialQuery,
  initialCustomers,
  initialTotal,
}: {
  locale: string;
  initialQuery: CustomersQuery;
  initialCustomers: Customer[] | null;
  initialTotal: number | null;
}) {
  const t = useTranslations("customers");
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = queryFromParams(new URLSearchParams(searchParams.toString()));
  const [searchDraft, setSearchDraft] = useState(query.search);

  const commit = (next: CustomersQuery, options: { resetPage?: boolean } = {}) => {
    const target = options.resetPage === false ? next : { ...next, page: 1 };
    const params = toUrlParams(target);
    // `push`, not `replace` — filter state in the URL is only half the promise
    // and a working back button is the other half.
    router.push(`/${locale}/customers${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  };

  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: customersKey(query),
    queryFn: () => fetchCustomers(query),
    initialData:
      initialCustomers !== null &&
      customersKey(query).join("|") === customersKey(initialQuery).join("|")
        ? { customers: initialCustomers, total: initialTotal ?? initialCustomers.length }
        : undefined,
    placeholderData: keepPreviousData,
  });

  const customers = data?.customers ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = isFiltered(query);

  /*
   * **The search box says what it searches, and it is not the name.**
   *
   * Measured with a positive control on 2026-08-19: customer 26 was given the
   * names `Zqxwvu Plmokn`; `?search=Zqxwvu` returned 0 rows and
   * `?search=cus_fresh` returned 1. `?search=` matches `user_login`, `user_email`
   * and `display_name` — never `first_name` or `last_name` — so Amina Benali, the
   * one richly-populated customer in this shop, cannot be found by typing her
   * name.
   *
   * A box labelled "search customers" is therefore a promise the endpoint breaks,
   * and it breaks it silently: an unmatched search is an ordinary empty list. The
   * label names the two fields that work, and the empty state repeats it, because
   * the person who needs that sentence is the one already looking at no results.
   */
  const searchIsName =
    filtered && /^[\p{L}\s'-]+$/u.test(query.search) && !query.search.includes("@");

  return (
    <Scaffold
      title={t("title")}
      trailing={
        <button
          type="button"
          onClick={() => void refetch()}
          aria-label={t("refresh")}
          className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
        >
          <Icon name="refresh" className={isFetching ? "size-5 spin" : "size-5"} />
        </button>
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

          {/*
            Two sorts, not four. The API accepts `ID` and `display_name` as well,
            and neither is offerable: `display_name` is not a field on a customer
            — the payload has `username`, `first_name` and `last_name` and no
            `display_name` at all — and it returned a byte-identical sequence to
            `user_email` across all 16 rows, because every display name here *is*
            the username and every username is the local part of the email. A
            "sort by name" control would sort by a key the reader cannot see, and
            put Amina Benali under A-C.
          */}
          <Segmented<OrderBy>
            segments={ORDERBY.map((value) => ({ value, label: t(`sort.${value}`) }))}
            value={ORDERBY.includes(query.orderby) ? query.orderby : "registered"}
            onChange={(orderby) => commit({ ...query, orderby })}
            label={t("sortLabel")}
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
          data-testid="customers-count"
        >
          <Isolate numeric>{t("count", { total })}</Isolate>
        </p>

        {isPending && customers.length === 0 ? (
          <RowSkeleton />
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : customers.length === 0 ? (
          <EmptyState
            message={
              filtered
                ? searchIsName
                  ? t("empty.searchIsName")
                  : t("empty.noResults")
                : t("empty.none")
            }
            action={
              filtered
                ? {
                    label: t("empty.clear"),
                    onClick: () => {
                      setSearchDraft("");
                      commit({ ...query, search: "" });
                    },
                  }
                : undefined
            }
          />
        ) : (
          <>
            <ListGroup>
              {customers.map((customer) => (
                <ListLinkRow
                  key={customer.id}
                  href={`/${locale}/customers/${customer.id}`}
                  ariaLabel={customerName(customer).text}
                >
                  <CustomerRow customer={customer} />
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
