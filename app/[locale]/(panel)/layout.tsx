import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { AppShell } from "@/components/ui/AppShell";
import { dirFor } from "@/i18n/routing";
import { THEME_COOKIE, isTheme } from "@/lib/theme";
import { QueryProvider } from "@/components/patterns/QueryProvider";

/**
 * Everything behind the credential boundary. The session is verified here, once,
 * so no page below has to remember to.
 *
 * The shell changed with the redesign: `TabBar` + `Sidebar` are replaced by
 * `AppShell`, which renders one grouped navigation tree as a persistent sidebar
 * at `lg` and as a drawer below it. Navigation is global by nature, so this file
 * is the one place it changes — screens still on the old visual system keep
 * working underneath it, because `Scaffold` is now a shim over `PageHeader`.
 */
export default async function PanelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { me } = await requireSession(locale);
  const tApp = await getTranslations("app");
  const themeCookie = (await cookies()).get(THEME_COOKIE)?.value;

  return (
    <QueryProvider>
      <AppShell
        locale={locale}
        dir={dirFor(locale)}
        theme={isTheme(themeCookie) ? themeCookie : "system"}
        appName={tApp("name")}
        /* `display_name` is a plain string on the identity schema, not optional,
           but it is empty on accounts created without one — so `username` is the
           fallback, and the avatar takes its initial from whichever wins. */
        userName={me.display_name.trim() || me.username}
        capabilities={me.capabilities}
      >
        {children}
      </AppShell>
    </QueryProvider>
  );
}
