import { describe, expect, it } from "vitest";
import {
  banner,
  bannerList,
  faq,
  faqCategoryList,
  faqList,
  homepage,
  homepageProblems,
  menu,
  page,
  pageList,
  pageRow,
} from "@/lib/api/schemas/cms";
import { mediaItem, mediaList } from "@/lib/api/schemas/media";
import fixtures from "./fixtures-cms.json";

/**
 * The CMS and media schemas, parsed against **captured live payloads**.
 *
 * `tests/cms.test.ts` covers the vocabulary and the pure logic; this covers the
 * boundary, which is a different failure. A schema is where a measured fact
 * about the API is written down, and the facts here were expensive to establish:
 * `image` is null on every fixture, `sizes` is empty, `meta.problems` is absent
 * rather than `[]`, `categories` is a list of objects and not of slugs. Left
 * only to the e2e suite, a shape change would surface as a server-render failure
 * on some screen rather than as a named failure here — and `acFetch` parses on
 * the *server*, so the first symptom is a 500 with a Zod trace in it.
 *
 * `tests/fixtures-cms.json` is the eight responses verbatim, captured
 * 2026-08-21. Re-capture it, do not hand-edit it: a fixture somebody tidied is a
 * fixture that no longer describes the API.
 *
 * The precedent is `tests/analytics.test.ts` and `tests/boundary.test.ts`, both
 * of which parse a real payload through the schema they ship.
 */

const envelope = <T,>(body: unknown) => (body as { data: T }).data;
const meta = (body: unknown) => (body as { meta?: Record<string, unknown> }).meta;

describe("the page index", () => {
  it("parses, and a row carries exactly what the index publishes", () => {
    const rows = pageList.parse(envelope(fixtures.pageIndex));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].path).not.toBe("");
  });

  it("keeps `content`, `seo` and `excerpt` out of a row", () => {
    /*
     * The omission is the contract, and it is asserted on both sides of the
     * wire: `CmsPresenter::pageRow()` on the backend and here. A row carrying a
     * page body would be a list that costs what opening every page costs, and
     * the way that regresses is somebody reusing `CmsPresenter::page()`.
     */
    const row = envelope<Record<string, unknown>[]>(fixtures.pageIndex)[0];
    for (const absent of ["content", "seo", "excerpt"]) {
      expect(row).not.toHaveProperty(absent);
    }
  });

  it("accepts a nested path, which is the address of a child page", () => {
    const rows = pageList.parse(envelope(fixtures.pageIndex));
    const child = rows.find((row) => row.path.includes("/"));
    expect(child?.parent_path).not.toBe("");
  });

  it("refuses a status the write vocabulary does not have", () => {
    // `publish` and `draft`, never `trash`: `DELETE` is what puts something
    // there, and a deleted page must not come back through a filter.
    const row = { ...envelope<Record<string, unknown>[]>(fixtures.pageIndex)[0], status: "trash" };
    expect(pageRow.safeParse(row).success).toBe(false);
  });
});

describe("a whole page", () => {
  it("parses, with its SEO block and a null image", () => {
    const parsed = page.parse(envelope(fixtures.page));

    expect(parsed.seo.robots).toHaveProperty("directive");
    expect(parsed.seo.overrides).toBeInstanceOf(Array);
    // Null on every fixture in this shop, and null is the ordinary case.
    expect(parsed.image).toBeNull();
  });

  it("reads `content` and `excerpt` back as rendered HTML", () => {
    /*
     * Not what was sent — the seed writes plain text and both come back wrapped.
     * Pinned because it is what makes binding a form straight to the response
     * safe: PATCHing the rendered form back does not accumulate another
     * wrapper, verified over three round trips.
     */
    const parsed = page.parse(envelope(fixtures.page));
    expect(parsed.content).toMatch(/^<p>/);
  });
});

describe("banners", () => {
  it("parses, with a dense position and a null image", () => {
    const rows = bannerList.parse(envelope(fixtures.banners));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => Number.isInteger(row.position))).toBe(true);
    expect(rows[0].image).toBeNull();
  });

  it("carries a texturized title, which is why nothing renders it raw", () => {
    /*
     * WordPress rewrites what it stores. The seed writes `Soldes d'été` and the
     * API returns its apostrophe as a numeric character reference — so a title
     * rendered without `decodeEntities` prints the entity on screen. The seed
     * itself learned this the hard way, creating a duplicate banner on its
     * second run because a `===` on the title never matched.
     */
    const rows = bannerList.parse(envelope(fixtures.banners));
    expect(rows.some((row) => /&#\d+;/.test(row.title) || /&\w+;/.test(row.caption))).toBe(true);
  });

  it("refuses a row missing the position the strip is ordered by", () => {
    const { position, ...withoutPosition } = envelope<Record<string, unknown>[]>(
      fixtures.banners,
    )[0] as { position: number };
    expect(banner.safeParse(withoutPosition).success).toBe(false);
  });
});

