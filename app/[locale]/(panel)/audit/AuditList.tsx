"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { AuditRow as Row } from "@/lib/api/schemas/audit";
import { acRead } from "@/lib/api/browser";
import { RESOURCE_TYPES } from "@/lib/audit";
import { formatDay } from "@/lib/format/date";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState } from "@/components/patterns/States";
import { ListGroup } from "@/components/primitives/GroupedList";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { AuditRow } from "./AuditRow";
import { RowSkeleton } from "../inventory/RowSkeleton";
import {
  PER_PAGE,
  auditKey,
  isFiltered,
  listParams,
  queryFromParams,
  toUrlParams,
  type AuditQuery,
} from "./query";

type Actor = { id: number; username: string; display_name: string };

async function fetchAudit(query: AuditQuery) {
  const { data, total } = await acRead<Row[]>(`/audit-logs?${listParams(query)}`);
  return { rows: data, total };
}

/**
 * The trail, and five filters that all work.
 *
 * **Two of them did not when this branch started.** `?resource_id=` and the date
 * range were accepted and silently ignored — 16 632 rows returned for every
 * value — which is §65's failure mode: a filter that does not filter looks
 * exactly like a collection that all matches. Both are named in ADMIN_PANEL.md
 * as though they worked, and 16 632 rows at 20 a page is **832 pages**, so they
 * went into `AuditRepository` on a narrow backend branch before this screen
 * existed rather than shipping as two controls that lie.
 *
 * **No search box and no sort control**, and both absences are measured. Writes
 * are audited by field *name* and never by value, so a free-text box would
 * search a column that holds nothing a reader is looking for; the table is
 * append-only, so its id order is its time order.
 *
 * The filters are behind a disclosure rather than in the toolbar. Five controls
 * over a list whose rows are already three lines each is a screen where the
 * filters are taller than the content at 390px — the products screen's argument
 * for `FilterSheet`, answered here with a simpler control because the panel is
 * flat rather than a sheet's worth of state.
 */
