"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Faq, FaqCategory } from "@/lib/api/schemas/cms";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { positionWrites } from "@/lib/cms";
import { decodeEntities } from "@/lib/format/html";
import { Scaffold } from "@/components/patterns/Scaffold";
import { EmptyState, ErrorState } from "@/components/patterns/States";
import { MoveControls, moveItem } from "@/components/patterns/MoveControls";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { ActionSheet } from "@/components/primitives/ActionSheet";
import { Sheet } from "@/components/primitives/Sheet";
import { TextField } from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Isolate } from "@/components/primitives/Ltr";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { useToast } from "@/components/primitives/Toast";
import { RowSkeleton } from "../../inventory/RowSkeleton";
import { FaqSheet } from "./FaqSheet";

/**
 * The FAQ list, ordered by `position` and taggable with categories.
 *
 * One list rather than one per category, unlike the banners: an FAQ can sit in
 * **more than one** category — that is the reason the API refuses the singular
 * `category` by name — so grouping by category would render the same question
 * twice and make "move up" ambiguous between two groups. The categories are
 * shown as badges on the row and are the thing the storefront filters by.
 */
export function FaqsList({
  locale,
  initialFaqs,
  initialCategories,
}: {
  locale: string;
  initialFaqs: Faq[] | null;
  initialCategories: FaqCategory[] | null;
}) {
  const t = useTranslations("content");
  const toast = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<Faq | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Faq | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const faqsQuery = useQuery({
    queryKey: ["cms", "faqs"],
    queryFn: async () => {
      const { data } = await acRead<Faq[]>("/cms/faqs?per_page=100&status=any");
      return data;
    },
    initialData: initialFaqs ?? undefined,
  });

  const categoriesQuery = useQuery({
    queryKey: ["cms", "faq-categories"],
    queryFn: async () => {
      const { data } = await acRead<FaqCategory[]>("/cms/faq-categories");
      return data;
    },
    initialData: initialCategories ?? undefined,
  });

  const faqs = [...(faqsQuery.data ?? [])].sort((a, b) => a.position - b.position);
  const categories = categoriesQuery.data ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["cms", "faqs"] });
    void queryClient.invalidateQueries({ queryKey: ["cms", "faq-categories"] });
  };

  async function reorder(from: number, to: number) {
    setBusy(true);
    const next = moveItem(faqs, from, to);

    try {
      await Promise.all(
        positionWrites(faqs, next).map(({ id, position }) =>
          acWrite("PATCH", `/cms/faqs/${id}`, { position }),
        ),
      );
      invalidate();
    } catch (error) {
      if (error instanceof BrowserApiError) toast.show(error.message, "danger");
      else throw error;
    } finally {
      setBusy(false);
    }
  }

  async function remove(faq: Faq) {
    setBusy(true);
    try {
      await acWrite("DELETE", `/cms/faqs/${faq.id}?force=true`);
      toast.show(t("faqs.deleted"));
      invalidate();
    } catch (error) {
      if (error instanceof BrowserApiError) toast.show(error.message, "danger");
      else throw error;
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  return (
    <Scaffold
      title={t("section.faqs")}
      back={{ href: `/${locale}/content`, label: t("title") }}
      trailing={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCategoriesOpen(true)}
            aria-label={t("faqs.manageCategories")}
            className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
          >
            <Icon name="tag" className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            aria-label={t("faqs.create")}
            className="tap-44 press flex size-11 items-center justify-center rounded-full text-accent"
          >
            <Icon name="plus" className="size-5" />
          </button>
        </div>
      }
    >
      <div className="mx-auto max-w-3xl px-4">
        <p aria-live="polite" className="mb-2 px-1 text-footnote text-label-secondary" data-testid="faqs-count">
          <Isolate numeric>{t("faqs.count", { total: faqs.length })}</Isolate>
        </p>

        {faqsQuery.isPending && faqs.length === 0 ? (
          <RowSkeleton rows={4} />
        ) : faqsQuery.isError ? (
          <ErrorState
            message={(faqsQuery.error as Error).message}
            onRetry={() => void faqsQuery.refetch()}
          />
        ) : faqs.length === 0 ? (
          <EmptyState
            message={t("faqs.empty")}
            action={{ label: t("faqs.create"), onClick: () => setCreating(true) }}
          />
        ) : (
          <ListGroup footnote={t("faqs.orderNote")}>
            {faqs.map((faq, index) => (
              <ListRow key={faq.id} className="items-start">
                <button
                  type="button"
                  onClick={() => setEditing(faq)}
                  className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-1 text-start"
                >
                  <span className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-body text-label" dir="auto">
                      {decodeEntities(faq.question)}
                    </span>
                    {faq.status === "draft" ? (
                      <StatusBadge tone="warning">{t("status.draft")}</StatusBadge>
                    ) : null}
                  </span>
                  {faq.categories.length > 0 ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      {faq.categories.map((category) => (
                        <StatusBadge key={category.id} tone="neutral">
                          {decodeEntities(category.name)}
                        </StatusBadge>
                      ))}
                    </span>
                  ) : (
                    <span className="text-footnote text-label-tertiary">
                      {t("faqs.uncategorised")}
                    </span>
                  )}
                </button>

                <MoveControls
                  index={index}
                  count={faqs.length}
                  onMove={(from, to) => void reorder(from, to)}
                  label={decodeEntities(faq.question)}
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => setRemoving(faq)}
                  disabled={busy}
                  aria-label={t("faqs.delete", { label: decodeEntities(faq.question) })}
                  className="press flex size-11 shrink-0 items-center justify-center rounded-md text-label-secondary disabled:opacity-30"
                >
                  <Icon name="trash" className="size-5" />
                </button>
              </ListRow>
            ))}
          </ListGroup>
        )}
      </div>

      {(creating || editing) ? (
        <FaqSheet
          open
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
          faq={editing}
          categories={categories}
          nextPosition={faqs.length}
          onSaved={invalidate}
        />
      ) : null}

      <CategoriesSheet
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        categories={categories}
        onChanged={invalidate}
      />

      <ActionSheet
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("faqs.deleteTitle")}
        description={t("faqs.deleteBody")}
        actions={[
          {
            label: t("faqs.deleteAction"),
            tone: "destructive",
            onSelect: () => removing && void remove(removing),
          },
        ]}
        cancelLabel={t("cancel")}
      />
    </Scaffold>
  );
}

