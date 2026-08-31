import { z } from "zod";
import { READABLE_STATUSES } from "@/lib/product-status";

/**
 * Shapes measured against the live API on 2026-08-18, not remembered.
 *
 * `GET /products` and `GET /products/{id}` return the **same** object — measured,
 * the two key sets are identical across all 28 products, exactly as the orders
 * branch found for orders. One schema serves both, and a detail screen's
 * richness comes from `/variations` and from the fields a list row has no room
 * for, never from a fatter product.
 */

/** Money is a decimal string and stays one. Never parsed into a number. */
const decimal = z.string();

export { READABLE_STATUSES, type ReadableStatus } from "@/lib/product-status";
export const readableStatus = z.enum(READABLE_STATUSES);

/**
 * An attribute as the product carries it.
 *
 * **`id: 0` means a local attribute** — one typed onto this product alone. §82 is
 * explicit that only a *global* attribute can be filtered or counted, because a
 * local one has no shared vocabulary and no term to count. Measured before the
 * catalogue was seeded: both variable products carried `id: 0` attributes
 * ("Taille", "Finition"), so the shop's only attributes were the two that could
 * never appear in a facet.
 *
 * `name` is the label for a local attribute and the **taxonomy** (`pa_matiere`)
 * for a global one, and `options` are free strings for the first and term *slugs*
 * for the second. That asymmetry is the API's, and the row renderer has to know
 * it or it prints `pa_matiere` at a shopkeeper.
 */
export const productAttribute = z.looseObject({
  id: z.number(),
  name: z.string(),
  options: z.array(z.string()),
  visible: z.boolean(),
  variation: z.boolean(),
  position: z.number(),
});
export type ProductAttribute = z.infer<typeof productAttribute>;

/** SEO travels on the product; there is no separate endpoint. */
export const productSeo = z.looseObject({
  title: z.string(),
  description: z.string(),
  canonical: z.string(),
  robots: z.looseObject({
    index: z.boolean(),
    follow: z.boolean(),
    directive: z.string(),
  }),
  /** Which fields were set by hand rather than derived. Empty on a fresh product. */
  overrides: z.array(z.string()),
});
export type ProductSeo = z.infer<typeof productSeo>;

/**
 * An attachment, as the product presenter embeds it — `image` and every entry
 * of `gallery`.
 *
 * ## `url` was required and `ProductPresenter` has never sent one
 *
 * This block used to read `{id, url, alt?}` under the line *"Null on every
 * product in this shop"*, and the second half is what hid the first.
 * `ProductPresenter::image()` returns exactly `{id, src, thumbnail, alt}` —
 * read from source — so **a product that has a picture threw at this
 * boundary**, taking the detail screen, the peek and the list page with it. Not
 * one of the 28 seeded rows carries `image_id`, so the shape was reachable
 * through a write and no other way, and until this branch nothing in the panel
 * could perform that write.
 *
 * The gallery is what made it live: sub-task 5 puts `image_id` and
 * `gallery_image_ids` on the edit form, so the very next save resolves an
 * embedded image into the response.
 *
 * **This is the CMS defect one collection over**, and the fix is deliberately
 * the identical one rather than a second opinion: `lib/api/schemas/cms.ts`'s
 * `embeddedImage` records the same slip against `MediaPresenter::image()` and
 * settles it the same way — `id` required, every carrier of the picture
 * optional, so both the presenter's `src` and the harness's `url` parse.
 * `embeddedImageSrc` in `lib/cms.ts` is the one place that decides which key
 * wins, and this screen calls it rather than minting a second rule.
 *
 * **Not shared with `embeddedImage` as one symbol**, and that is a decision:
 * they are two private methods in two unrelated PHP classes that happen to
 * agree today, and a single schema would assert that they must. They are kept
 * in step by their docblocks pointing at each other, which is the honest
 * strength of the claim.
 */
