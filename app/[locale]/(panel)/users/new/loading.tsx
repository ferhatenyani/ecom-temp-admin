import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { FormSkeleton, Skeleton, SkeletonRegion } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches `/roles`.
 *
 * **The one request behind this screen is the role matrix**, which is why the
 * page has a loading state at all: there is no record to fetch, but the picker
 * cannot be drawn before the seven rows arrive and a form that painted three
 * controls and then grew a fourth is the layout shift this file exists to stop.
 *
 * Three cards, matching the real screen: identity at **three** controls — login,
 * e-mail and display name; `first_name`/`last_name` are not collected, and
 * `NewUserForm.tsx` argues why — then the role picker alone, then the
 * capabilities card, which renders one line of prose until a role is chosen and
 * is drawn as that rather than as a row of badges.
 *
 * **The save bar is drawn here and not on the detail**, and the difference is the
 * `persistent` prop: a create form's primary must be reachable from first paint,
 * so the bar is in the tree from the start and a placeholder that omitted it
 * would settle by its full height the moment the form arrived.
 */
export default async function NewUserLoading() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "staff" });
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("newUser")}
        subtitle={label}
        back={{ href: `/${locale}/users`, label: t("title") }}
        divided={false}
      />

      <PageBody width="form" className="flex flex-col gap-4">
        <FormSkeleton fields={3} label={label} />
        <FormSkeleton fields={1} label={label} />

        {/* Capabilities before a role is chosen: a heading over one line. */}
        <SkeletonRegion
          label={label}
          className="ui-card flex flex-col gap-3 overflow-hidden py-4 sm:py-5"
        >
          <div className="px-4 sm:px-5">
            <Skeleton className="h-6 w-32" />
          </div>
          <div className="px-4 sm:px-5">
            <Skeleton className="h-4.5 w-64" />
          </div>
        </SkeletonRegion>

        {/* `SaveBar`'s own box: `ui-card` with `px-4 pt-3`, a message line and one
            button. It is `persistent` here, so it is on screen from first paint. */}
        <div className="ui-card flex items-center gap-3 px-4 pt-3 pb-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="ms-auto h-9 w-24 rounded-ui-md" />
        </div>
      </PageBody>
    </div>
  );
}
