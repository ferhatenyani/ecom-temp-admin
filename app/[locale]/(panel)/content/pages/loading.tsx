import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { TableSkeleton, RecordListSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches page one.
 *
 * It mirrors the real screen's chrome rather than being a bare spinner: the same
 * back link and header block, the same three-tab strip over the same search row,
 * and the same table geometry at `md`+ with the same record list below it. A
 * skeleton of the wrong shape is a layout shift with extra steps — which is the
 * whole reason this file exists instead of a `<Spinner />`.
 *
 * **Three body columns**, because three are visible by default: title · path ·
 * modified. `id` is behind the column picker, and a stored preference cannot be
 * read on the server anyway, so this is the shape a first visit gets.
 *
 * The back link is a real one rather than a placeholder block: its destination
 * and its label are both known here, and a working way out of a loading screen
 * is worth more than a grey bar that becomes one.
 */
export default async function ContentPagesLoading() {
  const t = await getTranslations("content");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("section.pages")}
        subtitle={label}
        actions={
          <>
            {/* The two real controls' boxes: a 36px icon button and the create
                link beside it, so the header does not reflow. */}
            <Skeleton className="size-9 rounded-ui-md" />
            <Skeleton className="h-9 w-36 rounded-ui-md" />
          </>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            {/* Three bands rather than one bar: `FilterTabs` draws each tab as
                its own control, and a one-piece placeholder settles into three. */}
            <div className="flex items-center gap-1 border-b border-ui-line">
              <Skeleton className="mb-1.5 h-7 w-14 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-20 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-24 rounded-ui-md" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-full rounded-ui-md sm:w-80" />
              <Skeleton className="ms-auto hidden h-8 w-24 rounded-ui-md md:block" />
              <Skeleton className="hidden h-8 w-24 rounded-ui-md md:block" />
            </div>
          </div>
        }
      />
      <PageBody width="full">
        <div className="hidden md:block">
          <TableSkeleton rows={8} cols={3} label={label} />
        </div>
        {/* `DataTable` wraps the record list in the card and pads it by 8px below
            `md`, so the placeholder wears the same box or the rows step inward
            when the data arrives. */}
        <div className="ui-card p-2 md:hidden">
          <RecordListSkeleton rows={6} label={label} />
        </div>
        {/* The `searchMatches` footnote is unconditional on the real screen, so
            its line is part of first paint. */}
        <Skeleton className="mt-3 h-4 w-72 rounded-ui-sm" />
      </PageBody>
    </div>
  );
}
