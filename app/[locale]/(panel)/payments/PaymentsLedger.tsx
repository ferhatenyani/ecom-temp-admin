"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { acRead } from "@/lib/api/browser";
import { providerLabel } from "@/lib/payments";
import type { Payment, PaymentMethod } from "@/lib/api/schemas/payment";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import {
  DataTable,
  TableControls,
  TableFooter,
  useTablePreferences,
} from "@/components/ui/DataTable";
import { FilterRow, FilterTabs, SearchField } from "@/components/ui/FilterBar";
import { DateField, Select } from "@/components/ui/Form";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { RecordListSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Button, IconButton } from "@/components/ui/Button";
import { Isolate } from "@/components/primitives/Ltr";
import {
  buildColumns,
  paymentOpenerId,
  paymentRecord,
  type PaymentColumnContext,
} from "./columns";
import { PaymentDrawer } from "./PaymentDrawer";
import {
  EMPTY_QUERY,
  STATUS_FILTERS,
  dayFromInput,
  isFiltered,
  isOverPaged,
  listParams,
  orderIdFromInput,
  paymentsKey,
  queryFromParams,
  toUrlParams,
  type PaymentsQuery,
  type StatusFilter,
} from "./query";

/**
 * The transactions ledger — the half of `/payments` that needs
 * `ac_manage_payments`.
 *
 * ## Four filter dimensions in one row, and no drawer
 *
 * Products needed a `Drawer` with draft-then-apply at nine dimensions. Four fit
 * a row: the status tabs above, then the order-number lookup, the method picker
 * and the two date bounds. A drawer for four controls is a click and a modal
 * between a person and a filter that was already on screen.
 *
 * **The status tabs are seven and the first sends no parameter.** The enum has
 * six values and the absence of the parameter is "every status" — and on this
 * collection `?status=` is a *400*, not an absence, so a first tab sending an
 * empty string would be a refusal rather than a redundant parameter.
 *
 * **The order-number box is `order_id`, not a search.** `?search=zzz` returns all
 * 45 rows; it is not a parameter of this route. `order_id` is an exact match on a
 * numeric key, so the box is submit-gated rather than firing per keystroke, and
 * non-digits are stripped rather than refused — a pasted "Commande 4586" means
 * 4586.
 *
 * **The method picker ships here where shipping's provider filter did not**, and
 * the difference is that `GET /payments/methods` enumerates *both* values the
 * collection carries (`cod` 43, `chargily` 2, summing to 45) where
 * `/shipping/providers` enumerated one of two. A picker built from a complete
 * allowlisted enumeration can offer every value that matters and cannot express a
 * typo, so `?provider=zzz`'s silent 200 is never reachable through it.
 *
 * ## What this screen deliberately does not ship
 *
 * **No sorting and no `aria-sort`** — see `columns.tsx`. **No search box** — not a
 * parameter here. **No `reference` filter**, though the parameter is honoured:
 * the column holds two distinct values across 45 rows and a typo answers a silent
 * 200. **No bulk and no export** — payments is not in `EXPORT_SUBJECTS`, so an
 * export control would point at a route that does not exist. **No create**:
 * `POST /orders/{id}/payments` mints a real customer checkout link and the proxy
 * allowlist refuses it deliberately, which is why `PageHeader` carries no primary
 * action. `query.ts` carries every measurement.
 *
 * ## The stale marker stays
 *
 * §3.7's amendment exempts a screen that cannot hold data older than its own last
 * fetch. This is not one: it is a client component over a react-query cache with
 * a manual refresh **and it writes** — the drawer verifies — so both halves of the
 * rule bite. The COD report below is server-rendered and read-only and carries no
 * second marker; `CodFunnel`'s docblock says so.
 */
