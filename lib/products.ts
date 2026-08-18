import type {
  AttributeFacetGroup,
  AttributeTerm,
  FacetGroup,
  FacetValue,
  GlobalAttribute,
  Product,
  ProductCategory,
  Variation,
} from "@/lib/api/schemas/product";

/**
 * What a product row and a filter sheet need to know, in one place.
 *
 * Types only from the schema module — `import type` is erased, so this file
 * stays importable from a client component without dragging Zod along.
 */

/* ------------------------------------------------------- the facet merge --- */

/**
 * A choice a filter group offers: a value, its label, and how many published
 * products carry it right now.
 */
export type FilterOption = {
  value: string;
  label: string;
  count: number;
};

/**
 * Merge a *complete* vocabulary with the counts a facet reported.
 *
 * **This function exists because the facet response is not a vocabulary**, and
 * two measurements say so.
 *
 * **A facet omits its zero-count values.** Measured 2026-08-18: `pa_matiere`
 * carries six terms and one of them ("Cuir") is on no product, so the group
 * reports five values and `total_values: 5`. `?search=tapis` cut the category
 * group from six values to two — the other four were dropped, not reported as
 * zero. `stock_status` is the exception and sends `onbackorder: 0` because it is
 * a closed enum the API can enumerate.
 *
 * So docs/ADMIN_PANEL.md's rule — *render every value in a group, including
 * zero-count ones, so a selection never turns its siblings into dead ends* — is
 * a rule the panel has to keep, not one the API keeps for it. The vocabulary
 * comes from `/product-categories` and `/attributes/{id}/terms`, both of which
 * are unfiltered and both of which publish a `count`; the facet supplies the
 * narrowed count and this puts the two together.
 *
 * **The category facet does not exclude its own filter.** Measured: with
 * `?category=16` the category group collapses to `tapis=3` and `total_values: 1`
 * — the other five categories vanish. The attribute groups and `stock_status`
 * and `price` all behave as specified and *do* exclude their own filter
 * (`?attributes[pa_matiere]=laine` leaves the matiere group at its full five
 * values). Category is the one that does not, and rendering it from the facet
 * alone would produce exactly the dead end the rule is written to prevent: pick
 * a category and you can no longer see, or reach, any other.
 *
 * `count` therefore falls back to the vocabulary's own unfiltered count for the
 * group that is currently filtered, and to 0 for a value the facet dropped. The
 * caller says which case it is, because only the caller knows whether this
 * group's own filter is active.
 */
export function mergeFacet(
  vocabulary: readonly FilterOption[],
  reported: readonly FacetValue[] | undefined,
  options: {
    /**
     * True when this group's own filter is active *and* the API narrowed the
     * group by it anyway — i.e. the counts on screen would otherwise be a lie by
     * omission. Only `category` and `tag` are ever true here.
     */
    selfNarrowed: boolean;
    /**
     * How to read a facet value's key so it matches the vocabulary's `value`.
     *
     * Not optional, and not defaulted to `slug`, because defaulting it is the
     * bug this parameter exists to prevent. A facet value carries **both**
     * `slug` and `term_id`, and the two dimensions want different ones:
     * `?attributes[pa_matiere]=` matches term *slugs* while `?category=` matches
     * term *ids* — measured, `?category=tapis` is a 400 whose message is the
     * pattern `^$|^[0-9]+(,[0-9]+)*$`. Keying both by `slug` compiled, typed and
     * ran, and put a `0` beside all six categories in a shop where the API had
     * just reported 15, 3, 3, 3, 2 and 2. Nothing failed; the numbers were
     * simply wrong, and only the screenshot showed it.
     */
    keyOf: (value: FacetValue) => string;
  },
): FilterOption[] {
  const counts = new Map(
    (reported ?? []).map((v) => [options.keyOf(v), v.count]),
  );

  return vocabulary.map((option) => {
    const reportedCount = counts.get(option.value);

    if (reportedCount !== undefined) return { ...option, count: reportedCount };

    // Absent from the facet. Either it genuinely has none in the current result
    // set — zero, and rendering it as zero is the point — or the group was
    // narrowed by its own filter and the API never counted it, in which case the
    // honest number is the unfiltered one the vocabulary already carries.
    return { ...option, count: options.selfNarrowed ? option.count : 0 };
  });
}

/**
 * How each dimension's facet values are keyed back to its vocabulary. Named here
 * rather than written inline at each call site, so the id/slug distinction is
 * stated once.
 */
export const BY_TERM_ID = (value: FacetValue): string => String(value.term_id ?? "");
export const BY_SLUG = (value: FacetValue): string => value.slug;

/** `/product-categories` as a vocabulary, keyed by the term id `?category=` takes. */
export function categoryVocabulary(
  categories: readonly ProductCategory[],
): FilterOption[] {
  return categories.map((c) => ({
    value: String(c.id),
    label: c.name,
    count: c.count,
  }));
}

/** One attribute's terms as a vocabulary. `count` here is the unfiltered usage. */
export function termVocabulary(terms: readonly AttributeTerm[]): FilterOption[] {
  return terms.map((t) => ({ value: t.slug, label: t.name, count: t.count }));
}

