import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { has } from "@/lib/capabilities";
import { faqList, faqCategoryList } from "@/lib/api/schemas/cms";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ForbiddenState } from "@/components/patterns/States";
import { FaqsList } from "./FaqsList";

export default async function FaqsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);

  if (!has(me, "ac_manage_content")) {
    const t = await getTranslations("content");
    return (
      <Scaffold title={t("section.faqs")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_content" />
        </div>
      </Scaffold>
    );
  }

  const soften = (error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  };

  const [faqs, categories] = await Promise.all([
    acFetch(faqList, session, "/cms/faqs?per_page=100&status=any").catch(soften),
    acFetch(faqCategoryList, session, "/cms/faq-categories").catch(soften),
  ]);

  return (
    <FaqsList
      locale={locale}
      initialFaqs={faqs?.data ?? null}
      initialCategories={categories?.data ?? null}
    />
  );
}
