import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { has } from "@/lib/capabilities";
import { page as pageSchema } from "@/lib/api/schemas/cms";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ForbiddenState } from "@/components/patterns/States";
import { PageForm } from "./PageForm";

/**
 * A page is addressed by its **full path**, so this is a catch-all.
 *
 * `legal/conditions-generales` is two segments and one page. A `[path]` segment
 * would have 404ed every child page in the shop — and the panel's proxy
 * allowlist has the matching rule (`/cms/pages/.+`) with the same reasoning
 * beside it.
 *
 * `?status=any` is not optional here. The default is `publish`, and a **draft
 * and a path that does not exist answer the same 404 with the same message** —
 * so a detail screen that asked for the default would tell somebody their draft
 * did not exist. That is not hypothetical: `privacy-policy` on this install is a
 * real draft that did exactly that before the index existed.
 */
export default async function ContentPageDetail({
  params,
}: {
  params: Promise<{ locale: string; path: string[] }>;
}) {
  const { locale, path } = await params;
  const { session, me } = await requireSession(locale);

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

  const full = path.join("/");

  const result = await acFetch(
    pageSchema,
    session,
    `/cms/pages/${full}?status=any`,
  ).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  });

  if (result === null) notFound();

  return <PageForm locale={locale} page={result.data} mode="edit" />;
}
