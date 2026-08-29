import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { FormSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton, shown while the Server Component fetches the coupon.
 *
 * **It draws one 640px column of form cards**, which is the whole reason this
 * file is worth having rather than a spinner: the real screen is
 * `PageBody width="form"`, and a full-width or two-column placeholder would paint
 * one shape and reflow into another the moment the data lands — a layout shift
 * with extra steps, §3.6's own words.
 *
 * The card counts are the real screen's and `FormSkeleton`'s field counts are the
 * real cards': the code and the discount is five controls, validity three, limits
 * four (three fields and the read-only redemption count), behaviour three, the
 * restrictions four rows, e-mail addresses one, and the record's three
 * label/value rows. `FormSkeleton` is measured against `Card`, which is what the
 * form is built from.
 *
 * **The save bar is deliberately absent.** It is `sticky` and appears only when
 * the form goes dirty, which a form nobody has typed into is not — drawing one
 * here would settle downwards on every visit.
 */
export default async function CouponLoading() {
  const locale = await getLocale();
  const t = await getTranslations("coupons");
  const label = t("loading");

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        back={{ href: `/${locale}/coupons`, label: t("title") }}
        divided={false}
        actions={
          /* The one real control's box: a 36px secondary icon button opening the
             delete menu, so the header does not reflow when it lands. */
          <Skeleton className="size-9 rounded-ui-md" />
        }
      />

      <PageBody width="form">
        <div className="flex flex-col gap-4">
          <FormSkeleton fields={5} label={label} />
          <FormSkeleton fields={3} label={label} />
          <FormSkeleton fields={4} label={label} />
          <FormSkeleton fields={3} label={label} />
          <FormSkeleton fields={4} label={label} />
          <FormSkeleton fields={1} footnote={1} label={label} />
          <FormSkeleton fields={3} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
