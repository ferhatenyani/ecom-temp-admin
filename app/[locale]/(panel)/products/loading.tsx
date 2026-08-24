import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { TableSkeleton, RecordListSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches page one
 * and the three vocabulary requests beside it.
 *
 * It mirrors the real screen's chrome rather than being a bare spinner: the same
 * header block, the same toolbar height, and the same table geometry at `md`+
 * with the same record list below it. A skeleton of the wrong shape is a layout
 * shift with extra steps — which is the whole reason this file exists instead of
 * a `<Spinner />`.
 *
 * Six body columns, because six are visible by default: name · sku · created ·
 * stock · price · status. The rest are behind the column picker and a stored
 * preference cannot be read on the server anyway, so this is the shape a first
 * visit gets.
 */
export default async function ProductsLoading() {
  const t = await getTranslations("products");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={t("loading")}
        toolbar={
          <div className="flex flex-col gap-3">
            {/* The tab strip's height, so the table does not jump when it lands.
                Five tabs: all, publish, draft, pending, private. */}
            <div className="-mx-4 border-b border-ui-line px-4 sm:-mx-6 sm:px-6 xl:-mx-8 xl:px-8">
              <div className="flex items-center gap-4 pb-2.5">
                {[12, 16, 20, 20, 14].map((w, i) => (
                  <Skeleton key={i} className={`h-4 w-${w}`} />
                ))}
              </div>
            </div>
            {/* The Filters button is there at every width; the density and
                column controls are `md`+ only, because below that they would act
                on a table nobody is looking at. The placeholders follow the same
                breakpoints or the toolbar reflows when the real one lands. */}
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-full rounded-ui-md sm:w-80" />
              <Skeleton className="h-8 w-20 rounded-ui-md" />
              <Skeleton className="ms-auto hidden h-8 w-24 rounded-ui-md md:block" />
              <Skeleton className="hidden h-8 w-24 rounded-ui-md md:block" />
            </div>
          </div>
        }
      />
      <PageBody width="full">
        <div className="hidden md:block">
          <TableSkeleton rows={8} cols={6} label={t("loading")} />
        </div>
        {/* `DataTable` wraps the record list in the card and pads it by 8px below
            `md`, so the placeholder wears the same box or the rows step inward
            when the data arrives. */}
        <div className="ui-card p-2 md:hidden">
          <RecordListSkeleton rows={6} label={t("loading")} />
        </div>
      </PageBody>
    </div>
  );
}
