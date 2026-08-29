import { getTranslations } from "next-intl/server";
import { Icon } from "@/components/primitives/Icon";
import { FormSkeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while `page.tsx` decides whether this reader is
 * already signed in.
 *
 * §3.6 asks for one on every route and this one is genuinely reachable rather
 * than decorative: with a session cookie present the page awaits `/auth/me`
 * before it can answer, and that is a real request over the same link the panel
 * runs on. **Signed out it is never seen** — `readSession()` answers from the
 * cookie jar and the page renders in the same tick — which is the opposite way
 * round from every screen behind the session, where the fallback is what a cold
 * load shows.
 *
 * ## What is real here, and why
 *
 * The mark, the aside panel and the layout are **not** drawn as placeholders.
 * They are constants — an icon from the sprite, `app.name`, one translated line —
 * and a skeleton stands in for something not yet known. Drawing a grey box over a
 * string this file already holds would be a placeholder that is guaranteed to be
 * the wrong shape. The mark reaches the card through `FormSkeleton`'s `mark`
 * slot, which takes a **node** for exactly that reason.
 *
 * What is unknown is nothing at all, strictly: the card's contents are constants
 * too. It is drawn as a `FormSkeleton` anyway, and the reason is §3.6's own —
 * this is the region that carries the form the reader is waiting to type into,
 * and a card of fully-rendered controls that cannot yet be focused is a screen
 * that looks ready and is not.
 *
 * ## The shape is the card's, measured against the same tokens
 *
 * `titled described={1}` is the card's `<h1>` at `--text-heading` over
 * `login.intro` at `--text-label`, which is one line at this width in French and
 * one in Arabic — the card is 400px and the sentence is 74 characters, so it
 * wraps to two at the 340px floor and this count is right in the reference frame
 * (1440, French) the rest of the run calibrates in, exactly as
 * `settings/loading.tsx` and `transfer/loading.tsx` name theirs.
 *
 * Three shapes: `field` for the username, `hinted` for the password and its
 * `passwordHint`, and a third `field` standing in for the submit button — a
 * `Button` at `size="md"` is `min-h-9`, which is `.ui-field`'s own pointer height,
 * and its label block above stands in for nothing, which is the residual and is
 * one 18px line. `FormSkeleton` has no button shape; adding one for a single
 * caller would be a prop no other screen could use.
 *
 * Driven in Chromium at 1440 with `/auth/me` held for four seconds behind a
 * proxy — the *client* read is the wrong thing to intercept here, because this
 * fallback is on screen while the **Server Component** fetches:
 *
 *   fr   skeleton 370 / real 386   −16px
 *   ar   skeleton 393 / real 372   +21px
 *
 * The sign flips because the two locales wrap differently and no single line
 * count is right in both — French is the reference frame, as everywhere else in
 * this run. The 16px there is the button's unreserved label block above; the
 * Arabic 21 is that same line against a `login.intro` that sets shorter at
 * 106.25%. **The mark is not part of either number**: it reaches the card through
 * `FormSkeleton`'s `mark` slot and is drawn as the real icon, so its 24px and its
 * 12px margin are reserved exactly rather than approximated.
 */
export default async function LoginLoading() {
  const label = (await getTranslations("states"))("loading");
  const tApp = await getTranslations("app");
  const t = await getTranslations("login");

  return (
    <div className="flex min-h-dvh bg-ui-canvas">
      <div className="flex w-full shrink-0 flex-col items-center justify-center px-4 py-10 sm:px-6 lg:w-120">
        <div className="flex w-full max-w-100 flex-col items-stretch">
          <FormSkeleton
            fields={["field", "hinted", "field"]}
            described={1}
            mark={<Icon name="lock" className="size-6 shrink-0 text-ui-fg" />}
            label={label}
          />
        </div>
      </div>

      <aside className="hidden min-w-0 flex-1 flex-col items-center justify-center border-ui-line bg-ui-surface-2 px-10 lg:flex lg:border-s">
        <div className="max-w-96">
          <p className="text-ui-title text-ui-fg">{tApp("name")}</p>
          <p className="mt-1.5 text-ui-body text-ui-muted">{t("aside")}</p>
        </div>
      </aside>
    </div>
  );
}
