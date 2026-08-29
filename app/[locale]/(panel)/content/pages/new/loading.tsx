import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { FormSkeleton } from "@/components/ui/Skeleton";

/**
 * The create screen's first paint.
 *
 * The same four cards as the edit form, with **two fewer fields**: there is no
 * read-only current path and no modified stamp on a page that does not exist
 * yet, and the real screen omits both. A placeholder copied from the edit route
 * would settle upwards by two rows.
 *
 * **No action block in the header**, for the same reason: the delete menu is
 * `mode === "edit"` only.
 *
 * The save bar *is* absent here too, and that is the one place this differs from
 * the real screen by a deliberate margin: create renders `SaveBar persistent`, so
 * the bar is there from first paint. It is `sticky bottom-0` inside the column
 * rather than in flow above it, so drawing it would put a second bar under a
 * column of grey cards for the few hundred milliseconds this file is on screen,
 * and it costs no layout when it arrives.
 */
export default async function NewContentPageLoading() {
  const locale = await getLocale();
  const t = await getTranslations("content");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("pages.newTitle")}
        subtitle={label}
        back={{ href: `/${locale}/content/pages`, label: t("section.pages") }}
        divided={false}
      />

      <PageBody width="form">
        <div className="flex flex-col gap-4">
          <FormSkeleton fields={3} label={label} />
          <FormSkeleton fields={2} footnote={2} label={label} />
          <FormSkeleton fields={2} label={label} />
          <FormSkeleton fields={5} footnote={1} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
