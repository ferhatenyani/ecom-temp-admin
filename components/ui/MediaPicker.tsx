"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { MediaItem } from "@/lib/api/schemas/media";
import { MEDIA_PER_PAGE } from "@/lib/media";
import { acRead, BrowserApiError } from "@/lib/api/browser";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/ui/States";
import {
  MediaGrid,
  MediaGridSkeleton,
  type MediaGridSelection,
} from "@/components/ui/MediaGrid";
import { Button } from "@/components/ui/Button";
import { CountBadge } from "@/components/ui/Badge";

/**
 * The multi-select contract: `MediaGridSelection` plus the one control the grid
 * has no business drawing.
 *
 * `onClear` rather than letting this panel call `onToggle` once per selected id:
 * the host's state is an array it replaces, so N calls would be N renders and —
 * on a caller that derives the next array from the current one — N chances to
 * write the same stale value. Clearing is one act and gets one callback.
 */
export type MediaPickerSelection = MediaGridSelection & {
  onClear: () => void;
};

/**
 * Choose an existing image.
 *
 * Promoted from `components/patterns/MediaPicker.tsx` on the content branch,
 * with one substantive change: **it is no longer an overlay.**
 *
 * ## Why it stopped being a `Sheet` and did not become a `Modal`
 *
 * The pattern wrapped itself in a `Sheet` and its only caller opened it from
 * inside another `Sheet`. That was already a stacked overlay, and DESIGN.md §3.1
 * rules on it directly — *"Never nested. A modal that needs a second modal is a
 * modal that needs steps."* Rebuilding it as a `Modal` over a `Drawer` would
 * have carried the defect across the migration in the new vocabulary, and at the
 * 340px floor both overlays are full-screen, so the second one simply erases the
 * first with no indication that it is still there.
 *
 * So this is a **panel**: a grid, a pager and the four states, with no chrome of
 * its own. The host decides where it lives, which is what lets the banner form
 * make it a *step* inside its own drawer — the form swaps to the picker and
 * back — and lets the full-page media screen render the identical grid with no
 * overlay at all. The host draws its own back control; this panel does not,
 * because "back" means something different in a step than it does on a page.
 *
 * **That last sentence used to name an `onCancel` prop that has never existed**,
 * which is the class of thing a docblock is worst at: it described a contract a
 * caller could have written to and got `undefined` from. `BannerDrawer` binds
 * its footer button to its own state and always has.
 *
 * ## The grid is not this file's any more
 *
 * `components/ui/MediaGrid.tsx` draws the tiles and the pager, because item 13's
 * full-page library needs the identical thing and forking one into a page is the
 * one move DESIGN.md §3 forbids by name. What is left here is what is actually
 * the *picker's*: the request, the four states, and `onPick`.
 *
 * ## It does **not** grow the library's search or sort, and the grid stayed shared
 *
 * `/media` gained both on the branch that measured them, and neither belongs
 * here. This is 520px of a `Drawer` that a person opened to attach one picture to
 * a banner: a search box and a sort strip inside it is a filter UI inside a
 * picker, and the three controls it would then hold are two more than the task
 * has. The library's toolbar lives in `MediaLibrary`'s `PageHeader` rather than
 * inside `MediaGrid` for exactly that reason — the grid took no new props, so
 * there was nothing here to make optional and nothing to fork.
 *
 * The library's own request now carries `search` and `orderby`; this one still
 * sends neither, so the picker keeps showing the collection at rest.
 *
 * ## Multi-select is opt-in, and the host owns the selection
 *
 * Four callers, and **three of them must not change**: `BannerDrawer` attaches
 * one image to one banner, `NewProductDrawer` sets one featured image, and
 * `BodyForm` picks one campaign logo. Only the product edit screen's *gallery*
 * is a list, and a gallery is the only field in this panel that is. So the mode
 * arrives as a prop that is either there or absent — `MediaGrid`'s docblock
 * argues the shape, and the argument is the same one file up — and the three
 * single-select callers are not merely compatible, they render the identical
 * tree they rendered before.
 *
 * ### The state is the host's, and that is forced rather than chosen
 *
 * This panel has no chrome, so the **commit** is somewhere this file cannot
 * see: `ProductMedia` puts it in its `Modal`'s footer, which is where §3.1 puts
 * an overlay's actions. A control cannot commit a value it cannot read, so
 * either the selection lives above both — the host — or this panel keeps it and
 * exposes an imperative handle for the footer to pull on. React's own answer is
 * the first, every controlled component in `components/ui/` is written that way,
 * and the second would be the only `useImperativeHandle` in the repository.
 *
 * That the host owns it also settles the question the fix round asked out loud:
 * **the selection survives paging**, because nothing in this panel's state is
 * what holds it. See `onPageChange` below for why that is also the right answer
 * rather than merely the convenient one.
 *
 * ### The count bar is this panel's, though
 *
 * A grid where four tiles are ticked and the fifth page is showing needs to say
 * *four*, and it is the panel — not the host — that knows a page is showing.
 * `DataTable`'s `SelectionBar` is the shape it borrows: `role="status"`, the
 * count, and a clear beside it, above the content rather than replacing
 * anything. It is a report on this panel's own state, which is not the "chrome"
 * the docblock above refuses; that word means the frame, the title and the back
 * control, and this draws none of them.
 *
 * ## It can be forbidden to somebody who can use the screen around it
 *
 * That is the gap the specification documents rather than a bug here. A Product
 * Manager deliberately cannot upload — `MediaService`'s docblock argues it — but
 * `ac_manage_content` guards the media **reads** too, so the "attach an image
 * that already exists" path the backend documents as theirs cannot be reached at
 * all. Measured: a Manager is 403 on `GET /media`. So this renders the refusal
 * naming the capability instead of an empty grid, which is the difference
 * between "there are no images" and "you cannot see them".
 */
