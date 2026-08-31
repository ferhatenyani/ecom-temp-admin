"use client";

import type { MediaItem } from "@/lib/api/schemas/media";
import { decodeEntities } from "@/lib/format/html";
import { rowOpenerId } from "@/components/ui/DataTable";
import { IconButton } from "@/components/ui/Button";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";
import { Icon } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";
import { useHydrated } from "@/lib/use-hydrated";
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
 *
 * ## A tile can also be a checkbox, and that reverses a decision taken in step 3
 *
 * `ProductMedia.tsx` closed the overlay on every pick and said why: *"Staying
 * open would mean a grid that cannot say which tiles are already in, because
 * `MediaGrid` has no selected state; adding one is a change to the component the
 * full-page library and the banner form also render, for one screen's
 * convenience. If this bites, that prop is the fix and it belongs on
 * `MediaGrid`."*
 *
 * **The argument was right and the premise expired.** What has changed is not
 * the cost — it is still a change to a component three other screens render —
 * but the price on the other side: a five-image gallery is five round trips
 * through an overlay that closes itself, and that is item 7 of the fix round
 * rather than one screen's convenience. So the prop is added here, where that
 * sentence said it belonged, and the *"for one screen's convenience"* half is
 * honoured by making it **opt-in**: a caller that passes no `selection` renders
 * the identical `<button>` tile it rendered before, down to the DOM.
 *
 * ### Why the selection is a prop and not a `multiple` flag
 *
 * A boolean beside a list is two sources for one fact, and it admits two states
 * that cannot mean anything: `multiple` with nothing selected *and no way to
 * select*, and a list of ids on a grid that is not in selection mode. Every
 * caller would then have to keep the two in sync, and the grid would have to
 * decide which one wins when they disagree.
 *
 * Presence is the mode instead, and the props are a **discriminated union**, so
 * `onOpen` and `selection` cannot both be passed. That is the part a flag could
 * not buy: `multiple` sitting next to a still-required `onOpen` would let a
 * caller ask for a tile that both opens a drawer and toggles a checkbox, which
 * is not a control anybody can draw. Here it is a compile error.
 *
 * ### A real `<input type="checkbox">`, not `aria-pressed` on the button
 *
 * `Form.tsx` opens with this rule and two screens in this panel have learned it
 * the expensive way — `RestrictionPicker.tsx` and `FaqDrawer.tsx` both shipped
 * `<button role="checkbox">` and both record replacing it: it *announces*
 * correctly and then behaves like neither control — no space-to-toggle from the
 * browser, no form association, nothing for `page.check()` to check. The tile
 * keeps its `mediaTileId`, moved onto the input, so it is still the focusable
 * element an overlay's `returnFocusTo` can name and still the same id shape the
 * tables use.
 *
 * The input is stretched over the tile (`absolute inset-0 opacity-0`) rather
 * than `sr-only`, which is `DataTable`'s `Checkbox` argument imported wholesale:
 * an `sr-only` input is a 1px box in a corner, a pointer reaches it only through
 * the label, and `page.check()` then reports the picture as intercepting pointer
 * events. Stretching costs nothing — it is still a real checkbox with a real
 * accessible name, and `.peer:focus-visible ~ .ui-ring-peer` still draws §3.4's
 * focus ring on the frame.
 *
 * ### `held` — the tiles the caller already has
 *
 * The sentence being reversed above names this as the reason the overlay closed:
 * a grid that cannot say which tiles are already in. So the selection carries
 * two lists, not one. `held` ids are drawn ticked, dimmed to `--color-muted`,
 * and **disabled** — a place §3.3's *"a control that cannot act is absent rather
 * than disabled"* deliberately does not reach, because the disabled state is
 * itself the information. An absent tile would say the file is not in the
 * library; a plain unticked one would say it is not on the product, and both are
 * false. They are not dimmed with `ROW_OFF`'s `opacity-50` either: that means
 * *you cannot use this*, and a held tile is not unusable, it is done.
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
function tileLabel(item: MediaItem): TileLabel {
  const title = decodeEntities(item.title).trim();
  return title === ""
    ? { text: item.filename, identifier: true }
    : { text: title, identifier: false };
}

type TileLabel = { text: string; identifier: boolean };

