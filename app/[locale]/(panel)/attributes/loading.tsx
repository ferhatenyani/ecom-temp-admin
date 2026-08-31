import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { CardSkeleton, FormSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton.
 *
 * **Two cards, because the real screen is two** — the list above and the create
 * form below — and the second is always on screen, including when the list is
 * empty. A placeholder drawing only the list would push the form down by a
 * card's height the moment the data arrived. `CategoriesScreen`'s skeleton makes
 * the same call for the same two-block shape.
 *
 * `FormSkeleton` with **two** fields rather than one, which is the difference
 * from that screen: this create card carries a name and a slug, and the slug box
 * is not optional decoration — an Arabic label derives an Arabic slug and a long
 * one is refused outright, so it is the only way through for a shop that names
 * things in Arabic.
 */
export default async function AttributesLoading() {
  const t = await getTranslations("attributes");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        actions={<Skeleton className="size-9 rounded-ui-md" />}
      />
      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          <CardSkeleton rows={3} label={label} titled={false} footnote={1} />
          <FormSkeleton fields={2} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
