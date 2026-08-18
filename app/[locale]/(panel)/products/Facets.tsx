"use client";

import { useTranslations } from "next-intl";
import type {
  AttributeTerm,
  Facets,
  GlobalAttribute,
  ProductCategory,
} from "@/lib/api/schemas/product";
import { PRODUCT_STATUSES, STOCK_STATUSES } from "@/lib/product-status";
import {
  BY_SLUG,
  BY_TERM_ID,
  categoryVocabulary,
  mergeFacet,
  termVocabulary,
  truncation,
} from "@/lib/products";
import { formatMoney } from "@/lib/format/money";
import { FilterGroup, FilterValue } from "@/components/patterns/FilterSheet";
import { DecimalField } from "@/components/primitives/Field";
import { Ltr } from "@/components/primitives/Ltr";
import type { ProductsQuery } from "./query";

/**
 * Every filter group, as rendered inside the sheet.
 *
 * Each group is built from a **vocabulary** merged with the facet's counts, never
 * from the facet alone — see `lib/products.ts` for why, with the measurements.
 */
export function FacetGroups({
  locale,
  query,
  facets,
  categories,
  attributes,
  terms,
  onChange,
}: {
  locale: string;
  query: ProductsQuery;
  facets: Facets | null;
  categories: readonly ProductCategory[];
  attributes: readonly GlobalAttribute[];
  terms: Record<string, AttributeTerm[]>;
  onChange: (next: Partial<ProductsQuery>) => void;
}) {
  const t = useTranslations("products");
  const tStatus = useTranslations("productStatus");
  const tStock = useTranslations("stockStatus");

  /** Toggle one value inside a comma-separated multi-select parameter. */
  const toggleIn = (current: string, value: string): string => {
    const set = new Set(current === "" ? [] : current.split(","));
    if (set.has(value)) set.delete(value);
    else set.add(value);
    return [...set].join(",");
  };

  const truncationNote = (group: Parameters<typeof truncation>[0]) => {
    const cut = truncation(group);
    if (!cut) return undefined;
    // "50 sur 128". A bounded list that does not say so reads as complete.
    return (
      <Ltr numeric={false}>{t("truncated", { shown: cut.shown, total: cut.total })}</Ltr>
    );
  };

  /* ------------------------------------------------------------- status --- */
  // No counts: `status` is not a facet the API offers, and inventing one from
  // the page in hand would be a number computed from 20 rows and presented as if
  // it covered 28.
  const statusOptions = PRODUCT_STATUSES.map((value) => ({
    value,
    label: tStatus(value),
  }));

  /* ----------------------------------------------------------- category --- */
  const categoryVocab = categoryVocabulary(categories);
  const categoryOptions = mergeFacet(categoryVocab, facets?.category?.values, {
    // Measured: with `?category=16` the category facet collapses to that one
    // value and drops the other five. It does *not* exclude its own filter, so
    // the counts for the unselected values would be missing rather than zero.
    selfNarrowed: query.category !== "",
    // Term ids, because `?category=` takes ids and `?category=tapis` is a 400.
    keyOf: BY_TERM_ID,
  });

  /* ---------------------------------------------------------------- tag --- */
  const tagValues = facets?.tag?.values ?? [];

  /* -------------------------------------------------------------- stock --- */
  // The one group the API enumerates completely on its own: `stock_status`
  // arrives with all three values including `onbackorder: 0`, because it is a
  // closed enum rather than a taxonomy.
  const stockReported = new Map(
    (facets?.stock_status ?? []).map((v) => [v.value, v.count]),
  );

  return (
    <>
      <FilterGroup title={t("filter.status")}>
        {statusOptions.map((option) => (
          <FilterValue
            key={option.value}
            label={option.label}
            count={null}
            selected={query.status === option.value}
            onToggle={() =>
              onChange({
                // Single-select, because `?status=` takes exactly one value.
                status: query.status === option.value ? "" : option.value,
              })
            }
          />
        ))}
      </FilterGroup>

      <FilterGroup
        title={t("filter.category")}
        footnote={truncationNote(facets?.category)}
      >
        {categoryOptions.map((option) => (
          <FilterValue
            key={option.value}
            label={option.label}
            count={option.count}
            selected={query.category.split(",").includes(option.value)}
            onToggle={() => onChange({ category: toggleIn(query.category, option.value) })}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={t("filter.stock")}>
        {STOCK_STATUSES.map((value) => (
          <FilterValue
            key={value}
            label={tStock(value)}
            count={stockReported.get(value) ?? 0}
            selected={query.stockStatus === value}
            onToggle={() =>
              onChange({ stockStatus: query.stockStatus === value ? "" : value })
            }
          />
        ))}
      </FilterGroup>

      {/*
        The price band. Two decimal fields rather than a two-handle slider: the
        catalogue spans 100 to 24 000 DA, so a slider's usable resolution at 390px
        is about 60 DA per pixel and nobody can pick 5 000 with a thumb. The facet
        supplies the real bounds as the placeholders, so the fields say what the
        shop actually contains.
      */}
      <FilterGroup
        title={t("filter.price")}
        footnote={
          facets?.price ? (
            /*
              Through the panel's own money formatter, not `toLocaleString()`.
              The bare call takes the *runtime's* default locale, which rendered
              "De 0 à 24,000 DA" — an English thousands separator inside a French
              sentence, and the same string in Arabic. `formatMoney` is where
              `fr-DZ` and the shop's symbol already live.
            */
            <Ltr numeric={false}>
              {t("priceRange", {
                min: formatMoney(facets.price.min, facets.price.currency, locale),
                max: formatMoney(facets.price.max, facets.price.currency, locale),
              })}
            </Ltr>
          ) : undefined
        }
      >
        <div className="w-full overflow-hidden rounded-lg bg-surface">
          <DecimalField
            label={t("filter.minPrice")}
            value={query.minPrice}
            onChange={(value) => onChange({ minPrice: value })}
            placeholder={facets?.price?.min}
          />
          <DecimalField
            label={t("filter.maxPrice")}
            value={query.maxPrice}
            onChange={(value) => onChange({ maxPrice: value })}
            placeholder={facets?.price?.max}
          />
        </div>
      </FilterGroup>

      <FilterGroup title={t("filter.flags")}>
        <FilterValue
          label={t("filter.onSale")}
          count={null}
          selected={query.onSale === "true"}
          onToggle={() => onChange({ onSale: query.onSale === "true" ? "" : "true" })}
        />
        <FilterValue
          label={t("filter.featured")}
          count={null}
          selected={query.featured === "true"}
          onToggle={() =>
            onChange({ featured: query.featured === "true" ? "" : "true" })
          }
        />
      </FilterGroup>

      {/*
        The attribute groups. Rendered from `/attributes/{id}/terms` — the
        complete vocabulary — with the facet supplying the counts. These *do*
        exclude their own filter: measured, `?attributes[pa_matiere]=laine`
        leaves the matiere group at all five of its counted values while the
        couleur group narrows to the three that match. So `selfNarrowed` is
        false here and a value the facet omits is genuinely zero.
      */}
      {attributes.map((attribute) => {
        const group = facets?.attributes?.groups.find(
          (g) => g.taxonomy === attribute.taxonomy,
        );
        const vocabulary = termVocabulary(terms[attribute.taxonomy] ?? []);
        if (vocabulary.length === 0) return null;

        const options = mergeFacet(vocabulary, group?.values, {
          selfNarrowed: false,
          // Term slugs, because `?attributes[pa_matiere]=laine` matches slugs.
          keyOf: BY_SLUG,
        });
        const selected = (query.attributes[attribute.taxonomy] ?? "").split(",");

        return (
          <FilterGroup
            key={attribute.taxonomy}
            title={attribute.name}
            footnote={truncationNote(group)}
          >
            {options.map((option) => (
              <FilterValue
                key={option.value}
                label={option.label}
                count={option.count}
                selected={selected.includes(option.value)}
                onToggle={() =>
                  onChange({
                    attributes: {
                      ...query.attributes,
                      [attribute.taxonomy]: toggleIn(
                        query.attributes[attribute.taxonomy] ?? "",
                        option.value,
                      ),
                    },
                  })
                }
              />
            ))}
          </FilterGroup>
        );
      })}

      {/*
        Tags exist as a filter and this shop has none — measured, all 28 products
        carry `tag_ids: []` and the tag facet is `{values: [], total_values: 0}`.
        The group is rendered only when there is something in it, rather than as
        an empty box that reads as a loading failure.
      */}
      {tagValues.length > 0 ? (
        <FilterGroup title={t("filter.tag")} footnote={truncationNote(facets?.tag)}>
          {tagValues.map((value) => (
            <FilterValue
              key={value.slug}
              label={value.name}
              count={value.count}
              selected={query.tag.split(",").includes(String(value.term_id ?? ""))}
              onToggle={() =>
                onChange({ tag: toggleIn(query.tag, String(value.term_id ?? "")) })
              }
            />
          ))}
        </FilterGroup>
      ) : null}

      {/*
        The scope note, in the API's own words, at the foot of the sheet.
        docs/ADMIN_PANEL.md is explicit that without it a list of seven rows
        beside a count of six reads as a bug and gets "fixed" into something
        wrong. Measured here: 28 products, 27 published, so every count in this
        sheet is out of 27 while the list shows 28.
      */}
      {facets ? (
        <p className="mt-2 mb-4 text-footnote text-label-secondary">
          {/*
            Localised from `scope`, which is the machine-readable half, and
            falling back to the API's own `scope_note` for a scope this panel has
            no wording for. Rendering the raw note always would put an English
            sentence at the foot of an Arabic sheet; ignoring `scope` and
            hard-coding the French would make the panel lie the day the API
            starts counting drafts.
          */}
          {t.has(`scopeNote.${facets.scope}`)
            ? t(`scopeNote.${facets.scope}`)
            : facets.scope_note}
        </p>
      ) : null}
    </>
  );
}
