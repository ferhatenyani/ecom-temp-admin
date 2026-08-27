import { getTranslations } from "next-intl/server";
import { MEDIA_PER_PAGE } from "@/lib/media";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { MediaGridSkeleton } from "@/components/ui/MediaGrid";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for `/media`, which had none while twenty other
 * routes did.
 *
 * It draws the real first paint rather than a spinner: the same header block,
 * the same two controls in it, and a **full page** of tiles at the real aspect
 * and the real gap, with the caption line under each one. §3.6 asks a skeleton
 * to mirror the box model, and a grid's box model is its *cell*.
 *
 * `MEDIA_PER_PAGE` tiles rather than a comfortable-looking dozen: the number is
 * exactly what the request asks for, so nothing under the grid moves when the
 * data lands. The pager below it is the one thing this cannot draw — it exists
 * only when the total exceeds a page, and the total is what has not arrived.
 *
 * There is no toolbar band, because the screen has no toolbar: no filter, no
 * search, no sort, and each absence is argued in `MediaLibrary`.
 *
 * It draws the reader who holds `ac_manage_content`. A Manager sees a forbidden
 * box where the grid is, which is not a shape a route-level skeleton can know:
 * the capability is on the session and this file runs before the fetch. Drawing
 * the majority screen and letting the refusal replace it is the honest trade.
 */
export default async function MediaLoading() {
  const t = await getTranslations("media");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        actions={
          <>
            <Skeleton className="size-9 rounded-ui-md" />
            <Skeleton className="h-9 w-32 rounded-ui-md" />
          </>
        }
      />
      <PageBody width="full">
        <MediaGridSkeleton label={label} count={MEDIA_PER_PAGE} />
      </PageBody>
    </div>
  );
}
