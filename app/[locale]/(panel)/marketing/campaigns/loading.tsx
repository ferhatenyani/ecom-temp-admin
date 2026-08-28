import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { TableSkeleton, RecordListSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches page one and
 * the segment list beside it.
 *
 * It mirrors the real screen's chrome rather than being a bare spinner: the back
 * link, the header block with its two actions, the six-tab status strip, the
 * filter row's own geometry, and the same table at `md`+ with the record list
 * below. A skeleton of the wrong shape is a layout shift with extra steps.
 *
 * **Six body columns**, because six are visible by default and none of this
 * screen's columns is optional — name, subject, audience, recipients, updated,
 * created. A stored column preference cannot be read on the server anyway, so
 * this is the shape a first visit gets.
 *
 * **The filter row is three bands, not one**: the search box has no visible label
 * and the segment picker does, so the picker's placeholder carries an 18px label
 * band above its 36px box — `FilterRow align="end"` is what puts both boxes on
 * one line, and a one-piece placeholder would settle by that label's height the
 * moment the real header lands.
 */
export default async function CampaignsLoading() {
  const t = await getTranslations("campaigns");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("campaigns")}
        subtitle={label}
        actions={
          <>
            {/* A 36px icon button and the create button beside it, so the header
                does not reflow when the real controls land. */}
            <Skeleton className="size-9 rounded-ui-md" />
            <Skeleton className="h-9 w-44 rounded-ui-md" />
          </>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            {/* Six tabs — every status plus "all" — each its own control, because
                `FilterTabs` draws them separately and a one-piece bar settles
                into six. */}
            <div className="flex items-center gap-1 border-b border-ui-line">
              <Skeleton className="mb-1.5 h-7 w-16 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-20 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-24 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-20 rounded-ui-md" />
              <Skeleton className="mb-1.5 hidden h-7 w-20 rounded-ui-md sm:block" />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Skeleton className="h-9 w-full rounded-ui-md sm:w-80" />
              <div className="flex w-full flex-col gap-1.5 sm:w-56">
                <Skeleton className="h-3.5 w-20 rounded-ui-sm" />
                <Skeleton className="h-9 w-full rounded-ui-md" />
              </div>
              <Skeleton className="ms-auto hidden h-8 w-24 rounded-ui-md md:block" />
              <Skeleton className="hidden h-8 w-24 rounded-ui-md md:block" />
            </div>
          </div>
        }
      />
      <PageBody width="full">
        <div className="hidden md:block">
          <TableSkeleton rows={5} cols={6} label={label} />
        </div>
        <div className="ui-card p-2 md:hidden">
          <RecordListSkeleton rows={5} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
