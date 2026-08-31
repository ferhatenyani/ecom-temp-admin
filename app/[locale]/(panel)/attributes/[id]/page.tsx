import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { has } from "@/lib/capabilities";
import { globalAttributeDetail } from "@/lib/api/schemas/product";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { AttributeDetail } from "./AttributeDetail";

/**
 * One attribute — step 4's admin sub-task 2, the half that edits.
 *
 * **`GET /attributes/{id}` is the only route that carries the counts**, and that
 * is the reason this is a route rather than an overlay on the list.
 * `AttributeController` splits them deliberately — *"The single read carries
 * usage; the list does not — two queries per row"* — so `term_count` and
 * `product_count` do not exist on a list row, and `product_count` is precisely
 * the number that decides whether deleting this attribute is silent or detaches
 * somebody's catalogue. The screen cannot be honest without this request.
 *
 * The terms are **not** prefetched here, unlike the products screen's own
 * per-attribute term reads. They are a second collection with their own error
 * and empty states, and the settings form above them does not depend on them —
 * a terms read that failed would take the whole screen down with it if it were
 * awaited here, where in the client it is one card saying so.
 *
 * A 404 is `notFound()` rather than an error: measured, it is `not_found` /
 * *"No attribute with that id."*, a single unambiguous fact, unlike a CMS page
 * where a draft and a missing path answer the same 404.
 *
 * `params` is a Promise in Next 16, like `searchParams` and `cookies()`.
 */
export default async function AttributePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { session, me } = await requireSession(locale);

  if (!has(me, "ac_manage_products")) {
    const t = await getTranslations("attributes");
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {/* No `back` link on the refusal: the list is the same capability, so
            offering a way to it would be a control that cannot act (§3.3). */}
        <PageHeader title={t("title")} divided={false} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_products" />
        </PageBody>
      </div>
    );
  }

  /* `\d+` at the proxy and in the API's own route pattern, so a non-numeric id
     would be a *path* refusal at the allowlist — which this screen would render
     as an error rather than as "no such attribute". */
  if (!/^\d+$/.test(id)) notFound();

  const attribute = await acFetch(globalAttributeDetail, session, `/attributes/${id}`).catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    },
  );

  return <AttributeDetail locale={locale} initial={attribute.data} />;
}
