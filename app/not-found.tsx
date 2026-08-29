import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { dirFor, isLocale, routing } from "@/i18n/routing";
import { IconSprite } from "@/components/primitives/Icon";
import { EmptyState } from "@/components/ui/States";
import { THEME_COOKIE, themeAttribute } from "@/lib/theme";
import fr from "@/messages/fr.json";
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
 *
 * ## `data-theme`, which this file did not stamp and everything else does
 *
 * `app/[locale]/layout.tsx` reads the theme cookie and puts it on `<html>`; this
 * file sits above that layout and emits its own `<html>`, so it was the one
 * document in the panel that never carried the attribute. The consequence is that
 * **every mistyped URL was light-themed for a reader in dark mode** — the tokens
 * branch on `[data-theme]`, and with nothing stamped only `prefers-color-scheme`
 * is left, which is not what the person chose. `capture.mjs:1334` asserts the
 * attribute matches the theme it asked for, and this screen was never in its
 * route list to be caught by it. Same cookie, same helper, same one line.
 *
 * ## No `global-not-found.js`, and the docs name this app's exact shape
 *
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md`
 * lists two cases it is *for*, and the second is this app: "your root layout is
 * defined using top-level dynamic segments (e.g. `app/[country]/layout.tsx`)".
 * It is declined anyway, for three reasons the same page states:
 *
 *   1. It needs `experimental.globalNotFound` in `next.config.ts`. This panel
 *      does not ship on an experimental flag for a 404.
 *   2. "The `global-not-found.js` file bypasses your app's normal rendering,
 *      which means you'll need to import any global styles, fonts, or other
 *      dependencies" — so it re-inherits the hand-rolled `<html>`/`<body>`
 *      problem this file already solves, plus the font preloads, plus the theme
 *      attribute, and solves nothing that is still open.
 *   3. It is the *same* markup either way. The docs' own reason for reaching for
 *      it — "when you can't build a 404 page using a combination of `layout.js`
 *      and `not-found.js`" — does not apply: this file builds one.
 *
 * ## No `loading.tsx`, and that is a status-code decision rather than taste
 *
 * The docs say `not-found.js` "renders between `loading.js` and `page.js`. It is
 * wrapped by the `<Suspense>` boundary from `loading.js` … in the same segment",
 * so an `app/loading.tsx` *would* apply here. It must not exist. `loading.md`'s
 * Status Codes section: "The response body starts streaming when a Suspense
 * fallback renders (for example, a `loading.tsx`)" and "it is not possible to
 * change the status code after streaming started" — a 404 that streams answers
 * **200** with a `noindex` tag. `e2e/not-found.spec.ts` asserts a 404 *status* in
 * three of its four tests, and they are asserting the right thing: this is the
 * response a crawler and a log reader both see. A boundary at `app/` would also
 * wrap every route in the panel, which no screen asked for.
 *
 * There is nothing to suspend on regardless. This is a static Server Component:
 * two cookie reads and a translation lookup, no fetch, no client cache, no poll.
 *
 * ## The two halves of §3.7-5, and it owes neither
 *
 * Per the customers-branch amendment, a screen that can hold data older than its
 * own last fetch shows the marker, and per the transfer-branch amendment a screen
 * that writes disables its controls offline. **This screen holds no data and
 * writes nothing** — one translated sentence and one link — so there is no age to
 * report and no control to disable, and this paragraph is the docblock those
 * amendments ask for. Nothing here can drift from anything.
 *
 * ## The way back does not name a section
 *
 * It used to render `nav.orders` — "Commandes" — pointing at `/{locale}/orders`,
 * which is a destination this file cannot promise. DECISIONS.md §11 measures a
 * Support Agent as **403 on `/orders`**, and this screen is reachable *signed
 * out*, where it does not even know who is reading. So the link goes to the panel
 * root, which resolves the front door per capability on the other side, and its
 * label names the panel rather than any screen in it.
 */
export default async function NotFound() {
  let locale: string = routing.defaultLocale;
  try {
    const resolved = await getLocale();
    if (isLocale(resolved)) locale = resolved;
  } catch {
    // No i18n request scope — keep the default rather than fail the 404.
  }

  /*
   * The fallback is the default locale's own message file rather than four
   * hand-typed French strings, which is what this file used to carry.
   *
   * Two of those literals had already drifted: the heading was right and the link
   * said "Commandes" for a destination that no longer exists here. A literal in a
   * component is a copy of a message that nothing keeps in step — and the same
   * import is what makes it impossible for the fallback and the message file to
   * disagree about wording again. `fr` is `routing.defaultLocale`; the branch
   * below reads whichever locale the request resolved to.
   */
  let title = fr.states.notFoundTitle;
  let body = fr.states.notFoundAddress;
  let home = fr.states.backToPanel;
  try {
    const t = await getTranslations({ locale, namespace: "states" });
    title = t("notFoundTitle");
    body = t("notFoundAddress");
    home = t("backToPanel");
  } catch {
    // Same reasoning: the default locale's strings are the fallback, not a
    // feature. A 404 that throws is worse than a 404 in the wrong language.
  }

  const theme = themeAttribute((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang={locale} dir={dirFor(locale)} data-theme={theme} className="h-full">
      <body className="min-h-dvh bg-ui-canvas antialiased" suppressHydrationWarning>
        {/*
          The sprite is rendered by `app/[locale]/layout.tsx` for every other
          screen, and this document is outside it — so without this line every
          `<use href="#icon-…">` on the page resolves against nothing and the
          state's icon is an empty box. It is the same cost as the layout's: one
          inline `<svg>`, no request.
        */}
        <IconSprite />
        {/*
          No `AppShell` and no nav. That lives under `(panel)` and assumes a
          session; this screen is reachable signed out, and a sidebar offering
          destinations that would bounce to the login form is worse than none.
        */}
        <main className="mx-auto flex min-h-dvh w-full max-w-192 flex-col justify-center px-4 py-10 sm:px-6">
          {/*
            `EmptyState`, not `ErrorState`: nothing went wrong and there is
            nothing to retry — the address simply does not exist, which is the
            same reading the eight panel not-found screens take. Its `href` action
            is the boundary fact the marketing branch added the prop for: this is
            a Server Component and cannot pass a handler into a client one.

            `title` and `titleAs` are the two slots it gained here. This document
            has no `PageHeader` above it — it is outside `app/[locale]/layout.tsx`
            — so the state's heading is the **only** heading on the page, and at
            the primitive's default level 2 that left the 404 with no `<h1>` at
            all. Twelve captures found it; `e2e/not-found.spec.ts` structurally
            could not, because `getByRole("heading", { name })` matches any of the
            six levels. Those assertions carry `level: 1` now.
          */}
          <EmptyState
            icon="search"
            title={title}
            titleAs="h1"
            message={body}
            action={{ label: home, href: `/${locale}` }}
          />
        </main>
      </body>
    </html>
  );
}