export function MediaPicker({
  /**
   * `false` while the host has the panel mounted but not showing — a closed
   * drawer, a step that is not the current one. It gates the request rather than
   * the render, so opening a form does not fetch a library nobody asked for.
   */
  active = true,
  onPick,
  selection,
}: {
  active?: boolean;
} & (
  | { onPick: (item: MediaItem) => void; selection?: never }
  | { onPick?: never; selection: MediaPickerSelection }
)) {
  const t = useTranslations("media");
  const tUi = useTranslations("ui.table");
  const [page, setPage] = useState(1);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["media", "picker", page],
    enabled: active,
    queryFn: async () => {
      const { data: items, total } = await acRead<MediaItem[]>(
        `/media?per_page=${MEDIA_PER_PAGE}&page=${page}`,
      );
      return { items, total };
    },
    placeholderData: keepPreviousData,
  });

  const forbidden = isError && error instanceof BrowserApiError && error.status === 403;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  if (forbidden) return <ForbiddenState capability="ac_manage_content" />;
  if (isError) {
    return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />;
  }

  if (isPending) {
    return (
      <MediaGridSkeleton label={t("loading")} variant="panel" count={MEDIA_PER_PAGE} />
    );
  }

  /* `empty.none` and there is no `empty.noResults` branch, because this panel has
     no control that could produce one — see the docblock. */
  if (items.length === 0) return <EmptyState message={t("empty.none")} icon="image" />;

  if (selection === undefined) {
    return (
      <MediaGrid
        items={items}
        scope="media-pick"
        variant="panel"
        /* `?.` for the type-checker alone — the props union makes `onPick`
           present exactly when `selection` is absent, which is this branch. */
        onOpen={(item) => onPick?.(item)}
        page={page}
        perPage={MEDIA_PER_PAGE}
        total={total}
        onPageChange={setPage}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/*
        Only when there is something to report. A bar reading "0 selected"
        above an untouched grid is §3.3's control that cannot act, drawn as a
        status line — and it would push the first row of pictures down on every
        open for a number nobody needs told.

        `role="status"` and not `alert`: `DataTable`'s selection bar is the
        precedent and the reason holds here — a tick is the person's own act,
        announced politely, not something that went wrong.
      */}
      {selection.selected.length > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-ui-md border border-ui-line bg-ui-surface-2 px-3 py-1.5"
        >
          <span className="flex items-center gap-2 text-ui-compact text-ui-fg">
            <CountBadge>{selection.selected.length}</CountBadge>
            {t("selectedCount", { count: selection.selected.length })}
          </span>
          {/*
            `ui.table.clearSelection` — "Désélectionner" — borrowed rather than
            minted, on the same test `MediaGrid`'s pager strings passed: the
            string names no row, so it is the same words for the same act.
            `ui.table.selected` failed that test in the line above it, because it
            counts *rows* and a picture is not one — which is the distinction
            `MediaGrid`'s own "why this is a grid and not a `DataTable`" makes.
          */}
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto"
            onClick={selection.onClear}
          >
            {tUi("clearSelection")}
          </Button>
        </div>
      ) : null}

      <MediaGrid
        items={items}
        scope="media-pick"
        variant="panel"
        selection={selection}
        page={page}
        perPage={MEDIA_PER_PAGE}
        total={total}
        /*
         * **A selection survives a page change**, and this is the one place in
         * the panel where that is the opposite of `DataTable`'s rule. There,
         * selection is cleared whenever the rows change, because the keys drive
         * an action *over the rows on screen* — an export that silently included
         * a row from the previous filter is the defect that rule prevents.
         *
         * Here the keys are a basket, not a target: they are attachment ids on
         * their way into a gallery, and the whole reason this mode exists is
         * that the four pictures a person wants are rarely on one page of
         * twenty. Clearing on paging would make multi-select useless at exactly
         * the size that needs it. Nothing goes invisible either — the bar above
         * counts the ones that are off-screen, and it is the count that makes
         * keeping them honest.
         *
         * The same answer would hold if this panel ever grew the library's
         * search: a filter narrows what you can *see*, not what you have
         * *chosen*.
         */
        onPageChange={setPage}
      />
    </div>
  );
}
