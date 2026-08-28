import { MEDIA_PER_PAGE } from "@/lib/media";

/**
 * The media library's URL state: a search term and a sort.
 *
 * This file exists because DECISIONS.md §14 recorded both controls as absent,
 * and the recorded reason was **false**. It said `search` "is honoured in
 * backend code and has no control at all" and that the only `orderby` control
 * anyone had taken was negative. Neither was a measurement of the collection —
 * they were a measurement of what nobody had run yet. Both were run on
 * 2026-08-28 against the live API, 43 rows, and both parameters work. The
 * standing rule is "unmeasured is treated as broken", not "unmeasured is broken",
 * and the remedy it names is to go and take the control.
 *
 * ## `orderby`, measured 2026-08-28
 *
 *   date asc        sorts, and **differs from the resting order**   positive control
 *   id   asc        sorts, differs from the bare listing            positive control
 *   date desc       byte-identical to the bare listing              proves nothing alone
 *   id   desc       byte-identical to the bare listing              proves nothing alone
 *   title           **unprovable that day** — 42 of the 43 rows are titled "Tapis"
 *   ?orderby=zzz    400 invalid_request                             validated, not ignored
 *   ?bogus_param=1  = the bare listing                              the control holds
 *
 * `date asc` is the control the standing rule asks for: a value that is not the
 * collection's resting order, taken against rows whose order under it is known to
 * differ. `?bogus_param=1` is the other half — it proves the collection really
 * does ignore what it does not know, so `date asc` differing is the parameter
 * working rather than the shop changing underneath.
 *
 * ## `title`, measured 2026-08-28 — the fixture this file asked for was built
 *
 * The entry above recorded `title` as unprovable and named the measurement it
 * still needed: *a fixture with distinct titles, three or more rows sorting
 * differently from both their ids and their dates*. Somebody went and made one —
 * five of the 43 rows, spread across the id range, renamed to titles whose
 * alphabetical order matches neither their ids nor their dates, then restored:
 *
 *   title asc   ->  761, 3035, 1658, 4234, 4    exactly alphabetical, and it
 *                                               differs from the bare listing
 *   title desc  ->  4, 4234, 1658, 3035, 761    the exact reverse
 *
 * That is the positive control in both directions on the axis itself, which is
 * strictly more than `date` has: `date desc` can only ever be proved by its
 * *opposite* differing, because it **is** the resting order.
 *
 * ## Four chips, and they are four answers rather than a field and a direction
 *
 * newest · oldest · A→Z · Z→A. Each is a complete answer to "in what order",
 * which is why they are four flat chips in one labelled group and not a field
 * selector beside a direction toggle: two controls would make the reader compose
 * an answer out of two halves, and one of the four compositions (`id`) is not
 * offered at all. `FilterTabs` in `chips` is single-select over complete values,
 * which is exactly the shape of the question.
 *
 * **Not `id`.** It sorts, and the measurement is good. But on this collection an
 * attachment's id order and its upload order are the same fact — the ids are
 * issued in upload sequence and `date_created` records that same moment — so a
 * fifth chip would offer a reader a choice between two spellings of one answer.
 * §3.3's "one primary per view" reaching a filter: a control doing another
 * control's job is chrome, and chrome on a toolbar costs the same band as a
 * control that means something.
 *
 * ## The resting order sends no `orderby` at all
 *
 * `date desc` **is** the resting order — measured byte-identical to the bare
 * listing — so asking for it explicitly is a parameter that changes nothing, in
 * every URL, for ever. `listParams` sends the pair for the other three only,
 * which is the same shape every other list's first tab has: the default is the
 * absence of the parameter, not a value. It also makes the first chip's second
 * press honest — pressing "newest first" again is a return to resting, not a
 * re-request.
 *
 * ## `search`, measured 2026-08-28
 *
 *   search=woocommerce-placeholder    1 of 43     discriminating positive control
 *   search=zzzqqq                     0 of 43
 *   search=<filename stem>            0 of 43     search does **not** reach filenames
 *   search=<slug>                     0 of 43     nor slugs
 *   search=""                        43 of 43     absence
 *   search + per_page=1              200, meta.total 1   combines with paging
 *
 * **What it reaches is the title**, and that is worth more than it sounds:
 * WordPress derives `post_title` from the uploaded filename, and the one fixture
 * row nobody has since renamed has `title === filename stem`. So searching by
 * title does reach what a person typed when they uploaded the file — until
 * somebody edits the title in the drawer, at which point the old name is
 * unreachable and the new one is what works.
 *
 * **The copy states the measured negative and never an unmeasured exclusion.**
 * `empty.noResults` says the search covers the title and not the filename, which
 * is what was measured in both directions. It does **not** say "the title only":
 * `WP_Query`'s `s` is a LIKE over `post_title`, `post_excerpt` and `post_content`,
 * so the caption is plausibly matched too and nobody has run that request. The
 * coupons precedent is the sentence's *shape* — name the scope where the reader
 * is already looking at nothing — not a licence to claim an exclusion this
 * collection has not answered.
 *
 * The scope has to be on screen because of the grid, not in spite of it: a tile
 * whose title is empty is labelled with its **filename**, so a reader typing what
 * the tile says would get nothing back and have no way to know why.
 *
 * **That same tile is what A→Z cannot draw honestly, and it is recorded rather
 * than worked around.** The sort is on `post_title`, and a row with no title
 * sorts as the empty string — first ascending, last descending — while the tile
 * under it shows a *filename* starting with some other letter. The alternative
 * would be sorting the page in the browser on whatever each tile happens to
 * display, which is a second, disagreeing order over one page of three and is
 * worse in every way. The API sorts; the grid labels; on a row where the two
 * fields differ they visibly differ. WordPress derives the title from the
 * filename at upload, so this is the rare row rather than the common one.
 *
 * ## The page is not in here, and that is unchanged
 *
 * `?peek=` is shareable; a page number on this screen is not. Both controls reset
 * it to 1 — page 3 of a re-sorted or re-searched library is a different set of
 * rows, not the same ones rearranged — and `MediaLibrary` holds it as local state
 * the way `/orders` does.
 */

