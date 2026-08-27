import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { has } from "@/lib/capabilities";
import { page as pageSchema } from "@/lib/api/schemas/cms";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
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
      <div className="min-h-dvh bg-ui-canvas">
        {/* No `back`: `/content/pages` is the same capability, so the link could
            only reach another refusal. See `content/pages/page.tsx`. */}
        <PageHeader title={t("section.pages")} divided={false} />
        <PageBody width="form">
          <ForbiddenState capability="ac_manage_content" />
        </PageBody>
      </div>
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

  /**
   * When this render happened, for §3.7's stale marker on the client form.
   *
   * The same reasoning the coupon, product and order details record:
   * `react-hooks/purity` flags reading the clock in a component body and is right
   * about the client case it is written for; an async Server Component runs once
   * per request and never re-renders, so this is part of the fetch rather than
   * part of the render. Recording it in a mount effect instead gives an age that
   * stops moving after `router.refresh()`, which re-renders the server tree
   * without remounting the client one.
   */
  // eslint-disable-next-line react-hooks/purity -- see above: a Server Component renders once per request.
  const fetchedAt = Date.now();

  return <PageForm locale={locale} page={result.data} fetchedAt={fetchedAt} mode="edit" />;
}
