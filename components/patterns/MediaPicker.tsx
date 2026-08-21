"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { MediaItem } from "@/lib/api/schemas/media";
import { acRead, BrowserApiError } from "@/lib/api/browser";
import { Sheet } from "@/components/primitives/Sheet";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/patterns/States";
import { Icon } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";

/**
 * Choose an existing image.
 *
 * Shared rather than owned by one screen: banners take an `image`, pages take a
 * thumbnail, and ADMIN_PANEL.md's Media section names the product image picker
 * as a third caller. It lives in `components/patterns/` for that reason.
 *
 * **It can be forbidden to somebody who can use the screen around it**, and that
 * is the gap the specification documents rather than a bug here. A Product
 * Manager deliberately cannot upload — `MediaService`'s docblock argues it — but
 * `ac_manage_content` guards the media **reads** too, so the "attach an image
 * that already exists" path the backend documents as theirs cannot be reached at
 * all. Measured: a Manager is 403 on `GET /media`. So this renders the refusal
 * naming the capability instead of an empty grid, which is the difference
 * between "there are no images" and "you cannot see them".
 */
const PER_PAGE = 30;

export function MediaPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (item: MediaItem) => void;
}) {
  const t = useTranslations("media");
  const [page, setPage] = useState(1);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["media", "picker", page],
    // `enabled` so opening a form does not fetch a library nobody asked for.
    enabled: open,
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("pickTitle")}>
      {forbidden ? (
        <ForbiddenState capability="ac_manage_content" />
      ) : isError ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isPending ? (
        <div
          role="status"
          aria-busy="true"
          aria-label={t("loading")}
          className="grid grid-cols-3 gap-2"
        >
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="skeleton aspect-square rounded-md" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState message={t("empty")} />
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onPick(item)}
                  className="press group relative block w-full overflow-hidden rounded-md bg-surface-2"
                >
                  {/*
                    `url` rather than a size from `sizes`. Measured: every fixture
                    in this shop has `sizes: []` because the images are 30×20 and
                    WordPress generates no thumbnail below its thresholds — so
                    code that indexed into `sizes[0]` would work in production and
                    fail on every test fixture. `url` is the one that always
                    exists.
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
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                aria-label={t("previousPage")}
                className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
              >
                <Icon name="back" flipInRtl className="size-5" />
              </button>
              <span className="text-footnote text-label-secondary">
                <Ltr numeric>
                  {page} / {pageCount}
                </Ltr>
              </span>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage((current) => current + 1)}
                aria-label={t("nextPage")}
                className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
              >
                <Icon name="chevron" flipInRtl className="size-5" />
              </button>
            </nav>
          ) : null}
        </>
      )}
    </Sheet>
  );
}
