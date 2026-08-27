import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

/**
 * The index's first paint, while four counts are fetched in parallel.
 *
 * Six rows because there are six destinations and the set is fixed — this is one
 * of the few placeholders in the panel that can be exactly right rather than
 * approximately. `NavRow` is `min-h-11` with `py-2.5` and a bottom rule, and the
 * label is `--text-body`; the geometry below is that row with its icon, its label
 * and its chevron, so nothing steps when the real list lands.
 *
 * The header carries no action block: this screen has no primary action, so a
 * placeholder for one would settle into empty space.
 */
export default async function ContentLoading() {
  const t = await getTranslations("content");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader title={t("title")} subtitle={label} />
      <PageBody width="detail">
        <Card footnote={<Skeleton className="h-4 w-64 rounded-ui-sm" />}>
          <SkeletonRegion label={label}>
            <ul className="flex min-w-0 flex-col">
              {Array.from({ length: 6 }, (_, index) => (
                <li
                  key={index}
                  className="flex min-h-11 items-center gap-3 border-b border-ui-line py-2.5 last:border-b-0"
                >
                  <Skeleton className="size-4 shrink-0 rounded-ui-sm" />
                  <Skeleton className="h-4 w-32 rounded-ui-sm" />
                  <Skeleton className="ms-auto h-3 w-6 rounded-ui-sm" />
                  <Skeleton className="size-4 shrink-0 rounded-ui-sm" />
                </li>
              ))}
            </ul>
          </SkeletonRegion>
        </Card>
      </PageBody>
    </div>
  );
}
