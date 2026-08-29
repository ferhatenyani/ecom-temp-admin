import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { auditList } from "@/lib/api/schemas/audit";
import { staffUserList } from "@/lib/api/schemas/staff";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
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
      <div className="min-h-dvh bg-ui-canvas">
        {/* The header still renders, so the refusal arrives on the screen the
            person asked for rather than on a blank page — §3.7's third state. No
            toolbar and no count: there is nothing behind the gate to filter or to
            count, and `audit-count` being absent is what distinguishes the
            refusal from a served screen with zero rows. */}
        <PageHeader title={t("title")} />
        <PageBody width="full">
          <ForbiddenState capability="ac_view_audit_logs" />
        </PageBody>
      </div>
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
   * 100 is the cap, and the residue is recorded rather than papered over: the
   * trail carries 222 distinct actors against the 70 `/users` publishes, so an
   * actor whose account has since been deleted appears on rows and cannot be
   * filtered to. `?actor_id=` still carries whatever the URL holds.
   *
   * **Neither read ends in `.catch(() => null)`.** An `ApiError` becomes a null
   * seed, so the client query issues the request itself and renders the API's
   * own refusal through `ErrorState` with a retry — §11's dashboard defect and
   * §18's settings defect were a *swallowed* failure rendering a degraded screen
   * with no error state at all. Anything that is not an `ApiError` rethrows and
   * reaches the route's error boundary.
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
