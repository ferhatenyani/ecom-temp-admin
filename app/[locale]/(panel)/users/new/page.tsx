import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { roleList } from "@/lib/api/schemas/staff";
import { canManageUsers } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { NewUserForm } from "./NewUserForm";

/**
 * Creating a staff account.
 *
 * Its own route rather than an overlay, and rather than the detail against an
 * empty object — `NewUserForm.tsx` carries the four measured reasons. The role
 * picker is the discriminating part: `/roles` publishes **seven** rows and only
 * **two** are assignable, so the control offers two options over a matrix of
 * seven, and a picker built from the whole list would offer five roles the API
 * refuses by name.
 */
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
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader
          title={t("newUser")}
          back={{ href: `/${locale}/users`, label: t("title") }}
          divided={false}
        />
        <PageBody width="form">
          <ForbiddenState capability="ac_manage_users" />
        </PageBody>
      </div>
    );
  }

  const roles = await acFetch(roleList, session, "/roles").catch((error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  });

  return (
    <NewUserForm
      locale={locale}
      myCapabilities={me?.capabilities ?? []}
      roles={roles?.data ?? []}
    />
  );
}
