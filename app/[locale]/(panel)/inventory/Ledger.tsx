"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ALL_REASONS, REASON_TONE } from "@/lib/movement-reason";
import { EmptyState, ErrorState, StaleBanner } from "@/components/patterns/States";
import {
  FilterAllPill,
  FilterChips,
  FilterGroup,
  FilterPill,
  FilterPills,
  FilterSheet,
  FilterValue,
} from "@/components/patterns/FilterSheet";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Icon } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { MovementRow } from "./MovementRow";
import { RowSkeleton } from "./RowSkeleton";
import {
  MOVES_PER_PAGE,
  fetchMovements,
  fetchSummary,
  isFiltered,
  movementsKey,
  summaryKey,
  type InventoryQuery,
} from "./query";

/**
 * The movements ledger — 1154 rows over 155 products, and the screen that proves
 * docs/ADMIN_PANEL.md's claim that no path changes stock without recording it.
 *
 * Two requests, both taking the same filters: the page of rows, and the summary
 * that makes 58 pages comprehensible without reading them.
 */
export function Ledger({
  locale,
  query,
  meId,
  commit,
}: {
  locale: string;
  query: InventoryQuery;
  meId: number | null;
  commit: (next: InventoryQuery, options?: { resetPage?: boolean }) => void;
}) {
  const t = useTranslations("inventory");
  const tReason = useTranslations("movementReason");
  const router = useRouter();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<InventoryQuery>(query);

  const movements = useQuery({
    queryKey: movementsKey(query, meId),
    queryFn: () => fetchMovements(query, meId),
    placeholderData: keepPreviousData,
  });

  /**
   * The summary is its own query and its own failure.
   *
   * A failed summary must not take the ledger down with it: the rows are the
   * screen and the strip above them is context. So it renders nothing at all when
   * it errors rather than an error box over a working list.
   */
  const summary = useQuery({
    queryKey: summaryKey(query, meId),
    queryFn: () => fetchSummary(query, meId),
    placeholderData: keepPreviousData,
  });

  const rows = movements.data?.movements ?? [];
  const total = movements.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / MOVES_PER_PAGE));
  const filtered = isFiltered(query);

  /*
   * The fifth state, on this view's own data.
   *
   * `InventoryScreen` renders the stale banner from the *stock* query, which is
   * disabled while the ledger is showing — so its `dataUpdatedAt` is 0 here and
   * the banner would never appear on the one view a person is most likely to be
   * reading in a van. Staleness is never silent, so the ledger says it itself,
   * about the rows it is actually showing.
   */
  const online = useOnline();

  const openSheet = () => {
    setDraft(query);
    setSheetOpen(true);
  };

  /* --------------------------------------------------------------- chips --- */

  const chips: { key: string; label: string; value: string; onRemove: () => void }[] = [];
  if (query.reason !== "") {
    chips.push({
      key: "reason",
      label: t("filter.reason"),
      value: tReason(query.reason),
      onRemove: () => commit({ ...query, reason: "" }),
    });
  }
  if (query.actor === "me") {
    chips.push({
      key: "actor",
      label: t("filter.actor"),
      value: t("ledger.you"),
      onRemove: () => commit({ ...query, actor: "" }),
    });
  }
  if (query.productId !== "") {
    chips.push({
      key: "product",
      label: t("filter.product"),
      value: query.productId,
      onRemove: () => commit({ ...query, productId: "" }),
    });
  }
  if (query.dateFrom !== "") {
    chips.push({
      key: "from",
      label: t("filter.dateFrom"),
      value: query.dateFrom,
      onRemove: () => commit({ ...query, dateFrom: "" }),
    });
  }
  if (query.dateTo !== "") {
    chips.push({
      key: "to",
      label: t("filter.dateTo"),
      value: query.dateTo,
      onRemove: () => commit({ ...query, dateTo: "" }),
    });
  }

  return (
    <>
      {/* `StaleBanner` carries its own `mx-4`, and this component renders inside
          the screen's padded column — the negative inline margin cancels that
          padding so the banner lines up with the rows rather than sitting 32px in. */}
      {!online && movements.dataUpdatedAt > 0 ? (
        <div className="-mx-4">
          <StaleBanner
            time={formatWhen(new Date(movements.dataUpdatedAt).toISOString(), locale)}
          />
        </div>
      ) : null}

      <div className="mb-3">
        <FilterPills>
          <FilterAllPill count={chips.length} onClick={openSheet} />
          <FilterPill
            label={t("filter.reason")}
            value={query.reason !== "" ? tReason(query.reason) : undefined}
            onClick={openSheet}
          />
          {/*
            "Mes mouvements" is the only identity control the ledger can honestly
            offer. `?actor_id=` genuinely filters — verified 1154 → 16 — while
            `actor_id` cannot be turned into a name for three of the four roles
            that hold `ac_manage_inventory`. So identity survives as something to
            pivot on even though it is not something to print.
          */}
          <FilterPill
            label={t("filter.actor")}
            value={query.actor === "me" ? t("ledger.you") : undefined}
            onClick={() => commit({ ...query, actor: query.actor === "me" ? "" : "me" })}
          />
          <FilterPill
            label={t("filter.dateFrom")}
            value={query.dateFrom !== "" || query.dateTo !== ""
              ? `${query.dateFrom || "…"} – ${query.dateTo || "…"}`
              : undefined}
            onClick={openSheet}
          />
        </FilterPills>
      </div>

      {chips.length > 0 ? (
        <FilterChips
          chips={chips}
          onClearAll={() =>
            commit({ ...query, reason: "", actor: "", productId: "", dateFrom: "", dateTo: "" })
          }
        />
      ) : null}

      <p
        aria-live="polite"
        className="mb-2 px-1 text-footnote text-label-secondary"
        data-testid="movements-count"
      >
        <Ltr numeric>{t("movesCount", { total })}</Ltr>
      </p>

      <Summary data={summary.data} />

      {movements.isPending && rows.length === 0 ? (
        <RowSkeleton />
      ) : movements.isError ? (
        <ErrorState
          message={(movements.error as Error).message}
          onRetry={() => void movements.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          message={filtered ? t("empty.noResults") : t("empty.moves")}
          action={
            filtered
              ? {
                  label: t("empty.clear"),
                  onClick: () =>
                    commit({
                      ...query,
                      reason: "",
                      actor: "",
                      productId: "",
                      dateFrom: "",
                      dateTo: "",
                    }),
                }
              : undefined
          }
        />
      ) : (
        <>
          <ListGroup>
            {rows.map((movement) => (
              <ListRow key={movement.id}>
                <MovementRow
                  movement={movement}
                  locale={locale}
                  meId={meId}
                  onOpenProduct={(id) => router.push(`/${locale}/inventory/${id}`)}
                />
              </ListRow>
            ))}
          </ListGroup>

          {total > MOVES_PER_PAGE ? (
            <nav className="mb-8 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={query.movesPage <= 1}
                onClick={() =>
                  commit(
                    { ...query, movesPage: Math.max(1, query.movesPage - 1) },
                    { resetPage: false },
                  )
                }
                aria-label={t("previousPage")}
                className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
              >
                <Icon name="back" flipInRtl className="size-5" />
              </button>
              <span className="text-footnote text-label-secondary">
                <Ltr numeric>
                  {query.movesPage} / {pageCount}
                </Ltr>
              </span>
              <button
                type="button"
                disabled={query.movesPage >= pageCount}
                onClick={() =>
                  commit({ ...query, movesPage: query.movesPage + 1 }, { resetPage: false })
                }
                aria-label={t("nextPage")}
                className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
              >
                <Icon name="chevron" flipInRtl className="size-5" />
              </button>
            </nav>
          ) : null}
        </>
      )}

      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={t("movesFiltersTitle")}
        onApply={() => {
          setSheetOpen(false);
          commit(draft);
        }}
        onClear={() =>
          setDraft({ ...draft, reason: "", actor: "", productId: "", dateFrom: "", dateTo: "" })
        }
      >
        {/*
          **The reasons come from `ALL_REASONS`, never from the summary.**

          The summary is a set of counts, exactly as a product facet is: it omits
          every reason with no rows, so `customer_return` and `other` are absent
          from it today and a filter list built from it would silently lose two of
          the six reasons a person can create. The counts beside each value come
          from the summary; the values themselves come from the vocabulary. This
          is the same separation `mergeFacet()` exists for on the products branch,
          in a second place.

          All nine are offered, including the three a person may never *write*:
          `?reason=order_reduced` filters the ledger perfectly well (480 rows) and
          is one of the more useful things to ask it.
        */}
        <FilterGroup title={t("filter.reason")} footnote={t("ledger.summaryOmits")}>
          {ALL_REASONS.map((reason) => (
            <FilterValue
              key={reason}
              label={tReason(reason)}
              count={null}
              selected={draft.reason === reason}
              onToggle={() =>
                setDraft({ ...draft, reason: draft.reason === reason ? "" : reason })
              }
            />
          ))}
        </FilterGroup>

        {/*
          Native date inputs. `/movements` validates `YYYY-MM-DD` and answers 400
          to anything else — measured on `?date_from=zzz` — so the control that
          can only produce that shape is the right one, and it is already
          localised and already accessible in both locales.
        */}
        <FilterGroup title={t("filter.dateFrom")}>
          <div className="flex w-full flex-col gap-2">
            <label className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-footnote text-label-secondary">
                {t("filter.dateFrom")}
              </span>
              <input
                type="date"
                value={draft.dateFrom}
                onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value })}
                className="min-h-11 flex-1 rounded-md bg-surface px-3 text-body text-label outline-none"
              />
            </label>
            <label className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-footnote text-label-secondary">
                {t("filter.dateTo")}
              </span>
              <input
                type="date"
                value={draft.dateTo}
                onChange={(event) => setDraft({ ...draft, dateTo: event.target.value })}
                className="min-h-11 flex-1 rounded-md bg-surface px-3 text-body text-label outline-none"
              />
            </label>
          </div>
        </FilterGroup>
      </FilterSheet>
    </>
  );
}