/**
 * What a selecting grid needs, and it is deliberately not a `Set`.
 *
 * A `readonly number[]` is what every caller already holds — `gallery_image_ids`
 * is an array on the draft because a gallery is a *sequence* — and handing the
 * grid a `Set` would mean each caller building one per render to satisfy a
 * lookup over at most twenty tiles. `DataTable`'s `selected: string[]` makes the
 * same call for the same reason.
 */
export type MediaGridSelection = {
  /** Chosen in this pass. Ticked, and a second press clears it. */
  selected: readonly number[];
  /** Already the caller's. Ticked, named as such, and refused rather than toggled. */
  held?: readonly number[];
  /** The whole item, not the id: a caller that keeps thumbnails needs the URL. */
  onToggle: (item: MediaItem, next: boolean) => void;
};

/**
 * The union is the whole point — see the docblock. `?: never` on both members so
 * the two keys can still be destructured, and so passing both is an error rather
 * than a silent precedence rule.
 */
type MediaGridProps = {
  items: readonly MediaItem[];
  /** Namespaces the tile ids — see `mediaTileId`. */
  scope: string;
  variant?: MediaGridVariant;
  page: number;
  perPage: number;
  total: number;
  onPageChange: (next: number) => void;
} & (
  | { onOpen: (item: MediaItem) => void; selection?: never }
  | { onOpen?: never; selection: MediaGridSelection }
);