export function PaymentsLedger({
  locale,
  initialQuery,
  initialPayments,
  initialTotal,
  methods,
  funnel,
}: {
  locale: string;
  initialQuery: PaymentsQuery;
  initialPayments: Payment[] | null;
  initialTotal: number | null;
  methods: PaymentMethod[];
  /** The COD report, rendered on the server and handed down. Absent without
      `ac_view_analytics`, or when the report itself failed. */
  funnel: ReactNode;
}) {
  const t = useTranslations("payments");
  const tA11y = useTranslations("a11y");
  const tStatus = useTranslations("paymentStatus");
  const tProvider = useTranslations("paymentProvider");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState<Payment | null>(null);

  const query = useMemo(
    () => queryFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: paymentsKey(query),
    queryFn: async () => {
      const result = await acRead<Payment[]>(`/payments?${listParams(query)}`);
      return { payments: result.data, total: result.total };
    },
    initialData:
      initialPayments !== null && paymentsKey(query)[1] === paymentsKey(initialQuery)[1]
        ? { payments: initialPayments, total: initialTotal ?? initialPayments.length }
        : undefined,
    /* Keeps the previous page on screen while the next loads, so changing a
       filter, the tab or the page never flashes a skeleton over content still
       valid. §3.6's third mechanism. */
    placeholderData: keepPreviousData,
  });

  const payments = data?.payments ?? [];
  const total = data?.total ?? 0;
  const filtered = isFiltered(query);
  const overPaged = isOverPaged(query);

  /* Not wrapped in `useCallback`: the React Compiler is on in this project and
     memoizes this already; a manual dependency list disagreeing with the
     compiler's inference makes it skip optimising the whole component. */
  function commit(next: PaymentsQuery) {
    const params = toUrlParams(next);
    /* `push`, not `replace` — going back from a filtered list must reach the
       unfiltered one. */
    router.push(`/${locale}/payments${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  /* A new filter resets to page one; paging and per-page do not. Page 3 of a
     differently filtered list is a different set of rows. */
  const commitFilter = (next: PaymentsQuery) => commit({ ...next, page: 1 });

  /* Message key → API `label` → raw name. The API's labels are English — `cod` is
     "Cash on delivery" — and were rendering as English in both localised panels.
     `chargily` has no key and keeps its brand. See `lib/payments.ts`. */
  const providerName = (name: string) =>
    providerLabel(name, methods, (key) =>
      tProvider.has(key as "cod") ? tProvider(key as "cod") : null,
    );

  const statusName = (status: string) =>
    tStatus.has(status as "pending") ? tStatus(status as "pending") : status;

  /*
   * The picker's options, and the last entry is the honest half.
   *
   * `/payments/methods` enumerates every value the collection carries, so in
   * practice the first two entries are the whole set. A hand-edited or stale
   * `?provider=` outside them is *not* refused by the API — it is a silent 200
   * with zero rows — so it travels, and a `<select>` whose value matches none of
   * its options renders blank. Adding the value as its own option is what keeps
   * the control able to show the state it is in; the chip beside it is how it
   * comes off.
   */
  const providerOptions = [
    { value: "", label: t("providerAny") },
    ...methods.map((method) => ({ value: method.name, label: providerName(method.name) })),
    ...(query.provider !== "" && !methods.some((method) => method.name === query.provider)
      ? [{ value: query.provider, label: query.provider }]
      : []),
  ];

  /*
   * **There are no filter chips, and that is a decision rather than an omission.**
   *
   * A first draft carried four — order, method, and the two dates. Every one of
   * them restated a control standing six inches above it: the term is in its own
   * box, the method is the `Select`'s selected option, and each date bound is
   * legible in its own picker. The status was excluded from the chips for exactly
   * this reason; the reason applies to all five.
   *
   * **The dates were the draft's strongest case for keeping chips, and that case
   * has now gone twice over.** The argument was that a native `<input type="date">`
   * renders `mm/dd/yyyy` under an Arabic label, so only a chip could show the
   * applied bound legibly. `echo` answered it first, by printing the bound a
   * second time underneath in the page's own language. The drawn `DateField`
   * answers it properly: the field itself reads in the reader's own field order,
   * so `echo` is deleted and there is nothing left for a chip to add.
   *
   * So this is shipping's and coupons' rule at four dimensions rather than two.
   * Products ships chips because its seven live behind a *closed* drawer, where
   * nothing is visible until you open it.
   *
   * What the chip row did earn is the one thing no other control offers: a way to
   * drop everything at once. Taking four filters off one control at a time is
   * four interactions. That is the button below, and it is the same control the
   * no-results empty state offers, doing the same thing.
   */
  const clearAll = () => commit({ ...EMPTY_QUERY, perPage: query.perPage });

  const ctx: PaymentColumnContext = {
    locale,
    providerName,
    t,
    tStatus: statusName,
  };
  const columns = buildColumns(ctx);

  /* Held here rather than inside `DataTable` so the controls sit in the toolbar
     beside the filters instead of floating above the card. */
  const preferences = useTablePreferences("payments", columns);

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={
          <span data-testid="payments-count">
            <Isolate>{t("count", { count: total })}</Isolate>
          </span>
        }
        /*
         * One control, and it is not a primary. **Nothing on this screen creates
         * a payment**: `POST /orders/{id}/payments` opens a checkout at the
         * provider and hands back a link for the *customer*, which the proxy
         * allowlist refuses deliberately. A "new transaction" button would name
         * an action this panel does not have.
         */
        actions={
          <IconButton
            label={t("refresh")}
            icon="refresh"
            variant="secondary"
            onClick={() => void refetch()}
            loading={isFetching}
          />
        }
        toolbar={
          <div className="flex flex-col gap-3">
            <FilterTabs<StatusFilter>
              tabs={STATUS_FILTERS.map((value) => ({
                value,
                label: value === "" ? t("allStatuses") : tStatus(value),
              }))}
              value={query.status}
              onChange={(status) => commitFilter({ ...query, status })}
              label={t("statusLabel")}
            />

            {/* `align="end"` because three of these four controls carry a visible
                label above the box — see `FilterRow`. */}
            <FilterRow align="end">
              {/*
                A floor under the box, and it is a measured one. `SearchField` is
                `flex-1 min-w-0`, so with three pickers beside it on one line it
                shrinks rather than wrapping — at 768 it measured ~150px and the
                placeholder read "Numéro de comm". `min-w-56` is the width the
                whole placeholder needs, so the row wraps a picker to the next
                line instead of squeezing the one control that has no visible
                label. `sm:max-w-80` repeats `SearchField`'s own cap so the
                wrapper and its child stop growing together.
              */}
              <div className="flex min-w-56 flex-1 sm:max-w-80">
                <SearchField
                  value={query.orderId}
                  /* Digits only, and non-digits are stripped rather than refused:
                     a pasted "Commande 4586" means 4586. See `orderIdFromInput`. */
                  onSubmit={(next) =>
                    commitFilter({ ...query, orderId: orderIdFromInput(next) })
                  }
                  placeholder={t("searchPlaceholder")}
                  label={t("searchLabel")}
                  clearLabel={t("clearSearch")}
                />
              </div>

              {/* `w-56` rather than `w-48`, measured on the filtered state: a
                  native `<select>` clips its selected option, and "Contre-
                  remboursement" — the longest of the two method labels and the
                  one on 43 of 45 rows — was losing its last character at 192px. */}
              <div className="w-full sm:w-56">
                <Select
                  label={t("provider")}
                  value={query.provider}
                  onChange={(provider) => commitFilter({ ...query, provider })}
                  options={providerOptions}
                />
              </div>

              {/*
                Two bounds, each bounding the other so an inverted range is hard
                to express — it is a 200 with zero rows rather than a refusal, so
                nothing on screen would explain it.

                **`echo` was on both and is deleted with the drawn picker.** It
                read the applied bound back underneath in the page's own language,
                because the native `<input type="date">` above it printed that
                same bound in the *browser's* — `mm/dd/yyyy` under an Arabic
                label. `DatePicker` renders the field in the reader's own field
                order, so a readback would now print the same date twice.

                Both ends are still whole calendar days in **UTC**, which is a
                property of `/payments` rather than of the control: `dayFromInput`
                is where that is enforced.
              */}
              <div className="w-full sm:w-44">
                <DateField
                  label={t("dateFrom")}
                  value={query.dateFrom}
                  max={query.dateTo === "" ? undefined : query.dateTo}
                  onChange={(next) =>
                    commitFilter({ ...query, dateFrom: dayFromInput(next) })
                  }
                />
              </div>

              <div className="w-full sm:w-44">
                <DateField
                  label={t("dateTo")}
                  value={query.dateTo}
                  min={query.dateFrom === "" ? undefined : query.dateFrom}
                  onChange={(next) => commitFilter({ ...query, dateTo: dayFromInput(next) })}
                />
              </div>

              {/*
                **Not rendered when nothing is filtered**, per §3.3: a control
                that cannot act is absent rather than disabled, and "clear" with
                nothing to clear cannot act. It is the only affordance on the row
                that no individual control offers — dropping four dimensions at
                once — and it is the same control, with the same words and the
                same handler, that the no-results empty state offers.

                `size="sm"` to match the panel's one existing filter-row button,
                the products filter trigger, and the empty state's own action.
              */}
              {filtered ? (
                <Button variant="ghost" size="sm" icon="close" onClick={clearAll}>
                  {t("clearFilter")}
                </Button>
              ) : null}

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
          </div>
        }
      />

      <PageBody width="full">
        {(!online || isError) && dataUpdatedAt > 0 ? (
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)}
            reason={online ? "refreshFailed" : "offline"}
          />
        ) : null}

        {/* A live region, so a filter that changes the result count announces it.
            Its own testid: `payments-count` above is the *visible* count, and two
            elements sharing one testid is a strict-mode violation the moment
            either is queried. */}
        <p aria-live="polite" className="sr-only" data-testid="payments-live">
          {tA11y("listUpdated", { total })}
        </p>

        {isPending && payments.length === 0 ? (
          <>
            <div className="hidden md:block">
              <TableSkeleton rows={8} cols={6} label={t("loading")} />
            </div>
            {/* The card and its 8px padding are `DataTable`'s below `md`, so the
                skeleton wears them too or the rows step inward when data lands. */}
            <div className="ui-card p-2 md:hidden">
              <RecordListSkeleton rows={6} label={t("loading")} />
            </div>
          </>
        ) : isError && payments.length === 0 ? (
          /*
           * **The error and the empty state no longer print the same string**,
           * which they did on the screen this replaces — a failed request and a
           * shop with no transactions both read "Aucune transaction.", so the one
           * case where retrying would help was indistinguishable from the one
           * where it would not. That is DECISIONS.md's inventory defect #2, and it
           * is fixed by the API's own sentence and a retry.
           */
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : payments.length === 0 ? (
          <EmptyState
            icon={filtered || overPaged ? "search" : "note"}
            /*
             * **Three empty states, and telling them apart is the point.** Past
             * the last page is the most specific fact and wins the one action this
             * state gets — `?page=999` answers a 200 with an empty array, so the
             * table is not drawn and with it goes the only control that could page
             * back. No results for these filters offers to clear them. No
             * transactions at all offers nothing, and that is correct: a payment
             * is created by a *shopper* at checkout, and a button here would name
             * an action this panel deliberately does not have.
             */
            message={
              overPaged
                ? t("empty.pastEnd")
                : filtered
                  ? t("noPaymentsFilter")
                  : t("noPayments")
            }
            action={
              overPaged
                ? { label: t("empty.firstPage"), onClick: () => commit({ ...query, page: 1 }) }
                : filtered
                  ? { label: t("clearFilter"), onClick: clearAll }
                  : undefined
            }
          />
        ) : (
          <DataTable
            preferences={preferences}
            rows={payments}
            columns={columns}
            rowKey={(payment) => String(payment.id)}
            rowLabel={(payment) => tA11y("paymentNumber", { number: payment.id })}
            record={(payment) => paymentRecord(payment, ctx)}
            /*
             * The whole row opens the drawer, and there is no trailing `Menu`: the
             * drawer holds the one action and a 40px column repeating "open" is
             * not an action.
             *
             * `onRowClick` is the *pointer* path only — a `<tr>` is not focusable.
             * `rowOpenerId` is what makes the id cell a real `<button>`, which is
             * the keyboard path and the drawer's focus target. Both end here.
             */
            onRowClick={(payment) => setOpen(payment)}
            rowOpenerId={(payment) => paymentOpenerId(payment.id)}
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

        {/* The COD report, below the ledger rather than beside it — `CodFunnel`
            carries the reason. */}
        {funnel ? <div className="mt-6">{funnel}</div> : null}
      </PageBody>

      <PaymentDrawer
        payment={open}
        providerName={providerName}
        locale={locale}
        online={online}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      />
    </div>
  );
}
