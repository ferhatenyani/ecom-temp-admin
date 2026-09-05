"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductCategory } from "@/lib/api/schemas/product";
import { BrowserApiError, acRead, acWriteWithMeta } from "@/lib/api/browser";
import { decodeEntities } from "@/lib/format/html";
import { formatWhen } from "@/lib/format/date";
import { useOnline } from "@/lib/use-online";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card, NavList, NavRow } from "@/components/ui/Card";
import { Button, IconButton } from "@/components/ui/Button";
import { TextField, TextArea, Select } from "@/components/ui/Form";
import { EmptyState, ErrorState, Notice, StaleBanner } from "@/components/ui/States";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/**
 * Product-category CRUD — the round-6 addition. Categories are the top
 * of the catalogue tree (Tapis, Vêtements, Accessoires), and until now
 * this panel could only read them. The storefront's home shelf renders
 * whatever the backend publishes with `count > 0`, so this screen is
 * what puts a "Tapis" tile there.
 *
 * ## Why this is a destination in the nav
 *
 * `AttributesScreen` argues at length why the vocabulary set up before a
 * product deserves a nav entry. Categories are the same shape: a shop's
 * first session is "create Tapis, then create a tapis" — with no product
 * to have arrived from. Same capability as products above
 * (`ac_manage_products`), so this entry appears and disappears with
 * `products` and can never lead a reader to a forbidden screen.
 *
 * ## The create form is a card, not an overlay
 *
 * Four fields — name, slug, parent, description — but the pattern from
 * `AttributesScreen` holds: an overlay puts a scrim and a focus trap
 * between a person and a text box, and the list it appends to is what
 * they are looking at while they type.
 *
 * ## Delete rules
 *
 * The list rows do not delete inline. Deleting a category that still
 * holds products silently detaches every one of them on WordPress's
 * side — a footgun documented in `CategoryController::destroy()` — so
 * the delete lives on the detail page, where the confirm dialog can
 * explain the consequence with the true count in front of the reader.
 */
export function CategoriesScreen({
  locale,
  initialCategories,
}: {
  locale: string;
  initialCategories: ProductCategory[] | null;
}) {
  const t = useTranslations("categories");
  const tStates = useTranslations("states");
  const toast = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parent, setParent] = useState("0");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [slugError, setSlugError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);

  const online = useOnline();

  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["product-categories"],
    queryFn: async () => {
      const { data: rows } = await acRead<ProductCategory[]>(
        "/product-categories?per_page=100",
      );
      return rows;
    },
    initialData: initialCategories ?? undefined,
  });

  const categories = data ?? [];

  const clearErrors = () => {
    setNameError(undefined);
    setSlugError(undefined);
    setFormError(null);
  };

  const create = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { name: name.trim() };
      const trimmedSlug = slug.trim();
      if (trimmedSlug !== "") payload.slug = trimmedSlug;
      const parentId = Number(parent);
      if (parentId > 0) payload.parent = parentId;
      const trimmedDescription = description.trim();
      if (trimmedDescription !== "") payload.description = trimmedDescription;
      return acWriteWithMeta<ProductCategory>("POST", "/product-categories", payload);
    },
    onSuccess: () => {
      setName("");
      setSlug("");
      setParent("0");
      setDescription("");
      clearErrors();
      toast.show(t("created"));
      void queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    },
    onError: (caught: unknown) => {
      if (caught instanceof BrowserApiError) {
        const fields = caught.fields ?? {};
        setNameError(fields.name);
        setSlugError(fields.slug);
        // Anything unrelated to name/slug — parent, description, or a
        // top-level message — lands on the form-level banner.
        const otherKeys = Object.keys(fields).filter(
          (k) => k !== "name" && k !== "slug",
        );
        if (otherKeys.length > 0) {
          setFormError(otherKeys.map((k) => fields[k]).join(" "));
        } else if (fields.name === undefined && fields.slug === undefined) {
          setFormError(caught.message);
        }
        return;
      }
      if (caught instanceof Error) {
        setFormError(caught.message);
        return;
      }
      throw caught;
    },
  });

  const trimmedName = name.trim();
  const blocked = trimmedName === "";

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={
          <span data-testid="categories-count">
            {t("count", { total: categories.length })}
          </span>
        }
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
            <StaleBanner
              time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)}
              reason={online ? "refreshFailed" : "offline"}
            />
          ) : null}

          {isPending && categories.length === 0 ? (
            <CardSkeleton rows={3} label={t("loading")} footnote={1} />
          ) : isError && categories.length === 0 ? (
            <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
          ) : categories.length === 0 ? (
            <EmptyState icon="list" message={t("empty")} detail={t("emptyDetail")} />
          ) : (
            <Card footnote={t("listNote")} flush>
              <div className="px-4 sm:px-5">
                <NavList>
                  {categories.map((category) => (
                    <NavRow
                      key={category.id}
                      href={`/${locale}/product-categories/${category.id}`}
                      label={decodeEntities(category.name)}
                      meta={
                        <Ltr numeric={false}>
                          {t("productsCount", { count: category.count })}
                        </Ltr>
                      }
                    />
                  ))}
                </NavList>
              </div>
            </Card>
          )}

          <Card title={t("add")} description={t("intro")}>
            <div className="flex flex-col gap-3">
              {formError ? (
                <Notice tone="danger" role="alert" title={tStates("errorTitle")}>
                  <Ltr numeric={false} className="block text-ui-label">
                    {formError}
                  </Ltr>
                </Notice>
              ) : null}

              <TextField
                id="category-name"
                label={t("name")}
                value={name}
                onChange={(next) => {
                  setName(next);
                  if (nameError !== undefined) setNameError(undefined);
                  if (formError !== null) setFormError(null);
                }}
                hint={t("nameHint")}
                error={nameError}
              />

              <TextField
                id="category-slug"
                label={t("slug")}
                value={slug}
                onChange={(next) => {
                  setSlug(next);
                  if (slugError !== undefined) setSlugError(undefined);
                  if (formError !== null) setFormError(null);
                }}
                hint={t("slugHint")}
                error={slugError}
              />

              <Select
                id="category-parent"
                label={t("parent")}
                value={parent}
                onChange={setParent}
                hint={t("parentHint")}
                options={[
                  { value: "0", label: t("parentNone") },
                  ...categories.map((c) => ({
                    value: String(c.id),
                    label: c.name,
                  })),
                ]}
              />

              <TextArea
                id="category-description"
                label={t("description")}
                value={description}
                onChange={setDescription}
                hint={t("descriptionHint")}
                rows={3}
              />

              <div>
                <Button
                  icon="plus"
                  onClick={() => create.mutate()}
                  loading={create.isPending}
                  disabled={blocked}
                  title={trimmedName === "" ? t("addBlocked") : undefined}
                >
                  {t("addAction")}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </PageBody>
    </div>
  );
}
