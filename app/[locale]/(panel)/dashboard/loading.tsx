import { getTranslations } from "next-intl/server";
import { PageBody, PageHeader } from "@/components/ui/PageHeader";
import { Skeleton, StatSkeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for `/dashboard`.
 *
 * It draws the real screen's chrome rather than a bare spinner: the same header
 * block, the same six-preset tab strip over the same applied-window line, the
 * same seven tiles in the same grid with the lead card double-width, and the
 * three footnotes underneath. A skeleton of the wrong shape is a layout shift
 * with extra steps.
 *
 * **Seven tiles because both card sets are seven**, which is the point of there
 * being two sets rather than one set with holes in it: with money the lead is net
 * revenue and collected sits beside it; without, the lead is orders placed and
 * completed and new customers take those two slots. The placeholder is therefore
 * honest for either tier without knowing which one is signing in — which it could
 * not know anyway, since this file runs before the fetch and the capability is on
 * the session.
 *
 * `StatSkeleton` carries every measurement, and it is `Stat`'s own box model
 * rather than a set of heights that happen to look close — see its docblock.
 *
 * **The "as of" line is drawn too.** It is not decoration on this screen: the
 * report sits behind a 60-second server cache, so the stamp is the only thing
 * that says how old the figures under it may be, and it is present on every
 * first paint that has data. A placeholder that omitted it would shift the whole
 * grid down by a line the moment the payload landed.
 */
export default async function DashboardLoading() {
  const t = await getTranslations("analytics");
  const tStates = await getTranslations("states");
  const label = tStates("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("dashboardTitle")}
        /* The "as of" line, at the height `PageHeader` gives a subtitle. */
        subtitle={<Skeleton className="h-4.5 w-56" />}
        toolbar={
          <div className="flex flex-col gap-2">
            {/*
              The tab strip's own geometry — `FilterTabs` bleeds its gutter with
              a negative inline margin and closes on a rule. Its tabs are
              `min-h-10`, so a 20px bar inside `my-2.5` is a band of exactly the
              40px the real strip measures; that height is the only thing here
              that can shift.

              Four bands rather than six: six grey blocks would run off both
              edges of a 340px screen, and the band's height is the same either
              way.
            */}
            <div className="-mx-4 sm:-mx-6 xl:-mx-8">
              <div className="flex items-center gap-1 border-b border-ui-line px-4 sm:px-6 xl:px-8">
                <Skeleton className="my-2.5 h-5 w-16 rounded-ui-md" />
                <Skeleton className="my-2.5 h-5 w-12 rounded-ui-md" />
                <Skeleton className="my-2.5 h-5 w-14 rounded-ui-md" />
                <Skeleton className="my-2.5 h-5 w-16 rounded-ui-md" />
              </div>
            </div>
            <Skeleton className="h-4 w-48" />
          </div>
        }
      />

      <PageBody width="wide">
        <div className="flex flex-col gap-6">
          <StatSkeleton count={7} wide label={label} />
          {/* Three footnotes at `--text-label`'s own line box, in the `gap-2`
              column the real ones stack in. */}
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4.5 w-full max-w-160" />
            <Skeleton className="h-4.5 w-full max-w-160" />
            <Skeleton className="h-4.5 w-full max-w-120" />
          </div>
        </div>
      </PageBody>
    </div>
  );
}
