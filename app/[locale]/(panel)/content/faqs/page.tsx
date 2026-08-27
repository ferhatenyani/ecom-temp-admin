import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { faqList, faqCategoryList } from "@/lib/api/schemas/cms";
import {
  CMS_LIST_PER_PAGE,
  DEFAULT_STATUS_FILTER,
  isStatusFilter,
  type StatusFilter,
} from "@/lib/cms";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { FaqsList } from "./FaqsList";

export default async function FaqsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("content");

  if (!has(me, "ac_manage_content")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {/* No back link: `/content` is behind the same capability, so it could
            only send this reader to another forbidden screen. */}
        <PageHeader title={t("section.faqs")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_content" />
        </PageBody>
      </div>
    );
  }

  const requested = typeof raw.status === "string" ? raw.status : "";
  const status: StatusFilter = isStatusFilter(requested) ? requested : DEFAULT_STATUS_FILTER;

  const soften = (error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  };

  /*
   * The categories ride along because the drawer tags with them, not because
   * this screen filters by them — `?category=` was never measured, so there is
   * no category filter. A failure in either request is a degraded screen rather
   * than no screen.
   */
  const [faqs, categories] = await Promise.all([
    acFetch(
      faqList,
      session,
      `/cms/faqs?per_page=${CMS_LIST_PER_PAGE}&status=${status}`,
    ).catch(soften),
    acFetch(faqCategoryList, session, "/cms/faq-categories").catch(soften),
  ]);

  /* `meta.total` decides whether the reorder controls may be rendered at all —
     see `reorderBlock()`. This screen shipped fetching a hundred rows and never
     asking how many there were. */
  const meta = faqs?.meta ? listMeta.safeParse(faqs.meta) : null;

  return (
    <FaqsList
      locale={locale}
      initialStatus={status}
      initialFaqs={faqs?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
      initialCategories={categories?.data ?? null}
    />
  );
}
