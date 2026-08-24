"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Customer } from "@/lib/api/schemas/customer";
import { acRead } from "@/lib/api/browser";
import { looksLikeAName } from "@/lib/customers";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import {
  DataTable,
  TableControls,
  TableFooter,
  useTablePreferences,
} from "@/components/ui/DataTable";
import { FilterRow, SearchField } from "@/components/ui/FilterBar";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { RecordListSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { ButtonLink, IconButton } from "@/components/ui/Button";
import { Isolate } from "@/components/primitives/Ltr";
import { buildColumns, customerRecord, type CustomerColumnContext } from "./columns";
import {
  customersKey,
  isFiltered,
  listParams,
  queryFromParams,
  toUrlParams,
  type CustomersQuery,
} from "./query";

async function fetchCustomers(query: CustomersQuery) {
  const { data, total } = await acRead<Customer[]>(`/customers?${listParams(query)}`);
  return { customers: data, total };
}

/**
 * The customer list, rebuilt on the new design system.
 *
 * ## There is one control, and its absence of siblings is the design
 *
 * `/customers` takes `search`, `orderby`, `order` and pagination — measured one
 * parameter at a time against the live router — and nothing else. No
 * paying-customer filter, no date range, no consent filter. So there is no
 * filter drawer here at all, because this API's failure mode is that **an
 * unknown parameter answers 200 with the full result set**: `?role=administrator`
 * returns all 16 rows, identical to no filter at all, and a control that
 * silently does nothing is indistinguishable on screen from one that works.
 *
 * The consequence worth stating out loud: 4 of the 16 are `is_paying_customer`
 * and there is no way to ask the API for them, so "our best customers" is not a
 * screen this endpoint can produce. The rows are badged and that is the whole of
 * what the panel can honestly offer.
 *
 * There are no filter chips either, for a smaller reason: with one filter the
 * chip would sit beside the search box repeating the term already visible in it.
 *
 * **And no sortable columns**, which is Orders' position rather than Products'.
 * `orderby` is accepted here and validated here, and nothing anywhere records a
 * positive control showing that either offerable value actually reorders a
 * result set. `columns.tsx` carries the full argument and the reason `query.ts`
 * reads as though it does. The `orderby`/`order` guard in `query.ts` stays
 * regardless: a stale or hand-edited URL must not be able to provoke a 400 this
 * screen then has to render as an error.
 *
 * ## The row navigates, and there is no peek
 *
 * The first list in this run where the default does not apply. `columns.tsx`
 * carries the argument: the detail is the row **plus `statistics`**, so a free
 * preview would show nothing new and a useful one costs a request per open.
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
  const tA11y = useTranslations("a11y");
  const tStates = useTranslations("states");
  const router = useRouter();
  const searchParams = useSearchParams();

  /* Every piece of list state lives in the URL on this screen — see `query.ts`
     for why it differs from the products list, which holds page and per-page in
     component state. */
  const query = useMemo(
    () => queryFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  /*
   * The fifth state. When the browser is certain it is offline, the rows on
   * screen are as old as the last successful fetch and staleness is never
   * silent. `navigator.onLine` is trusted in one direction only — it reports the
   * interface rather than reachability — which is why the refresh control stays
   * enabled below.
   */
  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: customersKey(query),
    queryFn: () => fetchCustomers(query),
    initialData:
      initialCustomers !== null &&
      customersKey(query)[1] === customersKey(initialQuery)[1]
        ? { customers: initialCustomers, total: initialTotal ?? initialCustomers.length }
        : undefined,
    /* Keeps the previous page on screen while the next loads, so changing the
       search or the page never flashes a skeleton over content still valid. */
    placeholderData: keepPreviousData,
  });

  const customers = data?.customers ?? [];
  const total = data?.total ?? 0;
  const filtered = isFiltered(query);

  /*
   * Not wrapped in `useCallback`. The React Compiler is on in this project and
   * memoizes this already; a manual dependency list disagreeing with the
   * compiler's inference makes it skip optimising the whole component.
   */
  function commit(next: CustomersQuery) {
    const params = toUrlParams(next);
    /* `push`, not `replace`. Filter state living in the URL is only half the
       promise; the other half is that the back button works, and `replace`
       overwrites the current entry so going back from a searched list skips the
       unsearched one. This suite asserts it. */
    router.push(`/${locale}/customers${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  /* A new filter resets to page one; paging and per-page do not. */
  const commitFilter = (next: CustomersQuery) => commit({ ...next, page: 1 });

  /**
   * **The search box says what it searches, and it is not the name.**
   *
   * Measured with a positive control on 2026-08-19: customer 26 was given the
   * names `Zqxwvu Plmokn`; `?search=Zqxwvu` returned 0 rows and
   * `?search=cus_fresh` returned 1. `?search=` matches `user_login`,
   * `user_email` and `display_name` — never `first_name` or `last_name` — so
   * Amina Benali, the one richly-populated customer in this shop, cannot be
   * found by typing her name.
   *
   * A box labelled "search customers" is therefore a promise the endpoint breaks,
   * and it breaks it silently: an unmatched search is an ordinary empty list. The
   * label names the two fields that work, and the empty state repeats it, because
   * the person who needs that sentence is the one already looking at no results.
   */
  const searchIsName = filtered && looksLikeAName(query.search);

  const ctx: CustomerColumnContext = useMemo(() => ({ locale, t }), [locale, t]);
  const columns = useMemo(() => buildColumns(ctx), [ctx]);

  /* Held here rather than inside `DataTable` so the controls sit in the toolbar
     beside the search field instead of floating above the card. */
  const preferences = useTablePreferences("customers", columns);

  const clearSearch = () => commitFilter({ ...query, search: "" });
  const offlineReason = tStates("offlineWrites");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        /*
         * The visible count, and the testid five assertions reach for — including
         * one that measures glyph positions to prove an Arabic sentence starts at
         * the right. `Isolate` and never `Ltr`: this is a translated sentence with
         * a number in it, not an identifier, and forcing LTR laid "16 عميلًا" out
         * from the left. README:435-438 records that rule burning sixteen call
         * sites.
         */
        subtitle={
          <span data-testid="customers-count">
            <Isolate>{t("count", { total })}</Isolate>
          </span>
        }
        actions={
          <>
            <IconButton
              label={t("refresh")}
              icon="refresh"
              variant="secondary"
              onClick={() => void refetch()}
              loading={isFetching}
            />
            {/* A real link, so the browser performs the download and the
                credential is attached server-side — never in the document. Its
                capability is `ac_manage_customers`, the same one gating this
                whole screen, so there is no second gate to apply.

                Disabled while the browser reports itself offline: this one
                genuinely leaves the page, and navigating to a route that cannot
                answer replaces the panel with the browser's own error page. */}
            <ButtonLink
              href="/api/export/customers"
              variant="secondary"
              icon="download"
              prefetch={false}
              disabled={!online}
              title={online ? undefined : offlineReason}
            >
              {t("export")}
            </ButtonLink>
          </>
        }
        toolbar={
          <FilterRow>
            <SearchField
              value={query.search}
              onSubmit={(next) => commitFilter({ ...query, search: next })}
              placeholder={t("searchPlaceholder")}
              /* Names the two fields the endpoint actually matches. */
              label={t("searchLabel")}
              clearLabel={t("clearSearch")}
            />
            <div className="ms-auto">
              <TableControls
                columns={columns}
                visible={preferences.visible}
                onVisibleChange={preferences.setVisible}
                density={preferences.density}
                onDensityChange={preferences.setDensity}
              />
            </div>
          </FilterRow>
        }
      />

      <PageBody width="full">
        {!online && dataUpdatedAt > 0 ? (
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
        ) : null}

        {/* A live region, so a search that changes the result count announces it.
            Its own testid: `customers-count` above is the *visible* count and is
            what the suite asserts on, and two elements sharing one testid is a
            strict-mode violation the moment either is queried. */}
        <p aria-live="polite" className="sr-only" data-testid="customers-live">
          {tA11y("listUpdated", { total })}
        </p>

        {isPending && customers.length === 0 ? (
          <>
            <div className="hidden md:block">
              <TableSkeleton rows={8} cols={6} label={t("loading")} />
            </div>
            {/* The card and its padding are `DataTable`'s below `md`, so the
                skeleton wears them too — otherwise the rows shift 8px inward the
                moment the data lands. */}
            <div className="ui-card p-2 md:hidden">
              <RecordListSkeleton rows={6} label={t("loading")} />
            </div>
          </>
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : customers.length === 0 ? (
          <EmptyState
            icon={filtered ? "search" : "customers"}
            /*
             * **Two empty states, and the second one is the point.**
             *
             * `lib/customers.ts:45-60` measures that `?search=` never matches a
             * first or last name, so searching for a person by name returns an
             * ordinary empty list with nothing to say the field never had a
             * chance. `looksLikeAName()` catches that case and the message names
             * what is actually searched instead of reporting "no results".
             *
             * No-data offers nothing, and that is correct rather than
             * unfinished: `POST /customers` is not on the proxy allowlist and no
             * screen in this panel creates a customer — a shopper registers on
             * the storefront — so a "New customer" button here would 404.
             */
            message={
              filtered
                ? searchIsName
                  ? t("empty.searchIsName")
                  : t("empty.noResults")
                : t("empty.none")
            }
            action={filtered ? { label: t("empty.clear"), onClick: clearSearch } : undefined}
          />
        ) : (
          <DataTable
            preferences={preferences}
            rows={customers}
            columns={columns}
            rowKey={(customer) => String(customer.id)}
            rowLabel={(customer) => tA11y("customerName", { name: customer.email })}
            record={(customer) => customerRecord(customer, ctx)}
            /* Navigates rather than previewing — see `columns.tsx`. The name cell
               is a real anchor on top of this, for the keyboard and the middle
               click; it stops propagation so only one push happens. */
            onRowClick={(customer) => router.push(`/${locale}/customers/${customer.id}`)}
            /* No `sort` and no `onSortChange` — `columns.tsx` carries the whole
               argument. Passing neither is what keeps `aria-sort` off the
               headers too: the primitive gates the attribute on a handler
               existing, precisely so a table cannot announce itself sortable by
               columns nothing on screen can sort. */
            footer={
              <TableFooter
                page={query.page}
                perPage={query.perPage}
                total={total}
                onPageChange={(page) => commit({ ...query, page })}
                onPerPageChange={(perPage) => commit({ ...query, perPage, page: 1 })}
              />
            }
          />
        )}
      </PageBody>
    </div>
  );
}
