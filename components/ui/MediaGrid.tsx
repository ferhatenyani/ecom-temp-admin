"use client";

import type { MediaItem } from "@/lib/api/schemas/media";
import { decodeEntities } from "@/lib/format/html";
import { rowOpenerId } from "@/components/ui/DataTable";
import { IconButton } from "@/components/ui/Button";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { Icon } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";
import { useTranslations } from "next-intl";

/**
 * The tile grid and its pager — one primitive, two callers.
 *
 * `components/ui/MediaPicker.tsx` already drew all of this and the full-page
 * library was about to draw it again. The two differ in exactly one thing —
 * what a tile *does*, `onPick` versus `onOpen` — so the geometry, the pager, the
 * placeholder and the RTL-safe indicator live here and each caller keeps only
 * its own query, its own states and its own chrome.
 *
 * ## Why this is a grid and not a `DataTable`
 *
 * DESIGN.md §3.2's table contract is about rows of fields, and for a picture the
 * picture **is** the identifying cell: a 44px thumbnail beside a generated
 * filename is a worse way to find an image than four columns of images. The
 * absence of a table is a decision rather than a gap — the record's fields live
 * in the peek drawer, which is the same trade `RecordList` makes below `md`.
 *
 * ## A tile is a real `<button>` with a stable id
 *
 * §3.2's `rowOpenerId` rule, arrived at from the other side: `DataTable` grew the
 * opener because a `<tr>` is not focusable, and a `<li>` is not either. So the
 * tile itself is the button, its id comes from the same helper the tables use,
 * and that id is both the keyboard path and the name an overlay's
 * `returnFocusTo` gives.
 *
 * A **scope** rather than a bare key, for `rowOpenerId`'s own reason: the picker
 * and the library can never be mounted together today, and `id` is
 * document-wide, so nothing but the scope would stop that from becoming true
 * silently.
 *
 * ## The columns are a named variant, not a viewport query
 *
 * Tailwind's breakpoints are the *viewport's*, and the picker renders inside a
 * 520px `Drawer`. At a 1440px viewport the page's own `xl:grid-cols-6` would put
 * six tiles across that drawer — 78px each. So the two geometries are named:
 * `page` opens the grid up to the 1600px list width, `panel` is the picker's
 * existing three-then-four and is unchanged.
 */

/** Both geometries, chosen by name. `panel` is what the picker has always drawn. */
const COLUMNS = {
  page: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
  panel: "grid-cols-3 sm:grid-cols-4",
} as const;

export type MediaGridVariant = keyof typeof COLUMNS;

/**
 * A tile's DOM id. `DataTable`'s helper, so a grid opener and a row opener are
 * the same shape and an overlay does not have to care which it was handed.
 */
export function mediaTileId(scope: string, id: number): string {
  return rowOpenerId(scope, id);
}

/**
 * What a tile is named by, and it is **not** `alt`.
 *
 * `alt` describes the picture to somebody who cannot see it; this names the
 * *record* to somebody who is managing it, and the two are different strings
 * with different jobs. One fixture carries `alt: ""` — a real attachment, since
 * nothing makes alt text mandatory — so a label built on it would leave a tile
 * with no name at all. `title` falls back to `filename`, which every row has.
 *
 * `decodeEntities` because this is a WordPress `post_title`: a numeric entity
 * for U+2019 has to reach the screen as an apostrophe, the way every other
 * title in the panel does.
 */
function tileLabel(item: MediaItem): { text: string; identifier: boolean } {
  const title = decodeEntities(item.title).trim();
  return title === ""
    ? { text: item.filename, identifier: true }
    : { text: title, identifier: false };
}

