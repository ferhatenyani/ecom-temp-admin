import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { routing, isLocale, dirFor } from "@/i18n/routing";
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "@/lib/theme-color";
import { IconSprite } from "@/components/primitives/Icon";
import { ToastProvider } from "@/components/primitives/Toast";
import "@/styles/globals.css";

/**
 * `lang` and `dir` come from the locale, so `<html>` is emitted here rather than
 * in the root layout — which cannot know it.
 *
 * **Not `next/root-params`, though next-intl's deprecation notice points there.**
 * Measured on 16.3.1: that module is a placeholder replaced by a compiler pass
 * (`next-root-params-loader`) registered only in `webpack-config.js`. Next 16
 * builds with Turbopack by default, where nothing substitutes it, so the import
 * fails the build with "The module has no exports at all." `getLocale()` is the
 * supported path and works under both bundlers.
 */

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  // `viewport-fit=cover` is what makes `env(safe-area-inset-*)` non-zero. A tab
  // bar sitting under the home indicator looks like a website pretending to be an
  // app, which is precisely the failure this brief exists to avoid.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // The literals live in lib/theme-color.ts, which records why that one file is
  // allowed them and which token they must mirror.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR_DARK },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "app" });
  return {
    title: t("name"),
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: t("name") },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // Makes the locale available to the server-side translation functions used by
  // deeper Server Components.
  setRequestLocale(locale);

  return (
    <html lang={locale} dir={dirFor(locale)} className="h-full">
      <head>
        {/*
          Preloaded, and only the face this locale actually needs. `unicode-range`
          means an Arabic file is never fetched on a French screen — so preloading
          both would download 88 KB nobody reads.
        */}
        <link
          rel="preload"
          href="/fonts/plex-sans-latin-var.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {locale === "ar" ? (
          <>
            <link
              rel="preload"
              href="/fonts/plex-arabic-400.woff2"
              as="font"
              type="font/woff2"
              crossOrigin="anonymous"
            />
            <link
              rel="preload"
              href="/fonts/plex-arabic-600.woff2"
              as="font"
              type="font/woff2"
              crossOrigin="anonymous"
            />
          </>
        ) : null}
      </head>
      <body className="min-h-full bg-bg-grouped text-label">
        <IconSprite />
        <NextIntlClientProvider>
          <ToastProvider>{children}</ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
