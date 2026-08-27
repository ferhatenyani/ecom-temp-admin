"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { MediaItem } from "@/lib/api/schemas/media";
import { acRead, BrowserApiError } from "@/lib/api/browser";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/ui/States";
import { IconButton } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Ltr } from "@/components/primitives/Ltr";

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
 * back — and lets a future full-page media screen render the identical grid with
 * no overlay at all. `onCancel` is what the host binds to its back control; the
 * panel does not draw one, because "back" means something different in a step
 * than it does on a page.
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
const PER_PAGE = 30;

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
        `/media?per_page=${PER_PAGE}&page=${page}`,
      );
      return { items, total };
    },
    placeholderData: keepPreviousData,
  });

  const forbidden = isError && error instanceof BrowserApiError && error.status === 403;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  if (forbidden) return <ForbiddenState capability="ac_manage_content" />;
  if (isError) {
    return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />;
  }

  if (isPending) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t("loading")}
        className="grid grid-cols-3 gap-2 sm:grid-cols-4"
      >
        {/* Nine tiles at the real aspect ratio and the real gap — DESIGN.md §3.6
            asks a skeleton to mirror the box model, and a grid's box model is its
            cell, not a row of bars. */}
        {Array.from({ length: 9 }, (_, index) => (
          <Skeleton key={index} className="aspect-square w-full rounded-ui-md" />
        ))}
      </div>
    );
  }

  if (items.length === 0) return <EmptyState message={t("empty")} icon="image" />;

  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onPick(item)}
              className="ui-interactive ui-ring block w-full cursor-pointer overflow-hidden rounded-ui-md border border-ui-line bg-ui-surface-2 hover:border-ui-line-strong"
            >
              {/*
                `url` rather than a size from `sizes`. Measured: every fixture in
                this shop has `sizes: []` because the images are 30×20 and
                WordPress generates no thumbnail below its thresholds — so code
                that indexed into `sizes[0]` would work in production and fail on
                every test fixture. `url` is the one that always exists.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt={item.alt || item.title}
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
            </button>
          </li>
        ))}
      </ul>

      {total > PER_PAGE ? (
        <nav className="mt-3 flex items-center justify-between gap-3">
          <IconButton
            label={t("previousPage")}
            icon="back"
            flipInRtl
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          />
          {/*
            `Ltr` around the whole indicator rather than around each number, and
            the wrap is the fix rather than decoration: `"{page} / {pages}"` has
            spaces around the slash, which break what would otherwise be one bidi
            number run, so an RTL paragraph swaps the two figures and tells the
            reader they are on the last page. `TableFooter` carries the same wrap
            for the same reason — see DECISIONS.md §8.
          */}
          <span className="text-ui-caption text-ui-muted">
            <Ltr numeric>
              {page} / {pageCount}
            </Ltr>
          </span>
          <IconButton
            label={t("nextPage")}
            icon="chevron"
            flipInRtl
            variant="secondary"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => current + 1)}
          />
        </nav>
      ) : null}
    </>
  );
}
