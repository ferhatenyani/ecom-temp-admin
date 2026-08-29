"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FaqCategory } from "@/lib/api/schemas/cms";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import { decodeEntities } from "@/lib/format/html";
import { formatWhen } from "@/lib/format/date";
import { useOnline } from "@/lib/use-online";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button, IconButton } from "@/components/ui/Button";
import { Menu } from "@/components/ui/Menu";
import { TextField } from "@/components/ui/Form";
import { ConfirmDialog, useConfirm } from "@/components/ui/Confirm";
import { useLatchedOpener } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, StaleBanner } from "@/components/ui/States";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/**
 * Create and delete FAQ categories.
 *
 * ## Two outcomes for one button, so two dialogs
 *
 * **Deleting a category that FAQs are in is a 409 naming the count**, and
 * `?force=true` detaches them rather than deleting them. Those are different
 * acts with different consequences, so the second is confirmed separately and
 * with the count in it — a person who agreed to "delete this category" has not
 * agreed to "and take it off eleven questions".
 *
 * The first delete used to fire **with no confirmation at all** and only put a
 * dialog up when the 409 came back, which meant a category nothing referenced —
 * the only case where the act is silent and immediate — was the one case nobody
 * was asked about. Both paths go through `ConfirmDialog` now (§8).
 *
 * ## No rename
 *
 * `PATCH /cms/faq-categories/{id}` is allowlisted and **nothing measured what it
 * accepts**, so under this run's standing rule it is treated as broken and no
 * control ships. The slug is derived from the name on create, so a rename would
 * also raise a question — does the slug follow? — that no measurement answers,
 * and an FAQ's `categories` are written by slug.
 *
 * ## The create form is a card, not an overlay
 *
 * One field. The inventory adjust form's argument: an overlay for a single input
 * puts a scrim and a focus trap between a person and a text box, and the list it
 * appends to is the thing they are looking at while they type.
 */
