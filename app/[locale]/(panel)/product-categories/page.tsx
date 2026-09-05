import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { has } from "@/lib/capabilities";
import { productCategories } from "@/lib/api/schemas/product";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { CategoriesScreen } from "./CategoriesScreen";

/**
 * Product-category CRUD — round-6.
 *
 * `ac_manage_products`, because that is what CategoryController guards
 * every route with. Same capability as `products` above in the nav, so the
 * two appear and disappear together and this can never be the link that
 * leads a reader to a forbidden screen.
 *
 * Prefetched on the server so the list is on screen in the first paint;
 * the create form still renders even when the read fails, because a
 * screen that refuses everything for one broken query hides the control
 * a person came for.
 */
export default async function ProductCategoriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
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

  const initial = await acFetch(
    productCategories,
    session,
    "/product-categories",
    { query: { per_page: 100 } },
  ).catch((error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  });

  return (
    <CategoriesScreen locale={locale} initialCategories={initial?.data ?? null} />
  );
}
