import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { landingPath } from "@/components/ui/nav-tree";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";

/**
 * The panel root — the front door, resolved for whoever is standing at it.
 *
 * It redirected to `/orders` unconditionally, along with the login form, the
 * login page's already-signed-in branch and the 404's way back. DECISIONS.md §11
 * **measured** a Support Agent as 403 on `/orders` and `/inventory` and 200 on
 * `/customers`, so all four sent that reader to a forbidden screen. All four go
 * through `landingPath()` now, which reads `NAV` — the same array the sidebar
 * filters — so the front door and the navigation cannot disagree.
 *
 * A reader holding `ac_manage_orders` still lands on `/orders`, because that is
 * the first entry in the first group and `NAV` is written commerce-first for that
 * reason. Nothing about the common path moves.
 *
 * **`null` is a state rather than a fallback.** An account holding none of the
 * thirteen has no destination in this tree, and redirecting it anywhere would be
 * a link to a 403. It gets the refusal instead, which is the same one the login
 * form renders when a correct credential resolves to nothing.
 *
 * The old docblock said "The dashboard is a later branch". The dashboard shipped
 * as checklist item 10.
 */
export default async function PanelIndex({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  /* Already awaited by `(panel)/layout.tsx` for the sidebar; Next dedupes the
     `/auth/me` read within the request, so this costs no second round trip. */
  const { me } = await requireSession(locale);
  const path = landingPath(me.capabilities);

  if (path) redirect(`/${locale}${path}`);

  const t = await getTranslations("app");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader title={t("name")} divided={false} />
      <PageBody width="detail">
        <ForbiddenState capability={[]} />
      </PageBody>
    </div>
  );
}