export function MediaGrid({
  items,
  /** Namespaces the tile ids — see `mediaTileId`. */
  scope,
  variant = "page",
  onOpen,
  page,
  perPage,
  total,
  onPageChange,
}: {
  items: readonly MediaItem[];
  scope: string;
  variant?: MediaGridVariant;
  onOpen: (item: MediaItem) => void;
  page: number;
  perPage: number;
  total: number;
  onPageChange: (next: number) => void;
}) {
  const t = useTranslations("ui.table");
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <>
      <ul className={`grid gap-3 ${COLUMNS[variant]}`}>
        {items.map((item) => {
          const label = tileLabel(item);
          return (
            <li key={item.id} className="min-w-0">
              <button
                type="button"
                id={mediaTileId(scope, item.id)}
                onClick={() => onOpen(item)}
                /*
                 * The truncated label in full, for a pointer. It is never the
                 * *only* way to it — §3.1 forbids that — because the tile opens
                 * a drawer that prints the title and the filename as their own
                 * rows, and CSS truncation does not touch the button's
                 * accessible name.
                 */
                title={label.text}
                className="ui-interactive ui-ring group block w-full min-w-0 cursor-pointer rounded-ui-md text-start"
              >
                <span className="relative block overflow-hidden rounded-ui-md border border-ui-line bg-ui-surface-2 group-hover:border-ui-line-strong">
                  {/*
                    The placeholder sits *behind* the picture rather than
                    replacing it on error. A file the browser has not fetched yet
                    and a file whose bytes have gone look identical from here —
                    there is no event that distinguishes them before `onerror`
                    fires, and after it there is no way back — so both read as
                    "no picture" instead of as a torn box, which is the only
                    honest thing a tile can say about either.
                  */}
                  <span className="flex aspect-square w-full items-center justify-center">
                    <Icon name="image" className="size-5 text-ui-subtle" />
                  </span>
                  {/*
                    `url`, never a member of `sizes`. Measured: every attachment
                    in this shop is 30×20 and below every threshold at which
                    WordPress generates a thumbnail, so `sizes` is empty on all
                    41 and code that indexed into it would work in production and
                    fail on every fixture. `url` is the one size guaranteed to
                    exist.

                    `alt=""`, deliberately: the label below is inside the button,
                    so it is already the control's accessible name, and repeating
                    the record's alt text here would announce the tile twice with
                    two different strings. The alt text is a *field of the
                    record*, edited in the drawer — not this thumbnail's
                    description.
                  */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.url}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 size-full object-cover"
                  />
                </span>

                {/*
                  One line, truncated. `Ltr` only when the label fell back to the
                  filename — that is an identifier and reorders inside an Arabic
                  paragraph; a title is prose and resolves its own direction.
                */}
                {label.identifier ? (
                  <Ltr
                    numeric={false}
                    className="mt-1.5 block truncate text-ui-label text-ui-fg"
                  >
                    {label.text}
                  </Ltr>
                ) : (
                  <span
                    dir="auto"
                    className="mt-1.5 block truncate text-ui-label text-ui-fg"
                  >
                    {label.text}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/*
        Not rendered on a single page: §3.3's rule that a control which cannot
        act is absent rather than disabled, and a pager over one page cannot.
        41 rows at 20 a page is three, so it is genuinely exercised.
      */}
      {total > perPage ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-ui-label text-ui-muted" data-numeric="">
            {t("range", { from, to, total })}
          </p>
          <div className="flex items-center gap-1">
            <IconButton
              label={t("previousPage")}
              icon="back"
              flipInRtl
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            />
            {/*
              `Ltr` around the whole indicator and not around each number. The
              string has spaces on both sides of the slash, which break what
              would otherwise be one bidi number run — so an RTL paragraph swaps
              the two figures and tells the reader they are on the last page.
              That is a wrong number, not an ugly one. `TableFooter` carries the
              same wrap for the same reason; this borrows its three strings
              rather than minting identical ones in the `media` namespace,
              because it is the same control doing the same job.
            */}
            <Ltr className="px-1 text-ui-label text-ui-muted">
              {t("pageOf", { page, pages })}
            </Ltr>
            <IconButton
              label={t("nextPage")}
              icon="chevron"
              flipInRtl
              variant="secondary"
              size="sm"
              disabled={page >= pages}
              onClick={() => onPageChange(page + 1)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The grid's first load. §3.6: a skeleton mirrors the real box model, and a
 * grid's box model is its **cell** — the same aspect, the same gap, the same
 * label line under it — not a row of bars.
 *
 * `count` defaults to a full page, so nothing below the grid moves when the data
 * lands. The picker's own skeleton drew nine tiles against a request for thirty,
 * which shifted its pager every time.
 */
export function MediaGridSkeleton({
  label,
  variant = "page",
  count,
}: {
  label: string;
  variant?: MediaGridVariant;
  count: number;
}) {
  return (
    <SkeletonRegion label={label} className={`grid gap-3 ${COLUMNS[variant]}`}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <Skeleton className="aspect-square w-full rounded-ui-md" />
          {/* `--text-label`'s own 1.125rem line box, so the caption line does
              not step when the real one arrives. */}
          <Skeleton className="h-4.5 w-24" />
        </div>
      ))}
    </SkeletonRegion>
  );
}
