import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { CardSkeleton, FormSkeleton, Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches the record.
 *
 * **It draws a single 640px column**, which is the reason this file is worth
 * having rather than a spinner: `PageBody width="form"` is a narrower measure
 * than the list's `full`, so a placeholder inheriting the wrong width would paint
 * one shape and reflow into another the moment the data lands. §2.3 puts "user"
 * in the form row by name.
 *
 * The card counts are the real screen's, in DOM order: identity (four controls —
 * display name, e-mail, and the two read-only rows, which wear the same
 * `FieldFrame` geometry), role, capabilities, credentials, status and delete.
 *
 * **Six cards is the majority screen rather than every screen.** The role card
 * loses its picker on the acting user's own account and on the two WordPress
 * administrators; the credentials card loses its two controls on a suspended
 * account; the status and delete cards lose their buttons on your own row. None
 * of that is knowable here — the record has not been fetched and the session is
 * not readable in a `loading.tsx` — and drawing the shape 65 of 69 rows get is
 * the honest trade. The alternative is a skeleton that matches nobody.
 *
 * **No save bar is drawn.** It is `dirty`-only, and a form that has just loaded
 * is clean by construction, so a placeholder for it would be a 61px block that
 * never arrives.
 *
 * **The title is the section's, not the record's.** A route-level `loading.tsx`
 * runs before the fetch, so the account's name is not knowable here — and
 * inventing a placeholder bar where an `<h1>` will be is worse than showing the
 * true heading of the thing being loaded, because the bar would be the one
 * element on the page that lies about its own width.
 */
export default async function UserDetailLoading() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "staff" });
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        back={{ href: `/${locale}/users`, label: t("title") }}
        divided={false}
      />

      <PageBody width="form" className="flex flex-col gap-4">
        {/* Identity: four label-over-control blocks under a heading. */}
        <FormSkeleton fields={4} label={label} />

        {/* Role: two blocks, which is the majority shape rather than every shape.
            **50 of 69 accounts hold a retired role**, and those get the held role
            stated read-only above a picker that cannot represent it; an account on
            one of the two assignable roles gets the picker alone and settles
            upward by one. */}
        <FormSkeleton fields={2} label={label} />

        {/* Capabilities: a heading, a description, and a wrapped row of badges.
            Seven is `ac_manager`'s count and the median of the seven roles;
            `CardSkeleton` cannot stand in for it, because badges are not rows. */}
        <SkeletonRegion
          label={label}
          className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
        >
          <div className="flex flex-col gap-1.5 px-4 sm:px-5">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4.5 w-48" />
          </div>
          {/* Literal class names, never interpolated: Tailwind extracts classes
              by scanning the source, so a `w-${n}` built at runtime produces no
              rule and the badge collapses to its content width. */}
          <div className="flex flex-wrap gap-1.5 px-4 sm:px-5">
            {["w-16", "w-20", "w-14", "w-24", "w-16", "w-20", "w-14"].map((width, index) => (
              <Skeleton key={index} className={`h-5 rounded-ui-md ${width}`} />
            ))}
          </div>
        </SkeletonRegion>

        {/* Credentials: the device list, then the name field and its button. Two
            rows is what account 774 carries and is the only shape on this shop
            with more than none. */}
        <SkeletonRegion
          label={label}
          className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
        >
          <div className="px-4 sm:px-5">
            <Skeleton className="h-6 w-48" />
          </div>
          <div className="px-4 sm:px-5">
            {[0, 1].map((row) => (
              <div
                key={row}
                className="flex items-center gap-3 border-b border-ui-line py-2 last:border-b-0"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4.5 w-32" />
                </div>
                <Skeleton className="size-7 rounded-ui-md" />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 px-4 sm:px-5">
            <Skeleton className="h-4.5 w-28" />
            <Skeleton className="ui-field w-full rounded-ui-md" />
          </div>
        </SkeletonRegion>

        {/* Status: one `DataRow` and a button. */}
        <CardSkeleton rows={1} label={label} />

        {/* Delete: a heading, a footnote and a button — no rows at all, which is
            why this one is drawn by hand rather than as a `CardSkeleton`. */}
        <SkeletonRegion
          label={label}
          className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
        >
          <div className="px-4 sm:px-5">
            <Skeleton className="h-6 w-40" />
          </div>
          <div className="flex justify-end px-4 sm:px-5">
            <Skeleton className="h-9 w-44 rounded-ui-md" />
          </div>
          <div className="px-4 sm:px-5">
            <Skeleton className="h-4.5 w-full" />
          </div>
        </SkeletonRegion>
      </PageBody>
    </div>
  );
}
