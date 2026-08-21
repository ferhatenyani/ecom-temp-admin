import { z } from "zod";
import { CONTENT_STATUSES, MENU_ITEM_TYPES } from "@/lib/cms";

/**
 * Shapes measured against the live API on 2026-08-21.
 *
 * The vocabulary lives in `lib/cms.ts`, which has no dependencies, and this
 * module imports it — the split every other resource in this panel makes, so a
 * client component can hold `SECTION_TYPES` as a value without Zod arriving in
 * the browser with it.
 *
 * `looseObject` throughout, as everywhere else here: the API adds keys to `meta`
 * and to resources between branches, and a strict object turns a additive server
 * change into a parse failure on a screen that did not need the new field.
 */

const status = z.enum(CONTENT_STATUSES);

/* ---------------------------------------------------------------- pages --- */

/**
 * A row from `GET /cms/pages`, the index added on `feat/cms-page-index`.
 *
 * Deliberately **less** than a page: no `content`, no `seo`, no `excerpt`. The
 * first is a whole page body per row and the second is a `SeoResolver` pass per
 * row, so an index carrying them would cost what opening every page at once
 * costs. The backend asserts the omission so it cannot drift back.
 */
export const pageRow = z.looseObject({
  id: z.number(),
  /** The address. `legal/terms`, never a bare slug — and **not unique**; see `collidingPaths()`. */
  path: z.string(),
  /** One segment. The field that *renames*, while `parent_path` is the field that moves. */
  slug: z.string(),
  parent_path: z.string(),
  status: status,
  title: z.string(),
  menu_order: z.number(),
  date_created: z.string(),
  date_modified: z.string(),
});
export type PageRow = z.infer<typeof pageRow>;

export const pageList = z.array(pageRow);

/**
 * The SEO block, written through the page's own PATCH.
 *
 * There is no SEO endpoint and §89 does not add one, so this rides inside the
 * page form. `overrides` names the fields a person has set by hand as against
 * the ones the resolver derived — everything else in here is *derived* and
 * changes when the title or excerpt changes, which is why the form shows it as
 * a preview rather than as a set of inputs.
 */
export const pageSeo = z.looseObject({
  title: z.string(),
  description: z.string(),
  canonical: z.string(),
  robots: z.looseObject({
    index: z.boolean(),
    follow: z.boolean(),
    directive: z.string(),
  }),
  og: z.looseObject({
    title: z.string(),
    description: z.string(),
    type: z.string(),
    image: z.unknown().nullable(),
  }),
  image: z.unknown().nullable(),
  structured_data: z.record(z.string(), z.unknown()),
  /** The keys a person has overridden. Empty means every value above is derived. */
  overrides: z.array(z.string()),
});
export type PageSeo = z.infer<typeof pageSeo>;

/**
 * An image as the CMS embeds it in a resource — `MediaPresenter::image()`.
 *
 * Null on every fixture in this shop, and null is the common case: a banner
 * without a picture is a banner. Never assume the object.
 */
