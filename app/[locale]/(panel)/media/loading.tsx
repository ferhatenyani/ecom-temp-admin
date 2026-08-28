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
 * **There is a toolbar band now, and it is the whole reason this file was
 * touched.** The screen grew a sort chip group and a search field on the branch
 * that measured both parameters, so a placeholder without them would settle 84px
 * short and push the entire grid down the moment the real header landed — which
 * is precisely the failure `loading.tsx` exists to prevent.
 *
 * The sort group went from two pills to four on 2026-08-28, when `orderby=title`
 * got the fixture it needed. **The band's height did not move**, because the
 * chip group scrolls rather than wraps — so what changed here is the number of
 * pills and the scroll container that keeps them from widening the page, not any
 * measurement below them.
 *
 * The two bands are drawn from the real controls' own utilities rather than from
 * heights that happen to look close: `min-h-9 ui-chip` is what `FilterTabs`
 * gives a pill and `ui-field` is what `SearchField` gives its box, so both match
 * at 36px on a pointer **and** at 44px on touch. A fixed `h-9` would have been
 * right on a laptop and 8px short on every phone, which is the shape of hole
 * `.ui-field` was written to close.
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
        toolbar={
          <div className="flex flex-col gap-3">
            {/* The sort group: its visible label at `--text-label`'s own line
                box, then the four pills at the height `.ui-chip` gives them. */}
            <div className="flex min-w-0 items-center gap-2">
              <Skeleton className="h-4.5 shrink-0 w-8" />
              {/*
                `gap-1` between the pills and `gap-2` after the label, which is
                `FilterTabs`'s own pair of gaps in its `chips` shape.

                **`overflow-x-auto` and `shrink-0` are load-bearing now that
                there are four.** Four 112px pills plus their gaps is 460px, well
                past the 340px floor, and a plain flex row would push the page
                itself sideways — the one thing §8 forbids outright. The real
                control scrolls instead of wrapping, for the same reason, so
                copying its `ui-tabs-scroll` here keeps the band exactly one row
                tall at every width and keeps this file matching first paint.
              */}
              <div className="ui-tabs-scroll flex min-w-0 items-center gap-1 overflow-x-auto">
                <Skeleton className="ui-chip min-h-9 w-28 shrink-0 rounded-ui-md" />
                <Skeleton className="ui-chip min-h-9 w-28 shrink-0 rounded-ui-md" />
                <Skeleton className="ui-chip min-h-9 w-20 shrink-0 rounded-ui-md" />
                <Skeleton className="ui-chip min-h-9 w-20 shrink-0 rounded-ui-md" />
              </div>
            </div>
            {/*
              The search box, drawn as the box it is rather than as a bar of the
              same nominal height. `SearchField` is a 1px-bordered `form` around
              a `.ui-field` input, and `box-sizing` is border-box everywhere — so
              a single skeleton carrying both `ui-field` and `border` measures 36
              and not 38, and the band lands 2px short at every width. Measured:
              real toolbar 86px at 1440, a one-piece skeleton 84.

              The border therefore belongs to a wrapper, exactly as it does in
              the real control, and the fill inside it is the `.ui-field`
              interior. 38px on a pointer, 46px on touch, both matching.

              Full-bleed at the 340px floor and capped at 320px from `sm` up,
              which is `SearchField`'s own `sm:max-w-80`.
            */}
            <div className="w-full overflow-hidden rounded-ui-md border border-ui-line-control sm:w-80">
              <Skeleton className="ui-field" />
            </div>
          </div>
        }
      />
      <PageBody width="full">
        <MediaGridSkeleton label={label} count={MEDIA_PER_PAGE} />
      </PageBody>
    </div>
  );
}
