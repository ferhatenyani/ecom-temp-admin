"use client";

import { useId, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Segment } from "@/lib/api/schemas/campaign";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { DataTable, TableFooter, useTablePreferences, type SortState } from "@/components/ui/DataTable";
import { EmptyState, ErrorState, Notice, StaleBanner } from "@/components/ui/States";
import { RecordListSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { Menu } from "@/components/ui/Menu";
import { Button, IconButton } from "@/components/ui/Button";
import { Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import {
  buildColumns,
  segmentOpenerId,
  segmentRecord,
  type SegmentColumnContext,
} from "./columns";
import { SegmentModal } from "./SegmentModal";
import {
  EMPTY_QUERY,
  listParams,
  orderbyFromKey,
  queryFromParams,
  segmentsKey,
  toUrlParams,
  type SegmentsQuery,
} from "./query";

/**
 * Segments: stored queries, not stored membership lists.
 *
 * **The count is the screen.** A segment's criteria are three words on a row and
 * tell nobody whether it is right; "8 clients" does, and "0 clients" is the thing
 * somebody needs to see before a campaign names it — that campaign's send is a
 * 409. `columns.tsx` carries the per-row request and the tone the zero gets.
 *
 * ## One sortable header, and both halves of its control
 *
 * `name`, and nothing else. `created_at` and `updated_at` are accepted, validated
 * and **honoured** — they simply tie on every row, because all four segments were
 * seeded in one pass and share a single stamp of each kind, so neither direction
 * can be distinguished from the other. `name asc` is the resting order, so it
 * proves nothing on its own either; what proves the parameter works is that
 * `name desc` reverses the default exactly *and* `id desc` differs from it, which
 * together show `orderby` discriminating between fields. `query.ts` carries every
 * request. `id` sorts and earns no column.
 *
 * ## One empty state, and the missing half has no producer
 *
 * DESIGN.md §3.7 as amended on the media branch: a screen whose controls can
 * empty the list ships both halves, and **a screen whose controls cannot ships
 * one and says so here** — which is this sentence. There is no search on this
 * collection (`?search=Alger` answers all four rows; the route declares no such
 * argument) and no filter of any kind, so "nothing matching this filter" has
 * nothing that could produce it. The sort cannot: re-ordering four rows returns
 * four rows. What *is* reachable is a page past the end, which is its own state
 * with its own action.
 *
 * **This has to be re-read whenever a control is added**, which is the whole
 * point of the rule living in the file the new control would land in.
 *
 * ## The editor is a `Modal` and the delete is not in it
 *
 * `SegmentModal` carries the argument for the overlay. The delete lives in the
 * row's own `Menu` instead, and that is §3.1 rather than taste: a `ConfirmDialog`
 * *is* a `Modal`, and "never nested — a modal that needs a second modal is a
 * modal that needs steps" would be broken by putting the destructive action
 * inside the editor. The row is where the record is named anyway.
 *
 * ## The stale marker stays
 *
 * A client component over a react-query cache with a manual refresh **and** two
 * writes, so both halves of §3.7 bite and every write control carries the same
 * reason.
 */
export function SegmentsList({
  locale,
  initialQuery,
  initialSegments,
  initialTotal,
  canCount,
}: {
  locale: string;
  initialQuery: SegmentsQuery;
  initialSegments: Segment[] | null;
  initialTotal: number | null;
  /**
   * A segment's **count** needs `ac_manage_customers` on top of the marketing
   * capability — it is a count of customers — while the list itself does not.
   * Measured: a Marketing Manager is 200 on `/segments` and 403 on
   * `/segments/{id}/preview`. So the rows render and the numbers say whose
   * permission they are.
   */
  canCount: boolean;
}) {
  const t = useTranslations("campaigns");
  const tStates = useTranslations("states");
  const tA11y = useTranslations("a11y");
  const router = useRouter();
  const searchParams = useSearchParams();
  const client = useQueryClient();
  const toast = useToast();
  const createId = useId();

  const [editing, setEditing] = useState<Segment | "new" | null>(null);
  const [confirming, setConfirming] = useState<Segment | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** The 409 a segment in use answers, in the panel's own words. */
  const [inUse, setInUse] = useState<{ name: string; campaigns: number | null } | null>(null);

  const query = useMemo(
    () => queryFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: segmentsKey(query),
    queryFn: async () => {
      const result = await acRead<Segment[]>(`/segments?${listParams(query)}`);
      return { segments: result.data, total: result.total };
    },
    initialData:
      initialSegments !== null && segmentsKey(query)[2] === segmentsKey(initialQuery)[2]
        ? { segments: initialSegments, total: initialTotal ?? initialSegments.length }
        : undefined,
    placeholderData: keepPreviousData,
  });

  const segments = data?.segments ?? [];
  const total = data?.total ?? 0;
  const overPaged = segments.length === 0 && query.page > 1;

  function commit(next: SegmentsQuery) {
    const params = toUrlParams(next);
    router.push(`/${locale}/marketing/segments${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  const blocked = online ? null : tStates("offlineWrites");

  const invalidate = () => void client.invalidateQueries({ queryKey: ["segments"] });

  const remove = async () => {
    if (confirming === null) return;
    setDeleting(true);
    try {
      await acWrite("DELETE", `/segments/${confirming.id}`);
      toast.show(t("segment.deleted"));
      setInUse(null);
      setConfirming(null);
      invalidate();
    } catch (thrown) {
      /*
       * **A segment a campaign names cannot be deleted**, and the 409 carries
       * `details.campaigns` counting them. The panel has its own sentence for
       * that fact, so the API's English is not what goes on screen — the count is
       * the information and `segment.inUse` is where it goes. A refusal with no
       * count falls back to the sentence without one rather than to the
       * provider's words, because the panel's mirror covers this shape.
       */
      const apiError = thrown as BrowserApiError;
      if (apiError.status === 409) {
        const count = apiError.details.campaigns;
        setInUse({
          name: confirming.name,
          campaigns: typeof count === "number" ? count : null,
        });
        setConfirming(null);
      } else {
        toast.show(apiError.message, "danger");
      }
    } finally {
      setDeleting(false);
    }
  };

  const ctx: SegmentColumnContext = { locale, t, canCount };
  const columns = buildColumns(ctx);
  /*
   * Held here for `DataTable`'s sake, and **`TableControls` is deliberately not
   * rendered**: all three columns are `required`, so the picker would offer three
   * switches that cannot be turned off, and a density toggle on a three-column
   * table of four rows is a control with nothing to gain. §3.3, at the level of a
   * toolbar rather than a button.
   */
  const preferences = useTablePreferences("segments", columns);

  const sortState: SortState = { key: query.orderby, direction: query.order };

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("segments")}
        back={{ href: `/${locale}/marketing`, label: t("hubTitle") }}
        subtitle={
          <span data-testid="segments-count">
            <Isolate>{t("segment.count", { total })}</Isolate>
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
            {/* A `Button` and not a `ButtonLink`: there is no `/new` route,
                because a segment is created by a `POST` from a dialog rather than
                by a screen. */}
            <Button
              id={createId}
              variant="primary"
              icon="plus"
              disabled={blocked !== null}
              title={blocked ?? undefined}
              onClick={() => setEditing("new")}
              data-testid="create-segment"
            >
              {t("segment.create")}
            </Button>
          </>
        }
      />

      <PageBody width="full">
        {!online && dataUpdatedAt > 0 ? (
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
        ) : null}

        <p aria-live="polite" className="sr-only" data-testid="segments-live">
          {tA11y("listUpdated", { total })}
        </p>

        {/* The 409, on screen and staying there: §3.1 — an error a person must act
            on is not a toast, and the act here is to point those campaigns at
            another audience first. */}
        {inUse !== null ? (
          <div className="mb-3">
            <Notice
              tone="warning"
              role="alert"
              title={
                inUse.campaigns === null
                  ? t("segment.inUseAny")
                  : t("segment.inUse", { count: inUse.campaigns })
              }
            >
              <p className="text-ui-label" dir="auto">
                {inUse.name}
              </p>
              <p className="text-ui-label">{t("segment.inUseFix")}</p>
            </Notice>
          </div>
        ) : null}

        {isPending && segments.length === 0 ? (
          <>
            <div className="hidden md:block">
              <TableSkeleton rows={4} cols={3} label={t("loading")} />
            </div>
            <div className="ui-card p-2 md:hidden">
              <RecordListSkeleton rows={4} label={t("loading")} />
            </div>
          </>
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : segments.length === 0 ? (
          <EmptyState
            icon={overPaged ? "search" : "customers"}
            message={overPaged ? t("empty.pastEnd") : t("empty.segments")}
            detail={overPaged ? undefined : t("empty.segmentsWhy")}
            action={
              overPaged
                ? { label: t("empty.firstPage"), onClick: () => commit({ ...query, page: 1 }) }
                : { label: t("segment.create"), onClick: () => setEditing("new") }
            }
          />
        ) : (
          <DataTable
            preferences={preferences}
            rows={segments}
            columns={columns}
            rowKey={(segment) => String(segment.id)}
            rowLabel={(segment) => tA11y("segmentName", { name: segment.name })}
            record={(segment) => segmentRecord(segment, ctx)}
            /* The row opens the editor; the name cell is the real `<button>` that
               makes that reachable from the keyboard and gives the modal a target
               to hand focus back to. */
            onRowClick={(segment) => setEditing(segment)}
            rowOpenerId={(segment) => segmentOpenerId(segment.id)}
            rowActions={(segment) => (
              <Menu
                label={t("actionsFor", { name: segment.name })}
                trigger={
                  <IconButton
                    id={`segment-menu-${segment.id}`}
                    label={t("actionsFor", { name: segment.name })}
                    icon="more"
                    size="sm"
                  />
                }
                actions={[
                  {
                    key: "delete",
                    label: t("segment.deleteAction"),
                    icon: "trash",
                    destructive: true,
                    disabled: blocked !== null,
                    onSelect: () => {
                      setInUse(null);
                      setConfirming(segment);
                    },
                  },
                ]}
              />
            )}
            sort={sortState}
            onSortChange={(next) =>
              commit({
                ...query,
                orderby: next === null ? EMPTY_QUERY.orderby : orderbyFromKey(next.key),
                order: next === null ? EMPTY_QUERY.order : next.direction,
                page: 1,
              })
            }
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

      {/* `key` so opening a different row remounts the form and its initialisers
          run once with the right values — the `RuleForm` precedent. */}
      {editing !== null ? (
        <SegmentModal
          key={editing === "new" ? "new" : editing.id}
          open
          segment={editing === "new" ? null : editing}
          canCount={canCount}
          returnFocusTo={
            editing === "new" ? createId : segmentOpenerId(editing.id)
          }
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            /* `saved`, the namespace's own generic — the second caller it has
               been waiting for since it was written. */
            toast.show(t("saved"));
            invalidate();
          }}
        />
      ) : null}

      {/*
        **No type-to-confirm**, and §3.1 as amended on the shipping branch is why:
        a segment's only identifier is its free-text name, which on this shop reads
        "Clients à plus de 10 000 DA" — a string with a non-breaking space in the
        number that nobody can reproduce from a keyboard. The dialog names the
        record instead, the tone stays `danger`, and Cancel takes focus.
      */}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        title={t("segment.deleteConfirm")}
        body={
          <span className="flex flex-col gap-2">
            <span dir="auto" className="text-ui-fg">
              {confirming?.name}
            </span>
            <span>{t("segment.deleteConfirmBody")}</span>
          </span>
        }
        confirmLabel={t("segment.deleteAction")}
        loading={deleting}
        onConfirm={() => void remove()}
        returnFocusTo={confirming === null ? undefined : `segment-menu-${confirming.id}`}
      />
    </div>
  );
}
