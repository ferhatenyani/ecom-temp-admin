"use client";

import { useState } from "react";
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
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { Button, IconButton } from "@/components/ui/Button";
import { Isolate } from "@/components/primitives/Ltr";
import { MEDIA_SCOPE, MediaDrawer } from "./MediaDrawer";
import { UploadModal } from "./UploadModal";

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
 * ## What this screen deliberately does not ship
 *
 * **No delete.** `DELETE /media/{id}` exists and `ac_manage_content` allows it,
 * and `lib/api/allowlist.ts` refuses it deliberately with `tests/boundary.test.ts`
 * pinning it shut. Nothing in this API tells the panel what an attachment is used
 * by — a banner's `image`, a page thumbnail and a homepage section all reference
 * one with no back-reference anywhere — so the library cannot answer "what would
 * this break?". An irreversible action a screen cannot explain is worse than one
 * it does not offer, so it is **not rendered**, not disabled.
 *
 * **No sorting, and no `aria-sort` anywhere.** `orderby` is `date|title|id` and
 * the only control anyone has taken is *negative* — `rand` answers 400, backend
 * suite `:373`. DECISIONS.md's standing rule wants a positive control that is
 * not the collection's resting order, and `date desc` is the resting order.
 *
 * **No `type` filter**, though the parameter demonstrably works — four positive
 * controls at `:337-361`. Two reasons, either sufficient. There is no allowlisted
 * enumeration of what a library can *hold*: `ACCEPTED_MIME` is what the panel can
 * upload, which is definitionally a subset, and the picker rule refuses a control
 * built on an incomplete one — the shipping-provider precedent. And every one of
 * the 41 rows is `image/*`, so the filter has exactly one non-empty value. A
 * control that can only answer "all of them" cannot act.
 *
 * **No search box.** `search` is honoured in backend code and has **no control at
 * all**, here or in the backend suite; the harness's own note says which fields it
 * would match is a guess. Unmeasured is treated as broken.
 *
 * **No bulk and no export** — media is not in `EXPORT_SUBJECTS`, so an export
 * control would point at a route that does not exist.
 *
 * ## One empty state, and the missing half has no producer
 *
 * §3.7 wants *nothing yet* told apart from *nothing matching this filter*. This
 * screen ships no filter, no search and no sort, and its pager is bounded by the
 * total it renders — so there is no control a reader can operate that produces an
 * empty result. A second state for it would be unreachable code standing in for a
 * control that does not exist, which is the same thing as a dead control.
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
  initialItems,
  initialTotal,
}: {
  locale: string;
  initialItems: MediaItem[] | null;
  initialTotal: number | null;
}) {
  const t = useTranslations("media");
  const tStates = useTranslations("states");
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  /* The page is local state and the peek is a URL parameter, which is the split
     `/orders` uses: the peek is worth sharing and worth a back button, and a
     page number on a screen with no filters is not a view anybody links to. */
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const peekId = searchParams.get("peek");

  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["media", "library", page],
    queryFn: async () => {
      const { data: items, total } = await acRead<MediaItem[]>(
        `/media?per_page=${MEDIA_PER_PAGE}&page=${page}`,
      );
      return { items, total };
    },
    initialData:
      initialItems !== null && page === 1
        ? { items: initialItems, total: initialTotal ?? initialItems.length }
        : undefined,
    /* Keeps the previous page on screen while the next loads, so paging never
       flashes a skeleton over content that is still valid. §3.6's third
       mechanism. */
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

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
    enabled: peekId !== null && inPage === null,
    queryFn: async () => (await acRead<MediaItem>(`/media/${peekId}`)).data,
    retry: false,
  });

  const peeked = inPage ?? peekQuery.data ?? null;

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
      />

      <PageBody width="full">
        {!online && dataUpdatedAt > 0 ? (
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
        ) : null}

        {isPending && items.length === 0 ? (
          <MediaGridSkeleton label={t("loading")} count={MEDIA_PER_PAGE} />
        ) : isError ? (
          /* The API's own sentence and a retry — never the empty state's words. A
             failed request and a shop with no files are different situations and
             only one of them is worth pressing a button about. */
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="image"
            message={t("empty")}
            /* Absent while offline rather than dimmed: the banner above says why,
               and §3.3 removes a control that cannot act. */
            action={
              blocked === null
                ? { label: t("upload"), onClick: () => setUploadOpen(true) }
                : undefined
            }
          />
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
      />

      <UploadModal
        open={uploadOpen}
        online={online}
        onOpenChange={setUploadOpen}
        onUploaded={() => {
          invalidate();
          /* The new file is the newest, and the collection rests newest-first —
             so page one is where it landed. */
          setPage(1);
        }}
      />
    </div>
  );
}
