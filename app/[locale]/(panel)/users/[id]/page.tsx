import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { staffUserDetail, roleList } from "@/lib/api/schemas/staff";
import { canManageUsers } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { UserDetail } from "./UserDetail";

export default async function UserPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { session, me } = await requireSession(locale);

  if (!canManageUsers(me)) {
    const t = await getTranslations("staff");
    return (
      <Scaffold title={t("title")} back={{ href: `/${locale}/users`, label: t("title") }}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_users" />
        </div>
      </Scaffold>
    );
  }

  const userId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(userId) || userId <= 0) notFound();

  /*
   * **A 404 here means "that is a customer, not staff"** as often as it means
   * "nobody". `GET /users/{id}` filters to accounts holding one of §45's seven
   * roles or `administrator`, so a shopper's id answers *"No staff account with
   * that id."* — which is the one thing the not-found screen has to say, because
   * the ids come from the same WordPress user table and somebody will paste one.
   */
  const [detail, roles] = await Promise.all([
    acFetch(staffUserDetail, session, `/users/${userId}`).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
    acFetch(roleList, session, "/roles").catch((error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    }),
  ]);

  if (detail === null) notFound();

  return (
    <UserDetail
      locale={locale}
      meId={me?.id ?? null}
      initial={detail.data}
      roles={roles?.data ?? []}
    />
  );
}
