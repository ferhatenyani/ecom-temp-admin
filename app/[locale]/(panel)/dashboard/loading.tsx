import { getTranslations } from "next-intl/server";
import { Scaffold } from "@/components/patterns/Scaffold";

/**
 * The dashboard's loading state.
 *
 * Cards rather than rows, at the real card height — `min-h-24` is what
 * `DashboardScreen` sets, and the hero spans the row there too. A skeleton of the
 * wrong shape is a layout shift with extra steps, which is the same reason
 * `SkeletonRows` is built from the row's own paddings rather than from a number
 * kept in step by hand.
 *
 * Seven tiles because **both card sets are seven**, which is the point of there
 * being two sets rather than one set with holes in it: with money the hero is net
 * revenue and collected sits beside it; without, the hero is orders placed and
 * completed and new customers take those two slots. The skeleton is therefore
 * honest for either tier without knowing which one is signing in.
 */
export default async function DashboardLoading() {
  const t = await getTranslations("analytics");

  return (
    <Scaffold
      title={t("dashboardTitle")}
      toolbar={
        <div className="flex flex-col gap-2">
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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {Array.from({ length: 7 }, (_, i) => (
            <div
              key={i}
              className={`skeleton min-h-24 rounded-lg ${i === 0 ? "col-span-2 md:col-span-3" : ""}`}
            />
          ))}
        </div>
      </div>
    </Scaffold>
  );
}
