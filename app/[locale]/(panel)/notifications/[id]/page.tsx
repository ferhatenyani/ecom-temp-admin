import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { notificationDetail } from "@/lib/api/schemas/notification";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
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
      <div className="min-h-dvh bg-ui-canvas">
        {/* No `back` link on the refusal: the list is the same 403, so offering a
            way to it would be a control that cannot act. §3.3, reaching a
            breadcrumb. */}
        <PageHeader title={t("title")} divided={false} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_customers" />
        </PageBody>
      </div>
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