/**
 * How many values a group *has*, for the "50 sur 128" line.
 *
 * `total_values` counts only the values with a non-zero count, so it is the
 * honest denominator for what the facet could have sent — and the vocabulary
 * length is the honest denominator for what the panel renders. They differ, and
 * the truncation notice is about the first.
 */
export function truncation(
  group: FacetGroup | AttributeFacetGroup | undefined,
): { shown: number; total: number } | null {
  if (!group?.truncated) return null;
  return { shown: group.values.length, total: group.total_values };
}

/* --------------------------------------------------------- product rows --- */

/**
 * What to print where a price goes.
 *
 * `price` is the effective figure and the API has already resolved it — a
 * variable product's `price` is its lowest variation's while its own
 * `regular_price` is `""`. A published product can also simply have no price:
 * measured on AC-SEO-NOPRICE, `price` and `regular_price` are both `""` and the
 * facet's `min` is `0.00` because WooCommerce's lookup table stores it as zero.
 *
 * Returning `null` rather than `"0"` keeps that distinction, because a product
 * priced at nothing and a product with no price are different problems and only
 * one of them is free.
 */
export function effectivePrice(product: Product): string | null {
  if (product.price !== "") return product.price;
  if (product.regular_price !== "") return product.regular_price;
  return null;
}

/** True when the row should show the regular price struck through beside the sale. */
export function isDiscounted(product: Product): boolean {
  return product.on_sale && product.sale_price !== "" && product.regular_price !== "";
}

/**
 * The stock line. `null` when the product does not manage stock at all, which is
 * 8 of 28 here — a quantity of "—" down a third of the list says nothing, and
 * `stock_status` already carries the part that matters.
 */
export function stockQuantity(product: Product): number | null {
  return product.manage_stock ? product.stock_quantity : null;
}

/**
 * A variable product's price span, for the row.
 *
 * Only meaningful when the variations disagree; `17 500 – 18 500` is worth the
 * space and `17 500 – 17 500` is not.
 */
export function priceSpan(
  prices: readonly string[],
): { min: string; max: string } | null {
  const numeric = prices
    .filter((p) => p !== "")
    .map((p) => ({ raw: p, n: Number(p) }))
    .filter((p) => Number.isFinite(p.n));

  if (numeric.length < 2) return null;

  let min = numeric[0];
  let max = numeric[0];
  for (const p of numeric) {
    if (p.n < min.n) min = p;
    if (p.n > max.n) max = p;
  }

  return min.n === max.n ? null : { min: min.raw, max: max.raw };
}

/**
 * A variation's identity, as the parent spells it.
 *
 * A variation stores its attribute values **lowercased**: the parent offers
 * `["S", "M", "L"]` and the variations come back `{"taille": "s"}`, `"m"`, `"l"`.
 * Printing the stored value puts a lowercase `s` in the variations section
 * directly under an attributes row reading `S, M, L` — the same product
 * disagreeing with itself two inches apart. A global attribute is worse: the
 * value is a term slug, so the row would read `bois-dolivier`.
 *
 * Resolved against the parent's own options case-insensitively, and against the
 * term list for a global attribute. Anything that resolves to neither is printed
 * as stored, because an unrecognised value is information rather than a reason to
 * render a blank.
 */
export function variationLabel(
  variation: Pick<Variation, "attributes">,
  product: Pick<Product, "attributes">,
  terms: ReadonlyMap<string, readonly AttributeTerm[]>,
): string[] {
  return Object.entries(variation.attributes).map(([name, value]) => {
    const parent = product.attributes.find(
      (a) => a.name.toLowerCase() === name.toLowerCase(),
    );

    if (parent && parent.id !== 0) {
      const vocabulary = terms.get(parent.name) ?? [];
      return vocabulary.find((t) => t.slug === value)?.name ?? value;
    }

    return (
      parent?.options.find((o) => o.toLowerCase() === value.toLowerCase()) ?? value
    );
  });
}

/**
 * The attributes worth showing on a detail screen, with the taxonomy resolved to
 * its label.
 *
 * A global attribute's `name` is the raw taxonomy (`pa_matiere`) and its
 * `options` are term *slugs* (`bois-dolivier`); a local one's are already human.
 * Printing the stored values would put `pa_matiere: bois-dolivier` in front of a
 * shopkeeper, so both are resolved where a resolution exists and left alone
 * where none does.
 */
export function describeAttribute(
  attribute: Product["attributes"][number],
  attributes: readonly GlobalAttribute[],
  terms: ReadonlyMap<string, readonly AttributeTerm[]>,
): { label: string; values: string[]; global: boolean } {
  const global = attribute.id !== 0;

  if (!global) {
    return { label: attribute.name, values: attribute.options, global: false };
  }

  const definition = attributes.find((a) => a.taxonomy === attribute.name);
  const vocabulary = terms.get(attribute.name) ?? [];

  return {
    label: definition?.name ?? attribute.name,
    values: attribute.options.map(
      (slug) => vocabulary.find((t) => t.slug === slug)?.name ?? slug,
    ),
    global: true,
  };
}
