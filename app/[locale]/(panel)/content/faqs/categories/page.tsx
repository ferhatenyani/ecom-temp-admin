import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { has } from "@/lib/capabilities";
import { faqCategoryList } from "@/lib/api/schemas/cms";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { CategoriesScreen } from "./CategoriesScreen";

/**
 * FAQ categories, as their own route.
 *
 * They used to be a `Sheet` nested inside the FAQ editor's own `Sheet`, and
 * DESIGN.md §3.1 rules on that directly — *"Never nested. A modal that needs a
 * second modal is a modal that needs steps."* A route is the honest version of
 * "steps" here, because managing categories is not a step of editing an FAQ at
 * all: different data, its own writes, its own empty state. It is reached from
 * the FAQ list's `PageHeader` and nowhere else, which is the same shape
 * `/inventory/movements` and `/shipping/rules` already take — no nav entry for a
 * screen you go to *from* somewhere.
 *
 * `GET /cms/faq-categories` exists only because §89's own table forgot it: `POST`
 * was listed and `GET` was not, so a panel could create a category it had no way
 * to list.
 */
export default async function FaqCategoriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("content");

  if (!has(me, "ac_manage_content")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {/* No back link: the FAQ list is behind the same capability. */}
        <PageHeader title={t("faqCategories.title")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_content" />
        </PageBody>
      </div>
    );
  }

  const initial = await acFetch(faqCategoryList, session, "/cms/faq-categories").catch(
    (error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    },
  );

  return <CategoriesScreen locale={locale} initialCategories={initial?.data ?? null} />;
}
