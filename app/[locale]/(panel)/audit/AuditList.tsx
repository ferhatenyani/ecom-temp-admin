"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { AuditRow } from "@/lib/api/schemas/audit";
import { acRead } from "@/lib/api/browser";
import {
  RESOURCE_TYPES,
  isActionQuery,
  isFilterableResourceId,
  isResourceType,
} from "@/lib/audit";
import { useOnline } from "@/lib/use-online";
import { formatDay, formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import {
  DataTable,
  TableControls,
  TableFooter,
  useTablePreferences,
} from "@/components/ui/DataTable";
import { FilterRow } from "@/components/ui/FilterBar";
import { DateField, Select, TextField } from "@/components/ui/Form";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { RecordListSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Button, IconButton } from "@/components/ui/Button";
import { Isolate } from "@/components/primitives/Ltr";
import { AuditPeek } from "./AuditPeek";
import {
  auditOpenerId,
  auditRecord,
  auditRowLabel,
  buildColumns,
  type AuditColumnContext,
} from "./columns";
import {
  EMPTY_QUERY,
  auditKey,
  dayFromInput,
  isFiltered,
  isOverPaged,
  listParams,
  queryFromParams,
  toUrlParams,
  type AuditQuery,
} from "./query";

type Actor = { id: number; username: string; display_name: string };

/** The column is `varchar(64)` and the route declares the `maxLength`, so a
    65-character value is refused rather than clipped. */
const RESOURCE_ID_MAX = 64;

async function fetchAudit(query: AuditQuery) {
  const { data, total } = await acRead<AuditRow[]>(`/audit-logs?${listParams(query)}`);
  return { rows: data, total };
}

/**
 * The trail: who changed what, and when.
 *
 * ## Five dimensions, all visible, no drawer and no chips
 *
 * Five is above payments' four, and the answer is still a row. A drawer puts a
 * modal between a person and controls that were already on screen, and this
 * screen's whole job is narrowing 887 pages — the filters *are* the screen.
 * Products ships a `Drawer` at nine dimensions and ships chips **because** its
 * controls are behind a closed one; nothing here is hidden, so nothing needs
 * restating, and a chip repeating a control standing six inches above it is a
 * second control doing the first one's job. §9's rule at §9's count.
 *
 * **The four controls are two different kinds, and the line between them is
 * worth stating once.** A **picker** ships only over a complete published
 * enumeration — that is the standing rule, and it is why shipping has no
 * provider filter and the notification queue lost its channel one. A **free-text
 * filter** ships on a different test: whether the reader *carries* the value or
 * has to *guess* it. An order number, a coupon code, a resource id and an action
 * are all carried — read off a row, followed from another record, or quoted out
 * of a bug report. A provider slug and a channel name are neither carried nor
 * enumerable, so nothing ships for them.
 *
 *   action         free text, and a picker is genuinely impossible — 85 values
 *                  that grow with every backend branch, 170 messages over a
 *                  vocabulary nobody publishes, and a `.` in a message key is a
 *                  `next-intl` path separator. Validated against the API's own
 *                  `^[a-z0-9._-]+$` **on the control, saying why**: a box that
 *                  silently turned what somebody typed into the unfiltered list
 *                  would be a filter reporting a narrowing that did not happen.
 *                  A well-formed unknown is a 200 with no rows and gets the
 *                  no-results empty state.
 *   resource type  a picker, and **not** a deviation from the standing rule.
 *                  `resource_type` is pattern-validated exactly as `action` is,
 *                  so `?resource_type=Product` and `?resource_type=` are 400s —
 *                  the validator is the guard against a typo, which is the job
 *                  the rule wants the picker for. This is §17's refinement
 *                  exactly. What is left is reachability, and the row renders an
 *                  unknown type as its raw string.
 *   resource id    free text, submit-gated, and it never sends `"0"` — see
 *                  `isFilterableResourceId`.
 *   actor          a picker over `/users`, a real allowlisted enumeration this
 *                  screen already fetches. The residue is recorded rather than
 *                  papered over: 222 actors appear in the trail and `/users`
 *                  publishes 70, so an actor whose account was deleted is
 *                  visible on rows and not filterable. §17's refinement again —
 *                  what the picker's job actually is here is keeping a typo
 *                  unreachable, which it does completely.
 *   date range     two `DateField`s with `echo`, which is the only defence
 *                  against Chromium rendering `mm/dd/yyyy` under an Arabic
 *                  label. Both ends are whole-day **UTC**, said once on the
 *                  control that means it.
 *
 * **No search box**: `?search=` is never declared in `indexArgs()`, so it is not
 * a parameter of this route at all. **Nothing sorts**: `AuditRepository.php:50`
 * is a literal `ORDER BY id DESC` with no branch, so no column carries a
 * `sortKey`, nothing passes `onSortChange`, and `DataTable` renders no
 * `aria-sort`. **No bulk, no export** (audit is not in `EXPORT_SUBJECTS`), **no
 * poll**, and **no write of any kind** — the route is GET-only by design.
 *
 * ## The stale marker ships and the disable half has nothing to disable
 *
 * §3.7-5 as amended on the transfer branch: *the marker is owed by a screen
 * whose pixels can outlive the fetch that produced them; the disable is owed by
 * a screen that writes.* This screen is the exact mirror of that one. It holds a
 * client cache and has a refresh control, so the pixels can age and the marker
 * is owed; it writes **nothing**, because there is nothing here to write, so the
 * other half has no control to disable. That is the second screen in the run to
 * owe one half without the other, and it does not need a new amendment.
 *
 * **The refresh control is what makes §3.7-4 reachable at all**, which is §17's
 * finding rather than decoration: every filter change here is a `router.push`,
 * so the *server* refetches and the client is seeded from `initialData`. Without
 * a manual refresh the browser never issues a request of its own, `isError` over
 * rows already on screen is unreachable, and a rule that cannot be reached is
 * not satisfied by a screen that cannot reach it.
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
  initialRows: AuditRow[] | null;
  initialTotal: number | null;
  actors: Actor[];
}) {
  const t = useTranslations("audit");
  const tA11y = useTranslations("a11y");
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = useMemo(
    () => queryFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  /* The fifth state's first half. `navigator.onLine` is trusted in one direction
     only — it reports the interface rather than reachability — which is why the
     refresh control stays enabled below. */
  const online = useOnline();

  /*
   * The two submit-gated filters hold a draft, and it follows the URL when the
   * URL changes underneath: clearing from the empty state, or a back navigation,
   * has to empty the visible box too.
   *
   * Adjusted during render against the previous value rather than in an effect,
   * which is `SearchField`'s own shape — an effect paints one frame with the old
   * term still in the box after the list behind it has already reset.
   */
  const [actionDraft, setActionDraft] = useState(query.action);
  const [resourceIdDraft, setResourceIdDraft] = useState(query.resourceId);
  const [lastCommitted, setLastCommitted] = useState({
    action: query.action,
    resourceId: query.resourceId,
  });
  if (
    query.action !== lastCommitted.action ||
    query.resourceId !== lastCommitted.resourceId
  ) {
    setLastCommitted({ action: query.action, resourceId: query.resourceId });
    setActionDraft(query.action);
    setResourceIdDraft(query.resourceId);
  }

  /** The open record. **Not** a URL parameter — see `AuditPeek`. */
  const [peek, setPeek] = useState<AuditRow | null>(null);

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: auditKey(query),
    queryFn: () => fetchAudit(query),
    initialData:
      initialRows !== null && auditKey(query)[1] === auditKey(initialQuery)[1]
        ? { rows: initialRows, total: initialTotal ?? initialRows.length }
        : undefined,
    /* Keeps the previous page on screen while the next loads, so changing a
       filter or the page never flashes a skeleton over content still valid.
       §3.6's third mechanism. */
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const filtered = isFiltered(query);
  const overPaged = isOverPaged(query);

  /* Not wrapped in `useCallback`: the React Compiler is on in this project and
     memoizes this already; a manual dependency list disagreeing with the
     compiler's inference makes it skip optimising the whole component. */
  function commit(next: AuditQuery) {
    const params = toUrlParams(next);
    /* `push`, not `replace` — going back from a filtered list must reach the
       unfiltered one. */
    router.push(`/${locale}/audit${params.size > 0 ? `?${params}` : ""}`, { scroll: false });
  }

  /* A new filter resets to page one; paging and per-page do not. Page 3 of a
     differently filtered list is a different set of rows. */
  const commitFilter = (next: AuditQuery) => commit({ ...next, page: 1 });

  /* The one affordance no individual control offers: dropping every dimension at
     once, while keeping the reading position's page size. Same control, same
     words and same handler as the no-results empty state. */
  const clearAll = () => commit({ ...EMPTY_QUERY, perPage: query.perPage });

  /*
   * **The control declines what the API would refuse, rather than sending it or
   * silently dropping it.** `queryFromParams` coerces a bad `?action=` to no
   * filter so a hand-edited URL cannot provoke an error screen; a *control* that
   * did the same would turn what somebody typed into the unfiltered list, which
   * is a filter reporting a narrowing that did not happen. So the field keeps
   * the value, shows the rule, and does not commit.
   */
  const submitAction = (next: string) => {
    if (!isActionQuery(next) || next === query.action) return;
    commitFilter({ ...query, action: next });
  };

  const submitResourceId = (next: string) => {
    if (next !== "" && !isFilterableResourceId(next)) return;
    if (next.length > RESOURCE_ID_MAX || next === query.resourceId) return;
    commitFilter({ ...query, resourceId: next });
  };

  const ctx: AuditColumnContext = {
    locale,
    t,
    hasResourceName: (type) => t.has(`resource.${type}`),
  };
  const columns = buildColumns(ctx);

  /* Held here rather than inside `DataTable` so the controls sit in the toolbar
     beside the filters instead of floating above the card. */
  const preferences = useTablePreferences("audit", columns);

  /* Offline, or the last fetch failed over rows still on screen. §3.7-4: a
     refetch that fails keeps the rows and reports their age. */
  const stale = dataUpdatedAt > 0 && (!online || isError);

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        /*
         * The visible count, and the testid the suite waits on before asserting
         * anything else. `Isolate` and never `Ltr`: this is a translated sentence
         * with a number in it, not an identifier, and forcing LTR lays an Arabic
         * count out from the left.
         *
         * It is also the only figure this screen prints about its own scale, and
         * it comes from `meta.total`. The retired screen carried a second
         * sentence at the foot of the list saying how many pages the trail ran
         * to and advising the reader to filter by date; the pager says the first
         * and the labelled date controls are the second, and a grey paragraph
         * under a table restating both is §11's defect.
         */
        subtitle={
          <span data-testid="audit-count">
            <Isolate>{t("count", { total })}</Isolate>
          </span>
        }
        /*
         * One control, and it is not a primary. **Nothing on this screen writes**:
         * `AuditLogController` registers GET on the collection and nothing else,
         * because the table is append-only by design. A create button here would
         * name an action the API does not have.
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
          /*
           * **Two rows, and the split is measured rather than tidy.** Six
           * controls do not fit one line at any width this panel supports — at
           * 1440 the content column is 1136px against about 1210px of controls —
           * so the sixth wraps, and in a `flex-wrap` row the second line begins
           * below the *tallest* item of the first. Measured in Chromium at 1440
           * in French: the "Jusqu’au" picker landed **146px** below its five
           * siblings, with the gap filled by nothing at all.
           *
           * Splitting it deliberately puts the break where it means something —
           * *what and who* above, *when* below — and gives each row exactly one
           * hinted control, placed where its help text hangs into empty space
           * instead of setting a line height for the controls beside it.
           *
           * `align="start"`, not `end`: `end` aligns the bottom of an item, which
           * is the hint’s last line and not the control’s box. See `FilterRow`.
           */
          <div className="flex flex-col gap-3">
            <FilterRow align="start">
              <div className="w-full sm:w-52">
                <TextField
                  label={t("actionLabel")}
                  value={actionDraft}
                  onChange={setActionDraft}
                  onSubmit={submitAction}
                  /* A real example rather than a description, as the coupon code
                     field does — and **no `hint`**: the placeholder already shows
                     exactly what a valid value looks like, and the rule only
                     becomes worth a sentence at the moment it is broken, which is
                     what `validate` says. */
                  placeholder={t("actionPlaceholder")}
                  validate={(value) => (isActionQuery(value) ? undefined : t("actionInvalid"))}
                  /* An action is an identifier: a dotted ASCII run typed into an
                     Arabic page is reordered by the bidi algorithm and the person
                     reads back a value they did not enter. */
                  isolate
                />
              </div>

              <div className="w-full sm:w-52">
                <Select
                  label={t("resourceLabel")}
                  value={query.resourceType}
                  onChange={(resourceType) => commitFilter({ ...query, resourceType })}
                  options={[
                    { value: "", label: t("resource.all") },
                    ...RESOURCE_TYPES.map((type) => ({
                      value: type as string,
                      label: t(`resource.${type}`),
                    })),
                  ]}
                />
              </div>

              <div className="w-full sm:w-44">
                <TextField
                  label={t("resourceIdLabel")}
                  value={resourceIdDraft}
                  onChange={setResourceIdDraft}
                  onSubmit={submitResourceId}
                  placeholder={t("resourceIdPlaceholder")}
                  validate={(value) =>
                    value === "0"
                      ? t("resourceIdZero")
                      : value.length > RESOURCE_ID_MAX
                        ? t("resourceIdTooLong")
                        : undefined
                  }
                  /* A resource id is a **string**, so a text box rather than a
                     number one: `cms` is audited as `ac_cms_homepage` and `menu`
                     as `primary`, and `inputMode="numeric"` on a field that has to
                     take those would be a keyboard that cannot type the value. */
                  isolate
                />
              </div>

              {/*
                Not rendered when `/users` did not answer: a picker with one option
                cannot narrow anything, which is §3.3. The rows still name their
                actor either way, so a failed fetch costs the filter and not the
                screen.
              */}
              {actors.length > 0 ? (
                <div className="w-full sm:w-56">
                  <Select
                    label={t("actorLabel")}
                    value={String(query.actorId)}
                    onChange={(value) =>
                      commitFilter({ ...query, actorId: Number.parseInt(value, 10) || 0 })
                    }
                    /*
                      Said once, on the control it is about — §19’s rule that a
                      caveat goes on the thing it is about. `?actor_id=0` is a
                      **400** (`minimum: 1`, and PHP’s `array_filter` would drop
                      the zero even without it), so there is no System option here:
                      it would be a control that cannot act. The system’s 1 021
                      rows still render as a named state; they are simply not
                      filterable *to*, and a reader looking for that option needs
                      to be told rather than left hunting.
                    */
                    hint={t("actorSystemNote")}
                    options={[
                      { value: "0", label: t("actorAll") },
                      ...actors.map((actor) => ({
                        value: String(actor.id),
                        label: `${actor.display_name} (${actor.username})`,
                      })),
                    ]}
                  />
                </div>
              ) : null}
            </FilterRow>

            <FilterRow align="start">
              {/*
                Two bounds, each bounding the other so an inverted range is hard to
                express — it is a 200 with zero rows rather than a refusal, so
                nothing on screen would explain it.

                `echo` on both, and it is a measured defence rather than a nicety: a
                native date input follows the *browser’s* locale and there is no way
                to change it, so the Arabic panel renders `mm/dd/yyyy` — a US
                ordering in a right-to-left screen for a shop in Algeria. The
                readback underneath is the only place the applied bound is legible.

                `formatDay` and not `formatDate`: these are calendar days the server
                draws in UTC, both ends inclusive of the whole day, not instants in
                the shop’s clock. `Isolate` and never `Ltr` — it is `Intl`-formatted,
                and forcing a direction over the marks ICU inserts renders an Arabic
                date backwards.
              */}
              <div className="w-full sm:w-48">
                <DateField
                  label={t("dateFrom")}
                  value={query.dateFrom}
                  max={query.dateTo === "" ? undefined : query.dateTo}
                  onChange={(next) => commitFilter({ ...query, dateFrom: dayFromInput(next) })}
                  /* The pair’s one caveat, on the first of the two and nowhere
                     else: both ends are whole days in UTC, so an entry stamped late
                     in the Algiers evening falls on the next day here. Repeating it
                     under the second picker would be §11’s footnote defect at a
                     six-inch distance. */
                  hint={t("dateHint")}
                  echo={
                    query.dateFrom === "" ? undefined : (
                      <Isolate>{formatDay(query.dateFrom, locale)}</Isolate>
                    )
                  }
                />
              </div>

              <div className="w-full sm:w-48">
                <DateField
                  label={t("dateTo")}
                  value={query.dateTo}
                  min={query.dateFrom === "" ? undefined : query.dateFrom}
                  onChange={(next) => commitFilter({ ...query, dateTo: dayFromInput(next) })}
                  echo={
                    query.dateTo === "" ? undefined : (
                      <Isolate>{formatDay(query.dateTo, locale)}</Isolate>
                    )
                  }
                />
              </div>

              {/*
                **Not rendered when nothing is filtered**, per §3.3: a control that
                cannot act is absent rather than disabled, and "clear" with nothing
                to clear cannot act.

                `mt-6` on both trailing controls, because this row is `items-start`
                and an unlabelled control would otherwise sit level with the
                *labels*: 18px of `--text-ui-label` plus `FieldFrame`’s 6px gap,
                both off the spacing scale. See `FilterRow`.
              */}
              {filtered ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="close"
                  className="mt-6"
                  onClick={clearAll}
                >
                  {t("empty.clear")}
                </Button>
              ) : null}

              <div className="ms-auto mt-6">
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
        {stale ? (
          /* The cause, not just the age: this screen reaches the marker with the
             interface still up whenever a refresh fails, so `offline` would be
             the banner stating something it has not established. */
          <StaleBanner
            time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)}
            reason={online ? "refreshFailed" : "offline"}
          />
        ) : null}

        {/* A live region, so a filter that changes the result count announces it.
            Its own testid: `audit-count` above is the *visible* count and is what
            the suite asserts on, and two elements sharing one testid is a
            strict-mode violation the moment either is queried. */}
        <p aria-live="polite" className="sr-only" data-testid="audit-live">
          {tA11y("listUpdated", { total })}
        </p>

        {isPending && rows.length === 0 ? (
          <>
            <div className="hidden md:block">
              <TableSkeleton rows={8} cols={4} label={t("loading")} />
            </div>
            {/* The card and its 8px padding are `DataTable`'s below `md`, so the
                skeleton wears them too or the rows step inward when data lands. */}
            <div className="ui-card p-2 md:hidden">
              <RecordListSkeleton rows={6} label={t("loading")} />
            </div>
          </>
        ) : isError && rows.length === 0 ? (
          /*
           * **The error state and the empty state print different strings.** A
           * failed request and an empty trail are not the same fact, and only one
           * of them is fixed by pressing retry.
           *
           * Reached only when there is nothing on screen. A refetch that fails
           * over rows already rendered keeps them — §3.7-4 as amended — and says
           * so through the marker above. `queryFromParams` drops every value the
           * API would refuse, so this screen does not manufacture its own 400s;
           * what reaches here is the API's own message for a refusal the panel
           * did not cause.
           */
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={filtered || overPaged ? "search" : "clock"}
            /*
             * **Three empty states, and telling them apart is the point.** Past
             * the last page is the most specific fact and wins the one action
             * this state gets — `?page=999` answers a 200 with an empty array, so
             * the table is not drawn and with it goes the only control that could
             * page back. At 887 pages that is an ordinary URL rather than a
             * curiosity, and "the journal is empty" would be a false sentence
             * about a table holding 17 732 rows. No results for these filters
             * offers to clear them; five dimensions can each empty this list, so
             * the second half has real producers. Nothing recorded at all offers
             * nothing, and that is correct: an entry is written by every other
             * screen in the panel, never by this one.
             */
            message={
              overPaged ? t("empty.pastEnd") : filtered ? t("empty.noResults") : t("empty.none")
            }
            action={
              overPaged
                ? { label: t("empty.firstPage"), onClick: () => commit({ ...query, page: 1 }) }
                : filtered
                  ? { label: t("empty.clear"), onClick: clearAll }
                  : undefined
            }
          />
        ) : (
          <DataTable
            preferences={preferences}
            rows={rows}
            columns={columns}
            rowKey={(row) => String(row.id)}
            /*
             * Named by its date as well as its action: `product.updated` is the
             * ordinary case seven rows running, and read out of a links list they
             * would be seven identical names pointing at seven different records.
             */
            rowLabel={(row) => auditRowLabel(row, ctx, tA11y)}
            record={(row) => auditRecord(row, ctx)}
            /* The row opens the peek rather than navigating: there is no detail
               route to navigate to. `rowOpenerId` is therefore required — a
               `<tr>` handler is a mouse-only row at `md`+, and the button it
               wraps the identifying cell in is both the keyboard path and the
               target the drawer's `returnFocusTo` names. §3.2 and §10. */
            onRowClick={(row) => setPeek(row)}
            rowOpenerId={(row) => auditOpenerId(row.id)}
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

      <AuditPeek
        row={peek}
        ctx={ctx}
        onOpenChange={(open) => {
          if (!open) setPeek(null);
        }}
        /* The one navigation this screen offers, and it is back into itself: an
           entry's object, and every other entry about it. The resource type goes
           with it only when this build can represent it — an unnamed type would
           be dropped on the next read of the URL, leaving the picker and the
           address disagreeing — and the id alone still narrows. */
        onFilterResource={(resourceType, resourceId) => {
          setPeek(null);
          commitFilter({
            ...query,
            resourceType: isResourceType(resourceType) ? resourceType : "",
            resourceId,
          });
        }}
      />
    </div>
  );
}
