import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { notificationDetail } from "@/lib/api/schemas/notification";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { NotificationDetail } from "./NotificationDetail";

/** `params` is a Promise in Next 16, like `searchParams` and `cookies()`. */
export default async function NotificationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { session, me } = await requireSession(locale);

  if (!has(me, "ac_manage_customers")) {
    const t = await getTranslations("notifications");
    return (
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_customers" />
        </div>
      </Scaffold>
    );
  }

  // `\d+` at the proxy and in the API's own route pattern, so a non-numeric id
  // never reaches the API — it would be a path refusal at the allowlist, which
  // this screen would render as an error rather than as "no such notification".
  if (!/^\d+$/.test(id)) notFound();

  /*
   * A 404 here says exactly one thing — "No notification with that id." — and
   * unlike a CMS page there is no draft/missing ambiguity behind it: the row is
   * addressed by primary key.
   */
  const notification = await acFetch(
    notificationDetail,
    session,
    `/notifications/${id}`,
  ).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });

  return <NotificationDetail locale={locale} initial={notification.data} />;
}
