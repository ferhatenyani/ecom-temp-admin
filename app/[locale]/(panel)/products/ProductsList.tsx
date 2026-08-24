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
import {
  DEFAULT_SORT_KEY,
  PRODUCT_STATUSES,
  sortFromKey,
  sortKey,
} from "@/lib/product-status";
import { useOnline } from "@/lib/use-online";
import { downloadCsv } from "@/lib/csv";
import { formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import {
  DataTable,
  TableFooter,
  TableControls,
  useTablePreferences,
  type SortState,
} from "@/components/ui/DataTable";
import { FilterTabs, SearchField, FilterChips, FilterRow } from "@/components/ui/FilterBar";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { TableSkeleton, RecordListSkeleton } from "@/components/ui/Skeleton";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { CountBadge } from "@/components/ui/Badge";
import { Menu } from "@/components/ui/Menu";
import { Isolate } from "@/components/primitives/Ltr";
import { buildColumns, productRecord, type ProductColumnContext } from "./columns";
import { ProductFilters } from "./ProductFilters";
import { ProductPeek } from "./ProductPeek";
import { toCsv } from "./export";
import {
  EMPTY_QUERY,
  drawerFilterCount,
  fetchProducts,
  isFiltered,
  productsKey,
  queryFromParams,
  toUrlParams,
  type ProductsQuery,
} from "./query";

/**
 * The products list, rebuilt on the new design system.
 *
 * ## Sorting ships here, and it is the one screen in the run where it does
 *
 * The orders list carries no sortable columns on purpose: this API has a measured
 * history of accepting `orderby` and silently ignoring it. On `/products` that
 * was **repaired** — `ProductRepository::orderingClause()` — and exactly five
 * combinations were re-measured as working, which is what `SORTS` in
 * `lib/product-status.ts` is. The column headers offer those five and no more;
 * `columns.tsx` carries the per-column evidence and the reason the name header
 * never reaches descending.
 *
 * ## What is deliberately absent
 *
 * **No bulk writes.** Selection exports and does nothing else. `POST
 * /products/bulk` appears once, as a bare word in a shorthand list, with no verb,
 * body or response shape and nothing measured — and `lib/api/allowlist.ts` plus
 * `tests/boundary.test.ts` both assert it stays unreachable. See `export.ts`.
 *
 * **No separate SKU box.** `search` already matches SKUs; the parameter still
 * works, and `query.ts` says why it is kept.
 *
 * **No `trash` tab.** `?status=trash` is a 400. A trashed product still *reads*
 * back with a 200, which is why the schema accepts the status and the detail
 * screen renders it — but it is not a filter.
 */
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
  const tA11y = useTranslations("a11y");
  const tUi = useTranslations("ui");
  const tStates = useTranslations("states");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(initialQuery.perPage);
  const [filtersOpen, setFiltersOpen] = useState(false);

  /* Filters and the sort come from the URL; page and per-page from state. The
     split is the orders list's, and `query.ts` records why this screen adopted
     it rather than keeping its own page-in-URL. */
  const filters = useMemo(
    () => queryFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const query: ProductsQuery = { ...filters, page, perPage };
  const peekId = searchParams.get("peek");

  /*
   * The fifth state. When the browser is certain it is offline, the rows on
   * screen are as old as the last successful fetch, and staleness is never
   * silent. `navigator.onLine` is only trusted in this direction — it reports the
   * interface rather than reachability, which is why `refetch` below stays
   * enabled: a van's phone holding one bar reports itself online and a warehouse
   * basement reports itself offline, and only one of those is worth blocking.
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
    /* Keeps the previous page on screen while the next loads, so changing a
       filter never flashes a skeleton over content that is still valid. */
    placeholderData: keepPreviousData,
  });

  const products = data?.products ?? [];
  const total = data?.total ?? 0;
  const facets = data?.facets ?? initialFacets;
  const currency = facets?.price?.currency ?? "DZD";
  const filtered = isFiltered(query);

  /*
   * Not wrapped in `useCallback`. The React Compiler is on in this project and
   * memoizes this already; a manual `useCallback` listing its own dependencies
   * and disagreeing with the compiler's inference makes it skip optimising the
   * whole component rather than trust either list.
   */
  function commit(next: ProductsQuery) {
    const params = toUrlParams(next);
    setPage(1);
    /**
     * `push`, not `replace`. Filter state living in the URL is only half the
     * promise; the other half is that the back button works, and `replace`
     * overwrites the current entry so going back from a filtered catalogue skips
     * the unfiltered one. Both this suite and the orders one assert it.
     *
     * `peek` is dropped rather than carried: the previewed row may not survive
     * the new filter, and a drawer describing a product that is no longer in the
     * list is worse than a closed drawer.
     */
    router.push(`/${locale}/products${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  /* The peek target lives in the URL, so a preview is shareable and the back
     button closes it — but it must not reset the page, so it writes the params
     directly rather than through `commit`. */
  function setPeek(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("peek", id);
    else params.delete("peek");
    router.push(`/${locale}/products${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

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

  const ctx: ProductColumnContext = useMemo(
    () => ({
      locale,
      currency,
      categoryName,
      t,
      tStatus,
      tStock,
      inStock: (count: number) => t("inStock", { count }),
      /* Falls back to the stored value: `type` is `z.string()` on the schema and
         an unrecognised one is information, not a reason to render a blank. */
      typeLabel: (type: string) => (t.has(`type.${type}`) ? t(`type.${type}`) : type),
    }),
    [locale, currency, categoryName, t, tStatus, tStock],
  );
  const columns = useMemo(() => buildColumns(ctx), [ctx]);

  /* Held here rather than inside DataTable so the controls can live in the
     toolbar beside the search field, where they belong, instead of floating
     above the card. */
  const preferences = useTablePreferences("products", columns);

  /* Resolved against the page already in memory — `GET /products/{id}` returns
     the same object as the list row, so opening a preview costs no request. */
  const peeked = peekId
    ? (products.find((p) => String(p.id) === peekId) ?? null)
    : null;

  /* Four statuses plus All. `trash` is absent because `?status=trash` is a 400. */
  const tabs = [
    { value: "", label: t("all") },
    ...PRODUCT_STATUSES.map((status) => ({ value: status as string, label: tStatus(status) })),
  ];

  /**
   * The chips: one per **value**, not one per group.
   *
   * Two categories selected is two chips, because each has to be removable on its
   * own. A single chip reading "Catégorie : Tapis, Épicerie" cannot be dismissed
   * by half, and truncating it hides which values are active — which is the one
   * thing the chip row exists to show.
   */
  const chips = useMemo(() => {
    const out: { key: string; label: string; onRemove: () => void }[] = [];
    const chip = (label: string, value: string) => t("chipValue", { label, value });
    const drop = (patch: Partial<ProductsQuery>) => () => commit({ ...query, ...patch });

    if (filters.search !== "") {
      out.push({
        key: "search",
        label: chip(t("filter.search"), filters.search),
        onRemove: drop({ search: "" }),
      });
    }
    if (filters.sku !== "") {
      out.push({
        key: "sku",
        label: chip(t("filter.sku"), filters.sku),
        onRemove: drop({ sku: "" }),
      });
    }
    if (filters.status !== "") {
      out.push({
        key: "status",
        label: chip(t("filter.status"), tStatus(filters.status)),
        onRemove: drop({ status: "" }),
      });
    }
    for (const id of filters.category.split(",").filter(Boolean)) {
      out.push({
        key: `category-${id}`,
        label: chip(t("filter.category"), categoryName.get(id) ?? id),
        onRemove: drop({
          category: filters.category.split(",").filter((c) => c !== id).join(","),
        }),
      });
    }
    if (filters.stockStatus !== "") {
      out.push({
        key: "stock",
        label: chip(t("filter.stock"), tStock(filters.stockStatus)),
        onRemove: drop({ stockStatus: "" }),
      });
    }
    if (filters.minPrice !== "" || filters.maxPrice !== "") {
      out.push({
        key: "price",
        label: chip(
          t("filter.price"),
          filters.minPrice !== "" && filters.maxPrice !== ""
            ? `${filters.minPrice} – ${filters.maxPrice}`
            : filters.minPrice !== ""
              ? `≥ ${filters.minPrice}`
              : `≤ ${filters.maxPrice}`,
        ),
        onRemove: drop({ minPrice: "", maxPrice: "" }),
      });
    }
    if (filters.onSale === "true") {
      out.push({
        key: "on-sale",
        label: t("filter.onSale"),
        onRemove: drop({ onSale: "" }),
      });
    }
    if (filters.featured === "true") {
      out.push({
        key: "featured",
        label: t("filter.featured"),
        onRemove: drop({ featured: "" }),
      });
    }
    for (const [taxonomy, slugs] of Object.entries(filters.attributes)) {
      const label = attributes.find((a) => a.taxonomy === taxonomy)?.name ?? taxonomy;
      for (const slug of slugs.split(",").filter(Boolean)) {
        out.push({
          key: `${taxonomy}-${slug}`,
          label: chip(label, termName.get(`${taxonomy}:${slug}`) ?? slug),
          onRemove: () => {
            const rest = slugs.split(",").filter((s) => s !== slug).join(",");
            const next = { ...filters.attributes };
            if (rest === "") delete next[taxonomy];
            else next[taxonomy] = rest;
            commit({ ...query, attributes: next });
          },
        });
      }
    }
    for (const id of filters.tag.split(",").filter(Boolean)) {
      out.push({
        key: `tag-${id}`,
        label: chip(t("filter.tag"), id),
        onRemove: drop({
          tag: filters.tag.split(",").filter((c) => c !== id).join(","),
        }),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, query, categoryName, termName, attributes, t, tStatus, tStock]);

  /* The sort survives a clear. It is not a chip and not a filter — a person who
     set "prix croissant" and then cleared their filters wanted the unfiltered
     catalogue in that order, not the default one. */
  const clearAll = () => commit({ ...EMPTY_QUERY, sort: filters.sort, perPage });

  const sort = sortFromKey(filters.sort);
  const sortState: SortState = { key: sort.orderby, direction: sort.order };

  const offlineReason = tStates("offlineWrites");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={<Isolate>{t("count", { total })}</Isolate>}
        actions={
          <>
            <IconButton
              label={t("refresh")}
              icon="refresh"
              variant="secondary"
              onClick={() => void refetch()}
              loading={isFetching}
            />
            {/* A real link, so the browser performs the download and the
                credential is attached server-side — never in the document. Its
                capability is `ac_manage_products`, the same one that gates the
                whole screen, so there is no second gate to apply here.

                Disabled while the browser reports itself offline: this one
                genuinely leaves the page, and a navigation to a route that
                cannot answer replaces the panel with the browser's own error
                page. The selection export beside it keeps working, because it is
                built from rows already in memory. */}
            <ButtonLink
              href={`/api/export/products`}
              variant="secondary"
              icon="download"
              prefetch={false}
              disabled={!online}
              title={online ? undefined : offlineReason}
            >
              {t("export")}
            </ButtonLink>
          </>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            <FilterTabs
              tabs={tabs}
              value={filters.status}
              onChange={(next) => commit({ ...query, status: next })}
              label={t("filter.status")}
            />
            <FilterRow>
              <SearchField
                value={filters.search}
                onSubmit={(next) => commit({ ...query, search: next })}
                placeholder={t("searchPlaceholder")}
                label={t("searchLabel")}
                clearLabel={t("clearSearch")}
              />
              {/* One button for the seven dimensions that do not fit a toolbar,
                  carrying the count so a filter set on another visit is never
                  invisible.

                  The label hides below `sm`, the way the table controls beside it
                  do: measured at 340px, three labelled buttons in this row left
                  the search field 55px wide — narrower than the word "Nom" it is
                  meant to hold. The count stays visible at every width, because
                  it is the part that cannot be inferred from the icon, and the
                  `aria-label` is what keeps the button named once the word is
                  gone. */}
              <Button
                variant="secondary"
                size="sm"
                icon="filter"
                aria-label={t("filters")}
                onClick={() => setFiltersOpen(true)}
              >
                <span className="hidden sm:inline">{t("filters")}</span>
                {drawerFilterCount(query) > 0 ? (
                  <CountBadge>{drawerFilterCount(query)}</CountBadge>
                ) : null}
              </Button>
              <div className="ms-auto">
                <TableControls
                  columns={columns}
                  visible={preferences.visible}
                  onVisibleChange={preferences.setVisible}
                  density={preferences.density}
                  onDensityChange={preferences.setDensity}
                />
              </div>
            </FilterRow>
            {chips.length > 0 ? (
              <FilterChips chips={chips} onClearAll={clearAll} />
            ) : null}
          </div>
        }
      />

      <PageBody width="full">
        {!online && dataUpdatedAt > 0 ? (
          <StaleBanner
            time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)}
          />
        ) : null}

        {/* The count is a live region: a filter that changes the result count
            must announce it, or a screen-reader user has no idea it worked. */}
        <p aria-live="polite" className="sr-only" data-testid="products-count">
          {tA11y("listUpdated", { total })}
        </p>

        {isPending && products.length === 0 ? (
          <>
            <div className="hidden md:block">
              <TableSkeleton rows={8} cols={6} label={t("loading")} />
            </div>
            {/* The card and its padding are `DataTable`'s below `md`, so the
                skeleton wears them too — otherwise the rows shift 8px inward the
                moment the data lands. */}
            <div className="ui-card p-2 md:hidden">
              <RecordListSkeleton rows={6} label={t("loading")} />
            </div>
          </>
        ) : isError ? (
          <ErrorState
            message={(error as Error).message}
            onRetry={() => void refetch()}
          />
        ) : products.length === 0 ? (
          <EmptyState
            icon={filtered ? "search" : "products"}
            message={filtered ? t("empty.noResults") : t("empty.noneYet")}
            /* No-results offers to clear the filter. No-data offers nothing, and
               that is correct rather than unfinished: `POST /products` is not on
               the proxy allowlist and no screen in this panel creates a product,
               so a "New product" button here would be a button that 404s. */
            action={filtered ? { label: t("empty.clear"), onClick: clearAll } : undefined}
          />
        ) : (
          <DataTable
            preferences={preferences}
            rows={products}
            columns={columns}
            rowKey={(product) => String(product.id)}
            rowLabel={(product) => tA11y("productName", { name: product.name })}
            record={(product) => productRecord(product, ctx)}
            onRowClick={(product) => setPeek(String(product.id))}
            sort={sortState}
            onSortChange={(next) => {
              /* Round-tripped through `sortFromKey`, which is the guard that
                 keeps this to the five measured combinations: anything else —
                 `title desc` above all — resolves to the default rather than
                 being sent as a sort that answers 200 and does nothing. */
              const key = next === null ? DEFAULT_SORT_KEY : `${next.key}-${next.direction}`;
              commit({ ...query, sort: sortKey(sortFromKey(key)) });
            }}
            selectable
            selectionActions={(selected) => (
              <Button
                variant="secondary"
                size="sm"
                icon="download"
                onClick={() => {
                  const chosen = products.filter((p) => selected.includes(String(p.id)));
                  downloadCsv(
                    toCsv(chosen, ctx, {
                      name: t("columns.name"),
                      status: t("columns.status"),
                      stock: t("columns.stock"),
                      price: t("columns.price"),
                    }),
                    `products-${selected.length}.csv`,
                  );
                }}
              >
                {t("exportSelected")}
              </Button>
            )}
            rowActions={(product) => (
              <Menu
                label={tA11y("productName", { name: product.name })}
                trigger={
                  <IconButton
                    label={tUi("table.actions")}
                    icon="more"
                    size="sm"
                    variant="ghost"
                  />
                }
                actions={[
                  {
                    key: "open",
                    label: t("openFull"),
                    icon: "external",
                    href: `/${locale}/products/${product.id}`,
                  },
                  {
                    key: "peek",
                    label: t("preview"),
                    icon: "search",
                    onSelect: () => setPeek(String(product.id)),
                  },
                  {
                    key: "copy",
                    label: t("copySku"),
                    icon: "note",
                    /* Disabled rather than hidden when there is nothing to copy,
                       and the hint says which — a menu whose items move between
                       rows is a menu nobody learns. */
                    disabled: product.sku === "",
                    hint: product.sku === "" ? t("noSku") : undefined,
                    onSelect: () => {
                      void navigator.clipboard?.writeText(product.sku);
                    },
                  },
                ]}
              />
            )}
            footer={
              <TableFooter
                page={page}
                perPage={perPage}
                total={total}
                onPageChange={setPage}
                onPerPageChange={(next) => {
                  setPerPage(next);
                  setPage(1);
                }}
              />
            }
          />
        )}
      </PageBody>

      <ProductFilters
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        locale={locale}
        query={query}
        facets={facets}
        categories={categories}
        attributes={attributes}
        terms={terms}
        onApply={commit}
      />

      <ProductPeek
        product={peeked}
        ctx={ctx}
        onOpenChange={(next) => {
          if (!next) setPeek(null);
        }}
      />
    </div>
  );
}
