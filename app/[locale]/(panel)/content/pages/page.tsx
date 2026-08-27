import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { pageList } from "@/lib/api/schemas/cms";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { PagesList } from "./PagesList";
import { listParams, queryFromParams } from "./query";

/**
 * The Pages index.
 *
 * A Server Component fetches the first page with the sealed credential and
 * streams it, so first paint carries data — the arrangement orders, products,
 * inventory, customers, coupons and payments all use.
 */
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
      <div className="min-h-dvh bg-ui-canvas">
        {/* No `back`, and the absence is the rule rather than an omission. Every
            route it could point at — `/content`, `/content/pages` — is gated on
            the same `ac_manage_content` this reader has just been refused for, so
            the link could only ever reach another "Accès refusé". DECISIONS.md:
            a link to a 403 is a control that cannot act. The five sibling screens
            render their refusal the same way.

            No subtitle either, so `pages-count` is absent rather than reporting a
            total nobody was allowed to read. The suite asserts that. */}
        <PageHeader title={t("section.pages")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_content" />
        </PageBody>
      </div>
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
