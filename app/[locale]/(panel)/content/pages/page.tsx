import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { pageList } from "@/lib/api/schemas/cms";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ForbiddenState } from "@/components/patterns/States";
import { PagesList } from "./PagesList";
import { listParams, queryFromParams } from "./query";

export default async function ContentPagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);

  /*
   * `ac_manage_content` is Super Admin alone after the two-tier collapse —
   * measured, a **Manager is 403** on every CMS route and on `/media`. That
   * makes one live credential a real forbidden fixture for this entire branch,
   * which is what the shipping branch established as the pattern.
   */
  if (!has(me, "ac_manage_content")) {
    const t = await getTranslations("content");
    return (
      <Scaffold title={t("section.pages")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_content" />
        </div>
      </Scaffold>
    );
  }

  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") incoming.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) incoming.set(key, value[0]);
  }
  const query = queryFromParams(incoming);

  const initial = await acFetch(pageList, session, `/cms/pages?${listParams(query)}`).catch(
    (error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    },
  );

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;
  const excluded =
    initial?.meta && typeof initial.meta.excluded_system === "number"
      ? initial.meta.excluded_system
      : 0;

  return (
    <PagesList
      locale={locale}
      initialQuery={query}
      initialPages={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
      initialExcluded={excluded}
    />
  );
}
