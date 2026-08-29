import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";

/**
 * A 404 on a staff id.
 *
 * **It means "that is a customer, not staff" as often as it means "nobody"**,
 * and that is the one thing worth saying here. `/users` and `/customers` draw
 * from the same WordPress user table and answer 404 for each other's ids, so a
 * shopper's id pasted into this URL lands here — and a screen saying only "not
 * found" would send somebody looking for a deleted colleague.
 *
 * `EmptyState` rather than a hand-rolled box: this is the panel's "nothing here"
 * shape and the previous version drew its own card, its own icon and its own two
 * type sizes. The action is an `href` rather than an `onClick`, which is what
 * that prop was added for — this is a Server Component and cannot pass a handler
 * through the client boundary.
 */
export default async function StaffNotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tStaff = await getTranslations({ locale, namespace: "staff" });

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={tStaff("title")}
        back={{ href: `/${locale}/users`, label: tStaff("title") }}
        divided={false}
      />
      <PageBody width="form">
        <EmptyState
          icon="alert"
          message={t("notFoundTitle")}
          detail={tStaff("notFound")}
          action={{ label: tStaff("backToList"), href: `/${locale}/users` }}
        />
      </PageBody>
    </div>
  );
}
