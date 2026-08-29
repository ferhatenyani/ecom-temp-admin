import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { FormSkeleton } from "@/components/ui/Skeleton";

/**
 * The create route's skeleton.
 *
 * It is the edit placeholder minus three things, and each absence is the real
 * screen's: **no delete menu** in the header, so no 36px box beside the title;
 * **no redemption count** in the limits card, which drops it from four fields to
 * three; and **no record card**, because a coupon that does not exist yet has no
 * id, no creation date and nothing modified.
 *
 * This route fetches nothing — it renders a blank object — so the window this
 * covers is the session check and the bundle, not an API round trip. It exists
 * anyway: `next dev` and a cold edge both make that window visible, and a route
 * with no `loading.tsx` shows the *previous* screen while it waits, which on the
 * way in from the list looks like the create link having done nothing.
 */
export default async function NewCouponLoading() {
  const locale = await getLocale();
  const t = await getTranslations("coupons");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("createTitle")}
        subtitle={label}
        back={{ href: `/${locale}/coupons`, label: t("title") }}
        divided={false}
      />

      <PageBody width="form">
        <div className="flex flex-col gap-4">
          <FormSkeleton fields={5} label={label} />
          <FormSkeleton fields={3} label={label} />
          <FormSkeleton fields={3} label={label} />
          <FormSkeleton fields={3} label={label} />
          <FormSkeleton fields={4} label={label} />
          <FormSkeleton fields={1} footnote={1} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
