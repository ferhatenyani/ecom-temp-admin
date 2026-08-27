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
