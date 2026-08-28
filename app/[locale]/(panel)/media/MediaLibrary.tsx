"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MediaItem } from "@/lib/api/schemas/media";
import { acRead } from "@/lib/api/browser";
import { MEDIA_PER_PAGE } from "@/lib/media";
import { formatWhen } from "@/lib/format/date";
import { useOnline } from "@/lib/use-online";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { MediaGrid, MediaGridSkeleton } from "@/components/ui/MediaGrid";
import { FilterRow, FilterTabs, SearchField } from "@/components/ui/FilterBar";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { Button, IconButton } from "@/components/ui/Button";
import { Isolate } from "@/components/primitives/Ltr";
import { MEDIA_SCOPE, MediaDrawer } from "./MediaDrawer";
import { UploadModal } from "./UploadModal";
import {
  MEDIA_ORDERS,
  isFiltered,
  listParams,
  mediaKey,
  queryFromParams,
  toUrlParams,
  type MediaOrder,
  type MediaQuery,
} from "./query";

/**
 * The media library.
 *
 * ## A grid, and the absence of a table is the decision
 *
 * DESIGN.md §3.2's table contract is about rows of fields, and here the picture
 * **is** the identifying cell: a list row showing a 44px thumbnail beside a
 * generated filename is a worse way to find an image than four columns of
 * images. So there is no `DataTable`, no `RecordList` and no `columns.tsx` — the
 * record's fields live in the peek drawer, which is the trade `RecordList`
 * already makes below `md`, taken one step further because there is nothing here
 * a column could usefully hold. `components/ui/MediaGrid.tsx` draws it, shared
 * with the picker rather than forked into this page.
 *
 * `PageBody width="full"` — §2.3's table/list row, capped at 1600. The screen
 * this replaces used `max-w-3xl`, which §0 retires by name.
 *
 * ## Delete ships, and the reason it did not is the reason it does
 *
 * This screen recorded "no delete" for a fortnight, and the recorded reason was
 * good: nothing in the API told the panel what an attachment was *used by*, so
 * the library could not answer "what would this break?" and an irreversible
 * action a screen cannot explain is worse than one it does not offer.
 *
 * `GET /media/{id}/usage` is the answer, added to the API for exactly this. It
 * lives in `MediaDrawer` — a header `Menu` into a `ConfirmDialog` that reads the
 * endpoint when it opens — and the whole argument for its wording is there.
 * `onDeleted` below is this screen's half: the count drops, the tile goes, and
 * `?peek=` is cleared by the one writer that owns it.
 *
 * ## What this screen deliberately does not ship
 *
 * **No `type` filter**, though the parameter demonstrably works — four positive
 * controls at `:337-361`. Two reasons, either sufficient. There is no allowlisted
 * enumeration of what a library can *hold*: `ACCEPTED_MIME` is what the panel can
 * upload, which is definitionally a subset, and the picker rule refuses a control
 * built on an incomplete one — the shipping-provider precedent. And every one of
 * the 41 rows is `image/*`, so the filter has exactly one non-empty value. A
 * control that can only answer "all of them" cannot act.
 *
 * **No bulk and no export** — media is not in `EXPORT_SUBJECTS`, so an export
 * control would point at a route that does not exist.
 *
 * ## Two controls that this screen shipped without, and the record that was wrong
 *
 * It shipped with no search and no sort, and DECISIONS.md §14 recorded both as
 * "unmeasured, therefore treated as broken". **Both were measured on 2026-08-28
 * against the live API and both work**, so the recorded reason was false and the
 * controls ship. The standing rule is not that an unmeasured parameter is broken;
 * it is that it is *treated* as broken until somebody goes and takes the control,
 * which is what happened. `query.ts` carries every request and its answer.
 *
 * What ships is a **submit-gated** search and **four** sort chips: newest,
 * oldest, A→Z, Z→A. The title half arrived second — `orderby=title` was
 * unprovable while 42 of the 43 rows shared the title "Tapis", and shipped on
 * 2026-08-28 once somebody built the fixture `query.ts` had asked for and took
 * the control in both directions. `id` sorts and is refused anyway: on this
 * collection id order and date order are the same fact, so a fifth chip would do
 * the first chip's job.
 *
 * **Four flat chips rather than a field selector and a direction toggle.** Each
 * is a complete answer to "in what order", and one of the four combinations a
 * two-control version would offer (`id`) does not ship — so the pair would be a
 * composer for a space that is not a product.
 *
 * **The sort is `FilterTabs` in its `chips` shape, and that is the panel-wide
 * rule rather than a choice made here** — DECISIONS.md §12: a full-bleed
 * underlined strip under the header always means *which view*, and a labelled
 * chip group always means a filter over it. This screen has no views, so the
 * strip variant would claim an axis it does not have. **No `aria-sort`**: that
 * attribute belongs to a table header and there is no table here. The chips are a
 * filter control, announce as one through `aria-current`, and the `nav` carries
 * the same visible label the sighted reader sees.
 *
 * **The search is submit-gated**, on the coupons pattern: `SearchField` fires on
 * Enter or on the clear button and never on a keystroke.
 *
 * ## Both empty states, and the second one now has a producer
 *
 * §3.7 wants *nothing yet* told apart from *nothing matching this search*. Until
 * this branch this screen could only ever have the first — no filter, no search,
 * no sort, and a pager bounded by the total it renders — and DESIGN.md §3.7
 * carries the amendment that was written about exactly that. **The amendment's
 * principle stands and its example is now stale**: the search can return nothing,
 * so the second state exists, offers to clear the search, and names what the
 * search covers. The sort cannot produce it — re-ordering 43 rows returns 43 rows
 * — so clearing does not touch it.
 *
 * ## The stale marker stays
 *
 * §3.7's amendment exempts a screen that cannot hold data older than its own last
 * fetch. This is not one: it is a client component over a react-query cache with a
 * manual refresh **and it writes** — the upload and the drawer both — so both
 * halves of the rule bite, and every write control carries the same reason.
 */
