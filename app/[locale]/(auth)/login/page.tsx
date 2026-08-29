import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { acFetch } from "@/lib/api/client";
import { identity } from "@/lib/api/schemas/order";
import { readSession } from "@/lib/session/read";
import { landingPath } from "@/components/ui/nav-tree";
import { LoginForm } from "./LoginForm";

/**
 * The credential boundary, and the only screen in the panel outside `(panel)`.
 *
 * ## The layout: a split at `lg`, one column below it
 *
 * A form column holding the card at a **400px** cap, and a second panel filling
 * the remainder on `--color-surface-2` behind a `border-inline-start`. Below `lg`
 * that panel is `display: none` and the form column is the whole page, centred on
 * `--color-canvas`.
 *
 * **`hidden lg:flex` rather than a conditional render, and the reason is that
 * this is a Server Component.** It cannot know the viewport; reading one would
 * mean a client component and a first paint that disagrees with the markup. It is
 * the mechanism `AppShell` already uses for its own two presentations — the
 * sidebar is `hidden lg:flex` and the top bar is `lg:hidden` — so the panel has
 * exactly one answer to this question. `display: none` costs no layout and is
 * skipped by the accessibility tree, so below `lg` the panel is absent in every
 * sense a reader can observe; the two sentences are still in the HTML.
 *
 * DESIGN.md §2.3 carries the amendment adding the row, because its table had none
 * for an auth screen and `max-w-md` (448) is not one of its widths.
 *
 * **No image, no gradient, no colour literal**, and no shop logo. The first two
 * fail `check-design.sh` and the third would render a state nobody has measured:
 * `store.logo_id` is writable, but `logo` is `z.unknown()` in the schema because
 * the resolved-attachment shape was never captured, and both the mock's default
 * and its `populated` variant answer `logo_id: 0` / `logo: null`. DECISIONS.md's
 * carried-forward list records that whoever ships the picker owes that capture
 * first; a login screen is not the place to spend it.
 *
 * **No `PageHeader`, and it is a deviation rather than an oversight.** §2.4's
 * block is a title, an optional subtitle and actions laid over a page column —
 * every one of the forty screens behind the session has one. This screen has no
 * page column and no actions, and its heading belongs to the card, which is the
 * only object on the page. DECISIONS.md §21 records it.
 *
 * **No locale switcher and no theme toggle.** The panel has neither anywhere —
 * `ThemeToggle` is imported once, by `AppShell` — so shipping the run's first one
 * on the last screen would be a panel-wide change this item does not own. The
 * theme still resolves correctly here: `app/[locale]/layout.tsx` stamps
 * `data-theme` from the cookie above this segment.
 *
 * ## Already signed in
 *
 * The redirect used to be `/orders` unconditionally, which DECISIONS.md §11
 * measures as a **403 for a Support Agent**. It goes through `landingPath()` now
 * — the first destination in `NAV` this reader may actually open — so the front
 * door and the sidebar cannot disagree.
 *
 * That costs one `/auth/me`, and the cost is the point: `readSession()` only
 * unseals the cookie, and a cookie outlives a revoked Application Password and a
 * suspended account. The old check therefore bounced a reader whose credential no
 * longer worked into the panel, which bounced them straight back. A failure here
 * falls through to the form, which is the honest outcome and the one
 * `requireSession()` already reaches from the other side.
 *
 * `redirect()` throws, so it is called **outside** the `try` — a `redirect` inside
 * one is swallowed by its own `catch` and renders the page it was leaving.
 */
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reason?: string }>;
}) {
  const { locale } = await params;
  const { reason } = await searchParams;

  let destination: string | null = null;
  let signedInWithNothing = false;

  // A `reason` means the session just ended or was refused; sending that person
  // back into the panel would hide the sentence they were sent here to read.
  if (reason === undefined) {
    const session = await readSession();
    if (session) {
      try {
        const { data: me } = await acFetch(identity, session, "/auth/me");
        destination = landingPath(me.capabilities);
        signedInWithNothing = destination === null;
      } catch {
        // A revoked password, a suspended account, an unreachable shop. Any of
        // them means the form is what this person needs.
      }
    }
  }

  if (destination) redirect(`/${locale}${destination}`);

  const t = await getTranslations("login");
  const tApp = await getTranslations("app");

  return (
    <div className="flex min-h-dvh bg-ui-canvas">
      <div className="flex w-full shrink-0 flex-col items-center justify-center px-4 py-10 sm:px-6 lg:w-120">
        <div className="w-full max-w-100">
          <LoginForm locale={locale} reason={reason} noDestination={signedInWithNothing} />
        </div>
      </div>

      {/*
        The second panel. `lg:flex` on an element that is `hidden` by default —
        see the docblock: a Server Component cannot know the viewport, and this is
        `AppShell`'s own mechanism. Below `lg` the form column is the whole page,
        centred on the canvas.

        It carries the panel's own name and one line, and nothing else. §0's
        direction is restraint and §18's rule is that restraint applies to words
        as much as to decoration: a marketing paragraph on a sign-in screen is
        read by staff who open it every morning.

        **`items-center` on a capped block, because `px-10` was doing inset where
        the panel wants optical centring.** Measured off the 1440 captures: the
        aside spans 480→1440 and its two lines sat at x=520–773 — 40px from the
        divider with ~667px of empty surface beyond them, and RTL mirrored it
        exactly, so in both directions the text was pinned to the border and the
        outer two thirds of the panel was dead. That reads as text that failed to
        land rather than as restraint. The block is centred in the aside's own
        column now, so the emptiness is symmetric and deliberate; the text still
        sets from its own start edge, because a centred paragraph beside a
        start-aligned form column is a third alignment nobody asked for. `px-10`
        stays as the floor for the narrow end of `lg`, where the column is 544px
        and the block would otherwise reach the border again.
      */}
      <aside className="hidden min-w-0 flex-1 flex-col items-center justify-center border-ui-line bg-ui-surface-2 px-10 lg:flex lg:border-s">
        <div className="max-w-96">
          <p className="text-ui-title text-ui-fg">{tApp("name")}</p>
          <p className="mt-1.5 text-ui-body text-ui-muted">{t("aside")}</p>
        </div>
      </aside>
    </div>
  );
}
