import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { has } from "@/lib/capabilities";
import { MENU_LOCATIONS, type MenuLocation } from "@/lib/cms";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { MenuEditor } from "./MenuEditor";

/**
 * The menus screen fetches nothing on the server.
 *
 * Unlike every other screen on this branch, and for a reason: the location is a
 * query parameter the editor owns, and a 404 here is a **state** ("no menu is
 * assigned to that location") rather than a failure. Fetching on the server
 * would mean either rendering that 404 as an error boundary or teaching the
 * server page a distinction the client already has to make.
 */
export default async function MenusPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { me } = await requireSession(locale);
  const t = await getTranslations("content");

  if (!has(me, "ac_manage_content")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {/* No back link: `/content` is behind the same capability. */}
        <PageHeader title={t("section.menus")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_content" />
        </PageBody>
      </div>
    );
  }

  const requested = typeof raw.location === "string" ? raw.location : "";
  const location: MenuLocation = (MENU_LOCATIONS as readonly string[]).includes(requested)
    ? (requested as MenuLocation)
    : "primary";

  return <MenuEditor locale={locale} initialLocation={location} />;
}
