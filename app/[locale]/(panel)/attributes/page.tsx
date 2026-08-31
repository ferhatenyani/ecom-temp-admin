import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { has } from "@/lib/capabilities";
import { globalAttributes } from "@/lib/api/schemas/product";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { AttributesScreen } from "./AttributesScreen";

/**
 * The attributes list — step 4's admin sub-task 2.
 *
 * `ac_manage_products`, and there is no new capability to weigh: the four
 * `/attributes` routes hang off one
 * `Permissions::callback(Capabilities::MANAGE_PRODUCTS)` in
 * `AttributeController::registerRoutes()`, and `AttributeService` asserts the
 * same capability again inside every method. `AttributeService`'s own docblock
 * argues why — inventing `ac_manage_attributes` would mean a Product Manager who
 * can build a variable product and cannot create the attribute it varies on.
 *
 * Prefetched on the server so the list is on screen in the first paint, and the
 * failure is `null` rather than a throw: the create card below the list still
 * works when the read failed, and a screen that refused to render because it
 * could not list would take the one control that does not depend on the list
 * with it. The client query retries and `StaleBanner` says which it is.
 *
 * `GET /attributes` is unpaginated — `index()` is explicit about it, *"a shop
 * has a handful"* — so there is no page parameter to carry and no
 * `searchParams` to read.
 */
export default async function AttributesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);

  if (!has(me, "ac_manage_products")) {
    const t = await getTranslations("attributes");
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {/* No `back` link: every destination this screen could offer is behind
            the same capability, and §3.3 refuses a control that cannot act. */}
        <PageHeader title={t("title")} divided={false} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_products" />
        </PageBody>
      </div>
    );
  }

  const initial = await acFetch(globalAttributes, session, "/attributes").catch(
    (error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    },
  );

  return <AttributesScreen locale={locale} initialAttributes={initial?.data ?? null} />;
}
