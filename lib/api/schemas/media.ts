import { z } from "zod";

/**
 * The media library, measured 2026-08-21 against `GET /media` (41 items).
 *
 * `sizes` is empty on every fixture in this shop and that is not a bug: the
 * fixtures are 30×20 pixels, below every threshold at which WordPress generates
 * a thumbnail. So a client that indexed into `sizes[0]` for a list thumbnail
 * would work on a production image and fail on every test fixture — the panel
 * uses `url` and lets the browser scale, which is also the only size that is
 * guaranteed to exist.
 *
 * **That absence is also why this schema was wrong for the whole run.** It
 * declared `sizes` an *array* of `{name, url, width, height}`;
 * `MediaPresenter::sizes()` returns `array<string, array{width, height,
 * mime_type}>` — a **map keyed by size name**, with no `url` and no `name` in
 * it. The two shapes have nothing in common, and it parsed only because PHP
 * serialises an empty map as `[]` and every attachment in this shop has one. The
 * day a single sub-size exists, every media response in the panel throws at the
 * boundary: the library, the picker, and the banner strip behind it.
 *
 * So both serialisations are accepted and normalised to the map, because an
 * empty array *means* an empty map here. `.max(0)` rather than a bare array: a
 * populated array is not something PHP can emit for this field, and accepting
 * one silently would be the permissive direction — the one DECISIONS.md §0 says
 * is never the safe one.
 *
 * Nothing in the panel reads `sizes`, and this is not a reason to leave it
 * unmodelled: `unwrap()` parses the whole response, so a field nobody reads can
 * still take a screen down.
 */
export const mediaSubSize = z.looseObject({
  width: z.number(),
  height: z.number(),
  mime_type: z.string(),
});
export type MediaSubSize = z.infer<typeof mediaSubSize>;

export const mediaSizes = z
  .union([z.array(z.unknown()).max(0), z.record(z.string(), mediaSubSize)])
  .transform((value): Record<string, MediaSubSize> => (Array.isArray(value) ? {} : value));

export const mediaItem = z.looseObject({
  id: z.number(),
  title: z.string(),
  slug: z.string(),
  alt: z.string(),
  caption: z.string(),
  mime_type: z.string(),
  url: z.string(),
  /**
   * **Generated server-side, and not the name that was picked.** Measured:
   * uploading `real.jpg` three times stored `real.jpg`, `real-1.jpg` and
   * `real-2.jpg`, and the extension comes from the *sniffed* type rather than
   * from the name. Always render this, never the `File.name` the person chose.
   */
  filename: z.string(),
  filesize: z.number(),
  /** Null for a file WordPress could not measure; every accepted upload has both. */
  width: z.number().nullable(),
  height: z.number().nullable(),
  sizes: mediaSizes,
  /** The staff id that uploaded it. There is no route that turns this into a name. */
  uploaded_by: z.number().nullable(),
  date_created: z.string(),
  date_modified: z.string(),
});
export type MediaItem = z.infer<typeof mediaItem>;

export const mediaList = z.array(mediaItem);

/**
 * One thing that holds an attachment id, from `GET /media/{id}/usage`.
 *
 * **Every string in here is an open vocabulary and none of them is an enum**,
 * which is the whole reason this is written out rather than tightened:
 *
 *   `kind`  `MediaUsageRepository::KINDS` maps four post types onto a word and
 *           falls through to **the raw post type** for anything else — the
 *           repository deliberately does not filter by type, because
 *           `_thumbnail_id` is WordPress's own key and `_ac_seo_image_id` is
 *           written for any post id, so restricting the query would silently
 *           miss a fifth kind. An enum of the five words measured today would
 *           throw the day a plugin sets a featured image on a post type nobody
 *           here has heard of, which is precisely the case the endpoint was
 *           built to surface.
 *
 *   `slot`  the five `SCOPES` today, and the docblock above them says the list
 *           is what the repository "actually searches" — a sixth store is a
 *           backend change, not a breaking one.
 *
 * The panel translates what it recognises and prints what it does not, which is
 * the `providerLabel` rule (DECISIONS.md's standing table) reaching a slot name.
 */
export const mediaReference = z.looseObject({
  kind: z.string(),
  /** `0` for the shop's logo: settings live in an option and have no row id. */
  id: z.number(),
  /** Never empty — the API substitutes `#{id}` for an untitled draft. */
  title: z.string(),
  slot: z.string(),
});
export type MediaReference = z.infer<typeof mediaReference>;

/**
 * `GET /media/{id}/usage` — measured 2026-08-28.
 *
 * ```jsonc
 * {"total": 1,
 *  "references":[{"kind":"product","id":4849,"title":"Imported Lamp","slot":"featured_image"}],
 *  "checked":["featured_image","gallery","option_choice_image","seo_image","store_logo"],
 *  "incomplete":["homepage_section_data","content_html"]}
 * ```
 *
 * **`checked` and `incomplete` are the qualification on `total`, not
 * decoration**, and a client that dropped them would turn "no *known* uses" into
 * "no uses". `MediaPresenter::usage()` puts them in `data` rather than `meta` for
 * exactly that reason.
 *
 * `incomplete` is **not** a fixed pair. It starts as `UNSEARCHABLE` —
 * `homepage_section_data` and `content_html`, the two documents no query can
 * search — and `MediaUsageRepository::find()` *appends a scope name* to it when
 * that scope's query hits `MAX_MATCHES` (100). So a value already in `checked`
 * can appear in `incomplete` too, meaning "searched, and the answer is
 * truncated". `z.array(z.string())` is what lets both facts through; a union of
 * the two literals measured today would throw on an attachment held by 100
 * products, which is the one case where being wrong about `total` matters most.
 */
export const mediaUsage = z.looseObject({
  total: z.number(),
  references: z.array(mediaReference),
  checked: z.array(z.string()),
  incomplete: z.array(z.string()),
});
export type MediaUsage = z.infer<typeof mediaUsage>;
