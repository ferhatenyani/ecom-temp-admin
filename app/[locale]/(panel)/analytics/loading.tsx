import { getTranslations } from "next-intl/server";
import { PageBody, PageHeader } from "@/components/ui/PageHeader";
import { CardSkeleton, Skeleton, StatSkeleton } from "@/components/ui/Skeleton";

/**
 * The loading state, and the reason it is a route file rather than a component.
 *
 * The range and the report are **URL state**, so changing either is a navigation
 * and the server fetches again — there is no client cache to render stale rows
 * from and no `isPending` to switch on. `loading.tsx` is the App Router's answer
 * to exactly that, and it is what stops a range change leaving the previous
 * report's figures on screen under a new window's label.
 *
 * ## It draws the real screen, and that is a correction
 *
 * This was `SkeletonRows rows={6}` inside a `max-w-3xl` stripe, against a real
 * first paint of a headline row and two to five titled sections at 1440 — a
 * layout shift with extra steps, which is the one thing §3.6 says a skeleton must
 * not be. It now draws the header block, the six-report tab strip, the labelled
 * range chips over the applied-window line, the "as of" line, four stat tiles and
 * two titled cards.
 *
 * **Four tiles and two cards is the shape of four of the six reports**, and of
 * `revenue`, which is `DEFAULT_VIEW` and therefore what `/analytics` with no
 * query renders. It cannot be better than that: `loading.tsx` receives no
 * `searchParams` in the App Router, so it cannot know which report is coming.
 * `products` lands one tile wide of this and `cod` has no headline row at all —
 * both settle by a single row rather than by the whole page, which is what the
 * old placeholder shifted by.
 *
 * The chrome above is the tall part and it is identical for all six, which is
 * what makes drawing it precisely worth more than guessing the body.
 */
export default async function AnalyticsLoading() {
  const t = await getTranslations("analytics");
  const tStates = await getTranslations("states");
  const label = tStates("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        /* The "as of" line, at the height `PageHeader` gives a subtitle. It is
           not decoration here: the reports sit behind a 60-second server cache,
           so the stamp is the only thing that says how old the figures under it
           may be, and it is present on every first paint that has data. */
        subtitle={<Skeleton className="h-4.5 w-56" />}
        toolbar={
          <div className="flex flex-col gap-3">
            {/*
              The report strip's own geometry — `FilterTabs` bleeds its gutter
              with a negative inline margin and closes on a rule. Its tabs are
              `min-h-10`, so a 20px bar inside `my-2.5` is a band of exactly the
              40px the real strip measures; that height is the only thing here
              that can shift.

              Four bands rather than six: six grey blocks would run off both
              edges of a 340px screen, and the band's height is the same either
              way.
            */}
            <div className="-mx-4 sm:-mx-6 xl:-mx-8">
              <div className="flex items-center gap-1 border-b border-ui-line px-4 sm:px-6 xl:px-8">
                <Skeleton className="my-2.5 h-5 w-28" />
                <Skeleton className="my-2.5 h-5 w-20" />
                <Skeleton className="my-2.5 h-5 w-16" />
                <Skeleton className="my-2.5 h-5 w-14" />
              </div>
            </div>

            {/* The range, in its `chips` shape: a visible label beside pills
                that are `min-h-9`, so an 18px block inside `my-1.5` is the same
                36px band. Then the applied-window line. */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4.5 w-16" />
                <Skeleton className="my-1.5 h-4.5 w-20 rounded-ui-md" />
                <Skeleton className="my-1.5 h-4.5 w-16 rounded-ui-md" />
                <Skeleton className="my-1.5 h-4.5 w-16 rounded-ui-md" />
              </div>
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        }
      />

      <PageBody width="wide">
        <div className="flex flex-col gap-6">
          <StatSkeleton count={4} label={label} />
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <CardSkeleton rows={4} footnote={2} label={label} />
            <CardSkeleton rows={4} label={label} />
          </div>
        </div>
      </PageBody>
    </div>
  );
}