export const media = z.looseObject({
  id: z.number(),
  /** `ProductPresenter::image()`'s own key — `wp_get_attachment_image_url($id, 'full')`. */
  src: z.string().optional(),
  /** The `woocommerce_thumbnail` size, falling back to `src`. */
  thumbnail: z.string().optional(),
  /** What the harness sends where the presenter sends `src`. See above. */
  url: z.string().optional(),
  alt: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type ProductMediaItem = z.infer<typeof media>;

export const product = z.looseObject({
  id: z.number(),
  name: z.string(),
  /** `""` on a draft that has never been published — measured on AC-SEO-DRAFT. */
  slug: z.string(),
  type: z.string(),
  status: readableStatus,
  featured: z.boolean(),
  catalog_visibility: z.string(),
  sku: z.string(),
  /** Both carry HTML and can carry a shortcode: `<p>…</p>[products limit="3"]`. */
  description: z.string(),
  short_description: z.string(),
  /**
   * The **effective** price, and `""` is a real value — measured on
   * AC-SEO-NOPRICE, a published product with no price at all. On a variable
   * product this holds the resolved figure while `regular_price` is `""`, which
   * is why the row renders `price` and the form edits `regular_price`.
   */
  price: decimal,
  regular_price: decimal,
  sale_price: decimal,
  on_sale: z.boolean(),
  manage_stock: z.boolean(),
  /** Null whenever `manage_stock` is false — 8 of 28 products. */
  stock_quantity: z.number().nullable(),
  stock_status: z.string(),
  weight: z.string(),
  category_ids: z.array(z.number()),
  tag_ids: z.array(z.number()),
  attributes: z.array(productAttribute),
  /** Variation **ids**, not objects. The bodies come from `/variations`. */
  variations: z.array(z.number()),
  image_id: z.number(),
  gallery_image_ids: z.array(z.number()),
  image: media.nullable(),
  gallery: z.array(media),
  permalink: z.string(),
  seo: productSeo,
  date_created: z.string(),
  date_modified: z.string(),

  /**
   * The three §83 keys, all **optional** — measured, they are absent from the
   * response entirely unless the product has an option set, which none of the 28
   * did. A required field here would fail the panel at its own boundary on every
   * ordinary product.
   */
  options: z.looseObject({ groups: z.array(z.looseObject({ id: z.string() })) }).nullable().optional(),
  /** Read-only. `available` is computed on every read, never stored. */
  bundle: z
    .looseObject({
      items: z.array(z.looseObject({ product_id: z.number(), quantity: z.number() })),
      available: z.number(),
    })
    .optional(),
  /**
   * Read-only, and present **only when something is wrong**. One English string
   * per group the stored document could not be read, naming the group by its
   * 1-based position rather than by its id — measured verbatim:
   * `"Option group 4 was dropped: Must be one of: choice, text, bundle."`
   *
   * The position is all there is to go on precisely because the broken group is
   * absent from `options.groups`, so nothing can link the warning to a row.
   */
  options_problems: z.array(z.string()).optional(),
});
export type Product = z.infer<typeof product>;

export const productList = z.array(product);

/**
 * A variation. Note `attributes` is an **object** here — `{"taille": "s"}` —
 * where the parent's is an array. The values are lowercased slugs of the parent's
 * options.
 */
export const variation = z.looseObject({
  id: z.number(),
  parent_id: z.number(),
  /** `""` means it inherits the parent's; the API reports what is stored. */
  sku: z.string(),
  status: z.string(),
  description: z.string(),
  price: decimal,
  regular_price: decimal,
  sale_price: decimal,
  on_sale: z.boolean(),
  manage_stock: z.boolean(),
  stock_quantity: z.number().nullable(),
  stock_status: z.string(),
  weight: z.string(),
  attributes: z.record(z.string(), z.string()),
  image_id: z.number(),
  image: media.nullable(),
  date_created: z.string(),
  date_modified: z.string(),
});
export type Variation = z.infer<typeof variation>;
export const variationList = z.array(variation);

/** `GET /product-categories` — flat, with `parent` for the tree and a usage count. */
export const productCategory = z.looseObject({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  parent: z.number(),
  description: z.string(),
  count: z.number(),
});
export type ProductCategory = z.infer<typeof productCategory>;
export const productCategories = z.array(productCategory);

/**
 * A global attribute. `slug` is what §88's routes take back and `taxonomy` is
 * what `?attributes[pa_matiere]=…` matches and what keys a facet group — both are
 * published because confusing them is the mistake the endpoint exists to prevent.
 */
export const globalAttribute = z.looseObject({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  taxonomy: z.string(),
  type: z.string(),
  order_by: z.string(),
  has_archives: z.boolean(),
});
export type GlobalAttribute = z.infer<typeof globalAttribute>;
export const globalAttributes = z.array(globalAttribute);

/**
 * `GET /attributes/{id}` — the same row **plus the two counts**, and the counts
 * are the whole reason the single read is worth a request.
 *
 * `AttributeController` splits them on purpose: *"The single read carries usage;
 * the list does not — two queries per row."* So a list row cannot say how many
 * products would be detached by deleting it, and the detail can. Measured
 * in-process through `rest_do_request()` (`tests/Api/attributes.php`, 59/59):
 * the list has no `term_count` key at all — asserted there by *"the list
 * computes usage per row"* — and the single read answers `term_count: 2`,
 * `product_count: 0` on a fresh attribute and `product_count: 1` once a product
 * carries it.
 *
 * Both are **required** here rather than optional, unlike `faqCategory.count`:
 * `AttributePresenter::toArray()` writes them whenever `$usage` is passed, and
 * `show()`, `store()` and `update()` all pass one. There is no shape of this
 * route that omits them, so making them optional would only let a screen forget
 * to handle the number it exists to show.
 */
export const globalAttributeDetail = globalAttribute.extend({
  term_count: z.number(),
  product_count: z.number(),
});
export type GlobalAttributeDetail = z.infer<typeof globalAttributeDetail>;

/**
 * A term. **`count` is here and it can be 0** — which is the whole reason the
 * panel reads this route at all: a facet group omits its zero-count values
 * entirely, so this is the only place the full vocabulary exists.
 */
export const attributeTerm = z.looseObject({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  menu_order: z.number(),
  count: z.number(),
});
export type AttributeTerm = z.infer<typeof attributeTerm>;
export const attributeTerms = z.array(attributeTerm);

/* ------------------------------------------------------------------ facets --- */

/**
 * `meta.facets`, which arrives only when `?facets=…` asks for it.
 *
 * **Three different shapes in one object**, measured rather than assumed:
 *
 * - `price` is `{min, max, currency}`
 * - `stock_status` and `rating` are bare **arrays** of `{value, count}`
 * - `category`, `tag` and each attribute group are `{values, total_values,
 *   truncated}`
 *
 * A single "facet group" type would be wrong for two of the three.
 */
export const facetValue = z.looseObject({
  slug: z.string(),
  name: z.string(),
  count: z.number(),
  term_id: z.number().optional(),
});
export type FacetValue = z.infer<typeof facetValue>;

export const facetGroup = z.looseObject({
  values: z.array(facetValue),
  /**
   * The number of values with a **non-zero** count, not the size of the
   * vocabulary. Measured: `pa_matiere` has six terms, one of which no product
   * carries, and the group reports `total_values: 5`.
   */
  total_values: z.number(),
  /** True once the group was cut to 50. Measured with a 60-term attribute: 50 values, `total_values: 60`, `truncated: true`. */
  truncated: z.boolean(),
});
export type FacetGroup = z.infer<typeof facetGroup>;

export const attributeFacetGroup = facetGroup.extend({
  taxonomy: z.string(),
  label: z.string(),
});
export type AttributeFacetGroup = z.infer<typeof attributeFacetGroup>;

export const facets = z.looseObject({
  /** Always `"publish"`. The list includes drafts; the counts do not. */
  scope: z.string(),
  /** The API's own sentence saying so. Rendered beside the facets, never hidden. */
  scope_note: z.string(),
  price: z.looseObject({ min: decimal, max: decimal, currency: z.string() }).optional(),
  stock_status: z.array(z.looseObject({ value: z.string(), count: z.number() })).optional(),
  rating: z.array(z.looseObject({ value: z.union([z.string(), z.number()]), count: z.number() })).optional(),
  category: facetGroup.optional(),
  tag: facetGroup.optional(),
  attributes: z
    .looseObject({
      /** The taxonomies this shop can filter on. `[]` in a shop with no global attributes. */
      facetable: z.array(z.string()),
      note: z.string(),
      groups: z.array(attributeFacetGroup),
    })
    .optional(),
});
export type Facets = z.infer<typeof facets>;

/** `meta` on a products listing: the pagination block plus the optional facets. */
export const productListMeta = z.looseObject({
  total: z.number(),
  page: z.number(),
  per_page: z.number(),
  total_pages: z.number(),
  facets: facets.optional(),
});
export type ProductListMeta = z.infer<typeof productListMeta>;

/** `DELETE /products/{id}` — identical for a trash and for `?force=true`. */
export const deleteResult = z.looseObject({ id: z.number(), deleted: z.boolean() });
