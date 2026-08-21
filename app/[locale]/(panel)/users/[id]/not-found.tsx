import { getLocale, getTranslations } from "next-intl/server";
import { Scaffold } from "@/components/patterns/Scaffold";
import { Icon } from "@/components/primitives/Icon";

/**
 * A 404 on a staff id.
 *
 * **It means "that is a customer, not staff" as often as it means "nobody"**,
 * and that is the one thing worth saying here. `/users` and `/customers` draw
 * from the same WordPress user table and answer 404 for each other's ids, so a
 * shopper's id pasted into this URL lands here — and a screen saying only "not
 * found" would send somebody looking for a deleted colleague.
 */
export default async function StaffNotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tStaff = await getTranslations({ locale, namespace: "staff" });

  return (
    <Scaffold title={tStaff("title")} back={{ href: `/${locale}/users`, label: tStaff("title") }}>
      <div className="px-4">
        <div className="rounded-lg bg-surface px-6 py-12 text-center">
          <Icon name="alert" className="mx-auto size-8 text-label-tertiary" />
          <h2 className="mt-4 text-title-3 text-label">{t("notFoundTitle")}</h2>
          <p className="mt-2 text-body text-label-secondary">{tStaff("notFound")}</p>
        </div>
      </div>
    </Scaffold>
  );
}
