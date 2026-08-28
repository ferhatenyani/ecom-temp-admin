"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { MediaItem } from "@/lib/api/schemas/media";
import { MEDIA_PER_PAGE } from "@/lib/media";
import { acRead, BrowserApiError } from "@/lib/api/browser";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/ui/States";
import { MediaGrid, MediaGridSkeleton } from "@/components/ui/MediaGrid";

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
}: {
  active?: boolean;
  onPick: (item: MediaItem) => void;
}) {
  const t = useTranslations("media");
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

  return (
    <MediaGrid
      items={items}
      scope="media-pick"
      variant="panel"
      onOpen={onPick}
      page={page}
      perPage={MEDIA_PER_PAGE}
      total={total}
      onPageChange={setPage}
    />
  );
}
