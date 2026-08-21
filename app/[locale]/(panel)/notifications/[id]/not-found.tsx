import { getLocale, getTranslations } from "next-intl/server";
import { Scaffold } from "@/components/patterns/Scaffold";
import { Icon } from "@/components/primitives/Icon";

/**
 * A 404 on a notification id.
 *
 * Unambiguous, unlike the CMS's — a page and a draft are the same 404 there,
 * which is why `feat/cms-page-index` existed. Here the row is addressed by
 * primary key and the API answers with one sentence: "No notification with that
 * id." Reached by a stale link, or by an id from a support ticket that predates
 * a table the backend's own suite empties before it asserts anything.
 */
export default async function NotificationNotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tNotifications = await getTranslations({ locale, namespace: "notifications" });

  return (
    <Scaffold
      title={tNotifications("title")}
      back={{ href: `/${locale}/notifications`, label: tNotifications("title") }}
    >
      <div className="px-4">
        <div className="rounded-lg bg-surface px-6 py-12 text-center">
          <Icon name="alert" className="mx-auto size-8 text-label-tertiary" />
          <h2 className="mt-4 text-title-3 text-label">{t("notFoundTitle")}</h2>
          <p className="mt-2 text-body text-label-secondary">{tNotifications("notFound")}</p>
        </div>
      </div>
    </Scaffold>
  );
}
