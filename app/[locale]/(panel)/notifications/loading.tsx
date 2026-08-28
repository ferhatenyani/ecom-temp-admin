import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { TableSkeleton, RecordListSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches page one.
 *
 * It mirrors the real screen's chrome rather than being a bare spinner: the same
 * header block with one icon button in it, the same tab strip over the same
 * filter row, and the same table geometry at `md`+ with the same record list
 * below it. A skeleton of the wrong shape is a layout shift with extra steps —
 * which is the whole reason this file exists instead of a `<Spinner />`.
 *
 * **Six body columns**, because six are visible by default: event · recipient ·
 * audience · last error · created · state. Attempts is behind the column picker,
 * and a stored preference cannot be read on the server anyway, so this is the
 * shape a first visit gets.
 *
 * **Four tab bands**, which is the whole strip: "all" plus the three statuses.
 *
 * **The filter row is drawn as two labelled pickers**, not as two bare boxes:
 * `FieldFrame` is a label over a control, so the real row is 18px taller than a
 * row of plain inputs and a placeholder that drew the boxes alone would shift the
 * table by that much when the controls land. The clear button and the chips are
 * not drawn — both are `filtered`-only, and a first paint of `/notifications`
 * with no query string has neither.
 *
 * It draws the screen a Super Admin, a Manager and a Support Agent all get. A
 * Marketing Manager sees a forbidden box where the table is, which is not a shape
 * a route-level skeleton can know: the capability is on the session and this file
 * runs before `requireSession`. Drawing the majority screen and letting the
 * refusal replace it is the honest trade; the alternative is a skeleton that
 * matches nobody.
 */
export default async function NotificationsLoading() {
  const t = await getTranslations("notifications");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        actions={<Skeleton className="size-9 rounded-ui-md" />}
        toolbar={
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1 border-b border-ui-line">
              <Skeleton className="mb-1.5 h-7 w-14 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-20 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-20 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-20 rounded-ui-md" />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {/* Label over control, matching `FieldFrame`'s `gap-1.5`. */}
              <div className="flex w-full flex-col gap-1.5 sm:w-44">
                <Skeleton className="h-4.5 w-20" />
                <Skeleton className="ui-field w-full rounded-ui-md" />
              </div>
              <div className="flex w-full flex-col gap-1.5 sm:w-44">
                <Skeleton className="h-4.5 w-20" />
                <Skeleton className="ui-field w-full rounded-ui-md" />
              </div>
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
