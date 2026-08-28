import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { CardSkeleton, Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches the record.
 *
 * **It draws a single 768px column**, which is the whole reason this file is
 * worth having rather than a spinner: `PageBody width="detail"` is a narrower
 * measure than the list's `full`, so a placeholder inheriting the wrong width
 * would paint one shape and reflow into another the moment the data lands.
 *
 * The card counts are the real screen's: status, message, delivery and links. The
 * status card is drawn at four rows — state, queued-at, attempts and the last
 * error — which is a failed row, the state somebody actually opens this screen
 * for; a queued row settles upward by two. The links card is drawn at three,
 * which is what an `order` subject gets, and every notification in this shop has
 * one.
 *
 * **The title is the section's, not the record's.** A route-level `loading.tsx`
 * runs before the fetch, so the event's name is not knowable here — and inventing
 * a placeholder bar where an `<h1>` will be is worse than showing the true
 * heading of the thing being loaded, because the bar would be the one element on
 * the page that lies about its own width.
 */
export default async function NotificationDetailLoading() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "notifications" });
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        back={{ href: `/${locale}/notifications`, label: t("title") }}
        divided={false}
        /* The primary's own box, so the header does not reflow when the control
           arrives. It is absent on a `sent` row; drawing it and having it not
           arrive costs one settle for the minority, where not drawing it costs one
           for everybody else. */
        actions={<Skeleton className="h-9 w-40 rounded-ui-md" />}
      />

      <PageBody width="detail" className="flex flex-col gap-4">
        <CardSkeleton rows={4} label={label} />

        {/* The message card: a heading, then the quote's own surface block. Its
            height is `blockquote`'s — `px-3 py-3` around a subject line and two
            paragraphs at their real line boxes. */}
        <SkeletonRegion
          label={label}
          className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
        >
          <div className="px-4 sm:px-5">
            <Skeleton className="h-6 w-32" />
          </div>
          <div className="px-4 sm:px-5">
            <div className="flex flex-col gap-3 rounded-ui-md bg-ui-surface-2 px-3 py-3">
              <Skeleton className="h-5.5 w-64" />
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-full" />
            </div>
          </div>
        </SkeletonRegion>

        <CardSkeleton rows={3} label={label} />

        {/* The links card: three `NavRow`s, each `min-h-11` with a rule under it —
            a taller row than a `DataRow`, which is why `CardSkeleton` cannot stand
            in for it. */}
        <SkeletonRegion
          label={label}
          className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
        >
          <div className="px-4 sm:px-5">
            <Skeleton className="h-6 w-32" />
          </div>
          <div className="px-4 sm:px-5">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="flex min-h-11 items-center gap-3 border-b border-ui-line py-2.5 last:border-b-0"
              >
                <Skeleton className="size-4 rounded-ui-sm" />
                <Skeleton className="h-5 w-28" />
                <Skeleton className="ms-auto h-5 w-24" />
              </div>
            ))}
          </div>
        </SkeletonRegion>
      </PageBody>
    </div>
  );
}
