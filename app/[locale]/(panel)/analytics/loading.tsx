import { getTranslations } from "next-intl/server";
import { Scaffold } from "@/components/patterns/Scaffold";
import { SkeletonRows } from "@/components/patterns/States";

/**
 * The loading state, and the reason it is a route file rather than a component.
 *
 * The range and the report are **URL state**, so changing either is a navigation
 * and the server fetches again — there is no client cache to render stale rows
 * from and no `isPending` to switch on. `loading.tsx` is the App Router's answer
 * to exactly that, and it is what stops a range change leaving the previous
 * report's figures on screen under a new window's label.
 *
 * Skeleton rows, never a centred spinner: a spinner reflows the page when data
 * lands and a skeleton does not. The pill rows above are drawn at their real
 * height for the same reason — the toolbar is the tallest thing that would
 * otherwise appear from nothing.
 */
export default async function AnalyticsLoading() {
  const t = await getTranslations("analytics");

  return (
    <Scaffold
      title={t("title")}
      toolbar={
        <div className="flex flex-col gap-3">
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="skeleton h-9 w-24 shrink-0 rounded-full" />
            ))}
          </div>
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="skeleton h-9 w-20 shrink-0 rounded-full" />
            ))}
          </div>
          <div className="skeleton h-4 w-48 rounded-sm" />
        </div>
      }
    >
      <div className="mx-auto max-w-3xl px-4">
        <SkeletonRows rows={6} />
      </div>
    </Scaffold>
  );
}
