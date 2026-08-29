import { getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { FormSkeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component reads `/auth/me`.
 *
 * §3.6 asks for one unconditionally and this route can genuinely reach it:
 * `page.tsx` awaits `requireSession()`, which fetches `/auth/me` rather than
 * trusting the cookie, so the segment suspends. **It is reached on a client
 * navigation and not on a full load** — `(panel)/layout.tsx` awaits the same
 * session for the sidebar, so on a cold load nothing paints until the identity
 * has landed and the fallback is never seen. That is true of every route in the
 * panel, not of this one, and it is stated here because it is what the
 * measurement below had to work around.
 *
 * **One 768px column of three cards**, which is the whole reason this file is
 * worth having rather than a spinner: the real screen is `PageBody
 * width="detail"` and a full-width placeholder would paint one shape and reflow
 * into another the moment the identity lands. The header matches too — a title,
 * no back link, no actions, `divided={false}` — so nothing in that block moves.
 *
 * ## The shapes are the real screen's, measured rather than eyed
 *
 * Driven in Chromium at 1440 in French against the built screen, with `/auth/me`
 * held for four seconds behind a proxy and both trees measured through
 * `getBoundingClientRect`:
 *
 *   export     404 skeleton / 477 real
 *   products   338 skeleton / 384 real
 *   inventory  238 skeleton / 266 real
 *
 * Every shape names what it stands in for. An export row is *a name over a
 * caption beside a 36px button*, which is a `field`'s box model (label, gap,
 * control) rather than a `DataRow`'s 37px line — `CardSkeleton` draws 148px for
 * those four rows against 259 real, so `FormSkeleton` is the right primitive
 * here even though the card holds no form. `described={2}` because `exportNote`
 * wraps to two lines at this width. The import cards are their file field and —
 * on products — their mode select, both `hinted`, then the Preview button's own
 * row.
 *
 * That is the reference width and locale, and naming it is the honest version:
 * 340 wraps every hint a line further and Arabic wraps differently again, so no
 * single count is right at all three viewports.
 *
 * ## The 147px residual was the footnote, and it is now reserved
 *
 * **Neither `CardSkeleton` nor `FormSkeleton` drew a footnote**, and all three
 * of this screen's cards carry one — the two caveats about the exported bytes,
 * and the import safety property on each of the other two. That was 90 / 48 / 48
 * px of paragraph unreserved, against which the four `field` boxes over-draw the
 * export rows by ~29 and each import card's trailing `field` over-draws its
 * button row by ~24, leaving the three deficits this file used to record: 73 /
 * 46 / 28.
 *
 * `Skeleton.tsx` grew `footnote` for it — the slot one below `described`, and
 * the same shape: a line count, `Card`'s own `gap-3` plus 18px a line. Measured
 * the same way, the three cards are now **-11 / -2 / -20**, and the sign is the
 * point: what is left is the *field* over-draw above, which this branch recorded
 * and did not cause. `footnote={4}` on the export card rather than 5 because its
 * footnote is two `<span className="block">` with `mt-1.5` between them — four
 * lines of text and a 6px margin a line count cannot model, which is 6px of the
 * 11.
 *
 * The reference frame named above is the reference frame here too, and the
 * footnote is where it bites hardest: that same export paragraph measures **9
 * lines at 340** and **2 in Arabic**. So the four reserved here leave -50 / -40
 * / -41 in Arabic at this width and +293 / +52 / +34 at 340 in French — a line
 * count cannot be right in all six frames, and this one is right in the frame
 * the rest of this file is measured in.
 *
 * **Three things are deliberately absent**, all conditional and none of them
 * knowable before the identity arrives: the fourth export row and the second
 * import card (a reader holding three of the four capabilities gets three rows
 * and possibly one card, and the placeholder cannot know which, so it draws the
 * page almost every reader gets), and the report block, which exists only after
 * somebody has pressed Preview — by definition after this is gone.
 */
export default async function TransferLoading() {
  const t = await getTranslations("transfer");
  const label = (await getTranslations("states"))("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader title={t("title")} divided={false} />

      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          <FormSkeleton fields={4} described={2} footnote={4} label={label} />
          <FormSkeleton fields={["hinted", "hinted", "field"]} footnote={2} label={label} />
          <FormSkeleton fields={["hinted", "field"]} footnote={2} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