/**
 * FAQ categories.
 *
 * `GET /cms/faq-categories` exists only because §89's own table forgot it —
 * `POST` was listed and `GET` was not, so a panel could create a category it had
 * no way to list. The correction block on that section records it.
 *
 * **Deleting a category that FAQs are in is a 409 naming the count**, and
 * `?force=true` detaches them rather than deleting them. Two different
 * outcomes, so they get two different confirmations.
 */
function CategoriesSheet({
  open,
  onOpenChange,
  categories,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: FaqCategory[];
  onChanged: () => void;
}) {
  const t = useTranslations("content");
  const toast = useToast();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [detaching, setDetaching] = useState<{ category: FaqCategory; count: number } | null>(
    null,
  );

  async function create() {
    if (name.trim() === "") return;
    setBusy(true);
    setError(undefined);

    try {
      await acWrite("POST", "/cms/faq-categories", { name: name.trim() });
      setName("");
      onChanged();
      toast.show(t("faqs.categoryCreated"));
    } catch (caught) {
      if (caught instanceof BrowserApiError) {
        setError(caught.fields?.name ?? caught.message);
      } else {
        throw caught;
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(category: FaqCategory, force: boolean) {
    setBusy(true);
    try {
      await acWrite("DELETE", `/cms/faq-categories/${category.id}${force ? "?force=true" : ""}`);
      toast.show(t("faqs.categoryDeleted"));
      setDetaching(null);
      onChanged();
    } catch (caught) {
      if (caught instanceof BrowserApiError && caught.status === 409) {
        const count = typeof caught.details.faqs === "number" ? caught.details.faqs : 0;
        setDetaching({ category, count });
      } else if (caught instanceof BrowserApiError) {
        toast.show(caught.message, "danger");
      } else {
        throw caught;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title={t("faqs.categoriesTitle")}>
        <ListGroup>
          {categories.length === 0 ? (
            <ListRow>
              <span className="text-footnote text-label-secondary">{t("faqs.noCategories")}</span>
            </ListRow>
          ) : (
            categories.map((category) => (
              <ListRow key={category.id}>
                <span className="min-w-0 flex-1 truncate text-body text-label" dir="auto">
                  {decodeEntities(category.name)}
                </span>
                {typeof category.count === "number" ? (
                  <Isolate numeric className="shrink-0 text-footnote text-label-secondary">
                    {t("faqs.categoryCount", { count: category.count })}
                  </Isolate>
                ) : null}
                <button
                  type="button"
                  onClick={() => void remove(category, false)}
                  disabled={busy}
                  aria-label={t("faqs.categoryDelete", {
                    label: decodeEntities(category.name),
                  })}
                  className="press flex size-11 shrink-0 items-center justify-center rounded-md text-label-secondary disabled:opacity-30"
                >
                  <Icon name="trash" className="size-5" />
                </button>
              </ListRow>
            ))
          )}
        </ListGroup>

        <ListGroup title={t("faqs.categoryAdd")}>
          <TextField
            label={t("faqs.categoryName")}
            value={name}
            onChange={setName}
            error={error}
            hint={t("faqs.categoryNameHint")}
          />
          <ListRow>
            <Button variant="tinted" onClick={() => void create()} loading={busy} disabled={name.trim() === ""}>
              {t("faqs.categoryAddAction")}
            </Button>
          </ListRow>
        </ListGroup>
      </Sheet>

      <ActionSheet
        open={detaching !== null}
        onOpenChange={(next) => !next && setDetaching(null)}
        title={t("faqs.categoryDetachTitle")}
        description={
          detaching ? t("faqs.categoryDetachBody", { count: detaching.count }) : ""
        }
        actions={[
          {
            label: t("faqs.categoryDetachAction"),
            tone: "destructive",
            onSelect: () => detaching && void remove(detaching.category, true),
          },
        ]}
        cancelLabel={t("cancel")}
      />
    </>
  );
}