/**
 * The four orders, in the order the chips are drawn.
 *
 * `newest` first, because it is the resting order and the first value of every
 * filter group in this panel is the one that sends nothing. The two date chips
 * lead the two title chips because the collection's own default is a date and a
 * reader arriving with no opinion is already in the first of them.
 */
export const MEDIA_ORDERS = ["newest", "oldest", "az", "za"] as const;
export type MediaOrder = (typeof MEDIA_ORDERS)[number];

/**
 * Each order as the pair of parameters it *is*, and `null` for the one that is
 * the absence of both.
 *
 * One table, read by `toUrlParams`, `listParams` and `queryFromParams` alike, so
 * the URL the panel shows and the request it makes cannot drift from the value
 * the chip is highlighting. That drift is the whole failure `mediaKey` guards
 * against at the other end.
 */
const ORDER_PARAMS: Record<MediaOrder, { orderby: "date" | "title"; order: "asc" | "desc" } | null> =
  {
    newest: null,
    oldest: { orderby: "date", order: "asc" },
    az: { orderby: "title", order: "asc" },
    za: { orderby: "title", order: "desc" },
  };

export type MediaQuery = {
  search: string;
  order: MediaOrder;
};

export const EMPTY_QUERY: MediaQuery = { search: "", order: "newest" };

/**
 * The URL, read.
 *
 * `orderby` is honoured only where it names an axis this screen ships, which is
 * `date` and `title` and not `id`. A stale `?orderby=id` is a legal 200 the chip
 * group could not represent afterwards — coupons' `?per_page=37` rule, that a
 * control unable to show the state it is in is a control that lies about it —
 * and `?orderby=zzz` is a measured **400**, which a hand-edited URL must not be
 * able to provoke into an error screen. Both fall back to resting.
 *
 * **A missing `order` is `desc`, because that is the API's own default**
 * (`MediaController::indexArgs()`, `'order' => ['default' => 'desc']`). So
 * `?orderby=title` alone is Z→A and is representable, rather than being thrown
 * away as half a state.
 */
export function queryFromParams(params: URLSearchParams): MediaQuery {
  const orderby = params.get("orderby");
  const ascending = params.get("order") === "asc";

  const order: MediaOrder =
    orderby === "title"
      ? ascending
        ? "az"
        : "za"
      : orderby === null || orderby === "date"
        ? ascending
          ? "oldest"
          : "newest"
        : "newest";

  return { search: params.get("search") ?? "", order };
}

/** The URL the panel shows: only what differs from resting. */
export function toUrlParams(query: MediaQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.search !== "") params.set("search", query.search);

  const sort = ORDER_PARAMS[query.order];
  if (sort !== null) {
    params.set("orderby", sort.orderby);
    params.set("order", sort.order);
  }
  return params;
}

/** The request. `orderby` is omitted at rest — see the docblock. */
export function listParams(query: MediaQuery, page: number): URLSearchParams {
  const params = new URLSearchParams({
    per_page: String(MEDIA_PER_PAGE),
    page: String(page),
  });

  if (query.search !== "") params.set("search", query.search);

  const sort = ORDER_PARAMS[query.order];
  if (sort !== null) {
    params.set("orderby", sort.orderby);
    params.set("order", sort.order);
  }
  return params;
}

/**
 * Whether a control a reader can operate is what emptied the list.
 *
 * The sort is not one of them: re-ordering 43 rows returns 43 rows. Only the
 * search can produce a no-results state, which is why clearing it is the only
 * thing the second empty state offers.
 */
export function isFiltered(query: MediaQuery): boolean {
  return query.search !== "";
}

/** The query key mirrors the request, so the two can never disagree. */
export function mediaKey(query: MediaQuery, page: number) {
  return ["media", "library", listParams(query, page).toString()] as const;
}
