import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { FaqRowsSkeleton } from "./skeleton";

/**
 * The route-level skeleton for the FAQ list.
 *
 * The header carries **three** action boxes, because the real one does: refresh,
 * the link to the categories route, and the create button. A placeholder with
 * two would reflow the whole header row the moment the data landed.
 *
 * `loading.tsx` takes no props, so it cannot know which status tab is coming and
 * does not need to — every tab renders the same box. `getLocale()` is how a file
 * with no `params` addresses a localised route, which the back link needs.
 */
export default async function FaqsLoading() {
  const t = await getTranslations("content");
  const label = t("loading");
  const locale = await getLocale();

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("section.faqs")}
        subtitle={label}
        back={{ href: `/${locale}/content`, label: t("title") }}
        actions={
          <>
            <Skeleton className="size-9 rounded-ui-md" />
            <Skeleton className="h-9 w-32 rounded-ui-md" />
            <Skeleton className="h-9 w-44 rounded-ui-md" />
          </>
        }
        toolbar={
          <div className="-mx-4 sm:-mx-6 xl:-mx-8">
            <div className="flex items-center gap-1 border-b border-ui-line px-4 sm:px-6 xl:px-8">
              <Skeleton className="mb-1.5 h-7 w-14 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-20 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-24 rounded-ui-md" />
            </div>
          </div>
        }
      />
      <PageBody width="detail">
        <FaqRowsSkeleton label={label} />
      </PageBody>
    </div>
  );
}