export function MediaGrid({
  items,
  scope,
  variant = "page",
  onOpen,
  selection,
  page,
  perPage,
  total,
  onPageChange,
}: MediaGridProps) {
  const t = useTranslations("ui.table");
  const tMedia = useTranslations("media");
  const hydrated = useHydrated();
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <>
      <ul className={`grid gap-3 ${COLUMNS[variant]}`}>
        {items.map((item) => {
          const label = tileLabel(item);
          const held = selection?.held?.includes(item.id) ?? false;
          const state: TileState = held
            ? "held"
            : (selection?.selected.includes(item.id) ?? false)
              ? "selected"
              : "idle";

          return (
            <li key={item.id} className="min-w-0">
              {selection ? (
                /*
                 * The `<label>` is the tile and the input is stretched over it,
                 * so the whole square is the hit area and the caption is the
                 * accessible name — the same two properties the `<button>`
                 * branch below has, arrived at with a control that toggles.
                 */
                <label
                  title={label.text}
                  className={`group relative block w-full min-w-0 rounded-ui-md ${
                    held ? "cursor-not-allowed" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    id={mediaTileId(scope, item.id)}
                    checked={state !== "idle"}
                    /*
                     * `!hydrated` for `Form.tsx`'s reason, and it applies here
                     * where it does not apply to the `<button>` branch: a press
                     * on a button before hydration is lost and nothing on screen
                     * says otherwise, but a press on a **checkbox** changes the
                     * DOM's `checked` and React never learns — a tick that looks
                     * accepted and is in no selection. Today no selecting grid is
                     * server-rendered (this mode is reachable only through an
                     * overlay a click opens), so the window cannot be hit; that
                     * is a property of one caller and not of this component.
                     */
                    disabled={held || !hydrated}
                    aria-busy={!hydrated || undefined}
                    /*
                     * Named by the label everywhere except here, and the
                     * exception is `DataTable`'s `Checkbox` precedent: a tick
                     * that is already the caller's has to *say* so, or a screen
                     * reader gets a checked box named "Burnous" and no reason
                     * for it.
                     *
                     * An `sr-only` phrase inside the label was the first
                     * attempt and it is subtly wrong: the name computation
                     * trims each node before joining, so the separator between
                     * the caption and the phrase is whatever CSS says — a
                     * space in a browser, where the caption is `display:block`,
                     * and *nothing* wherever no stylesheet is loaded. A name
                     * that depends on CSS having loaded is a name that is
                     * sometimes "BurnousDéjà ajoutée". One message with the
                     * label interpolated is the same words, in one text run,
                     * with the order left to the translator.
                     */
                    aria-label={
                      held ? tMedia("alreadyAdded", { name: label.text }) : undefined
                    }
                    onChange={(event) => selection.onToggle(item, event.target.checked)}
                    className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  />
                  <TileFace item={item} label={label} state={state} ring />
                </label>
              ) : (
                <button
                  type="button"
                  id={mediaTileId(scope, item.id)}
                  /* `?.` for the type-checker alone: the props union makes
                     `onOpen` present exactly when `selection` is absent, which
                     is the branch this is. */
                  onClick={() => onOpen?.(item)}
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
                  <TileFace item={item} label={label} state="idle" />
                </button>
              )}
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

/** Idle, chosen in this pass, or already the caller's. See `held` in the docblock. */
type TileState = "idle" | "selected" | "held";

/** The frame's border in each state. `line` → `fg` is the panel's checked box. */
const FRAME: Record<TileState, string> = {
  idle: "border-ui-line group-hover:border-ui-line-strong",
  selected: "border-ui-fg",
  held: "border-ui-line-strong",
};

/**
 * The tick, in the two states that carry one.
 *
 * `selected` is `DataTable`'s checked box exactly — ink ground, surface tick —
 * because it is the same answer to the same question and a second treatment
 * would be a second vocabulary. `held` is the tonal one: it is a *report* rather
 * than something the press just did, and §1.4's ink-is-for-action rule is what
 * separates them.
 */
const TICK: Record<"selected" | "held", string> = {
  selected: "border-ui-fg bg-ui-fg text-ui-surface",
  held: "border-ui-line-strong bg-ui-surface-3 text-ui-muted",
};

/**
 * The picture and its caption — everything a tile is that is not its control.
 *
 * Extracted when the tile grew a second control, and it is the one part of this
 * change that must be shared rather than forked: a picker whose thumbnails
 * differed from the library's by a pixel would be the fork DESIGN.md §3 forbids,
 * arrived at through a copy-paste instead of through a new file.
 */
function TileFace({
  item,
  label,
  state,
  /**
   * `.ui-ring-peer` only in the checkbox branch. The rule is
   * `.peer:focus-visible ~ .ui-ring-peer` and the `<button>` branch has no peer
   * before the frame, so it takes its ring on the button itself with `.ui-ring`.
   */
  ring = false,
}: {
  item: MediaItem;
  label: TileLabel;
  state: TileState;
  ring?: boolean;
}) {
  return (
    <>
      <span
        className={`ui-interactive relative block overflow-hidden rounded-ui-md border bg-ui-surface-2 ${FRAME[state]} ${ring ? "ui-ring-peer" : ""}`}
      >
        {/*
          The placeholder sits *behind* the picture rather than replacing it on
          error. A file the browser has not fetched yet and a file whose bytes
          have gone look identical from here — there is no event that
          distinguishes them before `onerror` fires, and after it there is no way
          back — so both read as "no picture" instead of as a torn box, which is
          the only honest thing a tile can say about either.
        */}
        <span className="flex aspect-square w-full items-center justify-center">
          <Icon name="image" className="size-5 text-ui-subtle" />
        </span>
        {/*
          `url`, never a member of `sizes`. Measured: every attachment in this
          shop is 30×20 and below every threshold at which WordPress generates a
          thumbnail, so `sizes` is empty on all 41 and code that indexed into it
          would work in production and fail on every fixture. `url` is the one
          size guaranteed to exist.

          `alt=""`, deliberately: the label below is inside the control, so it is
          already its accessible name, and repeating the record's alt text here
          would announce the tile twice with two different strings. The alt text
          is a *field of the record*, edited in the drawer — not this thumbnail's
          description.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.url}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />

        {/*
          The tick, over the picture's inline-end corner — `end-1`, so it crosses
          the tile in Arabic and never covers the same part of two pictures in
          the two languages. `aria-hidden`: the checkbox behind it already says
          "checked", and a second announcement of the same fact is noise.
        */}
        {state === "idle" ? null : (
          <span
            aria-hidden="true"
            className={`absolute end-1 top-1 flex size-5 items-center justify-center rounded-ui-sm border ${TICK[state]}`}
          >
            <Icon name="check" className="size-3.5" />
          </span>
        )}
      </span>

      {/*
        One line, truncated. `Ltr` only when the label fell back to the filename —
        that is an identifier and reorders inside an Arabic paragraph; a title is
        prose and resolves its own direction.
      */}
      {label.identifier ? (
        <Ltr
          numeric={false}
          className={`mt-1.5 block truncate text-ui-label ${state === "held" ? "text-ui-muted" : "text-ui-fg"}`}
        >
          {label.text}
        </Ltr>
      ) : (
        <span
          dir="auto"
          className={`mt-1.5 block truncate text-ui-label ${state === "held" ? "text-ui-muted" : "text-ui-fg"}`}
        >
          {label.text}
        </span>
      )}
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
