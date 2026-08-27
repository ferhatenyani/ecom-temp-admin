"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Faq, FaqCategory } from "@/lib/api/schemas/cms";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import {
  CMS_LIST_PER_PAGE,
  DEFAULT_STATUS_FILTER,
  isStatusFilter,
  positionWrites,
  reorderBlock,
  type StatusFilter,
} from "@/lib/cms";
import { decodeEntities } from "@/lib/format/html";
import { formatWhen } from "@/lib/format/date";
import { useOnline } from "@/lib/use-online";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { FilterTabs } from "@/components/ui/FilterBar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { Reorder, moveItem } from "@/components/ui/Reorder";
import { ConfirmDialog, useConfirm } from "@/components/ui/Confirm";
import { useLatchedOpener } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, Notice, StaleBanner } from "@/components/ui/States";
import { Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { FaqRowsSkeleton } from "./skeleton";
import { FaqDrawer } from "./FaqDrawer";

/**
 * The FAQ list, ordered by `position` and taggable with categories.
 *
 * ## One list, never one per category
 *
 * An FAQ can sit in **more than one** category — that is exactly why the API
 * refuses the singular `category` by name — so grouping by category would render
 * the same question twice and make "move up" ambiguous between two groups. The
 * categories are badges on the row, and the storefront is what filters by them.
 *
 * **There is no category filter either.** `?category=` was never measured, and
 * this run's standing rule treats an unmeasured parameter as broken. Stated here
 * rather than left looking like an oversight.
 *
 * ## Categories are a route, not a nested overlay
 *
 * They used to be a `Sheet` inside another `Sheet` — DESIGN.md §3.1: *"Never
 * nested. A modal that needs a second modal is a modal that needs steps."* A
 * route is the honest version of "steps" here, because it is not a step of
 * editing an FAQ at all: different data, its own writes, its own empty state.
 * The `PageHeader` is where it is reached from.
 *
 * ## Reordering, and the two ways this list can be a partial one
 *
 * `position` is dense across the collection and there is no bulk endpoint, so a
 * move is one `PATCH` per moved row and there is no save bar. `positionWrites()`
 * renumbers the array it is given to `0..n-1`, which is right only when that
 * array is the whole collection — and it was not, twice over: the fetch is
 * capped at a hundred and `meta.total` was never read, and a status tab returns
 * the collection's positions with the other status's numbers missing from the
 * middle. `reorderBlock()` answers both and the control is **not rendered**
 * when either bites, with one line saying which. See `lib/cms.ts`.
 */
const TABS: readonly StatusFilter[] = ["any", "publish", "draft"] as const;

const rowOpenerId = (id: number) => `faq-opener-${id}`;
const rowMenuId = (id: number) => `faq-menu-${id}`;

export function FaqsList({
  locale,
  initialStatus,
  initialFaqs,
  initialTotal,
  initialCategories,
}: {
  locale: string;
  initialStatus: StatusFilter;
  initialFaqs: Faq[] | null;
  initialTotal: number | null;
  initialCategories: FaqCategory[] | null;
}) {
  const t = useTranslations("content");
  const tA11y = useTranslations("a11y");
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const queryClient = useQueryClient();

  const requested = searchParams.get("status") ?? "";
  const status: StatusFilter = isStatusFilter(requested) ? requested : DEFAULT_STATUS_FILTER;

  const [editing, setEditing] = useState<Faq | "new" | null>(null);
  const confirm = useConfirm<Faq>();

  const online = useOnline();

  const faqsQuery = useQuery({
    queryKey: ["cms", "faqs", status],
    queryFn: async () => {
      const { data, total } = await acRead<Faq[]>(
        `/cms/faqs?per_page=${CMS_LIST_PER_PAGE}&status=${status}`,
      );
      return { faqs: data, total };
    },
    initialData:
      initialFaqs !== null && status === initialStatus
        ? { faqs: initialFaqs, total: initialTotal ?? initialFaqs.length }
        : undefined,
    placeholderData: keepPreviousData,
  });

  const categoriesQuery = useQuery({
    queryKey: ["cms", "faq-categories"],
    queryFn: async () => {
      const { data } = await acRead<FaqCategory[]>("/cms/faq-categories");
      return data;
    },
    initialData: initialCategories ?? undefined,
  });

  const ordered = useMemo(
    () => [...(faqsQuery.data?.faqs ?? [])].sort((a, b) => a.position - b.position),
    [faqsQuery.data],
  );

  const fetched = ordered.length;
  const total = Math.max(faqsQuery.data?.total ?? 0, fetched);
  const blocked = reorderBlock({ status, fetched, total: faqsQuery.data?.total ?? 0 });
  const categories = categoriesQuery.data ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["cms", "faqs"] });
    void queryClient.invalidateQueries({ queryKey: ["cms", "faq-categories"] });
  };

  const failed = (caught: unknown) => {
    if (caught instanceof BrowserApiError || caught instanceof Error) {
      toast.show(caught.message, "danger");
      return;
    }
    throw caught;
  };

  const move = useMutation({
    mutationFn: async ({ from, to }: { from: number; to: number }) => {
      await Promise.all(
        positionWrites(ordered, moveItem(ordered, from, to)).map(({ id, position }) =>
          acWrite("PATCH", `/cms/faqs/${id}`, { position }),
        ),
      );
    },
    onSuccess: invalidate,
    onError: failed,
  });

  const remove = useMutation({
    mutationFn: (faq: Faq) => acWrite("DELETE", `/cms/faqs/${faq.id}?force=true`),
    onSuccess: () => {
      confirm.close();
      toast.show(t("faqs.deleted"));
      invalidate();
    },
    onError: (caught: unknown) => {
      confirm.close();
      failed(caught);
    },
  });

  const busy = move.isPending || remove.isPending;

  const confirmOpener = useLatchedOpener(confirm.target && rowMenuId(confirm.target.id));
  const drawerOpener = useLatchedOpener(
    editing !== null && editing !== "new" ? rowOpenerId(editing.id) : null,
  );

  const commitStatus = (next: StatusFilter) =>
    router.push(
      `/${locale}/content/faqs${next === DEFAULT_STATUS_FILTER ? "" : `?status=${next}`}`,
      { scroll: false },
    );

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("section.faqs")}
        subtitle={
          <span data-testid="faqs-count">
            <Isolate>{t("faqs.count", { total })}</Isolate>
          </span>
        }
        back={{ href: `/${locale}/content`, label: t("title") }}
        actions={
          <>
            <IconButton
              label={t("refresh")}
              icon="refresh"
              variant="secondary"
              onClick={() => void faqsQuery.refetch()}
              loading={faqsQuery.isFetching}
            />
            {/* A real link, so middle-click and "open in new tab" work — the
                categories are a route now, not an overlay. */}
            <ButtonLink
              href={`/${locale}/content/faqs/categories`}
              variant="secondary"
              icon="tag"
            >
              {t("faqCategories.title")}
            </ButtonLink>
            <Button icon="plus" onClick={() => setEditing("new")}>
              {t("faqs.create")}
            </Button>
          </>
        }
        toolbar={
          <FilterTabs<StatusFilter>
            tabs={TABS.map((value) => ({ value, label: t(`statusFilter.${value}`) }))}
            value={status}
            onChange={commitStatus}
            label={t("statusLabel")}
          />
        }
      />

      <PageBody width="detail">
        {!online && faqsQuery.dataUpdatedAt > 0 ? (
          <StaleBanner
            time={formatWhen(new Date(faqsQuery.dataUpdatedAt).toISOString(), locale)}
          />
        ) : null}

        <p aria-live="polite" className="sr-only" data-testid="faqs-live">
          {tA11y("listUpdated", { total })}
        </p>

        {faqsQuery.isPending && fetched === 0 ? (
          <FaqRowsSkeleton label={t("loading")} />
        ) : faqsQuery.isError ? (
          <ErrorState
            message={(faqsQuery.error as Error).message}
            onRetry={() => void faqsQuery.refetch()}
          />
        ) : fetched === 0 ? (
          <EmptyState
            icon={status === DEFAULT_STATUS_FILTER ? "note" : "search"}
            message={
              status === DEFAULT_STATUS_FILTER ? t("faqs.empty") : t("faqs.emptyFiltered")
            }
            action={
              status === DEFAULT_STATUS_FILTER
                ? { label: t("faqs.create"), onClick: () => setEditing("new") }
                : {
                    label: t("empty.clear"),
                    onClick: () => commitStatus(DEFAULT_STATUS_FILTER),
                  }
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {blocked === "truncated" ? (
              <Notice tone="warning" title={t("faqs.truncatedTitle")}>
                <p className="text-ui-label">
                  <Isolate>{t("faqs.truncatedBody", { shown: fetched, total })}</Isolate>
                </p>
              </Notice>
            ) : null}

            {/* One card with no heading: there is one FAQ list, and a card
                titled "FAQ" under a page titled "FAQ" is chrome. */}
            <Card>
              <ul className="flex flex-col">
                {ordered.map((faq, index) => (
                  <li key={faq.id} className="ui-row flex min-w-0 items-center gap-3 py-2">
                    <button
                      id={rowOpenerId(faq.id)}
                      type="button"
                      onClick={() => setEditing(faq)}
                      className="ui-ring ui-interactive flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-ui-md text-start"
                    >
                      <span className="flex min-w-0 items-start gap-2">
                        <span
                          dir="auto"
                          className="min-w-0 flex-1 text-ui-subheading text-ui-fg"
                        >
                          {decodeEntities(faq.question)}
                        </span>
                        {faq.status === "draft" ? (
                          <Badge tone="warning">{t("status.draft")}</Badge>
                        ) : null}
                      </span>

                      {faq.categories.length > 0 ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {faq.categories.map((category) => (
                            <Badge key={category.id} tone="neutral">
                              {decodeEntities(category.name)}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        <span className="text-ui-label text-ui-subtle">
                          {t("faqs.uncategorised")}
                        </span>
                      )}
                    </button>

                    {blocked === null ? (
                      <Reorder
                        index={index}
                        count={ordered.length}
                        onMove={(from, to) => move.mutate({ from, to })}
                        label={decodeEntities(faq.question)}
                        disabled={busy}
                      />
                    ) : null}

                    <Menu
                      label={t("faqs.rowActions", {
                        label: decodeEntities(faq.question),
                      })}
                      actions={[
                        {
                          key: "delete",
                          label: t("faqs.deleteAction"),
                          icon: "trash",
                          destructive: true,
                          disabled: busy,
                          onSelect: () => confirm.ask(faq),
                        },
                      ]}
                      trigger={
                        <IconButton
                          id={rowMenuId(faq.id)}
                          label={t("faqs.rowActions", {
                            label: decodeEntities(faq.question),
                          })}
                          icon="more"
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                        />
                      }
                    />
                  </li>
                ))}
              </ul>
            </Card>

            <div className="flex flex-col gap-1 text-ui-label text-ui-subtle">
              <p>{t("faqs.listNote")}</p>
              {blocked === "filtered" ? <p>{t("faqs.reorderFiltered")}</p> : null}
            </div>
          </div>
        )}
      </PageBody>

      <FaqDrawer
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        open={editing !== null}
        faq={editing === "new" ? null : editing}
        categories={categories}
        nextPosition={total}
        returnFocusTo={drawerOpener}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          invalidate();
        }}
      />

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={confirm.onOpenChange}
        returnFocusTo={confirmOpener}
        tone="destructive"
        loading={remove.isPending}
        title={t("faqs.deleteTitle")}
        /*
         * **No `requireTyped`**, for the banner's reason. §3.1 wants the record's
         * identifier typed for an irreversible act, and an FAQ's only identifier
         * is its question — free prose that WordPress texturizes, so the
         * apostrophe on screen is U+2019 and not the one on the keyboard. A
         * question is also a sentence, and asking somebody to retype a sentence
         * to delete it is a guard that trains people to copy and paste. The
         * dialog names the question instead — §3.1 as amended on shipping.
         */
        body={
          <>
            <p className="text-ui-subheading text-ui-fg" dir="auto">
              {confirm.target ? decodeEntities(confirm.target.question) : ""}
            </p>
            <p className="mt-1.5">{t("faqs.deleteBody")}</p>
          </>
        }
        confirmLabel={t("faqs.deleteAction")}
        onConfirm={() => {
          if (confirm.target) remove.mutate(confirm.target);
        }}
      />
    </div>
  );
}
