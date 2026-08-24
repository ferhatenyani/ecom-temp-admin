import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { TableSkeleton, RecordListSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches page one.
 *
 * It mirrors the real screen's chrome rather than being a bare spinner: the same
 * header block, the same one-row toolbar, and the same table geometry at `md`+
 * with the same record list below it. A skeleton of the wrong shape is a layout
 * shift with extra steps — which is the whole reason this file exists instead of
 * a `<Spinner />`.
 *
 * **Six body columns**, because six are visible by default: name · e-mail ·
 * phone · registered · id is five, and `TableSkeleton` draws the widths in a
 * cycle rather than per column — six keeps the band the same length as the
 * orders and products placeholders beside it, which is what stops the eye
 * catching a step when someone moves between the three lists. The column picker
 * holds city, consent and modified; a stored preference cannot be read on the
 * server anyway, so this is the shape a first visit gets.
 *
 * **There is no tab strip here**, unlike the products placeholder: `/customers`
 * has no filterable dimension to put in one. The toolbar is a search field and
 * the two `md`+ table controls, and the placeholders follow the same breakpoints
 * or the toolbar reflows when the real one lands.
 */
export default async function CustomersLoading() {
  const t = await getTranslations("customers");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        actions={
          <>
            {/* The two real controls' boxes: a 36px icon button and the export
                link beside it, so the header does not reflow. */}
            <Skeleton className="size-9 rounded-ui-md" />
            <Skeleton className="h-9 w-28 rounded-ui-md" />
          </>
        }
        toolbar={
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-full rounded-ui-md sm:w-80" />
            <Skeleton className="ms-auto hidden h-8 w-24 rounded-ui-md md:block" />
            <Skeleton className="hidden h-8 w-24 rounded-ui-md md:block" />
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