export function CategoriesScreen({
  locale,
  initialCategories,
}: {
  locale: string;
  initialCategories: FaqCategory[] | null;
}) {
  const t = useTranslations("content");
  const toast = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const confirm = useConfirm<FaqCategory>();
  /** The 409's second act: detach `count` FAQs and delete anyway. */
  const [detaching, setDetaching] = useState<{ category: FaqCategory; count: number } | null>(
    null,
  );

  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["cms", "faq-categories"],
    queryFn: async () => {
      const { data: categories } = await acRead<FaqCategory[]>("/cms/faq-categories");
      return categories;
    },
    initialData: initialCategories ?? undefined,
  });

  const categories = data ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["cms", "faq-categories"] });
    /* The FAQ rows carry their categories as badges, so a delete changes them
       too — otherwise going back shows a category that no longer exists. */
    void queryClient.invalidateQueries({ queryKey: ["cms", "faqs"] });
  };

  const create = useMutation({
    mutationFn: () => acWrite("POST", "/cms/faq-categories", { name: name.trim() }),
    onSuccess: () => {
      setName("");
      setNameError(undefined);
      toast.show(t("faqCategories.created"));
      invalidate();
    },
    onError: (caught: unknown) => {
      if (caught instanceof BrowserApiError) {
        /* The refusal binds to the one field there is, rather than to a toast
           that disappears while somebody is still reading the box it is about. */
        setNameError(caught.fields?.name ?? caught.message);
        return;
      }
      if (caught instanceof Error) {
        setNameError(caught.message);
        return;
      }
      throw caught;
    },
  });

  const remove = useMutation({
    mutationFn: ({ category, force }: { category: FaqCategory; force: boolean }) =>
      acWrite(
        "DELETE",
        `/cms/faq-categories/${category.id}${force ? "?force=true" : ""}`,
      ),
    onSuccess: () => {
      confirm.close();
      setDetaching(null);
      toast.show(t("faqCategories.deleted"));
      invalidate();
    },
    onError: (caught: unknown, variables) => {
      /* The 409 is not a failure, it is the second question. `details.faqs` is
         the count, and the dialog it opens is the only place `?force=true` is
         ever sent from. */
      if (caught instanceof BrowserApiError && caught.status === 409) {
        confirm.close();
        setDetaching({
          category: variables.category,
          count: typeof caught.details.faqs === "number" ? caught.details.faqs : 0,
        });
        return;
      }
      confirm.close();
      setDetaching(null);
      if (caught instanceof Error) {
        toast.show(caught.message, "danger");
        return;
      }
      throw caught;
    },
  });

  const confirmOpener = useLatchedOpener(
    confirm.target && `faq-category-menu-${confirm.target.id}`,
  );
  const detachOpener = useLatchedOpener(
    detaching && `faq-category-menu-${detaching.category.id}`,
  );

  const blank = name.trim() === "";

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("faqCategories.title")}
        subtitle={
          <span data-testid="faq-categories-count">
            <Isolate>{t("faqCategories.count", { total: categories.length })}</Isolate>
          </span>
        }
        back={{ href: `/${locale}/content/faqs`, label: t("section.faqs") }}
        actions={
          <IconButton
            label={t("refresh")}
            icon="refresh"
            variant="secondary"
            onClick={() => void refetch()}
            loading={isFetching}
          />
        }
      />

      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          {(!online || isError) && dataUpdatedAt > 0 ? (
            <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)}
              reason={online ? "refreshFailed" : "offline"}
            />
          ) : null}

          {isPending && categories.length === 0 ? (
            <CardSkeleton rows={4} label={t("loading")} footnote={1} />
          ) : isError && categories.length === 0 ? (
            <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
          ) : categories.length === 0 ? (
            /* This list takes no filters, so it has exactly one empty state and
               it offers nothing: the create form is the next card down and is
               always on screen. */
            <EmptyState
              icon="tag"
              message={t("faqCategories.empty")}
              detail={t("faqCategories.emptyDetail")}
            />
          ) : (
            <Card footnote={t("faqCategories.listNote")}>
              <ul className="flex flex-col">
                {categories.map((category) => (
                  <li
                    key={category.id}
                    className="ui-row flex min-w-0 items-center gap-3 py-2"
                  >
                    <span
                      dir="auto"
                      className="min-w-0 flex-1 truncate text-ui-body text-ui-fg"
                    >
                      {decodeEntities(category.name)}
                    </span>

                    {typeof category.count === "number" ? (
                      <Isolate className="shrink-0 text-ui-label text-ui-muted">
                        {t("faqCategories.usedBy", { count: category.count })}
                      </Isolate>
                    ) : null}

                    <Menu
                      label={t("faqCategories.rowActions", {
                        label: decodeEntities(category.name),
                      })}
                      actions={[
                        {
                          key: "delete",
                          label: t("faqCategories.deleteAction"),
                          icon: "trash",
                          destructive: true,
                          disabled: remove.isPending,
                          onSelect: () => confirm.ask(category),
                        },
                      ]}
                      trigger={
                        <IconButton
                          id={`faq-category-menu-${category.id}`}
                          label={t("faqCategories.rowActions", {
                            label: decodeEntities(category.name),
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
          )}

          <Card title={t("faqCategories.add")}>
            <div className="flex flex-col gap-3">
              <TextField
                id="faq-category-name"
                label={t("faqCategories.name")}
                value={name}
                onChange={(next) => {
                  setName(next);
                  /* The server's refusal is about the value that was sent, so it
                     stops being true the moment the value changes. */
                  if (nameError !== undefined) setNameError(undefined);
                }}
                hint={t("faqCategories.nameHint")}
                error={nameError}
              />
              <div>
                <Button
                  icon="plus"
                  onClick={() => create.mutate()}
                  loading={create.isPending}
                  disabled={blank}
                  /* §3.3: a disabled control says why. */
                  title={blank ? t("faqCategories.addBlocked") : undefined}
                >
                  {t("faqCategories.addAction")}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </PageBody>

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={confirm.onOpenChange}
        returnFocusTo={confirmOpener}
        tone="destructive"
        loading={remove.isPending}
        title={t("faqCategories.deleteTitle")}
        /*
         * **No `requireTyped`.** §3.1 asks for a typed identifier on an
         * irreversible act; a category's only one is its name, which WordPress
         * texturizes exactly as it does a banner title, so what is on screen is
         * not what a keyboard produces. And this act is the least severe of the
         * three on this branch — the questions survive it. The dialog names the
         * category, which is §3.1 as amended on the shipping branch.
         */
        body={
          <>
            <p className="text-ui-subheading text-ui-fg" dir="auto">
              {confirm.target ? decodeEntities(confirm.target.name) : ""}
            </p>
            <p className="mt-1.5">{t("faqCategories.deleteBody")}</p>
          </>
        }
        confirmLabel={t("faqCategories.deleteAction")}
        onConfirm={() => {
          if (confirm.target) remove.mutate({ category: confirm.target, force: false });
        }}
      />

      <ConfirmDialog
        open={detaching !== null}
        onOpenChange={(next) => {
          if (!next) setDetaching(null);
        }}
        returnFocusTo={detachOpener}
        tone="destructive"
        loading={remove.isPending}
        title={t("faqCategories.detachTitle")}
        body={t("faqCategories.detachBody", { count: detaching?.count ?? 0 })}
        confirmLabel={t("faqCategories.detachAction")}
        onConfirm={() => {
          if (detaching) remove.mutate({ category: detaching.category, force: true });
        }}
      />
    </div>
  );
}
