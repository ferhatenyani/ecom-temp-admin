import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { has } from "@/lib/capabilities";
import { homepage, homepageProblems } from "@/lib/api/schemas/cms";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ErrorState, ForbiddenState } from "@/components/patterns/States";
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
      <Scaffold title={t("section.homepage")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_content" />
        </div>
      </Scaffold>
    );
  }

  const result = await acFetch(homepage, session, "/cms/homepage").catch((error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  });

  if (result === null) {
    return (
      <Scaffold
        title={t("section.homepage")}
        back={{ href: `/${locale}/content`, label: t("title") }}
      >
        <div className="px-4">
          <ErrorState message={t("homepage.loadFailed")} />
        </div>
      </Scaffold>
    );
  }

  /*
   * **`meta` is absent entirely when there is nothing to report** — not an empty
   * array, measured. So this reads through `meta?.problems` and defaults; code
   * that destructured `meta.problems` would throw on the healthy document and
   * work on the broken one, which is the wrong way round for a failure mode.
   */
  const parsed = result.meta?.problems
    ? homepageProblems.safeParse(result.meta.problems)
    : null;

  return (
    <HomepageEditor
      locale={locale}
      initialSections={result.data.sections}
      initialProblems={parsed?.success ? parsed.data : []}
    />
  );
}
