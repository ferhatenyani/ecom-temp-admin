import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { TableSkeleton, RecordListSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches page one.
 *
 * It mirrors the real screen's chrome rather than being a bare spinner: the same
 * header block with one labelled button in it, the same tab strip over the same
 * filter row, and the same table geometry at `md`+ with the same record list
 * below it. A skeleton of the wrong shape is a layout shift with extra steps —
 * which is the whole reason this file exists instead of a `<Spinner />`.
 *
 * **Five body columns**, because five are visible by default: name · login ·
 * role · registered · status. The e-mail is behind the column picker — six did
 * not fit, and the one that had to go was the widest and least load-bearing;
 * `columns.tsx` carries the measurement — and a stored preference cannot be read
 * on the server anyway, so this is the shape a first visit gets.
 *
 * **Three tab bands**, which is the whole strip: "all" plus the two statuses.
 *
 * **The filter row is drawn as a search box and one labelled picker.** `Select`
 * sits in a `FieldFrame`, which is a label over a control, so the real row is
 * 18px taller than a row of plain boxes and a placeholder that drew the box alone
 * would shift the table by that much when the controls land. The clear button is
 * not drawn — it is `filtered`-only, and a first paint of `/users` with no query
 * string does not have it.
 *
 * **Two action boxes**: a 36px icon button for the refresh and the create link
 * beside it, so the header does not reflow when the controls land. The refresh is
 * not decoration — `UsersList.tsx` records why it is the only control on this
 * screen that can reach §3.7-4's failed-refetch state.
 *
 * It draws the screen a Super Admin gets, which is the only credential that can
 * open this section at all — `ac_manage_users` is Super Admin's alone. Everybody
 * else sees a forbidden box where the table is, which is not a shape a
 * route-level skeleton can know: the capability is on the session and this file
 * runs before `requireSession`.
 */
export default async function UsersLoading() {
  const t = await getTranslations("staff");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        actions={
          <>
            <Skeleton className="size-9 rounded-ui-md" />
            <Skeleton className="h-9 w-36 rounded-ui-md" />
          </>
        }
        toolbar={
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1 border-b border-ui-line">
              <Skeleton className="mb-1.5 h-7 w-14 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-16 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-20 rounded-ui-md" />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {/* `SearchField` carries no label of its own, so its box sits on the
                  row's baseline rather than under one. */}
              <Skeleton className="ui-field w-full rounded-ui-md sm:w-80" />
              {/* Label over control, matching `FieldFrame`'s `gap-1.5`. */}
              <div className="flex w-full flex-col gap-1.5 sm:w-56">
                <Skeleton className="h-4.5 w-24" />
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