export function AuditList({
  locale,
  initialQuery,
  initialRows,
  initialTotal,
  actors,
}: {
  locale: string;
  initialQuery: AuditQuery;
  initialRows: Row[] | null;
  initialTotal: number | null;
  actors: Actor[];
}) {
  const t = useTranslations("audit");
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = queryFromParams(new URLSearchParams(searchParams.toString()));

  const [open, setOpen] = useState(false);
  const [action, setAction] = useState(query.action);
  const [resourceId, setResourceId] = useState(query.resourceId);

  const commit = (next: AuditQuery, options: { resetPage?: boolean } = {}) => {
    const target = options.resetPage === false ? next : { ...next, page: 1 };
    const params = toUrlParams(target);
    router.push(`/${locale}/audit${params.size > 0 ? `?${params}` : ""}`, { scroll: false });
  };

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: auditKey(query),
    queryFn: () => fetchAudit(query),
    initialData:
      initialRows !== null && auditKey(query).join("|") === auditKey(initialQuery).join("|")
        ? { rows: initialRows, total: initialTotal ?? initialRows.length }
        : undefined,
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = isFiltered(query);

  const clear = () => {
    setAction("");
    setResourceId("");
    commit({
      ...query,
      action: "",
      resourceType: "",
      resourceId: "",
      actorId: 0,
      dateFrom: "",
      dateTo: "",
    });
  };

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
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            className="press flex min-h-11 items-center gap-2 rounded-md bg-surface-2 px-3 text-body text-label"
          >
            <Icon name="filter" className="size-4 shrink-0 text-label-secondary" />
            <span className="min-w-0 flex-1 truncate text-start">{t("filters")}</span>
            {filtered ? (
              <span className="tone-accent tonal shrink-0 rounded-full px-2 py-0.5 text-caption">
                {t("filtersOn")}
              </span>
            ) : null}
            <Icon
              name="chevron"
              className={open ? "size-4 shrink-0 -rotate-90" : "size-4 shrink-0 rotate-90"}
            />
          </button>

          {open ? (
            <div className="flex flex-col gap-2">
              {/*
                A free-text action, not a picker. 85 distinct values on this
                install, every one dotted, and an unmatched one is a 200 with no
                rows rather than a 400 — so a wrong guess is an empty list and a
                picker would be a list somebody has to maintain against a
                vocabulary the API publishes nowhere.
              */}
              <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3">
                <Icon name="list" className="size-4 shrink-0 text-label-secondary" />
                <input
                  type="text"
                  value={action}
                  onChange={(event) => setAction(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commit({ ...query, action });
                  }}
                  onBlur={() => {
                    if (action !== query.action) commit({ ...query, action });
                  }}
                  placeholder={t("actionPlaceholder")}
                  aria-label={t("actionLabel")}
                  dir="ltr"
                  className="min-h-11 min-w-0 flex-1 bg-transparent text-start text-footnote text-label outline-none placeholder:text-label-tertiary"
                  style={{ unicodeBidi: "isolate" }}
                />
              </div>

              <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3">
                <Icon name="box" className="size-4 shrink-0 text-label-secondary" />
                <select
                  value={query.resourceType}
                  onChange={(event) => commit({ ...query, resourceType: event.target.value })}
                  aria-label={t("resourceLabel")}
                  className="min-h-11 min-w-0 flex-1 appearance-none bg-transparent text-footnote text-label outline-none"
                >
                  <option value="">{t("resource.all")}</option>
                  {RESOURCE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`resource.${type}`)}
                    </option>
                  ))}
                </select>
                <Icon name="chevron" className="size-4 shrink-0 rotate-90 text-label-tertiary" />
              </div>

              {/*
                A resource id is a **string**, so a text box rather than a number
                one: a page is audited by path and a menu by location, and
                `inputMode="numeric"` on a field that takes `conditions` would be
                a keyboard that cannot type the value.
              */}
              <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3">
                <Icon name="link" className="size-4 shrink-0 text-label-secondary" />
                <input
                  type="text"
                  value={resourceId}
                  onChange={(event) => setResourceId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commit({ ...query, resourceId });
                  }}
                  onBlur={() => {
                    if (resourceId !== query.resourceId) commit({ ...query, resourceId });
                  }}
                  maxLength={64}
                  placeholder={t("resourceIdPlaceholder")}
                  aria-label={t("resourceIdLabel")}
                  dir="ltr"
                  className="min-h-11 min-w-0 flex-1 bg-transparent text-start text-footnote text-label outline-none placeholder:text-label-tertiary"
                  style={{ unicodeBidi: "isolate" }}
                />
              </div>

              {/*
                The actor picker, fed by `/users`. Free on this screen and only
                on this screen: `ac_view_audit_logs` and `ac_manage_users` are
                held by the same tier, so the list is always fillable for anybody
                who can open the page — which is exactly the gap the inventory
                ledger has and cannot close.
              */}
              {actors.length > 0 ? (
                <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3">
                  <Icon name="customers" className="size-4 shrink-0 text-label-secondary" />
                  <select
                    value={String(query.actorId)}
                    onChange={(event) =>
                      commit({ ...query, actorId: Number.parseInt(event.target.value, 10) || 0 })
                    }
                    aria-label={t("actorLabel")}
                    className="min-h-11 min-w-0 flex-1 appearance-none bg-transparent text-footnote text-label outline-none"
                  >
                    <option value="0">{t("actorAll")}</option>
                    {actors.map((actor) => (
                      <option key={actor.id} value={String(actor.id)}>
                        {actor.display_name} ({actor.username})
                      </option>
                    ))}
                  </select>
                  <Icon name="chevron" className="size-4 shrink-0 rotate-90 text-label-tertiary" />
                </div>
              ) : null}

              <div className="flex min-w-0 items-center gap-2 rounded-md bg-surface-2 px-3">
                <Icon name="clock" className="size-4 shrink-0 text-label-secondary" />
                <input
                  type="date"
                  value={query.dateFrom}
                  max={query.dateTo || undefined}
                  onChange={(event) => commit({ ...query, dateFrom: event.target.value })}
                  aria-label={t("dateFrom")}
                  className="min-h-11 min-w-0 flex-1 bg-transparent text-footnote text-label outline-none"
                />
                <span aria-hidden="true" className="shrink-0 text-footnote text-label-tertiary">
                  –
                </span>
                <input
                  type="date"
                  value={query.dateTo}
                  min={query.dateFrom || undefined}
                  onChange={(event) => commit({ ...query, dateTo: event.target.value })}
                  aria-label={t("dateTo")}
                  className="min-h-11 min-w-0 flex-1 bg-transparent text-footnote text-label outline-none"
                />
              </div>

              {filtered ? (
                <button
                  type="button"
                  onClick={clear}
                  className="press min-h-11 self-start rounded-md px-2 text-footnote text-accent"
                >
                  {t("clearFilters")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      }
    >
      <div className="mx-auto max-w-3xl px-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
          <p aria-live="polite" className="text-footnote text-label-secondary" data-testid="audit-count">
            <Isolate numeric>{t("count", { total })}</Isolate>
          </p>
          {/*
            The range is UTC and the panel says so once, here, rather than beside
            every date. `formatDay` renders these in UTC for the same reason the
            analytics boundaries are: they are calendar days the server drew, not
            instants in the shop's clock.
          */}
          {query.dateFrom !== "" || query.dateTo !== "" ? (
            <p className="text-caption text-label-tertiary">
              <Isolate>
                {t("dateScope", {
                  from: query.dateFrom === "" ? "…" : formatDay(query.dateFrom, locale),
                  to: query.dateTo === "" ? "…" : formatDay(query.dateTo, locale),
                })}
              </Isolate>
            </p>
          ) : null}
        </div>

        {isPending && rows.length === 0 ? (
          <RowSkeleton rows={6} />
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            message={filtered ? t("empty.noResults") : t("empty.none")}
            action={filtered ? { label: t("empty.clear"), onClick: clear } : undefined}
          />
        ) : (
          <>
            <ListGroup>
              {rows.map((row) => (
                <AuditRow key={row.id} row={row} locale={locale} />
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

            {/*
              Said once, at the foot: the trail is append-only and unpruned, so
              "832 pages" is not a figure of speech. It is the argument for the
              date range being the control this screen opens with.
            */}
            <p className="mb-8 px-1 text-caption text-label-tertiary">
              <Isolate numeric>{t("scaleNote", { pages: pageCount })}</Isolate>
            </p>
          </>
        )}
      </div>
    </Scaffold>
  );
}
