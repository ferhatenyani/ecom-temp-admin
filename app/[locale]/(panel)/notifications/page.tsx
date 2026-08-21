import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { notificationList } from "@/lib/api/schemas/notification";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { NotificationsList } from "./NotificationsList";
import { listParams, queryFromParams } from "./query";

export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);

  /*
   * **`ac_manage_customers`, and 14a's forbidden fixture does not transfer.**
   *
   * Measured 2026-08-21 across four roles: Super Admin, Manager and Support
   * Agent are all **200** here, and a Marketing Manager is **403** on all three
   * notification routes and on `/customers` as well. That is the exact inverse
   * of the content branch, where a Manager is 403 on every `/cms/` route — which
   * is why step 14 is three branches and the seam is the capability.
   *
   * §90 gates it here and explicitly refuses to invent a capability: a row holds
   * a customer's address and, on the single read, the frozen body of their order
   * confirmation. §63's rule — reporting may not disclose in aggregate what the
   * caller cannot already read in detail — makes the capability that already
   * reads a customer's record the honest gate.
   */
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

  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") incoming.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) incoming.set(key, value[0]);
  }
  const query = queryFromParams(incoming);

  const initial = await acFetch(
    notificationList,
    session,
    `/notifications?${listParams(query)}`,
  ).catch((error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  });

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <NotificationsList
      locale={locale}
      initialQuery={query}
      initialNotifications={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
    />
  );
}