export function MediaLibrary({
  locale,
  initialQuery,
  initialItems,
  initialTotal,
}: {
  locale: string;
  initialQuery: MediaQuery;
  initialItems: MediaItem[] | null;
  initialTotal: number | null;
}) {
  const t = useTranslations("media");
  const tStates = useTranslations("states");
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  /* The search term and the sort live in the URL, on the shape every other list
     uses; the page is local state and the peek is a URL parameter, which is the
     split `/orders` uses. A peek is worth sharing and worth a back button, and a
     page number on this screen is still not a view anybody links to — both
     controls send it back to 1, so it never outlives the list it counted into. */
  const query = useMemo(
    () => queryFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  /** Attachments this session has permanently deleted — see `peeked` below. */
  const [deleted, setDeleted] = useState<ReadonlySet<number>>(new Set());
  const peekId = searchParams.get("peek");

  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: mediaKey(query, page),
    queryFn: async () => {
      const { data: items, total } = await acRead<MediaItem[]>(
        `/media?${listParams(query, page)}`,
      );
      return { items, total };
    },
    /* Only where the server's own request was this one. It fetches page 1 of
       whatever the URL asked for, so the two agree on arrival — and the guard is
       what keeps them from disagreeing during a client navigation that has
       committed a new URL against a page number the reader was already on. */
    initialData:
      initialItems !== null && page === 1 && mediaKey(query, 1)[2] === mediaKey(initialQuery, 1)[2]
        ? { items: initialItems, total: initialTotal ?? initialItems.length }
        : undefined,
    /* Keeps the previous page on screen while the next loads, so paging never
       flashes a skeleton over content that is still valid. §3.6's third
       mechanism. */
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const filtered = isFiltered(query);

  const inPage = peekId === null ? null : (items.find((item) => String(item.id) === peekId) ?? null);

  /*
   * **A peek off the current page, and it is a deep link that has to work.**
   *
   * Every other `?peek=` in this panel resolves against the rows already in
   * memory and stops there, because on those screens the id in the URL got there
   * by somebody clicking a row that is on screen. Here it does not survive
   * contact with the resting order: the collection is **newest first**, so
   * `/media?peek=5001` — the oldest attachment, and the harness's own capture
   * target — sits on page **three** and resolved to nothing at all. A URL that
   * silently renders no drawer is the same defect as a control that silently
   * does nothing.
   *
   * `GET /media/{id}` is what closes it, and it costs nothing this screen was
   * saving: `MediaPresenter::toArrayList` is `array_map(toArray)`, so the single
   * read is the list row exactly — the same fact that makes the drawer free in
   * the first place. Only fired when the row is not already here, so clicking a
   * tile still costs no request.
   *
   * `retry: false`, and a failure opens nothing: an id naming no attachment is a
   * file that is gone or a URL somebody typed, and the library behind it is
   * intact and usable. There is no error state to put on a screen that is
   * working.
   */
  const peekQuery = useQuery({
    queryKey: ["media", "item", peekId],
    enabled: peekId !== null && inPage === null && !deleted.has(Number(peekId)),
    queryFn: async () => (await acRead<MediaItem>(`/media/${peekId}`)).data,
    retry: false,
  });

  /*
   * **An id this session deleted resolves to nothing, cache or no cache**, and
   * both halves of that were measured in Chromium rather than reasoned about.
   *
   * The query above is still mounted for the render in which a successful delete
   * clears `?peek=` — `enabled` cannot go false until React has re-rendered — so
   * the invalidation that follows re-asked `GET /media/{id}` for the row that had
   * just stopped existing and took a 404 in the console. And `setPeek` uses
   * `push`, so **back** lands on the `?peek=` the delete navigated away from:
   * with the answer still in cache and `retry: false` keeping the last successful
   * `data` through the 404, that re-opened a drawer on a deleted file.
   *
   * One set closes both. `removeQueries` closes neither — removing a query with a
   * live observer makes it fetch again, which is the 404 above.
   */
  const peeked =
    peekId !== null && deleted.has(Number(peekId)) ? null : (inPage ?? peekQuery.data ?? null);

  /* Not wrapped in `useCallback`: the React Compiler is on in this project and
     memoizes this already; a manual dependency list disagreeing with the
     compiler's inference makes it skip optimising the whole component. */
  function setPeek(id: number | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id === null) params.delete("peek");
    else params.set("peek", String(id));
    /* `push`, not `replace` — closing a preview with the back button is half of
       what putting it in the URL is for. */
    router.push(`/${locale}/media${params.size > 0 ? `?${params}` : ""}`, { scroll: false });
  }

  /*
   * A control moved. Both of them reset the page: page 3 of a re-sorted or
   * re-searched library is a different set of rows, not the same ones
   * rearranged, so keeping the number would keep a position that no longer
   * refers to anything.
   *
   * `push`, not `replace` — filter state in the URL is only half the promise and
   * the other half is that the back button undoes it.
   *
   * `?peek=` is deliberately not carried across. The drawer traps focus, so no
   * control in this toolbar is reachable while one is open; a branch preserving
   * it would be code for a path nobody can walk.
   */
  function commit(next: MediaQuery) {
    setPage(1);
    const params = toUrlParams(next);
    router.push(`/${locale}/media${params.size > 0 ? `?${params}` : ""}`, { scroll: false });
  }

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["media"] });

  /* The fifth state's second half. Every write on this screen carries the same
     sentence, and the two that can act are the upload and the drawer's save. */
  const blocked = online ? null : tStates("offlineWrites");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={
          /* The count, and it does not claim a total before one has arrived: a
             failed server fetch leaves the client pending, where `total` is 0 and
             `count` reads "Aucun fichier" — a sentence about a library nobody has
             counted yet. */
          <span data-testid="media-count">
            {isPending && items.length === 0 ? (
              t("loading")
            ) : (
              <Isolate>{t("count", { total })}</Isolate>
            )}
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
            {/* The screen's one primary, and the id is what the modal returns
                focus to — see `UploadModal`. */}
            <Button
              id="media-upload"
              icon="plus"
              onClick={() => setUploadOpen(true)}
              disabled={blocked !== null}
              title={blocked ?? undefined}
            >
              {t("upload")}
            </Button>
          </>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            {/*
              **`chips`, and it is the panel's rule rather than this screen's
              taste** — DECISIONS.md §12. A full-bleed underlined strip in this
              slot means *which view* everywhere else in the panel, and this
              screen has no views; a labelled chip group means a filter over what
              is on screen, which is what a sort is. The visible label is half of
              that distinction.

              Four options, and the first is the resting order — so pressing
              "newest" again returns to rest and the URL goes back to clean. The
              group scrolls rather than wraps at 340px (`ui-tabs-scroll`), which
              is what keeps the toolbar one band tall at every width and is why
              `loading.tsx` still matches first paint after this grew from two.

              No `aria-sort` anywhere near it: that attribute belongs to a table
              header and there is no table on this screen. `FilterTabs` announces
              the selection with `aria-current` and names the group on its `nav`.
            */}
            <FilterTabs<MediaOrder>
              variant="chips"
              label={t("sortLabel")}
              value={query.order}
              onChange={(order) => commit({ ...query, order })}
              tabs={MEDIA_ORDERS.map((order) => ({
                value: order,
                label: t(`sort.${order}`),
              }))}
            />

            {/*
              Submit-gated, on the coupons pattern: `SearchField` fires on Enter
              and on its own clear button, never on a keystroke.

              **The placeholder names its own scope**, which matters more here
              than on any list in the panel. A tile whose title is empty is
              labelled with its *filename*, and the filename is measured **not**
              to be searchable — so a reader typing what a tile says would get
              nothing back with nothing on screen to say why. `empty.noResults`
              repeats it, because that is where the reader who needs the sentence
              is standing.
            */}
            <FilterRow>
              <SearchField
                value={query.search}
                onSubmit={(search) => commit({ ...query, search })}
                placeholder={t("searchPlaceholder")}
                label={t("searchLabel")}
                clearLabel={t("clearSearch")}
              />
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

        {isPending && items.length === 0 ? (
          <MediaGridSkeleton label={t("loading")} count={MEDIA_PER_PAGE} />
        ) : isError && items.length === 0 ? (
          /* The API's own sentence and a retry — never the empty state's words. A
             failed request and a shop with no files are different situations and
             only one of them is worth pressing a button about. */
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : items.length === 0 ? (
          /*
           * **Both halves of §3.7's second state, and the second half has a
           * producer now.** A shop with no files at all and a search that matched
           * nothing are different situations: the first offers the upload, the
           * second offers to clear the search and says what the search covers.
           *
           * Only the search can empty this list — re-ordering 43 rows returns 43
           * rows — so clearing is the search alone and the sort is left where the
           * reader put it.
           */
          filtered ? (
            <EmptyState
              icon="search"
              message={t("empty.noResults")}
              /* Always offered, offline included: clearing a search is a
                 navigation, not a write. */
              action={{
                label: t("clearSearch"),
                onClick: () => commit({ ...query, search: "" }),
              }}
            />
          ) : (
            <EmptyState
              icon="image"
              message={t("empty.none")}
              /* Absent while offline rather than dimmed: the banner above says
                 why, and §3.3 removes a control that cannot act. */
              action={
                blocked === null
                  ? { label: t("upload"), onClick: () => setUploadOpen(true) }
                  : undefined
              }
            />
          )
        ) : (
          <MediaGrid
            items={items}
            /* The same scope the drawer's `returnFocusTo` is built from. */
            scope={MEDIA_SCOPE}
            onOpen={(item) => setPeek(item.id)}
            page={page}
            perPage={MEDIA_PER_PAGE}
            total={total}
            onPageChange={setPage}
          />
        )}
      </PageBody>

      <MediaDrawer
        item={peeked}
        locale={locale}
        online={online}
        onOpenChange={(next) => {
          if (!next) setPeek(null);
        }}
        onSaved={invalidate}
        /*
         * The file is gone. **Clearing `?peek=` is what closes the drawer**, and
         * it is the only thing that may: the URL is this drawer's open state, so
         * calling `onOpenChange(false)` from inside as well would push twice and
         * put a dead `?peek=` in the history for the back button to land on.
         *
         * The invalidation is what drops the count in the header and removes the
         * tile, and it reaches `["media","item",id]` too — the deleted row is
         * cached there whenever the peek came from a URL rather than from a
         * click, and the whole `media` prefix is invalidated for that reason.
         *
         * **`["media","library"]` and not the whole prefix**, which is the one
         * place on this screen where the difference is load-bearing. The record's
         * own entry must not be *refreshed* — the row is gone, so the refresh is
         * a `GET /media/{id}` that can only 404 — and it must not be *read* on the
         * way back either. `deleted` is what answers the second; leaving the
         * sweep off its key is what answers the first, because a `setState` here
         * has not re-rendered by the time an invalidation on the same line runs
         * and the query is still live. Both driven in Chromium. `peeked` above
         * carries the argument.
         *
         * **Deleting the last row of a page has to move the page**, and it does
         * not recover on its own. `MediaGrid` renders no pager at all when the
         * page it is handed is empty — this screen swaps in the empty state
         * before the grid is reached — so a reader who deleted row 41 of 41 from
         * page 3 would land on "no files yet", offering an upload, on a library
         * of forty. One step back, and only when this page held exactly one row:
         * anything less specific would move a reader who did not need moving.
         */
        onDeleted={(id) => {
          setDeleted((current) => new Set(current).add(id));
          void queryClient.invalidateQueries({ queryKey: ["media", "library"] });
          if (items.length === 1 && page > 1) setPage(page - 1);
          setPeek(null);
        }}
      />

      <UploadModal
        open={uploadOpen}
        online={online}
        onOpenChange={setUploadOpen}
        onUploaded={() => {
          invalidate();
          /*
           * The new file is the newest, and at rest the collection is
           * newest-first — so page one is where it landed.
           *
           * **Under a search or an oldest-first sort it is not**, and the upload
           * deliberately does not clear either to go and find it: a control that
           * threw away the state a reader had set, in order to show them
           * something, is worse than one that leaves them where they were. The
           * toast says the file was saved; the library they are looking at is
           * still the library they asked for.
           */
          setPage(1);
        }}
      />
    </div>
  );
}
