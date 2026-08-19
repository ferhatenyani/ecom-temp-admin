"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  AttributeTerm,
  Facets,
  GlobalAttribute,
  Product,
  ProductCategory,
} from "@/lib/api/schemas/product";
import { SORTS, sortFromKey, sortKey } from "@/lib/product-status";
import { Scaffold } from "@/components/patterns/Scaffold";
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  StaleBanner,
} from "@/components/patterns/States";
import {
  FilterAllPill,
  FilterChips,
  FilterPill,
  FilterPills,
  FilterSheet,
} from "@/components/patterns/FilterSheet";
import { ListGroup, ListLinkRow } from "@/components/primitives/GroupedList";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { ProductRow } from "./ProductRow";
import { FacetGroups } from "./Facets";
import {
  EMPTY_QUERY,
  PER_PAGE,
  fetchProducts,
  isFiltered,
  productsKey,
  queryFromParams,
  toUrlParams,
  type ProductsQuery,
} from "./query";

export function ProductsList({
  locale,
  initialQuery,
  initialProducts,
  initialTotal,
  initialFacets,
  categories,
  attributes,
  terms,
}: {
  locale: string;
  initialQuery: ProductsQuery;
  initialProducts: Product[] | null;
  initialTotal: number | null;
  initialFacets: Facets | null;
  categories: ProductCategory[];
  attributes: GlobalAttribute[];
  terms: Record<string, AttributeTerm[]>;
}) {
  const t = useTranslations("products");
  const tStatus = useTranslations("productStatus");
  const tStock = useTranslations("stockStatus");
  const tSort = useTranslations("productSort");
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = queryFromParams(new URLSearchParams(searchParams.toString()));
  const [searchDraft, setSearchDraft] = useState(query.search);
  const [sheetOpen, setSheetOpen] = useState(false);

  /**
   * The sheet edits a **draft**, and applies on demand.
   *
   * Live-applying each toggle inside a sheet would push a history entry per tap
   * and refetch on every one of them: nine groups is easily a dozen taps to
   * express one intent, and reads are 600/min per credential shared across every
   * tab this person has open. The pills outside the sheet apply immediately —
   * those are single decisions.
   */
  const [draft, setDraft] = useState<ProductsQuery>(query);

  const commit = (next: ProductsQuery, options: { resetPage?: boolean } = {}) => {
    const target = { ...next, page: options.resetPage === false ? next.page : 1 };
    const params = toUrlParams(target);
    /**
     * `push`, not `replace`. Filter state living in the URL is only half the
     * promise; the other half is that the back button works, and `replace`
     * overwrites the current entry so going back from a filtered catalogue skips
     * the unfiltered one. The orders branch has an e2e test asserting exactly
     * this, and so does this one.
     */
    router.push(`/${locale}/products${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  };

  /*
   * The fifth state. `StaleBanner` has existed since the shell branch and had
   * never been rendered — Part VI owns the service worker and the offline cache,
   * and until it lands there is nothing cached to be stale. There is still
   * something honest to say now: when the browser is certain it is offline, the
   * rows on screen are as old as the last successful fetch, and Part V's rule is
   * that staleness is never silent.
   *
   * Part VI generalises this — the orders list needs it too — which is why the
   * hook lives in `lib/` rather than beside this screen.
   */
  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: productsKey(query),
    queryFn: () => fetchProducts(query),
    // Nothing here polls. Only the orders list and the campaign-send progress do,
    // and a catalogue does not change under a person the way an order book does.
    initialData:
      initialProducts !== null &&
      productsKey(query)[1] === productsKey(initialQuery)[1]
        ? {
            products: initialProducts,
            total: initialTotal ?? initialProducts.length,
            facets: initialFacets,
          }
        : undefined,
    placeholderData: keepPreviousData,
  });

  const products = data?.products ?? [];
  const total = data?.total ?? 0;
  const facets = data?.facets ?? initialFacets;
  const currency = facets?.price?.currency ?? "DZD";
  const filtered = isFiltered(query);

  /* ------------------------------------------------------------- labels --- */

  const categoryName = useMemo(
    () => new Map(categories.map((c) => [String(c.id), c.name])),
    [categories],
  );
  const termName = useMemo(() => {
    const map = new Map<string, string>();
    for (const [taxonomy, list] of Object.entries(terms)) {
      for (const term of list) map.set(`${taxonomy}:${term.slug}`, term.name);
    }
    return map;
  }, [terms]);

  /**
   * The chips: one per *value*, not one per group.
   *
   * Two categories selected is two chips, because each has to be removable on
   * its own. A single chip reading "Catégorie : Tapis, Épicerie" cannot be
   * dismissed by half, and truncating it hides which values are active — which
   * is the one thing the chip row exists to show.
   */
  const chips = useMemo(() => {
    const out: { key: string; label: string; value: string; onRemove: () => void }[] = [];
    const drop = (patch: Partial<ProductsQuery>) => () => commit({ ...query, ...patch });

    if (query.search !== "") {
      out.push({
        key: "search",
        label: t("filter.search"),
        value: query.search,
        onRemove: () => {
          setSearchDraft("");
          commit({ ...query, search: "" });
        },
      });
    }
    if (query.sku !== "") {
      out.push({ key: "sku", label: t("filter.sku"), value: query.sku, onRemove: drop({ sku: "" }) });
    }
    if (query.status !== "") {
      out.push({
        key: "status",
        label: t("filter.status"),
        value: tStatus(query.status),
        onRemove: drop({ status: "" }),
      });
    }
    for (const id of query.category.split(",").filter(Boolean)) {
      out.push({
        key: `category-${id}`,
        label: t("filter.category"),
        value: categoryName.get(id) ?? id,
        onRemove: drop({
          category: query.category.split(",").filter((c) => c !== id).join(","),
        }),
      });
    }
    if (query.stockStatus !== "") {
      out.push({
        key: "stock",
        label: t("filter.stock"),
        value: tStock(query.stockStatus),
        onRemove: drop({ stockStatus: "" }),
      });
    }
    if (query.minPrice !== "" || query.maxPrice !== "") {
      out.push({
        key: "price",
        label: t("filter.price"),
        value:
          query.minPrice !== "" && query.maxPrice !== ""
            ? `${query.minPrice} – ${query.maxPrice}`
            : query.minPrice !== ""
              ? `≥ ${query.minPrice}`
              : `≤ ${query.maxPrice}`,
        onRemove: drop({ minPrice: "", maxPrice: "" }),
      });
    }
    if (query.onSale === "true") {
      out.push({
        key: "on-sale",
        label: t("filter.flags"),
        value: t("filter.onSale"),
        onRemove: drop({ onSale: "" }),
      });
    }
    if (query.featured === "true") {
      out.push({
        key: "featured",
        label: t("filter.flags"),
        value: t("filter.featured"),
        onRemove: drop({ featured: "" }),
      });
    }
    for (const [taxonomy, slugs] of Object.entries(query.attributes)) {
      const label = attributes.find((a) => a.taxonomy === taxonomy)?.name ?? taxonomy;
      for (const slug of slugs.split(",").filter(Boolean)) {
        out.push({
          key: `${taxonomy}-${slug}`,
          label,
          value: termName.get(`${taxonomy}:${slug}`) ?? slug,
          onRemove: () => {
            const rest = slugs.split(",").filter((s) => s !== slug).join(",");
            const next = { ...query.attributes };
            if (rest === "") delete next[taxonomy];
            else next[taxonomy] = rest;
            commit({ ...query, attributes: next });
          },
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, categoryName, termName, attributes, t, tStatus, tStock]);

  const sort = sortFromKey(query.sort);
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <Scaffold
      title={t("title")}
      trailing={
        <button
          type="button"
          onClick={() => void refetch()}
          aria-label={t("refresh")}
          className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
        >
          <Icon name="refresh" className={isFetching ? "size-5 spin" : "size-5"} />
        </button>
      }
      toolbar={
        <div className="flex flex-col gap-3">
          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              commit({ ...query, search: searchDraft.trim() });
            }}
            className="flex items-center gap-2 rounded-md bg-surface-2 px-3"
          >
            <Icon name="search" className="size-4 shrink-0 text-label-secondary" />
            <input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchLabel")}
              enterKeyHint="search"
              className="min-h-11 min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-tertiary"
            />
            {searchDraft ? (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft("");
                  commit({ ...query, search: "" });
                }}
                aria-label={t("clearSearch")}
                className="press flex size-8 items-center justify-center rounded-full text-label-secondary"
              >
                <Icon name="close" className="size-4" />
              </button>
            ) : null}
          </form>

          {/*
            The pill row. Every pill opens the same sheet — the sheet is where a
            multi-value group can actually be edited — while carrying its own
            state so a person can see what is set without opening anything.
          */}
          <FilterPills>
            <FilterAllPill
              count={chips.length}
              onClick={() => {
                setDraft(query);
                setSheetOpen(true);
              }}
            />
            <FilterPill
              label={t("filter.status")}
              value={query.status !== "" ? tStatus(query.status) : undefined}
              onClick={() => {
                setDraft(query);
                setSheetOpen(true);
              }}
            />
            <FilterPill
              label={t("filter.category")}
              value={
                query.category !== ""
                  ? query.category
                      .split(",")
                      .map((id) => categoryName.get(id) ?? id)
                      .join(", ")
                  : undefined
              }
              onClick={() => {
                setDraft(query);
                setSheetOpen(true);
              }}
            />
            <FilterPill
              label={t("filter.stock")}
              value={query.stockStatus !== "" ? tStock(query.stockStatus) : undefined}
              onClick={() => {
                setDraft(query);
                setSheetOpen(true);
              }}
            />
            <FilterPill
              label={t("filter.price")}
              value={
                query.minPrice !== "" || query.maxPrice !== ""
                  ? `${query.minPrice || "…"} – ${query.maxPrice || "…"}`
                  : undefined
              }
              onClick={() => {
                setDraft(query);
                setSheetOpen(true);
              }}
            />
            {attributes.map((attribute) => (
              <FilterPill
                key={attribute.taxonomy}
                label={attribute.name}
                value={
                  query.attributes[attribute.taxonomy]
                    ? query.attributes[attribute.taxonomy]
                        .split(",")
                        .map((slug) => termName.get(`${attribute.taxonomy}:${slug}`) ?? slug)
                        .join(", ")
                    : undefined
                }
                onClick={() => {
                  setDraft(query);
                  setSheetOpen(true);
                }}
              />
            ))}
            <FilterPill
              label={t("filter.sort")}
              value={tSort(sortKey(sort))}
              onClick={() => {
                setDraft(query);
                setSheetOpen(true);
              }}
            />
          </FilterPills>
        </div>
      }
    >
      {/* `StaleBanner` carries its own `mx-4`, so it goes in a wrapper without
          padding — inside the padded column below it would sit 32px in and step
          out of line with every row under it. */}
      {!online && dataUpdatedAt > 0 ? (
        <div className="mx-auto max-w-3xl">
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
        </div>
      ) : null}

      <div className="mx-auto max-w-3xl px-4">
        {chips.length > 0 ? (
          /* The sort survives a clear. It is not a chip and not a filter — a
             person who set "prix croissant" and then cleared their filters wanted
             the unfiltered catalogue in that order, not the default one. The
             sheet's own "Tout effacer" keeps it too. */
          <FilterChips
            chips={chips}
            onClearAll={() => commit({ ...EMPTY_QUERY, sort: query.sort })}
          />
        ) : null}

        <p
          aria-live="polite"
          className="mb-2 px-1 text-footnote text-label-secondary"
          data-testid="products-count"
        >
          <Isolate numeric>{t("count", { total })}</Isolate>
        </p>

        {isPending && products.length === 0 ? (
          <SkeletonRows />
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : products.length === 0 ? (
          <EmptyState
            message={filtered ? t("empty.noResults") : t("empty.noneYet")}
            action={
              filtered
                ? {
                    label: t("empty.clear"),
                    onClick: () => {
                      setSearchDraft("");
                      commit({ ...EMPTY_QUERY, sort: query.sort });
                    },
                  }
                : undefined
            }
          />
        ) : (
          <>
            <ListGroup>
              {products.map((product) => (
                <ListLinkRow
                  key={product.id}
                  href={`/${locale}/products/${product.id}`}
                  ariaLabel={product.name}
                >
                  <ProductRow product={product} locale={locale} currency={currency} />
                </ListLinkRow>
              ))}
            </ListGroup>

            {total > PER_PAGE ? (
              <nav className="mb-8 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={query.page <= 1}
                  onClick={() =>
                    commit({ ...query, page: Math.max(1, query.page - 1) }, { resetPage: false })
                  }
                  aria-label={t("previousPage")}
                  className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
                >
                  <Icon name="back" flipInRtl className="size-5" />
                </button>
                <span className="text-footnote text-label-secondary">
                  <Ltr numeric>
                    {query.page} / {pageCount}
                  </Ltr>
                </span>
                <button
                  type="button"
                  disabled={query.page >= pageCount}
                  onClick={() => commit({ ...query, page: query.page + 1 }, { resetPage: false })}
                  aria-label={t("nextPage")}
                  className="press min-h-11 rounded-md bg-surface px-4 text-body text-accent disabled:opacity-40"
                >
                  <Icon name="chevron" flipInRtl className="size-5" />
                </button>
              </nav>
            ) : null}
          </>
        )}
      </div>

      <FilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onApply={() => {
          setSheetOpen(false);
          commit(draft);
        }}
        onClear={() => setDraft({ ...EMPTY_QUERY, sort: draft.sort })}
      >
        <FacetGroups
          locale={locale}
          query={draft}
          facets={facets}
          categories={categories}
          attributes={attributes}
          terms={terms}
          onChange={(next) => setDraft((current) => ({ ...current, ...next }))}
        />

        {/* Sort lives in the sheet beside the filters: it is the same decision —
            "which of these do I want to see first" — and a separate control for
            it would be a second row of chrome above a phone-sized list. */}
        <section className="mb-6">
          <h3 className="mb-2 text-headline text-label">{t("filter.sort")}</h3>
          <div className="overflow-hidden rounded-lg bg-surface">
            {SORTS.map((option) => {
              const key = sortKey(option);
              const selected = draft.sort === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setDraft((current) => ({ ...current, sort: key }))}
                  className="list-row press-row flex min-h-11 w-full items-center gap-3 px-4 py-3 text-start"
                >
                  <span className="min-w-0 flex-1 text-body text-label">
                    {tSort(key)}
                  </span>
                  {selected ? (
                    <Icon name="check" className="size-5 shrink-0 text-accent" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      </FilterSheet>
    </Scaffold>
  );
}
