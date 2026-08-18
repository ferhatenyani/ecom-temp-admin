import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { dirFor, isLocale, routing } from "@/i18n/routing";
import "@/styles/globals.css";

/**
 * The 404 for a URL that matches no route at all.
 *
 * **This file emits its own `<html>` and `<body>`**, which no other screen in the
 * panel does. Next renders the root not-found against `app/layout.tsx`, and that
 * layout returns bare `children` on purpose — `lang` and `dir` come from the
 * locale and the root does not know it. So without the tags here, every mistyped
 * address answered with a runtime error reading "Missing <html> and <body> tags
 * in the root layout" instead of a 404 screen. Measured: `/fr/nope` returned 404
 * with that error page, and so did every invalid locale.
 *
 * `app/[locale]/not-found.tsx` is **not** what catches this. Measured on 16.3.1:
 * adding one changed nothing, because a path that resolves to no page never
 * "matches" the `[locale]` segment, so Next walks to the root boundary. That
 * file was removed again rather than left in as a decoration.
 *
 * The locale still comes through: `getLocale()` reads the request scope the
 * proxy populated, so `/ar/nope` renders in Arabic even though this component
 * sits outside the locale segment. It is wrapped anyway — this is the one screen
 * that must render when something about the request is already wrong, and a 404
 * that throws is worse than a 404 in the wrong language.
 */
export default async function NotFound() {
  let locale: string = routing.defaultLocale;
  try {
    const resolved = await getLocale();
    if (isLocale(resolved)) locale = resolved;
  } catch {
    // No i18n request scope — keep the default rather than fail the 404.
  }

  let title = "Introuvable";
  let body = "Cette adresse n’existe pas.";
  let home = "Commandes";
  try {
    const t = await getTranslations({ locale, namespace: "states" });
    const tNav = await getTranslations({ locale, namespace: "nav" });
    title = t("notFoundTitle");
    body = t("notFoundAddress");
    home = tNav("orders");
  } catch {
    // Same reasoning: the French strings above are the fallback, not a feature.
  }

  return (
    <html lang={locale} dir={dirFor(locale)} className="h-full">
      <body className="min-h-dvh bg-bg-grouped antialiased" suppressHydrationWarning>
        {/*
          No `Scaffold` and no tab bar. Those live under `(panel)` and assume a
          session; this screen is reachable signed out, and a nav bar offering
          destinations that would bounce to the login form is worse than none.
        */}
        <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center px-6 text-center">
          <h1 className="text-large-title text-label">{title}</h1>
          <p className="mt-2 text-body text-label-secondary">{body}</p>
          <Link
            href={`/${locale}/orders`}
            className="press tone-accent tonal mt-6 inline-flex min-h-11 items-center rounded-md px-4 text-headline"
          >
            {home}
          </Link>
        </main>
      </body>
    </html>
  );
}
