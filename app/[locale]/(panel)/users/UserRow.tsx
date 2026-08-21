import { useTranslations } from "next-intl";
import type { Role, StaffUser } from "@/lib/api/schemas/staff";
import { STATUS_TONE, isRetiredRole, roleLabel, staffName } from "@/lib/staff";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Ltr, Isolate } from "@/components/primitives/Ltr";

/**
 * One staff account.
 *
 * Module scope with explicit props, never nested inside the list — a component
 * declared inside another gets a new identity on every parent render, remounts,
 * and loses its state. `RetrySection` shipped that way on 14b and the e2e caught
 * it as a race that passed four runs before failing once. This one holds no
 * state and would only be wasteful, but the rule is the rule.
 *
 * No date on the row. `date_created` is ISO with an offset and safe to format,
 * but a staff list is a list of *people* — the useful second line is who they
 * are and whether they can sign in, and the date is on the detail. That also
 * keeps `formatWhen` off this screen entirely, which is the other README trap:
 * it cannot be server-rendered without `useHydrated()`.
 */
export function UserRow({
  user,
  roles,
  isMe,
}: {
  user: StaffUser;
  roles: readonly Role[];
  isMe: boolean;
}) {
  const t = useTranslations("staff");

  const retired = isRetiredRole(user.role, roles);

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1 py-1">
      <span className="flex items-center gap-2">
        {/* User content in whichever language it was typed — `dir="auto"`, or
            `truncate` clips from the wrong end in the other locale. */}
        <span className="min-w-0 flex-1 truncate text-body text-label" dir="auto">
          {staffName(user)}
        </span>
        {isMe ? <StatusBadge tone="accent">{t("you")}</StatusBadge> : null}
        <StatusBadge tone={STATUS_TONE[user.status]}>{t(`status.${user.status}`)}</StatusBadge>
      </span>

      <span className="flex items-center gap-2 text-footnote text-label-secondary">
        {/* The login is an identifier and the audit trail's `actor_login`, so
            `Ltr` around it and never around the whole row. */}
        <Ltr numeric={false} className="min-w-0 truncate">
          {user.username}
        </Ltr>
        <span aria-hidden="true" className="text-label-tertiary">
          ·
        </span>
        <Isolate numeric={false} className="min-w-0 truncate">
          {roleLabel(user.role, user.role_name, roles)}
        </Isolate>
        {retired ? (
          <StatusBadge tone="neutral" className="shrink-0">
            {t("retired")}
          </StatusBadge>
        ) : null}
        {user.is_administrator ? (
          <StatusBadge tone="warning" className="shrink-0">
            {t("wordpress")}
          </StatusBadge>
        ) : null}
      </span>
    </span>
  );
}
