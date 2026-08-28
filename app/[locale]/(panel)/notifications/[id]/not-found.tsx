import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";

/**
 * A 404 on a notification id.
 *
 * Unambiguous, unlike the CMS's — a page and a draft are the same 404 there,
 * which is why `feat/cms-page-index` existed. Here the row is addressed by
 * primary key and the API answers with one sentence: "No notification with that
 * id." Reached by a stale link, or by an id from a support ticket that predates a
 * table the backend's own suite empties before it asserts anything.
 *
 * `EmptyState` rather than `ErrorState`: nothing failed. The request was
 * answered, and the answer is that there is no such row — so there is no retry to
 * offer and the one useful action is the way back to the queue.
 */
export default async function NotificationNotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tNotifications = await getTranslations({ locale, namespace: "notifications" });

  const back = `/${locale}/notifications`;

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("notFoundTitle")}
        back={{ href: back, label: tNotifications("title") }}
        divided={false}
      />
      <PageBody width="detail">
        <EmptyState
          icon="alert"
          message={tNotifications("notFound")}
          /* `href` and not `onClick`: this is a Server Component, and `States.tsx`
             is `"use client"` — a function cannot cross that boundary at all. */
          action={{ label: tNotifications("title"), href: back }}
        />
      </PageBody>
    </div>
  );
}
