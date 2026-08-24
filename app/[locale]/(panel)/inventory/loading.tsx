import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { TableSkeleton, RecordListSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches page one.
 *
 * There was none for any of the three inventory routes before this branch, which
 * meant a cold navigation to the panel's most-used warehouse screen painted
 * nothing at all until the fetch landed. It mirrors the real screen's chrome
 * rather than being a spinner: the same header block, the same tab strip, the
 * same two-control toolbar, and the same table geometry at `md`+ with the same
 * record list below it.
 *
 * **Five body columns**, because five are visible by default — name · SKU ·
 * state · quantity · threshold. The picker holds type, backorders and the id; a
 * stored preference cannot be read on the server, so this is the shape a first
 * visit gets.
 *
 * **The tab strip is drawn and the search field is not.** The strip exists on
 * both views; the search box and the Filters button exist only on `all`, and the
 * default view is `low`. Drawing them would settle downwards on the screen this
 * placeholder is shown for most often. The SKU lookup is on both views, so its
 * box is here.
 */
export default async function InventoryLoading() {
  const t = await getTranslations("inventory");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        actions={
          <>
            {/* The three real controls' boxes: a 36px icon button and the two
                links beside it, so the header does not reflow. */}
            <Skeleton className="size-9 rounded-ui-md" />
            <Skeleton className="h-9 w-32 rounded-ui-md" />
            <Skeleton className="h-9 w-28 rounded-ui-md" />
          </>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            <div className="-mx-4 border-b border-ui-line px-4 sm:-mx-6 sm:px-6 xl:-mx-8 xl:px-8">
              <div className="flex items-center gap-4 pb-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-24" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="ui-field w-full rounded-ui-md sm:w-72" />
              <Skeleton className="ms-auto hidden h-8 w-24 rounded-ui-md md:block" />
              <Skeleton className="hidden h-8 w-24 rounded-ui-md md:block" />
            </div>
            <Skeleton className="h-4.5 w-72" />
          </div>
        }
      />
      <PageBody width="full">
        <div className="hidden md:block">
          <TableSkeleton rows={8} cols={5} label={label} />
        </div>
        {/* `DataTable` wraps the record list in the card and pads it by 8px below
            `md`, so the placeholder wears the same box or the rows step inward
            when the data arrives. */}
        <div className="ui-card p-2 md:hidden">
          <RecordListSkeleton rows={6} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
