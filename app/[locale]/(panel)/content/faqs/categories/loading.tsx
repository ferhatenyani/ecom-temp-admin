import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { CardSkeleton, FormSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for FAQ categories.
 *
 * **Two cards, because the real screen is two** — the list above and the create
 * form below — and the second is always on screen, including when the list is
 * empty. A placeholder that drew only the list would push the form down by a
 * card's height the moment the data arrived.
 *
 * `CardSkeleton` for the list because a category row *is* a label/value pair —
 * the name against the count of questions using it — which is the shape that
 * component is measured against. `FormSkeleton` with one field for the create
 * card, which is one `TextField` and a button.
 */
export default async function FaqCategoriesLoading() {
  const t = await getTranslations("content");
  const label = t("loading");
  const locale = await getLocale();

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("faqCategories.title")}
        subtitle={label}
        back={{ href: `/${locale}/content/faqs`, label: t("section.faqs") }}
        actions={<Skeleton className="size-9 rounded-ui-md" />}
      />
      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          <CardSkeleton rows={4} label={label} titled={false} footnote={1} />
          <FormSkeleton fields={1} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
