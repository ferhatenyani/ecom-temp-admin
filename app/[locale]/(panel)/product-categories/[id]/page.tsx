import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { has } from "@/lib/capabilities";
import { productCategory, productCategories } from "@/lib/api/schemas/product";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { CategoryDetail } from "./CategoryDetail";

/**
 * One product category — edit + delete.
 *
 * Two reads: the target and the full list (up to 100 categories), the
 * second so the parent-picker can show every candidate. The list read is
 * unpaginated at 100, matching CategoriesScreen — the real limit is the
 * backend's per_page cap. A shop with more than 100 categories would need
 * the parent selector to become a searchable listbox; documented as a
 * follow-up in PLAN-FIXES.md rather than built here.
 */
export default async function ProductCategoryDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { session, me } = await requireSession(locale);

  if (!has(me, "ac_manage_products")) {
    const t = await getTranslations("categories");
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader title={t("title")} divided={false} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_products" />
        </PageBody>
      </div>
    );
  }

  if (!/^\d+$/.test(id)) notFound();

  const [current, all] = await Promise.all([
    acFetch(productCategory, session, `/product-categories/${id}`).catch(
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 404) notFound();
        throw error;
      },
    ),
    acFetch(productCategories, session, "/product-categories", {
      query: { per_page: 100 },
    }).catch(() => null),
  ]);

  return (
    <CategoryDetail
      locale={locale}
      initial={current.data}
      allCategories={all?.data ?? []}
    />
  );
}
