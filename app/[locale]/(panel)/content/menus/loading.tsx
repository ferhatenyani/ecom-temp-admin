import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for the menus.
 *
 * **It is the shortest-lived placeholder on this branch and still worth having.**
 * `page.tsx` fetches nothing — the menu is read in the client, because a 404 here
 * is a *state* rather than a failure — so this covers only the segment's own
 * render. What it buys is the chrome: the back link, the add button and the
 * two-tab location strip all exist before the tree does, and drawing them here
 * means the strip does not appear under the reader's pointer a frame later.
 *
 * The tree itself gets `CardSkeleton`, untitled, at five rows — a menu row is a
 * label against a target, which is the label/value shape that component is
 * measured against, and the primary menu on this shop is five items.
 */
export default async function MenusLoading() {
  const t = await getTranslations("content");
  const label = t("loading");
  const locale = await getLocale();

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("section.menus")}
        subtitle={label}
        back={{ href: `/${locale}/content`, label: t("title") }}
        actions={<Skeleton className="h-9 w-40 rounded-ui-md" />}
        toolbar={
          <div className="-mx-4 sm:-mx-6 xl:-mx-8">
            <div className="flex items-center gap-1 border-b border-ui-line px-4 sm:px-6 xl:px-8">
              <Skeleton className="mb-1.5 h-7 w-20 rounded-ui-md" />
              <Skeleton className="mb-1.5 h-7 w-24 rounded-ui-md" />
            </div>
          </div>
        }
      />
      <PageBody width="detail">
        <CardSkeleton rows={5} label={label} titled={false} footnote={1} />
      </PageBody>
    </div>
  );
}
