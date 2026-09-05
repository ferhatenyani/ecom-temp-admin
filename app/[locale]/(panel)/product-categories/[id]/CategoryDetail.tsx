"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProductCategory } from "@/lib/api/schemas/product";
import { BrowserApiError, acWriteWithMeta } from "@/lib/api/browser";
import { decodeEntities } from "@/lib/format/html";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button, IconButton } from "@/components/ui/Button";
import { TextField, TextArea, Select } from "@/components/ui/Form";
import { ConfirmDialog, useConfirm } from "@/components/ui/Confirm";
import { Notice } from "@/components/ui/States";
import { Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

type DeleteKind = { force: boolean; count: number };

/**
 * One product category — edit its name, slug, parent and description,
 * or delete it. Two delete flows:
 *
 *   - Empty category → single confirm, `DELETE /product-categories/{id}`.
 *   - Non-empty category → first delete returns a 400 with `count`.
 *     The confirm re-opens naming the count and offering to detach and
 *     delete (`?force=true`), matching the backend contract from
 *     CategoryController::destroy().
 */
export function CategoryDetail({
  locale,
  initial,
  allCategories,
}: {
  locale: string;
  initial: ProductCategory;
  allCategories: readonly ProductCategory[];
}) {
  const t = useTranslations("categories");
  const tStates = useTranslations("states");
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const confirm = useConfirm<DeleteKind>();

  const [current, setCurrent] = useState<ProductCategory>(initial);
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [parent, setParent] = useState(String(initial.parent ?? 0));
  const [description, setDescription] = useState(initial.description ?? "");
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [slugError, setSlugError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);

  const parentOptions = useMemo(() => {
    // Never let a category pick itself as parent (the backend refuses too).
    const others = allCategories.filter((c) => c.id !== current.id);
    return [
      { value: "0", label: t("parentNone") },
      ...others.map((c) => ({ value: String(c.id), label: c.name })),
    ];
  }, [allCategories, current.id, t]);

  const dirty =
    name.trim() !== current.name ||
    slug.trim() !== current.slug ||
    Number(parent) !== (current.parent ?? 0) ||
    description !== (current.description ?? "");

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      if (name.trim() !== current.name) payload.name = name.trim();
      if (slug.trim() !== current.slug) payload.slug = slug.trim();
      if (Number(parent) !== (current.parent ?? 0)) payload.parent = Number(parent);
      if (description !== (current.description ?? "")) payload.description = description;
      return acWriteWithMeta<ProductCategory>(
        "PATCH",
        `/product-categories/${current.id}`,
        payload,
      );
    },
    onSuccess: ({ data }) => {
      setCurrent(data);
      setName(data.name);
      setSlug(data.slug);
      setParent(String(data.parent ?? 0));
      setDescription(data.description ?? "");
      setNameError(undefined);
      setSlugError(undefined);
      setFormError(null);
      // The list on the previous route caches by `["product-categories"]`;
      // bust it so an edited name/slug is up to date if the user goes back.
      void queryClient.invalidateQueries({ queryKey: ["product-categories"] });
      toast.show(t("saved"));
    },
    onError: (caught: unknown) => {
      if (caught instanceof BrowserApiError) {
        const fields = caught.fields ?? {};
        setNameError(fields.name);
        setSlugError(fields.slug);
        const other = Object.keys(fields).filter(
          (k) => k !== "name" && k !== "slug",
        );
        if (other.length > 0) {
          setFormError(other.map((k) => fields[k]).join(" "));
        } else if (fields.name === undefined && fields.slug === undefined) {
          setFormError(caught.message);
        }
        return;
      }
      if (caught instanceof Error) setFormError(caught.message);
    },
  });

  const del = useMutation({
    mutationFn: (force: boolean) =>
      acWriteWithMeta<{ id: number; deleted: true }>(
        "DELETE",
        `/product-categories/${current.id}${force ? "?force=true" : ""}`,
      ),
    onSuccess: () => {
      confirm.close();
      toast.show(t("deleted"));
      // Bust the list's react-query cache so the row is gone by the
      // time the redirect renders. `router.refresh()` re-runs the RSC,
      // but useQuery keeps its cached data across that render unless
      // we invalidate here.
      void queryClient.invalidateQueries({ queryKey: ["product-categories"] });
      router.push(`/${locale}/product-categories`);
      router.refresh();
    },
    onError: (caught: unknown) => {
      // Non-empty categories 400 with `count`. Re-open the confirm asking
      // the reader to accept detaching the products.
      if (caught instanceof BrowserApiError) {
        const details = caught.details ?? {};
        const count =
          typeof details.count === "number" ? details.count : current.count;
        confirm.close();
        confirm.ask({ force: true, count });
        return;
      }
      confirm.close();
      if (caught instanceof Error) setFormError(caught.message);
    },
  });

  const kind = confirm.target;

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("detailTitle", { name: decodeEntities(current.name) })}
        back={{ href: `/${locale}/product-categories`, label: t("back") }}
        actions={
          <IconButton
            label={t("deleteAction")}
            icon="trash"
            variant="destructive"
            onClick={() => confirm.ask({ force: false, count: current.count })}
            loading={del.isPending}
          />
        }
      />

      <PageBody width="detail">
        <Card>
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
                if (nameError) setNameError(undefined);
                if (formError) setFormError(null);
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
                if (slugError) setSlugError(undefined);
                if (formError) setFormError(null);
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
              options={parentOptions}
            />

            <TextArea
              id="category-description"
              label={t("description")}
              value={description}
              onChange={setDescription}
              hint={t("descriptionHint")}
              rows={4}
            />

            <div>
              <Button
                icon="check"
                onClick={() => save.mutate()}
                loading={save.isPending}
                disabled={!dirty}
                title={!dirty ? t("saveBlocked") : undefined}
              >
                {t("save")}
              </Button>
            </div>
          </div>
        </Card>
      </PageBody>

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={confirm.onOpenChange}
        title={t("deleteTitle")}
        body={
          kind === null
            ? ""
            : kind.force
              ? t("deleteBlocked", { count: kind.count })
              : t("deleteBody")
        }
        confirmLabel={kind?.force ? t("deleteForce") : t("deleteAction")}
        onConfirm={() => del.mutate(kind?.force ?? false)}
        loading={del.isPending}
      />
    </div>
  );
}
