import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { staffUserList, roleList } from "@/lib/api/schemas/staff";
import { listMeta } from "@/lib/api/envelope";
import { canManageUsers } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { UsersList } from "./UsersList";
import { listParams, queryFromParams } from "./query";

/**
 * Staff accounts — `ac_manage_users`, **Super Admin alone**.
 *
 * `/users` is staff and `/customers` is shoppers and **no account is in both**:
 * `GET /users/{id}` on a shopper is a 404 and `GET /customers/{id}` on a staff
 * account is the same. So this list shares no reader, no type and no capability
 * with the customers screen, and the two deliberately do not meet.
 */
export default async function UsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);

  if (!canManageUsers(me)) {
    const t = await getTranslations("staff");
    return (
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_users" />
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

  /*
   * Both reads on the server and in parallel. `/roles` is the label source for
   * every row — 51 of 72 accounts hold a role that can no longer be assigned,
   * so a list rendered without it would show a raw key beside three quarters of
   * the shop's staff — and it changes about as often as the code does, so it is
   * fetched once here rather than per row.
   */
  const [initial, roles] = await Promise.all([
    acFetch(staffUserList, session, `/users?${listParams(query)}`).catch((error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    }),
    acFetch(roleList, session, "/roles").catch((error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    }),
  ]);

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <UsersList
      locale={locale}
      meId={me?.id ?? null}
      initialQuery={query}
      initialUsers={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
      roles={roles?.data ?? []}
    />
  );
}
