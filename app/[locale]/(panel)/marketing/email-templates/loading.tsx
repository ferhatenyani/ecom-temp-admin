import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { TableSkeleton, RecordListSkeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for the template list.
 *
 * **No actions and no toolbar**, and both absences are the screen: there is
 * nothing to create — templates are authored in wp-admin — and nothing to search,
 * sort or filter, because paging is this route's whole query contract. A
 * placeholder drawing either would promise a control the real screen does not
 * have.
 *
 * **Five body columns**: name, subject, unknown tokens, unsubscribe, modified.
 */
export default async function EmailTemplatesLoading() {
  const t = await getTranslations("campaigns");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader title={t("templates")} subtitle={label} />
      <PageBody width="full">
        <div className="hidden md:block">
          <TableSkeleton rows={3} cols={5} label={label} />
        </div>
        <div className="ui-card p-2 md:hidden">
          <RecordListSkeleton rows={3} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
