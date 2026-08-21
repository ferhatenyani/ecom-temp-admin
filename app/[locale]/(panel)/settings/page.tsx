import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { settings as settingsSchema } from "@/lib/api/schemas/settings";
import { canManageSettings } from "@/lib/capabilities";
import { ForbiddenState, ErrorState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { SettingsForm } from "./SettingsForm";

/**
 * The shop's own configuration — `ac_manage_settings`, **Super Admin alone**.
 *
 * Measured 2026-08-21: a Manager holding ten other management capabilities is
 * **403 on both verbs**. ADMIN_PANEL.md calls that the boundary that stops an
 * Admin escalating, and asks that the forbidden state name Super Admin rather
 * than the capability string — which `ForbiddenState` already does through
 * `states.capability.*`.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("settings");

  if (!canManageSettings(me)) {
    return (
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_settings" />
        </div>
      </Scaffold>
    );
  }

  /*
   * Read on the server, where Zod's weight is free and where a 403 the
   * capability check did not predict still lands on a built screen rather than
   * on a blank one. The gate above is for rendering; this is the authority.
   */
  const document = await acFetch(settingsSchema, session, "/settings").catch((error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  });

  if (document === null) {
    return (
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ErrorState message={t("unreadable")} />
        </div>
      </Scaffold>
    );
  }

  return <SettingsForm locale={locale} initial={document.data} />;
}
