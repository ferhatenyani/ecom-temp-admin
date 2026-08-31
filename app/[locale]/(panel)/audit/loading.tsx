import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { TableSkeleton, RecordListSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches page one.
 *
 * It mirrors the real screen's chrome rather than being a bare spinner: the same
 * header block with one icon button in it, the same filter row, and the same
 * table geometry at `md`+ with the same record list below it. A skeleton of the
 * wrong shape is a layout shift with extra steps — which is the whole reason this
 * file exists instead of a `<Spinner />`, and it did not exist at all before this
 * branch (40 of the 41 routes under `(panel)` had one; audit was the hole).
 *
 * **Four body columns**, because the table has exactly four and none is
 * `optional`: action · actor · resource · when. A stored column preference
 * cannot be read on the server anyway, so this is the shape a first visit gets.
 *
 * **Six filter controls over two rows, each drawn as a label over a box** —
 * `FieldFrame` is a label over a control, so a placeholder that drew the boxes
 * alone would shift the table by 18px plus the gap when the controls land. The
 * two rows are the real toolbar's, and why it is two rows rather than one is
 * measured in `AuditList`. Exactly one control per row carries a **hint** at
 * first paint — the actor picker's note that the system is not filterable, and
 * the date range's whole-day-UTC caveat — and each is drawn its own line count.
 *
 * Not drawn: the clear button, which is conditional on a filter being applied —
 * and a first paint of `/audit` with no query string has none.
 *
 * This used to name two more absentees, the date fields' `echo` readbacks. They
 * are gone from `AuditList` itself now that the picker is drawn and the field
 * reads in the page's own language, so there is nothing left to leave out; the
 * skeleton's shape is unchanged, because it never drew them. The actor picker is
 * drawn because
 * `/users` answers on every session that can open this page; if it ever does not,
 * the first row is one control narrower than this and the residual is 224px of
 * width on one line, not vertical shift.
 *
 * It draws the screen a Super Admin gets. Anyone else sees a forbidden box where
 * the table is, which is not a shape a route-level skeleton can know: the
 * capability is on the session and this file runs before `requireSession`.
 * Drawing the majority screen and letting the refusal replace it is the honest
 * trade; the alternative is a skeleton that matches nobody.
 */
export default async function AuditLoading() {
  const t = await getTranslations("audit");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        actions={<Skeleton className="size-9 rounded-ui-md" />}
        toolbar={
          /* Two `FilterRow align="start"`s in a `flex-col gap-3`, which is the
             real toolbar's own box — see `AuditList` for why it is two rows. */
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start gap-2">
              <Field className="sm:w-52" />
              <Field className="sm:w-52" />
              <Field className="sm:w-44" />
              <Field className="sm:w-56" hinted={2} />
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <Field className="sm:w-48" hinted={3} />
              <Field className="sm:w-48" />
              {/* `TableControls` is `hidden … md:flex`, its two triggers are
                  `Button size="sm"` — 28px — and `mt-6` is the label line plus
                  `FieldFrame`'s gap, exactly as the real row carries. */}
              <Skeleton className="ms-auto mt-6 hidden h-7 w-24 rounded-ui-md md:block" />
              <Skeleton className="mt-6 hidden h-7 w-24 rounded-ui-md md:block" />
            </div>
          </div>
        }
      />
      <PageBody width="full">
        <div className="hidden md:block">
          <TableSkeleton rows={8} cols={4} label={label} />
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

/**
 * One `FieldFrame`: a `--text-ui-label` line (1.125rem, `h-4.5`), a 6px gap, the
 * `.ui-field` box, and — where the real control carries one — its hint's own
 * lines. Every number is `Form.tsx`'s rather than a guess.
 *
 * `hinted` is a **line count** for the same reason `CardSkeleton`'s `described`
 * and `footnote` are: a paragraph's height is its own, and the count is taken at
 * 1440 in French, the house reference frame. The actor picker's note runs to two
 * lines in its 224px column and the date range's caveat to three in its 192px
 * one; Arabic sets both shorter, so this over-draws there by a line, which is the
 * trade `fix/skeleton-footnote` already recorded and calibrated the same way.
 * The hint sits inside `FieldFrame`'s `gap-1.5` column, so the gap arrives from
 * the parent exactly as the real `<p>`'s does.
 */
function Field({ className = "", hinted = 0 }: { className?: string; hinted?: number }) {
  return (
    <div className={`flex w-full flex-col gap-1.5 ${className}`}>
      <Skeleton className="h-4.5 w-24" />
      <Skeleton className="ui-field w-full rounded-ui-md" />
      {hinted > 0 ? (
        <div>
          {Array.from({ length: hinted }, (_, i) => (
            <Skeleton
              key={i}
              className={`h-4.5 ${i === hinted - 1 ? "w-2/3" : "w-full"}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