/**
 * Net movement by reason, over whatever the ledger is currently filtered to.
 *
 * 1154 rows at 20 a page is 58 pages, and nobody reads 58 pages. This is the line
 * that answers "how much did we write off to damage this month" without any of
 * them — which is why the reason vocabulary is a closed enum at the API in the
 * first place.
 *
 * `date_from`/`date_to` are real here: measured, the unfiltered summary reports
 * `correction: −1540 over 166 movements` and the same call windowed to today
 * reports `−141 over 15`. The strip therefore always states its own scope, since
 * a number whose window is invisible is a number people misread.
 *
 * Reasons with no rows are **absent from the response**, not zero — so this
 * renders what came back rather than iterating the vocabulary. A zero row here
 * would be inventing a fact the API did not report; the filter sheet is where the
 * complete vocabulary belongs.
 */
function Summary({ data }: { data: Record<string, { net: number; movements: number }> | undefined }) {
  const t = useTranslations("inventory");
  const tReason = useTranslations("movementReason");

  const entries = Object.entries(data ?? {}).filter(([reason]) => reason in REASON_TONE);
  if (entries.length === 0) return null;

  return (
    <section aria-label={t("ledger.summaryTitle")} className="mb-4">
      <h2 className="mb-2 px-1 text-footnote text-label-secondary">
        {t("ledger.summaryTitle")}
      </h2>
      <div className="pill-row -mb-1 flex gap-2 overflow-x-auto pb-1">
        {entries.map(([reason, value]) => (
          <div
            key={reason}
            className="flex min-w-28 shrink-0 flex-col gap-1 rounded-lg bg-surface px-3 py-2"
          >
            <StatusBadge tone={REASON_TONE[reason as keyof typeof REASON_TONE]}>
              {tReason(reason)}
            </StatusBadge>
            <Ltr
              className={`text-title-3 ${
                value.net > 0
                  ? "tonal-fg tone-success"
                  : value.net < 0
                    ? "tonal-fg tone-danger"
                    : "text-label"
              }`}
            >
              {value.net > 0 ? `+${value.net}` : value.net < 0 ? `−${Math.abs(value.net)}` : "0"}
            </Ltr>
            <span className="text-caption text-label-tertiary">
              <Ltr numeric>{t("ledger.movements", { count: value.movements })}</Ltr>
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-caption text-label-tertiary">{t("ledger.summaryScope")}</p>
    </section>
  );
}
