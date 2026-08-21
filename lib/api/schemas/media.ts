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
 */
export const mediaSize = z.looseObject({
  name: z.string(),
  url: z.string(),
  width: z.number(),
  height: z.number(),
});

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
  sizes: z.array(mediaSize),
  /** The staff id that uploaded it. There is no route that turns this into a name. */
  uploaded_by: z.number().nullable(),
  date_created: z.string(),
  date_modified: z.string(),
});
export type MediaItem = z.infer<typeof mediaItem>;

export const mediaList = z.array(mediaItem);