export const embeddedImage = z.looseObject({
  id: z.number(),
  url: z.string(),
  alt: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type EmbeddedImage = z.infer<typeof embeddedImage>;

/**
 * A whole page, from `GET /cms/pages/{path}`.
 *
 * **The read body PATCHes back unchanged** — asserted on the backend and
 * verified here twice over: `content` and `excerpt` both read back as *rendered*
 * HTML (`<p>…</p>\n`) rather than as what was sent, and PATCHing that rendered
 * form back does **not** accumulate another wrapper. So the form binds directly
 * to the response, which is what makes "GET, edit, PATCH the whole thing" safe
 * here where a coupon's `date_expires` made it unsafe there.
 */
export const page = z.looseObject({
  id: z.number(),
  path: z.string(),
  slug: z.string(),
  parent_path: z.string(),
  status: status,
  title: z.string(),
  /** Rendered HTML, sanitised **on save**. The panel renders it back, never re-sanitises. */
  content: z.string(),
  excerpt: z.string(),
  parent_id: z.number(),
  menu_order: z.number(),
  image: embeddedImage.nullable(),
  seo: pageSeo,
  date_created: z.string(),
  date_modified: z.string(),
});
export type Page = z.infer<typeof page>;

/* -------------------------------------------------------------- banners --- */

/**
 * `position` is **dense** — measured `0,1,2` across the collection, not sparse —
 * so a reorder screen can swap two adjacent values rather than rewriting a
 * fractional index, and a new banner appended at `n` is correct.
 *
 * `placement` is a free key rather than an enum on the API's side, deliberately:
 * where a shop puts a banner is a shop's decision and the plugin is cloned per
 * client. So the panel offers the placements it finds in the data plus a free
 * field, and never a fixed list.
 */
export const banner = z.looseObject({
  id: z.number(),
  /** Texturized by WordPress: an apostrophe arrives as character reference 8217. Decode before rendering. */
  title: z.string(),
  caption: z.string(),
  link: z.string(),
  placement: z.string(),
  status: status,
  position: z.number(),
  image: embeddedImage.nullable(),
  date_modified: z.string(),
});
export type Banner = z.infer<typeof banner>;

export const bannerList = z.array(banner);

/* ----------------------------------------------------------------- FAQs --- */

export const faqCategory = z.looseObject({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** Present on `/cms/faq-categories`, absent on the embedded form. */
  count: z.number().optional(),
});
export type FaqCategory = z.infer<typeof faqCategory>;

export const faqCategoryList = z.array(faqCategory);

/**
 * `categories` is a list of `{id, slug, name}` on read, and the writer accepts
 * that shape **or** a bare list of slugs or ids.
 *
 * The singular `category` is refused *by name* — "Use \"categories\" — an FAQ
 * may sit in more than one." — which is how the field was found rather than
 * guessed. Three more are refused the same way: `title` (use `question`),
 * `content` (use `answer`) and `menu_order` (use `position`).
 */
export const faq = z.looseObject({
  id: z.number(),
  question: z.string(),
  answer: z.string(),
  categories: z.array(faqCategory),
  status: status,
  position: z.number(),
  date_modified: z.string(),
});
export type Faq = z.infer<typeof faq>;

export const faqList = z.array(faq);

/* ---------------------------------------------------------------- menus --- */

/**
 * A menu item **as the reader publishes it**, which is WordPress's vocabulary
 * and not the writer's.
 *
 * `type` is `post_type`/`taxonomy`/`custom` with the real kind under `object`,
 * and the label is `title` rather than `label`. `CmsPresenter::menu()` has
 * published this since §61 and changing it would break every existing caller, so
 * `MenuInput` normalises both shapes on the way back in and the round trip
 * holds. `toWriteItem()` below is the panel's half.
 */
export type MenuItem = {
  id: number;
  title: string;
  url: string;
  target: string;
  type: string;
  object: string;
  object_id: number;
  position: number;
  classes: string[];
  children: MenuItem[];
};

export const menuItem: z.ZodType<MenuItem> = z.lazy(() =>
  z.looseObject({
    id: z.number(),
    title: z.string(),
    url: z.string(),
    target: z.string(),
    type: z.string(),
    object: z.string(),
    object_id: z.number(),
    position: z.number(),
    classes: z.array(z.string()),
    children: z.array(menuItem),
  }),
) as z.ZodType<MenuItem>;

export const menu = z.looseObject({
  location: z.string(),
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  items: z.array(menuItem),
});
export type Menu = z.infer<typeof menu>;

/**
 * The writer's shape for one item.
 *
 * `label`, `type`, `children`, plus exactly one target: `path` for a page,
 * `object_id` for a category or product, `url` for a link.
 */
export type MenuWriteItem = {
  label: string;
  type: (typeof MENU_ITEM_TYPES)[number];
  path?: string;
  object_id?: number;
  url?: string;
  children: MenuWriteItem[];
};

/* ------------------------------------------------------------- homepage --- */

/**
 * A section that survived the read.
 *
 * `data` is **free-form** — that is the whole reason §89 could not point
 * `wp_kses` at it and had to route string leaves through
 * `ContentHtml::looksLikeMarkup()` instead. So `data` is `unknown` here and the
 * editor treats it as a JSON document rather than as a typed object: inventing a
 * per-type shape in the panel would be inventing a contract the API does not
 * have.
 */
export const homepageSection = z.looseObject({
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type HomepageSection = z.infer<typeof homepageSection>;

export const homepage = z.looseObject({
  sections: z.array(homepageSection),
});
export type Homepage = z.infer<typeof homepage>;

/**
 * `meta.problems` — the drop report, **absent entirely when there is nothing to
 * report**.
 *
 * Not an empty array: measured, `meta` itself does not appear. So this reads
 * `meta?.problems` and defaults, and a screen that destructured `meta.problems`
 * would throw on the healthy case rather than on the broken one.
 */
export const homepageProblems = z.array(z.string());
