"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type {
  AttributeTerm,
  Facets,
  GlobalAttribute,
  ProductCategory,
} from "@/lib/api/schemas/product";
import { STOCK_STATUSES } from "@/lib/product-status";
import {
  BY_SLUG,
  BY_TERM_ID,
  categoryVocabulary,
  mergeFacet,
  termVocabulary,
  truncation,
} from "@/lib/products";
import { formatMoney } from "@/lib/format/money";
import { Drawer } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Section, CheckRow, ChoiceGroup, NumberField } from "@/components/ui/Form";
import { Ltr } from "@/components/primitives/Ltr";
import type { ProductsQuery } from "./query";

/**
 * The filter drawer. See DESIGN.md §3.1 — filters are a `Drawer`'s job.
 *
 * **Nine dimensions do not fit a toolbar.** Status is `FilterTabs` and search is
 * the `SearchField`, both in the page header where a single decision belongs;
 * everything else is here, behind one button that carries the count. The
 * alternative the old screen used — a scrolling row of pills that all opened the
 * same sheet — spent a whole row of chrome to say what one button and a badge
 * say.
 *
 * ## The draft, which is the best thing about the screen this replaces
 *
 * Edits stage in local state and commit on **Apply**. Live-applying each toggle
 * would push a history entry per tap and refetch on every one of them: seven
 * groups is easily a dozen taps to express one intent, and reads are 600/min per
 * credential shared across every tab this person has open. One intent, one
 * history entry, one request.
 *
 * The draft is re-seeded from the URL each time the drawer opens, adjusted during
 * render rather than in an effect — an effect runs after paint, so a re-opened
 * drawer would show one frame of the previous session's abandoned edits.
 *
 * ## Every group is a vocabulary merged with counts, never a facet alone
 *
 * `lib/products.ts` carries the measurements. In one line: a facet omits its
 * zero-count values, and `category` does not exclude its own filter while the
 * attribute groups do. Rendering these from `meta.facets` would make selecting a
 * category delete every other category from the drawer, with the browser's back
 * button as the only way out.
 */
