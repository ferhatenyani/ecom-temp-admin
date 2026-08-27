import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { has } from "@/lib/capabilities";
import { homepage, homepageProblems } from "@/lib/api/schemas/cms";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { HomepageEditor } from "./HomepageEditor";

export default async function HomepagePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("content");

  if (!has(me, "ac_manage_content")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {/* No back link: `/content` is behind the same capability. */}
        <PageHeader title={t("section.homepage")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_content" />
        </PageBody>
      </div>
    );
  }

  /*
   * A failed read keeps its message rather than being flattened to `null`.
   *
   * The old version ended in `.catch(() => null)`, so a 409, a dead network and a
   * malformed document all produced one sentence the panel invented and none of
   * them said what happened. That is the defect the dashboard branch fixed for
   * `/analytics/overview`, one collection over. The editor renders the API's own
   * words as `ErrorState.detail` beside the panel's line, and offers the retry a
   * refused read is exactly the case for.
   */
  const result = await acFetch(homepage, session, "/cms/homepage").catch((error: unknown) => {
    if (error instanceof ApiError) return error;
    throw error;
  });

  if (result instanceof ApiError) {
    return (
      <HomepageEditor
        locale={locale}
        initialSections={[]}
        initialProblems={[]}
        loadError={result.message}
      />
    );
  }

  /*
   * **`meta` is absent entirely when there is nothing to report** — not an empty
   * array, measured. So this reads through `meta?.problems` and defaults; code
   * that destructured `meta.problems` would throw on the healthy document and
   * work on the broken one, which is the wrong way round for a failure mode.
   */
  const parsed = result.meta?.problems ? homepageProblems.safeParse(result.meta.problems) : null;

  return (
    <HomepageEditor
      locale={locale}
      initialSections={result.data.sections}
      initialProblems={parsed?.success ? parsed.data : []}
      loadError={null}
    />
  );
}
