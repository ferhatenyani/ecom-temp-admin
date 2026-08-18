import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { TabBar, Sidebar } from "@/components/patterns/TabBar";
import { QueryProvider } from "@/components/patterns/QueryProvider";

/**
 * Everything behind the credential boundary. The session is verified here, once,
 * so no page below has to remember to.
 */
export default async function PanelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireSession(locale);
  const t = await getTranslations("nav");
  const tApp = await getTranslations("app");

  return (
    <QueryProvider>
      {/* Skip-to-content on every page, before anything focusable. */}
      <a
        href="#content"
        className="press sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-surface focus:px-4 focus:py-3 focus:text-body focus:text-accent"
      >
        {t("skipToContent")}
      </a>
      <Sidebar locale={locale} appName={tApp("name")} />
      <div className="md:ms-60">{children}</div>
      <TabBar locale={locale} />
    </QueryProvider>
  );
}