export function ProductFilters({
  open,
  onOpenChange,
  locale,
  query,
  facets,
  categories,
  attributes,
  terms,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
  query: ProductsQuery;
  facets: Facets | null;
  categories: readonly ProductCategory[];
  attributes: readonly GlobalAttribute[];
  terms: Record<string, AttributeTerm[]>;
  onApply: (next: ProductsQuery) => void;
}) {
  const t = useTranslations("products");
  const tStock = useTranslations("stockStatus");

  const [draft, setDraft] = useState<ProductsQuery>(query);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(query);
  }

  const patch = (next: Partial<ProductsQuery>) =>
    setDraft((current) => ({ ...current, ...next }));

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
    return <Ltr numeric={false}>{t("truncated", { shown: cut.shown, total: cut.total })}</Ltr>;
  };

  /* ----------------------------------------------------------- category --- */
  const categoryOptions = mergeFacet(
    categoryVocabulary(categories),
    facets?.category?.values,
    {
      // Measured: with `?category=16` the category facet collapses to that one
      // value and drops the other five. It does *not* exclude its own filter, so
      // the counts for the unselected values would be missing rather than zero.
      selfNarrowed: query.category !== "",
      // Term ids, because `?category=` takes ids and `?category=tapis` is a 400.
      keyOf: BY_TERM_ID,
    },
  );

  /* -------------------------------------------------------------- stock --- */
  // The one group the API enumerates completely on its own: `stock_status`
  // arrives with all three values including `onbackorder: 0`, because it is a
  // closed enum rather than a taxonomy.
  const stockReported = new Map(
    (facets?.stock_status ?? []).map((value) => [value.value, value.count]),
  );

  const tagValues = facets?.tag?.values ?? [];

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={t("filtersTitle")}
      size="md"
      footer={
        <>
          {/* Clear first in DOM order, so it is the first tab stop and, on a
              phone, the lower of the two — `flex-col-reverse` puts Apply on top
              where the thumb is not. It clears this drawer's own dimensions and
              leaves the search term and the status tab alone: those are visible
              controls elsewhere on the screen, and a button inside a panel that
              silently reaches outside it is a button nobody trusts twice. */}
          <Button
            variant="secondary"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                category: "",
                tag: "",
                minPrice: "",
                maxPrice: "",
                stockStatus: "",
                onSale: "",
                featured: "",
                attributes: {},
              }))
            }
          >
            {t("clearFilters")}
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              onApply(draft);
            }}
          >
            {t("apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Section
          title={t("filter.category")}
          footnote={truncationNote(facets?.category)}
        >
          {categoryOptions.map((option) => (
            <CheckRow
              key={option.value}
              label={option.label}
              count={option.count}
              checked={draft.category.split(",").includes(option.value)}
              onChange={() => patch({ category: toggleIn(draft.category, option.value) })}
            />
          ))}
        </Section>

        <Section title={t("filter.stock")}>
          {/* Single-select, because `?stock_status=` takes one value. A radio
              group rather than checkboxes that pretend otherwise — and "all" is
              a real option rather than an absence, because a radio cannot be
              unchecked by clicking it again. */}
          <ChoiceGroup
            label={t("filter.stock")}
            value={draft.stockStatus}
            onChange={(next) => patch({ stockStatus: next })}
            options={[
              { value: "", label: t("all") },
              ...STOCK_STATUSES.map((value) => ({
                value,
                label: tStock(value),
                count: stockReported.get(value) ?? 0,
              })),
            ]}
          />
        </Section>

        {/*
          The price band. Two decimal fields rather than a two-handle slider: the
          catalogue spans 100 to 24 000 DA, so a slider's usable resolution at
          340px is about 70 DA per pixel and nobody can pick 5 000 with a thumb.
          The facet supplies the real bounds as the placeholders, so the fields
          say what the shop actually contains.
        */}
        <Section
          title={t("filter.price")}
          footnote={
            facets?.price ? (
              /*
                Through the panel's own money formatter, not `toLocaleString()`.
                The bare call takes the *runtime's* default locale, which
                rendered "De 0 à 24,000 DA" — an English thousands separator
                inside a French sentence, and the same string in Arabic.
                `formatMoney` is where `fr-DZ` and the shop's symbol already live.
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
          <div className="flex flex-wrap gap-3">
            <NumberField
              label={t("filter.minPrice")}
              value={draft.minPrice}
              onChange={(value) => patch({ minPrice: value })}
              placeholder={facets?.price?.min}
            />
            <NumberField
              label={t("filter.maxPrice")}
              value={draft.maxPrice}
              onChange={(value) => patch({ maxPrice: value })}
              placeholder={facets?.price?.max}
            />
          </div>
        </Section>

        <Section title={t("filter.flags")}>
          {/* No counts: neither flag is a facet the API offers, and inventing one
              from the page in hand would be a number computed over 20 rows and
              presented as though it covered 28. */}
          <CheckRow
            label={t("filter.onSale")}
            count={null}
            checked={draft.onSale === "true"}
            onChange={(next) => patch({ onSale: next ? "true" : "" })}
          />
          <CheckRow
            label={t("filter.featured")}
            count={null}
            checked={draft.featured === "true"}
            onChange={(next) => patch({ featured: next ? "true" : "" })}
          />
        </Section>

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
            (candidate) => candidate.taxonomy === attribute.taxonomy,
          );
          const vocabulary = termVocabulary(terms[attribute.taxonomy] ?? []);
          if (vocabulary.length === 0) return null;

          const options = mergeFacet(vocabulary, group?.values, {
            selfNarrowed: false,
            // Term slugs, because `?attributes[pa_matiere]=laine` matches slugs.
            keyOf: BY_SLUG,
          });
          const selected = (draft.attributes[attribute.taxonomy] ?? "").split(",");

          return (
            <Section
              key={attribute.taxonomy}
              title={attribute.name}
              footnote={truncationNote(group)}
            >
              {options.map((option) => (
                <CheckRow
                  key={option.value}
                  label={option.label}
                  count={option.count}
                  checked={selected.includes(option.value)}
                  onChange={() =>
                    patch({
                      attributes: {
                        ...draft.attributes,
                        [attribute.taxonomy]: toggleIn(
                          draft.attributes[attribute.taxonomy] ?? "",
                          option.value,
                        ),
                      },
                    })
                  }
                />
              ))}
            </Section>
          );
        })}

        {/*
          Tags exist as a filter and this shop has none — measured, all 28
          products carry `tag_ids: []` and the tag facet is
          `{values: [], total_values: 0}`. The group renders only when there is
          something in it, rather than as an empty box that reads as a loading
          failure.
        */}
        {tagValues.length > 0 ? (
          <Section title={t("filter.tag")} footnote={truncationNote(facets?.tag)}>
            {tagValues.map((value) => (
              <CheckRow
                key={value.slug}
                label={value.name}
                count={value.count}
                checked={draft.tag.split(",").includes(String(value.term_id ?? ""))}
                onChange={() =>
                  patch({ tag: toggleIn(draft.tag, String(value.term_id ?? "")) })
                }
              />
            ))}
          </Section>
        ) : null}

        {/*
          The scope note, in the API's own words, at the foot of the drawer.
          docs/ADMIN_PANEL.md is explicit that without it a list of seven rows
          beside a count of six reads as a bug and gets "fixed" into something
          wrong. Measured here: 28 products, 27 published, so every count above is
          out of 27 while the list shows 28.
        */}
        {facets ? (
          <p className="text-ui-label text-ui-subtle">
            {/*
              Localised from `scope`, which is the machine-readable half, and
              falling back to the API's own `scope_note` for a scope this panel
              has no wording for. Rendering the raw note always would put an
              English sentence at the foot of an Arabic drawer; ignoring `scope`
              and hard-coding the French would make the panel lie the day the API
              starts counting drafts.
            */}
            {t.has(`scopeNote.${facets.scope}`)
              ? t(`scopeNote.${facets.scope}`)
              : facets.scope_note}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}
