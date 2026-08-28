"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PageRow } from "@/lib/api/schemas/cms";
import { acRead } from "@/lib/api/browser";
import { collidingPaths, STATUS_FILTERS, type StatusFilter } from "@/lib/cms";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { Isolate } from "@/components/primitives/Ltr";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ButtonLink, IconButton } from "@/components/ui/Button";
import { FilterTabs, FilterRow, SearchField } from "@/components/ui/FilterBar";
import { DataTable, TableControls, TableFooter, useTablePreferences } from "@/components/ui/DataTable";
import { TableSkeleton, RecordListSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { buildColumns, pageRecord, type PageColumnContext } from "./columns";
import {
  EMPTY_QUERY,
  isFiltered,
  listParams,
  pagesKey,
  queryFromParams,
  toUrlParams,
  type PagesQuery,
} from "./query";

type PagesPage = { pages: PageRow[]; total: number; excludedSystem: number };

async function fetchPages(query: PagesQuery): Promise<PagesPage> {
  const { data, total, meta } = await acRead<PageRow[]>(`/cms/pages?${listParams(query)}`);

  return {
    pages: data,
    total,
    excludedSystem: typeof meta.excluded_system === "number" ? meta.excluded_system : 0,
  };
}

/**
 * The Pages index.
 *
 * **This screen is why the backend grew a route.** `GET /cms/pages` did not
 * exist: §89 shipped `POST /cms/pages` and `GET, PATCH, DELETE
 * /cms/pages/{path}`, a complete write surface over a read surface that could
 * address one page and list none. So a content manager could edit any page whose
 * path they already knew and discover not one — and the failure was worse than
 * inconvenience, because a **draft** and a **path that does not exist** answer
 * the same 404 with the same message. `privacy-policy` on this install is a real
 * draft that answered "No page at that path." about a page sitting right there.
 *
 * The index resolves that: the page is in the list with `status: "draft"`, and
 * the screen knows to read it with `?status=any`.
 *
 * ## No peek drawer
 *
 * `GET /cms/pages/{path}` returns the row **plus `content`, `excerpt` and the
 * whole resolved `seo` block** — `lib/api/schemas/cms.ts` measures the index as
 * deliberately less than a page, and the backend asserts the omission so it
 * cannot drift back. A preview is free only where the two are the same object
 * (orders, products, payments); here it would spend a request to show a page
 * body in a 520px drawer, which is what the form is for. The identifying cell is
 * a real anchor instead, which is the customers/coupons/inventory shape.
 *
 * ## No bulk and no export
 *
 * `content` is not in `EXPORT_SUBJECTS`, and there is no bulk endpoint on any
 * `/cms/` collection — DECISIONS.md's rule is that no bulk write ships without a
 * measured, allowlisted endpoint.
 */
export function PagesList({
  locale,
  initialQuery,
  initialPages,
  initialTotal,
  initialExcluded,
}: {
  locale: string;
  initialQuery: PagesQuery;
  initialPages: PageRow[] | null;
  initialTotal: number | null;
  initialExcluded: number;
}) {
  const t = useTranslations("content");
  const tA11y = useTranslations("a11y");
  const router = useRouter();
  const searchParams = useSearchParams();
  const online = useOnline();

  const query = queryFromParams(new URLSearchParams(searchParams.toString()));

  /*
   * Not wrapped in `useCallback`. The React Compiler is on in this project and
   * memoizes this already; a manual dependency list disagreeing with the
   * compiler's inference makes it skip optimising the whole component.
   */
  function commit(next: PagesQuery) {
    const params = toUrlParams(next);
    /* `push`, not `replace`. Filter state living in the URL is only half the
       promise; the other half is that the back button works. */
    router.push(`/${locale}/content/pages${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  /* A new filter resets to page one; paging and per-page do not. */
  const commitFilter = (next: PagesQuery) => commit({ ...next, page: 1 });

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: pagesKey(query),
    queryFn: () => fetchPages(query),
    initialData:
      initialPages !== null && pagesKey(query).join("|") === pagesKey(initialQuery).join("|")
        ? {
            pages: initialPages,
            total: initialTotal ?? initialPages.length,
            excludedSystem: initialExcluded,
          }
        : undefined,
    placeholderData: keepPreviousData,
  });

  const pages = data?.pages ?? [];
  const total = data?.total ?? 0;
  const filtered = isFiltered(query);

  /* Computed once for the whole list rather than per row: a row cannot know
     whether another row shares its path. */
  const collisions = collidingPaths(pages.map((page) => page.path));

  const ctx: PageColumnContext = { locale, t, collisions };
  const columns = buildColumns(ctx);

  /* Held here rather than inside `DataTable` so the controls sit in the toolbar
     beside the search field instead of floating above the card. */
  const preferences = useTablePreferences("content-pages", columns);

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("section.pages")}
        back={{ href: `/${locale}/content`, label: t("title") }}
        /*
         * The visible count, and the testid the suite waits on before asserting
         * anything else. `Isolate` and never `Ltr`: this is a translated sentence
         * with a number in it, not an identifier.
         */
        subtitle={
          <span data-testid="pages-count">
            <Isolate>{t("pages.count", { total })}</Isolate>
          </span>
        }
        actions={
          <>
            <IconButton
              label={t("refresh")}
              icon="refresh"
              variant="secondary"
              onClick={() => void refetch()}
              loading={isFetching}
            />
            {/* `POST /cms/pages` is allowlisted, so the primary can act. A real
                link rather than a button: middle click and "open in new tab" are
                how somebody drafts a second page beside the list. */}
            <ButtonLink
              href={`/${locale}/content/pages/new`}
              variant="primary"
              icon="plus"
            >
              {t("pages.create")}
            </ButtonLink>
          </>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            {/*
              **The first tab is `any`, and that is the inversion.** On every
              other list in the panel the leading tab sends nothing and means
              "all"; here the API's own default is `publish`, so "all" is an
              explicit `?status=any` and it is `publish` that is the filter.
              `toUrlParams` omits `any` because it is the *screen's* default, not
              because it is the API's.
            */}
            <FilterTabs<StatusFilter>
              tabs={STATUS_FILTERS.map((value) => ({
                value,
                label: t(`statusFilter.${value}`),
              }))}
              value={query.status}
              onChange={(status) => commitFilter({ ...query, status })}
              label={t("statusLabel")}
            />

            <FilterRow>
              <SearchField
                value={query.search}
                onSubmit={(next) => commitFilter({ ...query, search: next })}
                placeholder={t("pages.searchPlaceholder")}
                label={t("pages.searchLabel")}
                clearLabel={t("clearSearch")}
              />
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
          </div>
        }
      />

      <PageBody width="full">
        {(!online || isError) && dataUpdatedAt > 0 ? (
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)}
            reason={online ? "refreshFailed" : "offline"}
          />
        ) : null}

        {/* A live region, so a filter that changes the result count announces it.
            Its own testid: `pages-count` above is the *visible* count, and two
            elements sharing one testid is a strict-mode violation. */}
        <p aria-live="polite" className="sr-only" data-testid="pages-live">
          {tA11y("listUpdated", { total })}
        </p>

        {isPending && pages.length === 0 ? (
          <>
            <div className="hidden md:block">
              <TableSkeleton rows={8} cols={3} label={t("loading")} />
            </div>
            {/* The card and its padding are `DataTable`'s below `md`, so the
                skeleton wears them too — otherwise the rows shift 8px inward the
                moment the data lands. */}
            <div className="ui-card p-2 md:hidden">
              <RecordListSkeleton rows={6} label={t("loading")} />
            </div>
          </>
        ) : isError && pages.length === 0 ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : pages.length === 0 ? (
          <EmptyState
            icon={filtered ? "search" : "note"}
            /*
             * Two empty states, and telling them apart is the point. No pages at
             * all offers the create action — `POST /cms/pages` is allowlisted.
             * No results for a filter offers to clear it, back to the *screen's*
             * defaults rather than the API's, so clearing does not quietly hide
             * every draft.
             */
            message={filtered ? t("pages.empty.noResults") : t("pages.empty.none")}
            action={
              filtered
                ? { label: t("empty.clear"), onClick: () => commitFilter(EMPTY_QUERY) }
                : {
                    label: t("pages.create"),
                    onClick: () => router.push(`/${locale}/content/pages/new`),
                  }
            }
          />
        ) : (
          <DataTable
            preferences={preferences}
            rows={pages}
            columns={columns}
            rowKey={(page) => String(page.id)}
            rowLabel={(page) => tA11y("pageName", { title: page.title })}
            record={(page) => pageRecord(page, ctx)}
            /*
             * Navigates rather than previewing — see the docblock. The title cell
             * is a real anchor on top of this, for the keyboard and the middle
             * click; it stops propagation so only one push happens.
             */
            onRowClick={(page) => router.push(`/${locale}/content/pages/${page.path}`)}
            /*
             * **A colliding row is not clickable, and it is not a link either.**
             * `/cms/pages/{path}` resolves exactly one of the rows sharing a
             * path, and the panel cannot tell which — so following any of them
             * is a coin flip that ends in editing somebody else's page. The row
             * still renders every fact it has, and carries the sentence saying
             * why it does not open. DESIGN.md §3.3's rule that a control which
             * cannot act is not rendered, reaching a table row.
             */
            rowClickable={(page) => !collisions.has(page.path)}
            footer={
              <TableFooter
                page={query.page}
                perPage={query.perPage}
                total={total}
                onPageChange={(page) => commit({ ...query, page })}
                onPerPageChange={(perPage) => commit({ ...query, perPage, page: 1 })}
              />
            }
          />
        )}

        {/*
          Two footnotes, and both exist because a number on this screen would
          otherwise be quietly wrong.

          The first: the index omits the pages whose body the shop generates —
          `shop`, `cart`, `checkout`, `my-account` — so the count here is short of
          what wp-admin reports. `meta.excluded_system` is how many, and saying so
          is cheaper than the bug report.

          The second: `?search=` matches the title and the body and **never the
          path**. `WP_Query`'s `s` does not search `post_name`, so on the one
          resource whose address is its path, typing a path finds nothing. The
          customers screen sets the precedent for saying what a field matches
          rather than letting somebody conclude the search is broken.
        */}
        <p className="mt-3 text-ui-label text-ui-subtle">
          {data && data.excludedSystem > 0 ? (
            <>
              <Isolate numeric>
                {t("pages.excludedSystem", { count: data.excludedSystem })}
              </Isolate>{" "}
            </>
          ) : null}
          {t("pages.searchMatches")}
        </p>
      </PageBody>
    </div>
  );
}