describe("FAQs", () => {
  it("parses `categories` as objects, never as a list of slugs", () => {
    /*
     * The read emits `{id, slug, name}` and the writer accepts that *or* bare
     * slugs. The asymmetry is the whole reason the singular `category` is
     * refused by name, and a schema that took `string[]` would parse nothing.
     */
    const rows = faqList.parse(envelope(fixtures.faqs));
    const categorised = rows.find((row) => row.categories.length > 0);
    expect(categorised?.categories[0]).toHaveProperty("slug");
    expect(categorised?.categories[0]).toHaveProperty("name");
  });

  it("parses the category list the spec's own table forgot", () => {
    // `GET /cms/faq-categories` was missing from §89's table — `POST` was
    // listed, so a panel could create a category it had no way to list.
    const terms = faqCategoryList.parse(envelope(fixtures.faqCategories));
    expect(terms.length).toBeGreaterThan(0);
    expect(typeof terms[0].count).toBe("number");
  });

  it("refuses `category` where `categories` belongs", () => {
    const row = envelope<Record<string, unknown>[]>(fixtures.faqs)[0];
    expect(faq.safeParse({ ...row, categories: undefined }).success).toBe(false);
  });
});

describe("a menu", () => {
  it("parses WordPress's vocabulary, not the writer's", () => {
    /*
     * `type` is `post_type`/`taxonomy`/`custom` with the real kind under
     * `object`, and the label is `title` rather than `label`. The reader has
     * published this since §61 and `MenuInput` normalises both on the way back,
     * which is what makes "GET, drag one item, PUT it back" work.
     */
    const parsed = menu.parse(envelope(fixtures.menu));
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.items[0]).toHaveProperty("title");
    expect(parsed.items[0]).not.toHaveProperty("label");
    expect(["custom", "post_type", "taxonomy"]).toContain(parsed.items[0].type);
  });

  it("parses the second level, recursively", () => {
    // Two levels, and the schema is `z.lazy` for exactly this row.
    const parsed = menu.parse(envelope(fixtures.menu));
    const withChildren = parsed.items.find((item) => item.children.length > 0);
    expect(withChildren?.children[0]).toHaveProperty("title");
  });
});

describe("the homepage document", () => {
  it("parses the sections that survived the read", () => {
    const parsed = homepage.parse(envelope(fixtures.homepage));
    expect(parsed.sections.length).toBeGreaterThan(0);
    expect(parsed.sections[0]).toHaveProperty("data");
  });

  it("keeps a section's `data` free-form, because the API defines no shape", () => {
    /*
     * That is not laxity, it is the reason §89 could not point `wp_kses` at the
     * homepage and had to route string leaves through `looksLikeMarkup()`
     * instead. A schema inventing a per-type shape would be inventing a
     * contract the API does not have.
     */
    const parsed = homepage.parse(envelope(fixtures.homepage));
    const hero = parsed.sections.find((s) => s.type === "hero");
    expect(hero?.data).toBeTypeOf("object");
  });

  it("survives `Tapis & Kilims`, which is why looksLikeMarkup() exists", () => {
    // Running `wp_kses` over every string leaf rewrote it to `Tapis &amp;
    // Kilims`. If that regresses, it regresses here first.
    const parsed = homepage.parse(envelope(fixtures.homepage));
    const hero = parsed.sections.find((s) => s.type === "hero");
    expect(hero?.data.title).toBe("Tapis & Kilims");
  });

  it("reads the drop report out of `meta`, which is absent when clean", () => {
    /*
     * **Absent, not `[]`** — measured. Code that destructured `meta.problems`
     * would throw on the healthy document and work on the broken one, which is
     * the wrong way round for a failure mode.
     */
    const problems = homepageProblems.parse(meta(fixtures.homepage)?.problems);
    expect(problems).toHaveLength(3);

    expect(homepageProblems.safeParse(undefined).success).toBe(false);
    expect(meta({ data: { sections: [] } })).toBeUndefined();
  });
});

describe("media", () => {
  it("parses, and every row carries the server's own filename", () => {
    const rows = mediaList.parse(envelope(fixtures.media));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].filename).toMatch(/\.(jpe?g|png|webp)$/i);
  });

  it("normalises an empty `sizes` to the map PHP meant by it", () => {
    /*
     * The images are 30×20, below every threshold at which WordPress generates
     * a thumbnail. A client indexing into `sizes[0]` works in production and
     * fails on every test fixture — `url` is the one that always exists.
     *
     * `{}` and not `[]`: `MediaPresenter::sizes()` returns a **map keyed by
     * size name**, and PHP serialises the empty one as `[]`. The schema
     * declared an array of `{name, url, width, height}` — a shape the presenter
     * has never emitted — and parsed only because of that serialisation. See
     * `mediaSizes`.
     */
    const rows = mediaList.parse(envelope(fixtures.media));
    expect(rows[0].sizes).toEqual({});
    expect(rows[0].url).not.toBe("");
  });

  it("accepts null dimensions, for a file WordPress could not measure", () => {
    const row = envelope<Record<string, unknown>[]>(fixtures.media)[0];
    const parsed = mediaItem.parse({ ...row, width: null, height: null });
    expect(parsed.width).toBeNull();
  });
});

describe("an added field is not a breaking change", () => {
  it("passes an unknown key through rather than refusing the response", () => {
    /*
     * `looseObject` throughout, and this is the assertion that keeps it that
     * way. The API adds keys to resources between branches; a strict object
     * would turn an additive server change into a parse failure on a screen
     * that did not need the new field — and because `acFetch` parses on the
     * server, that failure is a 500 rather than a missing value.
     */
    const row = { ...envelope<Record<string, unknown>[]>(fixtures.banners)[0], invented: true };
    expect(banner.parse(row)).toHaveProperty("invented", true);
  });

  it("still refuses a field that changed type", () => {
    // The floor: loose must not mean unchecked.
    const row = { ...envelope<Record<string, unknown>[]>(fixtures.media)[0], filesize: "706" };
    expect(mediaItem.safeParse(row).success).toBe(false);
  });
});
