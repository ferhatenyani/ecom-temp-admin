import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { BannerRowsSkeleton } from "./skeleton";

/**
 * The route-level skeleton for the banner strip.
 *
 * It draws the real chrome rather than a spinner: the back link, the two header
 * controls, the three-tab status strip and one placement card of four rows. A
 * skeleton of the wrong shape is a layout shift with extra steps.
 *
 * **`loading.tsx` receives no props** — not `params`, not `searchParams` — so it
 * cannot know which status tab is coming, and it does not need to: every tab
 * renders the same box. `getLocale()` is how a file with no `params` addresses a
 * localised route, which is what the back link needs; omitting the link would
 * settle the whole page upward by 28px the moment the data landed.
 *
 * Three tab bands rather than one bar, because `FilterTabs` draws each tab as
 * its own control and a one-piece placeholder settles into three.
 */
export default async function BannersLoading() {
  const t = await getTranslations("content");
  const label = t("loading");
  const locale = await getLocale();

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("section.banners")}
        subtitle={label}
        back={{ href: `/${locale}/content`, label: t("title") }}
        actions={
          <>
            <Skeleton className="size-9 rounded-ui-md" />
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
        <BannerRowsSkeleton label={label} />
      </PageBody>
    </div>
  );
}
