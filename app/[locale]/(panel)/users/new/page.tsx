import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { roleList } from "@/lib/api/schemas/staff";
import { canManageUsers } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { NewUserForm } from "./NewUserForm";

export default async function NewUserPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("staff");

  if (!canManageUsers(me)) {
    return (
      <Scaffold title={t("newUser")} back={{ href: `/${locale}/users`, label: t("title") }}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_users" />
        </div>
      </Scaffold>
    );
  }

  const roles = await acFetch(roleList, session, "/roles").catch((error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  });

  return <NewUserForm locale={locale} roles={roles?.data ?? []} />;
}
