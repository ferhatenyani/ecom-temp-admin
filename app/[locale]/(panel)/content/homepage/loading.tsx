import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { FormSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for the homepage document.
 *
 * **Three section cards of two fields each**, because that is what a section
 * card is — a type `Select` over a `data` `TextArea` — and because this shop's
 * seeded document leaves five sections standing, of which three fit above the
 * fold at every width this panel is checked at. It cannot do better: `loading.tsx`
 * receives no props and no data, so it cannot know how many sections are coming.
 *
 * **It does not draw the drop report.** That block exists only on a document the
 * reader could not fully parse, so a placeholder for it would promise a warning
 * to every visit and then take it away — the opposite of what a skeleton is for.
 * A document that has one settles down by the height of the notice, which is the
 * right direction: content arriving, not content vanishing.
 *
 * No save bar either: it renders only when the form is dirty, and nothing is
 * dirty on first paint.
 */
export default async function HomepageLoading() {
  const t = await getTranslations("content");
  const label = t("loading");
  const locale = await getLocale();

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("section.homepage")}
        subtitle={label}
        back={{ href: `/${locale}/content`, label: t("title") }}
        actions={<Skeleton className="h-9 w-44 rounded-ui-md" />}
      />
      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }, (_, index) => (
            <FormSkeleton key={index} fields={2} label={label} />
          ))}
        </div>
      </PageBody>
    </div>
  );
}
