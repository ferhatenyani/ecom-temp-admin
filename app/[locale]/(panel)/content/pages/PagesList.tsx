"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PageRow as PageRowData } from "@/lib/api/schemas/cms";
import { acRead } from "@/lib/api/browser";
import { collidingPaths, STATUS_FILTERS, type StatusFilter } from "@/lib/cms";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState, StaleBanner } from "@/components/patterns/States";
import { ListGroup, ListLinkRow, ListRow } from "@/components/primitives/GroupedList";
import { Segmented } from "@/components/primitives/Segmented";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useOnline } from "@/lib/use-online";
import { formatWhen } from "@/lib/format/date";
import { PageRow } from "./PageRow";
import { RowSkeleton } from "../../inventory/RowSkeleton";
import {
  EMPTY_QUERY,
  PER_PAGE,
  isFiltered,
  listParams,
  pagesKey,
  queryFromParams,
  toUrlParams,
  type PagesQuery,
} from "./query";

type PagesPage = { pages: PageRowData[]; total: number; excludedSystem: number };

async function fetchPages(query: PagesQuery): Promise<PagesPage> {
  const { data, total, meta } = await acRead<PageRowData[]>(`/cms/pages?${listParams(query)}`);

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
  initialPages: PageRowData[] | null;
  initialTotal: number | null;
  initialExcluded: number;
}) {
  const t = useTranslations("content");
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = queryFromParams(new URLSearchParams(searchParams.toString()));
  const [searchDraft, setSearchDraft] = useState(query.search);

  const commit = (next: PagesQuery, options: { resetPage?: boolean } = {}) => {
    const target = options.resetPage === false ? next : { ...next, page: 1 };
    const params = toUrlParams(target);
    router.push(`/${locale}/content/pages${params.size > 0 ? `?${params}` : ""}`, {
      scroll: false,
    });
  };

  const online = useOnline();

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
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = isFiltered(query);

  // Computed once for the whole list rather than per row: a row cannot know
  // whether another row shares its path.
  const collisions = collidingPaths(pages.map((page) => page.path));

  return (
    <Scaffold
      title={t("section.pages")}
      back={{ href: `/${locale}/content`, label: t("title") }}
      trailing={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void refetch()}
            aria-label={t("refresh")}
            className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
          >
            <Icon name="refresh" className={isFetching ? "size-5 spin" : "size-5"} />
          </button>
          <a
            href={`/${locale}/content/pages/new`}
            aria-label={t("pages.create")}
            className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
          >
            <Icon name="plus" className="size-5" />
          </a>
        </div>
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
              placeholder={t("pages.searchPlaceholder")}
              aria-label={t("pages.searchLabel")}
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

          <Segmented<StatusFilter>
            segments={STATUS_FILTERS.map((value) => ({
              value,
              label: t(`statusFilter.${value}`),
            }))}
            value={query.status}
            onChange={(status) => commit({ ...query, status })}
            label={t("statusLabel")}
          />
        </div>
      }
    >
      {!online && dataUpdatedAt > 0 ? (
        <div className="mx-auto max-w-3xl">
          <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
        </div>
      ) : null}

      <div className="mx-auto max-w-3xl px-4">
        <p
          aria-live="polite"
          className="mb-2 px-1 text-footnote text-label-secondary"
          data-testid="pages-count"
        >
          <Isolate numeric>{t("pages.count", { total })}</Isolate>
        </p>

        {isPending && pages.length === 0 ? (
          <RowSkeleton rows={5} />
        ) : isError ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : pages.length === 0 ? (
          <EmptyState
            message={filtered ? t("pages.empty.noResults") : t("pages.empty.none")}
            action={
              filtered
                ? {
                    label: t("empty.clear"),
                    onClick: () => {
                      setSearchDraft("");
                      // Back to the *screen's* defaults, which are not the
                      // API's: `?status=any`, so clearing a filter does not
                      // quietly hide every draft.
                      commit(EMPTY_QUERY);
                    },
                  }
                : undefined
            }
          />
        ) : (
          <>
            <ListGroup>
              {pages.map((page) =>
                collisions.has(page.path) ? (
                  /*
                   * Not a link. Two rows share this path and only one of them is
                   * reachable through `/cms/pages/{path}` — the panel cannot tell
                   * which, so following either would be a coin flip that ends in
                   * editing somebody else's page.
                   */
                  <ListRow key={page.id}>
                    <PageRow page={page} locale={locale} colliding />
                  </ListRow>
                ) : (
                  <ListLinkRow
                    key={page.id}
                    href={`/${locale}/content/pages/${page.path}`}
                    ariaLabel={page.title}
                  >
                    <PageRow page={page} locale={locale} />
                  </ListLinkRow>
                ),
              )}
            </ListGroup>

            {total > PER_PAGE ? (
              <nav className="mb-4 flex items-center justify-between gap-3">
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

        {/*
          Two footnotes, and both exist because a number on this screen would
          otherwise be quietly wrong.

          The first: the index omits the pages whose body the shop generates —
          `shop`, `cart`, `checkout`, `my-account` — so the count here is short
          of what wp-admin reports. `meta.excluded_system` is how many, and
          saying so is cheaper than the bug report.

          The second: `?search=` matches the title and the body and **never the
          path**. `WP_Query`'s `s` does not search `post_name`, so on the one
          resource whose address is its path, typing a path finds nothing. The
          customers screen sets the precedent for saying what a field matches
          rather than letting somebody conclude the search is broken.
        */}
        <p className="mb-8 px-1 text-footnote text-label-secondary">
          {data && data.excludedSystem > 0 ? (
            <>
              <Isolate numeric>
                {t("pages.excludedSystem", { count: data.excludedSystem })}
              </Isolate>{" "}
            </>
          ) : null}
          {t("pages.searchMatches")}
        </p>
      </div>
    </Scaffold>
  );
}
