import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { CardSkeleton, FormSkeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component reads `/settings`.
 *
 * **It draws one 640px column of cards**, which is the whole reason this file is
 * worth having rather than a spinner: the real screen is `PageBody width="form"`
 * and a full-width placeholder would paint one shape and reflow into another the
 * moment the document lands — §3.6's own "layout shift with extra steps". The
 * header matches too: a title, no back link (settings is a top-level nav route)
 * and no actions, so nothing in the block moves when the real one renders.
 *
 * ## The counts and the shapes are the real screen's, measured rather than eyed
 *
 * Six cards, in the order the form stacks them, and every one carries a
 * `description` — `blockNote.*` — so each passes `described`. **Driven in
 * Chromium at 1440 in French**, the six descriptions occupy 36 / 18 / 36 / 18 /
 * 36 / 36 px, which is the 2 / 1 / 2 / 1 / 2 / 2 below. That is the reference
 * width and locale: 340 wraps every one of them a line further and Arabic wraps
 * one fewer, and no single count can be right at all six. Naming which one it is
 * right at is the honest version.
 *
 *   store       name, a `rows={3}` description, a hinted storefront URL, and the
 *               four read-only rows — `locale`, `currency`, `currency_symbol`,
 *               `logo_id`, each a label over a value over its reason
 *   contact     five, of which the address and the opening hours are textareas
 *   legal       five, of which the RC carries a hint
 *   social      four plain fields
 *   features    9 flag rows, a `DataList` — so `CardSkeleton`, whose row is
 *               `DataRow`'s geometry, not `FormSkeleton`, whose row is a control
 *   providers   3 registry rows
 *
 * `FormSkeleton` learned those four shapes for this screen and the numbers are in
 * its docblock. Driven at 1440 fr with the API's own read held for five seconds,
 * before and after:
 *
 *   before   632 / 480 / 480 / 404 / 448 / 226   379px short, 294 of it card one
 *   after    740 / 550 / 504 / 386 / 448 / 226   195px short, 186 of it card one
 *   real     926 / 550 / 504 / 386 / 457 / 226
 *
 * Four of the six are **exact**. `features` is 9px over nine rows, which is
 * `CardSkeleton`'s row against a row holding a `Badge` rather than a line of
 * text, and is left where every other screen's is.
 *
 * **What is left on the first card is deliberate.** The storefront warning is
 * ~150px of it on this install and is *conditional*: it renders only while
 * `store.storefront_url` is empty, which a placeholder drawn before the document
 * arrives cannot know. Drawing it would be right on this shop and wrong on a shop
 * that has set its URL. The remaining ~36 is `currency`'s and `logo_id`'s reasons
 * wrapping to two lines where the other two read-only rows take one — at 340 all
 * four wrap, so a fixed two would only move the error to the wider viewport. The
 * error summary is absent for the conditional reason too.
 *
 * **And the save bar is absent for a different one.** It is `sticky` and appears
 * only when the form goes dirty, which a form nobody has typed into is not —
 * drawing one here would settle downwards on every visit.
 */
export default async function SettingsLoading() {
  const t = await getTranslations("settings");
  const label = (await getTranslations("states"))("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader title={t("title")} divided={false} />

      <PageBody width="form">
        <div className="flex flex-col gap-4">
          <FormSkeleton
            fields={["field", "area", "hinted", "read", "read", "read", "read"]}
            described={2}
            label={label}
          />
          <FormSkeleton
            fields={["field", "field", "area", "field", "area"]}
            described={1}
            label={label}
          />
          <FormSkeleton
            fields={["field", "hinted", "field", "field", "field"]}
            described={2}
            label={label}
          />
          <FormSkeleton fields={4} described={1} label={label} />
          <CardSkeleton rows={9} described={2} label={label} />
          <CardSkeleton rows={3} described={2} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
