"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Campaign, Segment } from "@/lib/api/schemas/campaign";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import {
  DataTable,
  TableControls,
  TableFooter,
  useTablePreferences,
  type SortState,
} from "@/components/ui/DataTable";
import { FilterRow, FilterTabs, SearchField } from "@/components/ui/FilterBar";
import { Select } from "@/components/ui/Form";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { RecordListSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { Button, IconButton } from "@/components/ui/Button";
import { Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import {
  buildColumns,
  campaignOpenerId,
  campaignRecord,
  type CampaignColumnContext,
} from "./columns";
import { CampaignPeek } from "./CampaignPeek";
import {
  EMPTY_QUERY,
  STATUS_FILTERS,
  campaignsKey,
  isFiltered,
  listParams,
  orderbyFromKey,
  queryFromParams,
  toUrlParams,
  type CampaignsQuery,
  type StatusFilter,
} from "./query";

/**
 * The campaign list, rebuilt on the new design system.
 *
 * ## Four filter dimensions in one row, and no drawer and no chips
 *
 * Status tabs above; then the search box, the segment picker and — only while
 * something is filtered — the clear button. Products needed a `Drawer` with
 * draft-then-apply at nine dimensions; four fit a row, and that is payments'
 * judgement at exactly this count. **No chips**, for payments' reason as well: the
 * status is the highlighted tab, the term is in its own box and the segment is
 * the `Select`'s own selected option, so a chip row would restate three controls
 * standing six inches above it. What survives is the one affordance no individual
 * control offers — dropping every dimension at once — rendered only when it can
 * act, per §3.3, and it is the same control the no-results empty state offers.
 *
 * **The search placeholder names its scope, and here that scope is two fields.**
 * `?search=Ramadan` hits campaign 320 on its *name*; the same parameter matches
 * the subject. Saying so is the coupons rule ("porte sur le code") with a
 * different answer rather than the same one: a person who searches a body and
 * gets nothing needs the sentence to be on screen where they are already looking.
 *
 * **The segment picker ships where shipping's provider box did not**, and the
 * difference is the enumeration rather than the parameter. `?segment_id=99999` is
 * a silent **200 with 0 rows**, not a refusal, so free text would make a typo
 * indistinguishable from "no campaign uses this segment"; `GET /segments` is
 * allowlisted and enumerates **all four**, so a picker can offer every value that
 * matters and cannot express one that does not. DECISIONS.md's picker rule,
 * landing on the yes side.
 *
 * ## Sorting, on three of six columns
 *
 * The strongest sort in the run — see `query.ts`, which carries every request.
 * `name`, `updated_at` and `created_at` carry a `sortKey` and those three headers
 * announce `aria-sort`; `subject`, `audience` and `recipients` deliberately do
 * not, because the API cannot sort them. `id` sorts, gets no column and stays
 * reachable by URL. **No sort below `md`**: `RecordList` takes no sort props and
 * that is correct rather than a gap — a control with nothing on screen to act on
 * is worse than no control.
 *
 * ## Create is a `Button`, and it was broken
 *
 * **A POST, so it must not be a link.** Next prefetches links, so a `/new` route
 * that created a draft would create one when somebody's thumb passed over it —
 * which is also why `PageHeader` had to learn to hold a button rather than the
 * primary being demoted to the toolbar. `POST /campaigns` is what makes the
 * composer's save-on-advance possible: the preview is a render of the **server's**
 * copy.
 *
 * The body this used to send was `subject: ""`, with a comment calling it "the
 * minimum the API accepts". It is a **400** — `subject: Required — a campaign
 * with no subject line is not sendable.` — so the button had never worked against
 * the live shop. The real minimum is a name, a non-empty subject and an
 * `audience_type`: absent behaves as `"segment"`, which then refuses for a
 * missing `segment_id`, so `"all"` is the only value that needs no second field.
 * Both bodies may be empty — that is a measured **201**, and the rule that they
 * must both be filled is the wizard's rather than the API's.
 *
 * ## The stale marker stays
 *
 * §3.7's amendment exempts a screen that cannot hold data older than its own last
 * fetch. This is not one: a client component over a react-query cache with a
 * manual refresh **and** a write, so both halves of the rule bite.
 */
export function CampaignsList({
  locale,
  initialQuery,
  initialCampaigns,
  initialTotal,
  segments,
}: {
  locale: string;
  initialQuery: CampaignsQuery;
  initialCampaigns: Campaign[] | null;
  initialTotal: number | null;
  /**
   * The whole segment list, fetched on the server beside page one.
   *
   * It feeds two things at once and neither costs a second request: the filter
   * picker, and the audience column's ability to say *which* segment rather than
   * "Un segment". Empty when the request failed — the picker is then not
   * rendered at all, per §3.3, and the clear button is still the way out of a
   * `?segment_id=` that arrived in the URL.
   */
  segments: Segment[];
}) {
  const t = useTranslations("campaigns");
  const tA11y = useTranslations("a11y");
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [creating, setCreating] = useState(false);

  const query = useMemo(
    () => queryFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: campaignsKey(query),
    queryFn: async () => {
      const result = await acRead<Campaign[]>(`/campaigns?${listParams(query)}`);
      return { campaigns: result.data, total: result.total };
    },
    initialData:
      initialCampaigns !== null && campaignsKey(query)[2] === campaignsKey(initialQuery)[2]
        ? { campaigns: initialCampaigns, total: initialTotal ?? initialCampaigns.length }
        : undefined,
    /* Keeps the previous page on screen while the next loads, so changing a
       filter, the tab, the sort or the page never flashes a skeleton over content
       still valid. §3.6's third mechanism. */
    placeholderData: keepPreviousData,
  });

  const campaigns = data?.campaigns ?? [];
  const total = data?.total ?? 0;
  const filtered = isFiltered(query);
  /* `?page=999` answers 200 with an empty array, so the table is not drawn and
     with it goes the only control that could page back. */
  const overPaged = campaigns.length === 0 && query.page > 1;

  const peekId = searchParams.get("peek");
  const inPage =
    peekId === null ? null : (campaigns.find((row) => String(row.id) === peekId) ?? null);

  /*
   * **A peek off the current page, and it is a deep link that has to work.**
   *
   * `/orders` and `/products` resolve `?peek=` against the rows already in memory
   * and stop there, which DECISIONS.md §14 records as a carried-forward defect:
   * on those screens the id got into the URL by somebody clicking a visible row,
   * so only a shared or bookmarked link reaches the gap — and then it silently
   * renders no drawer at all. The media branch fixed it there rather than
   * reproducing it, and this screen does the same.
   *
   * It costs nothing this list was saving: `GET /campaigns/{id}` is the list row
   * exactly, which is the same fact that makes the drawer free. Only fired when
   * the row is not already here, so clicking one still costs no request.
   *
   * `retry: false`, and a failure opens nothing: an id naming no campaign is one
   * somebody deleted or typed, and the list behind it is intact and usable. There
   * is no error state to put on a screen that is working.
   */
  const peekQuery = useQuery({
    queryKey: ["campaigns", "item", peekId],
    enabled: peekId !== null && inPage === null,
    queryFn: async () => (await acRead<Campaign>(`/campaigns/${peekId}`)).data,
    retry: false,
  });

  const peeked = inPage ?? peekQuery.data ?? null;

  /* Not wrapped in `useCallback`: the React Compiler is on in this project and
     memoizes this already; a manual dependency list disagreeing with the
     compiler's inference makes it skip optimising the whole component. */
  function commit(next: CampaignsQuery) {
    const params = toUrlParams(next);
    /* `push`, not `replace` — going back from a filtered list must reach the
       unfiltered one, and closing a preview with the back button is half of what
       putting it in the URL is for. */
    router.push(`/${locale}/marketing/campaigns${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  /* A new filter or a new sort resets to page one; paging and per-page do not.
     Page 3 of a re-ordered list is a different set of rows, not the same ones
     rearranged. */
  const commitFilter = (next: CampaignsQuery) => commit({ ...next, page: 1 });

  function setPeek(id: number | null) {
    const params = toUrlParams(query);
    if (id !== null) params.set("peek", String(id));
    router.push(`/${locale}/marketing/campaigns${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  const create = async () => {
    setCreating(true);
    try {
      const created = await acWrite<{ id: number }>("POST", "/campaigns", {
        name: t("create"),
        /*
         * A real subject, because an empty one is a 400 on this route. It is a
         * placeholder the content step exists to replace, and it says so in the
         * reader's language rather than being a blank the person has to notice.
         */
        subject: t("newSubject"),
        /* Both accepted empty — a measured 201. The wizard will not let either
           stay empty, which is its rule and not the API's. */
        body_html: "",
        body_text: "",
        /* The only audience needing no second field, so the draft is valid the
           moment it exists and the audience step opens on a choice rather than on
           a refusal. Absent would behave as `"segment"` and refuse. */
        audience_type: "all",
      });
      router.push(`/${locale}/marketing/campaigns/${created.id}`);
    } catch (thrown) {
      toast.show((thrown as BrowserApiError).message, "danger");
      setCreating(false);
    }
  };

  const segmentName = (id: number) =>
    segments.find((segment) => segment.id === id)?.name ?? null;

  const ctx: CampaignColumnContext = { locale, t, segmentName };
  const columns = buildColumns(ctx);

  /* Held here rather than inside `DataTable` so the controls sit in the toolbar
     beside the filters instead of floating above the card. */
  const preferences = useTablePreferences("campaigns", columns);

  /* Read straight off the URL state. At rest `query.orderby` is `created_at`,
     which the created column *does* declare — so that header reads
     `aria-sort="descending"` on a first paint, which is true: the list really is
     in that order, and the third click drops `orderby` and returns to it. */
  const sortState: SortState = { key: query.orderby, direction: query.order };

  /*
   * The picker's options, and the last branch is the honest half.
   *
   * A hand-edited or stale `?segment_id=` outside the enumeration is **not**
   * refused by the API — it is a silent 200 with zero rows — so it travels, and a
   * `<select>` whose value matches none of its options renders blank. Adding the
   * value as its own option is what keeps the control able to show the state it
   * is in; the clear button beside it is how it comes off.
   */
  const segmentOptions = [
    { value: "0", label: t("segmentAny") },
    ...segments.map((segment) => ({ value: String(segment.id), label: segment.name })),
    ...(query.segmentId > 0 && segmentName(query.segmentId) === null
      ? [{ value: String(query.segmentId), label: t("segmentUnknown", { id: query.segmentId }) }]
      : []),
  ];

  const clearAll = () => commit({ ...EMPTY_QUERY, perPage: query.perPage });

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("campaigns")}
        back={{ href: `/${locale}/marketing`, label: t("hubTitle") }}
        subtitle={
          <span data-testid="campaigns-count">
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
            {/* A `Button`, never a `ButtonLink` — see the docblock. */}
            <Button
              variant="primary"
              icon="plus"
              loading={creating}
              onClick={() => void create()}
              data-testid="create-campaign"
            >
              {t("create")}
            </Button>
          </>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            <FilterTabs<StatusFilter>
              tabs={STATUS_FILTERS.map((value) => ({
                value,
                label: value === "" ? t("statusAll") : t(`status.${value}`),
              }))}
              value={query.status}
              onChange={(status) => commitFilter({ ...query, status })}
              label={t("statusLabel")}
            />

            {/* `align="end"`, because the segment picker carries a visible label
                over its box and the search field does not — see `FilterRow`. */}
            <FilterRow align="end">
              <div className="flex min-w-56 flex-1 sm:max-w-80">
                <SearchField
                  value={query.search}
                  onSubmit={(next) => commitFilter({ ...query, search: next })}
                  placeholder={t("searchPlaceholder")}
                  label={t("searchLabel")}
                  clearLabel={t("clearSearch")}
                />
              </div>

              {/*
                Not rendered when there is nothing to pick from — §3.3, and it is
                a real case rather than a defensive one: the list is fetched on the
                server and a failure there leaves this empty while every other
                control still works.
              */}
              {segments.length > 0 || query.segmentId > 0 ? (
                <div className="w-full sm:w-56">
                  <Select
                    label={t("field.segment")}
                    value={String(query.segmentId)}
                    onChange={(value) =>
                      commitFilter({ ...query, segmentId: Number(value) || 0 })
                    }
                    options={segmentOptions}
                  />
                </div>
              ) : null}

              {filtered ? (
                <Button variant="ghost" size="sm" icon="close" onClick={clearAll}>
                  {t("empty.clear")}
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
        {!online && dataUpdatedAt > 0 ? (
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
        ) : null}

        {/* A live region, so a filter that changes the result count announces it.
            Its own testid: `campaigns-count` above is the *visible* count and is
            what the suite asserts on, and two elements sharing one testid is a
            strict-mode violation the moment either is queried. */}
        <p aria-live="polite" className="sr-only" data-testid="campaigns-live">
          {tA11y("listUpdated", { total })}
        </p>

        {isPending && campaigns.length === 0 ? (
          <>
            <div className="hidden md:block">
              <TableSkeleton rows={5} cols={6} label={t("loading")} />
            </div>
            {/* The card and its 8px padding are `DataTable`'s below `md`, so the
                skeleton wears them too or the rows step inward when data lands. */}
            <div className="ui-card p-2 md:hidden">
              <RecordListSkeleton rows={5} label={t("loading")} />
            </div>
          </>
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon={filtered || overPaged ? "search" : "mail"}
            /*
             * **Three empty states, and telling them apart is the point.** Past
             * the last page is the most specific fact and wins the one action this
             * state gets. No results for these filters offers to clear them and
             * names what the search covers, because the person who needs that
             * sentence is already looking at nothing. No campaigns at all offers
             * the create action — `POST /campaigns` is allowlisted and this screen
             * is where a first campaign comes from.
             */
            message={
              overPaged
                ? t("empty.pastEnd")
                : filtered
                  ? t("empty.noResults")
                  : t("empty.none")
            }
            action={
              overPaged
                ? { label: t("empty.firstPage"), onClick: () => commit({ ...query, page: 1 }) }
                : filtered
                  ? { label: t("empty.clear"), onClick: clearAll }
                  : { label: t("create"), onClick: () => void create() }
            }
          />
        ) : (
          <DataTable
            preferences={preferences}
            rows={campaigns}
            columns={columns}
            rowKey={(campaign) => String(campaign.id)}
            rowLabel={(campaign) => tA11y("campaignName", { name: campaign.name })}
            record={(campaign) => campaignRecord(campaign, ctx)}
            /*
             * The whole row opens the peek, and there is no trailing `Menu`: the
             * drawer holds the one action and a 40px column repeating "open" is
             * not an action.
             *
             * `onRowClick` is the *pointer* path only — a `<tr>` is not focusable.
             * `rowOpenerId` is what makes the name cell a real `<button>`, which
             * is the keyboard path and the drawer's focus target.
             */
            onRowClick={(campaign) => setPeek(campaign.id)}
            rowOpenerId={(campaign) => campaignOpenerId(campaign.id)}
            sort={sortState}
            onSortChange={(next) =>
              /* `null` is the third click and it restores the resting order rather
                 than sending `orderby=created_at&order=desc` as an explicit ask:
                 `toUrlParams` omits both when they equal `EMPTY_QUERY`. */
              commitFilter({
                ...query,
                orderby: next === null ? EMPTY_QUERY.orderby : orderbyFromKey(next.key),
                order: next === null ? EMPTY_QUERY.order : next.direction,
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

      <CampaignPeek
        campaign={peeked}
        ctx={ctx}
        locale={locale}
        onOpenChange={(next) => {
          if (!next) setPeek(null);
        }}
      />
    </div>
  );
}
