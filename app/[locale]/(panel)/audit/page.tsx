import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { auditList } from "@/lib/api/schemas/audit";
import { staffUserList } from "@/lib/api/schemas/staff";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { AuditList } from "./AuditList";
import { listParams, queryFromParams } from "./query";

/**
 * The audit trail — `ac_view_audit_logs`.
 *
 * ADMIN_PANEL.md: *this is the screen that makes the per-user credential
 * decision worth its cost — every row names a person because every staff member
 * authenticates as themselves.* Measured, `actor_login` is on every row, so this
 * screen does not have the inventory ledger's problem, which is the same
 * observation from the other side: a movement carries `actor_id` alone and the
 * ledger cannot name anybody.
 */
export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);

  if (!has(me, "ac_view_audit_logs")) {
    const t = await getTranslations("audit");
    return (
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_view_audit_logs" />
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
   * The actor picker is fed by `/users`, and this is the one screen where that
   * is free: `ac_view_audit_logs` and `ac_manage_users` are held by the same
   * tier — measured, a Manager is 403 on both — so the list is always fillable
   * for anybody who can open this page. That is exactly the gap the *inventory*
   * ledger has and cannot close: `ac_manage_inventory` is held by four roles and
   * `/users` by one, so its rows cannot name a colleague.
   *
   * 100 is the cap. This shop has 72 accounts and the picker is a convenience
   * over `?actor_id=`, which the URL carries whether or not the name resolves.
   */
  const [initial, actors] = await Promise.all([
    acFetch(auditList, session, `/audit-logs?${listParams(query)}`).catch((error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    }),
    acFetch(staffUserList, session, "/users?per_page=100").catch((error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    }),
  ]);

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <AuditList
      locale={locale}
      initialQuery={query}
      initialRows={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
      actors={(actors?.data ?? []).map((user) => ({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
      }))}
    />
  );
}
