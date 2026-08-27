/**
 * The CMS vocabulary, and the three facts about it that are not obvious.
 *
 * No dependencies, so a client component can import a value from here without
 * pulling Zod into the browser — the split `lib/coupon-status.ts` and
 * `lib/movement-reason.ts` already make. `lib/api/schemas/cms.ts` imports this,
 * never the other way round.
 *
 * Everything here was measured against the live API on 2026-08-21, and the
 * measurements are in the comments rather than in a changelog because the
 * comment is what somebody reads before changing the value under it.
 */

/* ------------------------------------------------------------- statuses --- */

/**
 * Every CMS resource writes `draft` or `publish`, and every read takes
 * `?status=` with a third value that is not a status.
 *
 * `any` is **publish plus draft and never the trash**, which is deliberate on
 * the API's side: `DELETE` is what puts something in the trash, so a deleted
 * page must not come back through a filter.
 */
export const CONTENT_STATUSES = ["publish", "draft"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** What `?status=` accepts. `""` is not one of them — the API defaults to `publish`. */
export const STATUS_FILTERS = ["publish", "draft", "any"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * The panel asks for `any` by default and every other list in this panel asks
 * for nothing.
 *
 * That inversion is on purpose. On coupons, the absence of `?status=` means
 * publish *and* draft, so "all" is the absence of the parameter. Here the
 * absence means **publish only**, so a Content screen that sent nothing would
 * open on a list with the drafts silently missing — and a draft is precisely
 * what a content manager opens this screen to finish.
 */
export const DEFAULT_STATUS_FILTER: StatusFilter = "any";

export function isContentStatus(value: string): value is ContentStatus {
  return (CONTENT_STATUSES as readonly string[]).includes(value);
}

export function isStatusFilter(value: string): value is StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------- homepage --- */

/**
 * The eleven section types, and the only way to discover them.
 *
 * There is no endpoint that publishes this vocabulary. It was read out of a
 * **400**: `PUT /cms/homepage` with `{"type":"not_a_real_type"}` answers
 *
 *   sections[0].type: Unknown section type "not_a_real_type".
 *                     One of: hero, featured_products, categories, promotion,
 *                     banner, text, image, faq, testimonials, newsletter, custom.
 *
 * So this list is a copy of a server-side constant with no contract keeping the
 * two in step, which is why `unknownSectionTypes()` exists below: rather than
 * trusting the copy, the editor renders a type it does not recognise as
 * *unrecognised* instead of dropping it or crashing.
 */
export const SECTION_TYPES = [
  "hero",
  "featured_products",
  "categories",
  "promotion",
  "banner",
  "text",
  "image",
  "faq",
  "testimonials",
  "newsletter",
  "custom",
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

/**
 * Measured: a 51st section is a **400 on `sections`**, not on `sections[50]`.
 *
 *   {"sections": "A homepage carries at most 50 sections; this one has 51."}
 *
 * Two error paths from one endpoint, and only one of them is positional — the
 * same one-endpoint-two-shapes trap analytics has with `details.params` versus
 * `details.fields`. A form that binds every homepage error to a section index
 * loses this one entirely.
 */
export const MAX_SECTIONS = 50;

export function isSectionType(value: string): value is SectionType {
  return (SECTION_TYPES as readonly string[]).includes(value);
}

/**
 * The types in a document that this build has no name for.
 *
 * The vocabulary above is a copy of a constant on the other side of the wire.
 * If the backend gains a twelfth type, the reader will happily return it and
 * this panel would otherwise render a blank row — so the editor asks first and
 * labels the section by its raw key with a note, rather than pretending.
 */
export function unknownSectionTypes(types: readonly string[]): string[] {
  return [...new Set(types.filter((type) => !isSectionType(type)))];
}

/* -------------------------------------------------------- the drop report --- */

/**
 * A `meta.problems` entry, classified.
 *
 * `GET /cms/homepage` reports the sections it had to drop as **English
 * sentences**, one per dropped section:
 *
 *   Section 2 is not an object.
 *   Section 4 has an unknown type "carousel".
 *   Section 6 ("promotion") has a "data" that is not an object.
 *
 * Rendering those verbatim puts an English paragraph in the middle of an Arabic
 * sheet, which is the exact defect the analytics branch shipped and a capture
 * caught. But unlike analytics' `unavailable`, this is not an object keyed by a
 * stable key — it is prose with a number in it, so there is nothing to key a
 * translation on.
 *
 * So the panel does what `ErrorState` already does for a 409: it states the
 * *shape* of the problem in the reader's language, and carries the API's own
 * sentence beside it as diagnostic detail. The position is extracted because it
 * is the actionable part and because it is **1-based over the stored document**,
 * not over the sections that survived — so "Section 6" is not the sixth thing on
 * screen, and a report that implied it was would send somebody to the wrong row.
 */
export type SectionProblem = {
  /** 1-based, over the *stored* document — not over the surviving sections. */
  position: number | null;
  kind: "not_an_object" | "unknown_type" | "bad_data" | "too_many" | "other";
  /** The API's own sentence, rendered as detail rather than as the message. */
  detail: string;
};

export function classifyProblem(sentence: string): SectionProblem {
  const position = sentence.match(/Section (\d+)/);
  const at = position ? Number.parseInt(position[1], 10) : null;

  if (/More than \d+ sections/.test(sentence)) {
    return { position: null, kind: "too_many", detail: sentence };
  }
  if (/is not an object/.test(sentence) && /^Section \d+ is not an object/.test(sentence)) {
    return { position: at, kind: "not_an_object", detail: sentence };
  }
  if (/unknown type/.test(sentence)) {
    return { position: at, kind: "unknown_type", detail: sentence };
  }
  if (/"data" that is not an object/.test(sentence)) {
    return { position: at, kind: "bad_data", detail: sentence };
  }

  return { position: at, kind: "other", detail: sentence };
}

/* ---------------------------------------------------------------- menus --- */

/**
 * The two locations the API will accept, and the asymmetry between them.
 *
 * Measured: `GET /cms/menus/footer` is a **404 with its own message** — "No menu
 * is assigned to that location." — which is a different fact from a location
 * that was never registered, and the screen says so. `PUT /cms/menus/footer`
 * then **creates and assigns** the menu, naming it "Footer navigation". So an
 * unassigned location is an empty state with a working action behind it, not an
 * error.
 */
export const MENU_LOCATIONS = ["primary", "footer"] as const;
export type MenuLocation = (typeof MENU_LOCATIONS)[number];

/**
 * `type` on a menu item, as the writer accepts it.
 *
 * The reader publishes **WordPress's** vocabulary instead — `type: "post_type"`
 * with `object: "page"`, and the label under `title` rather than `label` — and
 * the writer normalises both, because "GET the menu, drag one item, PUT it back"
 * is the only interaction a menu screen has. `normaliseMenuItem()` below is the
 * panel's half of that.
 */
export const MENU_ITEM_TYPES = ["page", "category", "product", "url"] as const;
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number];

/** Two levels, fifty items. Both are refused above, positionally. */
export const MAX_MENU_DEPTH = 2;
export const MAX_MENU_ITEMS = 50;

/**
 * A URL a menu item may point at.
 *
 * `http`, `https`, or a path beginning with `/`. **`javascript:` is a valid URL**
 * and this is where that matters — measured, the API refuses it on
 * `items[0].url`, and the panel refuses it before sending so the person is told
 * by the field rather than by a round trip. `//host` is not a path: it is a
 * protocol-relative URL to somewhere else.
 */
export function isAllowedMenuUrl(url: string): boolean {
  const trimmed = url.trim();

  if (trimmed === "") return false;
  if (trimmed.startsWith("//")) return false;
  if (trimmed.startsWith("/")) return true;

  return /^https?:\/\//i.test(trimmed);
}

/* ---------------------------------------------------------------- pages --- */

/**
 * **Two pages can share a path, and the path is the only address.**
 *
 * Measured 2026-08-21, before the seed cleaned it: 53 pages answered to
 * `ac-unpublished` and 27 to `conditions`. `wp_unique_post_slug()` does not run
 * for a draft, so nothing stops it, and `get_page_by_path()` resolves exactly
 * one of them — the other 78 rows could not be read, written or deleted through
 * `/cms/pages/{path}` at all.
 *
 * The index is the only place this is visible, and it has to be visible: rows
 * that look identical whose links all open the same page is a screen where
 * editing the fourteenth silently edits the first. So the list marks them and
 * refuses to link the ones it cannot address.
 *
 * Returns the set of paths carried by more than one row.
 */
export function collidingPaths(paths: readonly string[]): Set<string> {
  const counts = new Map<string, number>();

  for (const path of paths) counts.set(path, (counts.get(path) ?? 0) + 1);

  return new Set([...counts].filter(([, count]) => count > 1).map(([path]) => path));
}

/* ------------------------------------------------------------ reordering --- */

/**
 * Which rows need a `position` write after a move, and which do not.
 *
 * Banners and FAQs are both ordered by a dense `position` — measured `0,1,2`
 * across the collection, not sparse — and neither has a bulk endpoint, so a
 * reorder is one `PATCH` per row that actually moved. Sending the whole list
 * back would be a burst of writes that say nothing and still count against the
 * 120-a-minute cap.
 *
 * **Both halves of the condition are load-bearing.** A row is left alone only
 * when it is in the same slot *and* its stored position already matches that
 * slot. Checking the slot alone is what the first version did, and it is wrong
 * the moment the stored positions are not already `0..n-1` — a collection that
 * had drifted would keep its drift forever, because every row would look
 * unmoved. Dense positions make the two checks agree today; the second one is
 * what keeps them agreeing.
 */
export function positionWrites<T extends { id: number; position: number }>(
  before: readonly T[],
  after: readonly T[],
): { id: number; position: number }[] {
  return after.flatMap((item, index) =>
    item.id === before[index]?.id && item.position === index
      ? []
      : [{ id: item.id, position: index }],
  );
}

/**
 * The one page a banner or FAQ list ever asks for. 100 is the API's ceiling on
 * `per_page` — `?per_page=101` is a 400 — so this is not a tuning knob.
 */
export const CMS_LIST_PER_PAGE = 100;

/**
 * Why a reorder control may not be rendered, or `null` when it may.
 *
 * `positionWrites()` above renumbers **the array it is given** to `0..n-1`. That
 * is correct exactly when the array is the whole collection, and it is a
 * data-corruption bug when it is not — so the question of completeness has to be
 * answered before the control is ever drawn, not inside the write.
 *
 * There are two ways to be handed a partial array here, and they are different
 * facts with different remedies, so they are reported separately rather than
 * collapsed into one "cannot reorder" message. That is the inventory branch's
 * second defect — one `SectionError` serving both "request failed" and "nothing
 * has moved" — and it is the reason this returns a reason rather than a boolean.
 *
 * **`truncated`** — the list asked for `per_page=100` and `meta.total` says
 * there are more. Both screens shipped sending `per_page=100&status=any` and
 * **never reading `meta.total`**, so a 101st row was silently invisible; worse,
 * a move then renumbered the visible hundred to `0..99` while the rows nobody
 * fetched kept their stored positions, leaving two disjoint sets claiming one
 * dense sequence. Hiding rows is recoverable by scrolling. That is not.
 * Paging is not the remedy either: there is no bulk endpoint and no "move to
 * position n" route — a reorder is one `PATCH` per moved row computed from the
 * array in hand — so a row cannot cross a page boundary at all, and a second
 * page would offer a control that works within itself and lies about the whole.
 *
 * **`filtered`** — `?status=publish` or `?status=draft` is applied. The rows
 * that come back carry the collection's positions with the other status's
 * numbers *missing from the sequence*: publish-only might be `0, 2, 3`. Feeding
 * that to `positionWrites()` writes `1` and `2` onto rows that never moved, over
 * the top of the draft sitting at `1`. This one is a screen decision rather than
 * an API limit — the tab is one click away — so it is recoverable and the line
 * that reports it says which tab restores the control.
 *
 * Truncation wins when both are true: clearing the filter would not give the
 * control back, and saying otherwise would send somebody round a loop.
 *
 * `total` is `0` when the envelope carried no `meta.total` — `acRead` defaults
 * it — and that must not read as "every row is missing". The refusal fires on
 * positive evidence only, so an absent `meta` keeps the control.
 *
 * Nothing here touches create, edit or delete: each addresses one row by id and
 * none of them depends on the list being complete.
 */
export type ReorderBlock = "truncated" | "filtered";

export function reorderBlock({
  status,
  fetched,
  total,
}: {
  status: StatusFilter;
  /** Rows in hand. */
  fetched: number;
  /** `meta.total` for the same request. */
  total: number;
}): ReorderBlock | null {
  if (total > fetched) return "truncated";
  if (status !== "any") return "filtered";
  return null;
}

/**
 * The parent path of a page path, or `""` for a root page.
 *
 * `legal/terms` → `legal`. The API resolves `parent_path` itself and answers a
 * **400 on that field** for a path naming nothing — measured, rather than
 * creating an orphan — so this is for display and for pre-filling a form, never
 * for deciding whether a move is legal.
 */
export function parentPathOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

/**
 * How deep a page is filed, from its path. Root is 0.
 *
 * Used only to indent the index. There is no depth limit on pages the way there
 * is on menu items.
 */
export function pageDepth(path: string): number {
  return path === "" ? 0 : path.split("/").length - 1;
}

/**
 * The URL of an embedded image — the one place that knows the key is disputed.
 *
 * `MediaPresenter::image()` sends `src`; the harness sends `url`, which is the
 * panel's own old guess handed back to it. Neither has been measured over the
 * wire, so `lib/api/schemas/cms.ts` accepts both and this decides which wins —
 * the presenter's, because it is the router rather than a fixture.
 *
 * Structurally typed rather than importing `EmbeddedImage`, so this file keeps
 * the property its docblock opens with: no dependency on the schema layer, and
 * therefore no Zod in the browser for a component that only wants a `src`.
 */
export function embeddedImageSrc(
  image: { src?: string; url?: string } | null | undefined,
): string | null {
  return image?.src ?? image?.url ?? null;
}
