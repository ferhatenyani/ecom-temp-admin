import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { TableSkeleton, RecordListSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for the parcels list.
 *
 * It mirrors the real screen's chrome rather than being a bare spinner: the same
 * header block, the same tab strip over the same toolbar row, and the same table
 * geometry at `md`+ with the same record list below it. A skeleton of the wrong
 * shape is a layout shift with extra steps.
 *
 * **Six body columns**, because six are visible by default — tracking · status ·
 * order · destination · provider · created. Delivery type and the COD amount sit
 * behind the column picker, and a stored preference cannot be read on the server
 * anyway, so this is the shape a first visit gets.
 *
 * **Four tab bands rather than eleven.** The real strip carries "all" plus the
 * ten statuses and scrolls; a placeholder that drew all of them would be drawing
 * a row of grey blocks off both edges of a 340px screen. Four is what fits at the
 * floor, and the strip's height — which is the only thing that can shift — is the
 * same either way.
 */
export default async function ShippingLoading() {
  const t = await getTranslations("shipping");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        actions={
          <>
            {/* The two real controls' boxes: a 36px icon button and the link to
                the tariff beside it, so the header does not reflow. */}
            <Skeleton className="size-9 rounded-ui-md" />
            <Skeleton className="h-9 w-24 rounded-ui-md" />
          </>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1 border-b border-ui-line">
              <Skeleton className="mb-1.5 h-7 w-14 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-20 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-16 rounded-ui-md" />
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
          <TableSkeleton rows={8} cols={6} label={label} />
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
