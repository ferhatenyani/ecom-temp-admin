"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import type { Role, StaffUserDetail } from "@/lib/api/schemas/staff";
import { BrowserApiError, acRead, acWrite } from "@/lib/api/browser";
import {
  assignableRoles,
  deleteConflictCount,
  isRetiredRole,
  isSelf,
  roleLabel,
  staffName,
  STATUS_TONE,
} from "@/lib/staff";
import { formatDate } from "@/lib/format/date";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { ReadOnlyField, SelectField, TextField } from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { ActionSheet } from "@/components/primitives/ActionSheet";
import { useToast } from "@/components/primitives/Toast";
import { CredentialsSection } from "./CredentialsSection";
import { userKey } from "../query";

/**
 * One staff account, and **the five escalation refusals rendered as controls
 * that say no rather than controls that are not there.**
 *
 * ADMIN_PANEL.md is explicit about that: the refusals *are* the security model,
 * and a Super Admin should be able to see it. A hidden suspend button teaches
 * nothing; a disabled one with "you cannot suspend your own account" beside it
 * teaches the rule in the place somebody would otherwise file a bug about it.
 *
 * The five split two ways, and the split is the same one the analytics money
 * gate makes:
 *
 *   known locally   changing your own role, suspending yourself, deleting
 *                   yourself. The panel knows who it is, so the control is
 *                   disabled with the reason and no request is sent.
 *
 *   asked           assigning a WordPress or a retired role, and deleting an
 *                   account that owns orders. **Nothing on a user row says
 *                   whether they own orders** — there is no count, and
 *                   `/orders?customer_id=` is a capability this screen's gate
 *                   does not imply — so a panel that greyed the button out would
 *                   be guessing. It asks and renders `details.orders`.
 */
export function UserDetail({
  locale,
  meId,
  initial,
  roles,
}: {
  locale: string;
  meId: number | null;
  initial: StaffUserDetail;
  roles: Role[];
}) {
  const t = useTranslations("staff");
  const router = useRouter();
  const toast = useToast();

  const { data: user = initial, refetch } = useQuery({
    queryKey: userKey(initial.id),
    queryFn: async () => (await acRead<StaffUserDetail>(`/users/${initial.id}`)).data,
    initialData: initial,
  });

  const [draft, setDraft] = useState({
    first_name: initial.first_name,
    last_name: initial.last_name,
    email: initial.email,
  });
  const [role, setRole] = useState(initial.role);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"suspend" | "activate" | "delete" | null>(null);
  const [deleteBlock, setDeleteBlock] = useState<{ message: string; orders: number | null } | null>(
    null,
  );

  const me = isSelf(user.id, meId);
  const retired = isRetiredRole(user.role, roles);
  const wordpress = user.is_administrator;
  const assignable = assignableRoles(roles);

  const identityDirty =
    draft.first_name !== user.first_name ||
    draft.last_name !== user.last_name ||
    draft.email !== user.email;
  const roleDirty = role !== user.role;
  const dirty = identityDirty || roleDirty;

  async function save() {
    setSaving(true);
    setFields(null);
    setFailure(null);

    try {
      const payload: Record<string, string> = {};
      if (draft.first_name !== user.first_name) payload.first_name = draft.first_name;
      if (draft.last_name !== user.last_name) payload.last_name = draft.last_name;
      if (draft.email !== user.email) payload.email = draft.email;
      if (roleDirty) payload.role = role;

      await acWrite("PATCH", `/users/${user.id}`, payload);
      await refetch();
      toast.show(t("saved"));
    } catch (error) {
      if (error instanceof BrowserApiError) {
        setFields(error.fields);
        /*
         * A 403 here is one of the three self-refusals arriving anyway — a
         * second tab, a stale render — and a 409 is a duplicate email. Both
         * carry a sentence worth showing whole, and neither has a field to bind
         * to when `details` is empty.
         */
        if (error.fields === null) setFailure(error.message);
      } else {
        setFailure((error as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(next: "active" | "suspended") {
    try {
      await acWrite("PATCH", `/users/${user.id}`, { status: next });
      await refetch();
      toast.show(next === "suspended" ? t("suspended") : t("reactivated"));
    } catch (error) {
      toast.show((error as Error).message);
    } finally {
      setConfirming(null);
    }
  }

  async function remove() {
    setConfirming(null);
    setDeleteBlock(null);

    try {
      await acWrite("DELETE", `/users/${user.id}`);
      toast.show(t("deleted"));
      router.push(`/${locale}/users`);
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 409) {
        /*
         * **The 409 body is the authority**, the house rule this panel applies
         * to an order's status transition and applies again here. `details.orders`
         * is a count, and the message names the alternative — suspend — which
         * becomes a button rather than a sentence repeated back.
         */
        setDeleteBlock({ message: error.message, orders: deleteConflictCount(error.details) });
      } else {
        toast.show((error as Error).message);
      }
    }
  }

  return (
    <Scaffold
      title={staffName(user)}
      back={{ href: `/${locale}/users`, label: t("title") }}
      trailing={<StatusBadge tone={STATUS_TONE[user.status]}>{t(`status.${user.status}`)}</StatusBadge>}
    >
      <div className="mx-auto max-w-3xl px-4 pb-28">
        {failure !== null ? (
          <div
            role="alert"
            className="tone-danger tonal mb-3 flex items-start gap-2 rounded-lg px-3 py-2"
          >
            <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 text-footnote">{failure}</span>
          </div>
        ) : null}

        <ListGroup title={t("identity")}>
          {/*
            The username is the identity, not a field. `user_login` is refused by
            name — "A login is an identity, not a field. Create the account with
            the username you want." — so a control here would be a control that
            400s, which is a bug report waiting to be filed.
          */}
          <ReadOnlyField
            label={t("field.username")}
            value={<Ltr numeric={false}>{user.username}</Ltr>}
            reason={t("readOnly.username")}
          />
          <TextField
            label={t("field.first_name")}
            value={draft.first_name}
            onChange={(value) => setDraft((d) => ({ ...d, first_name: value }))}
            error={fields?.first_name}
          />
          <TextField
            label={t("field.last_name")}
            value={draft.last_name}
            onChange={(value) => setDraft((d) => ({ ...d, last_name: value }))}
            error={fields?.last_name}
          />
          <TextField
            label={t("field.email")}
            value={draft.email}
            onChange={(value) => setDraft((d) => ({ ...d, email: value }))}
            error={fields?.email}
            isolate
          />
          <ReadOnlyField
            label={t("field.date_created")}
            value={<Isolate>{formatDate(user.date_created, locale)}</Isolate>}
          />
        </ListGroup>

        <ListGroup title={t("roleSection")} footnote={t("roleNote")}>
          {me || wordpress ? (
            /*
              Two of the five refusals, both known locally, both rendered as a
              value with its reason rather than as a disabled picker: a `<select>`
              nobody can open is worse than a line of text saying why.
            */
            <ReadOnlyField
              label={t("field.role")}
              value={<Isolate numeric={false}>{roleLabel(user.role, user.role_name, roles)}</Isolate>}
              reason={me ? t("refusal.ownRole") : t("refusal.wordpress")}
            />
          ) : (
            <SelectField
              label={t("field.role")}
              value={role}
              onChange={setRole}
              /*
                The picker offers **only assignable roles**, and the account's own
                role is prepended when it is one of the five retired ones — 51 of
                72 accounts are in that state, and a picker that silently
                reselected `ac_manager` for them would change a role nobody asked
                to change on the next save.
              */
              options={[
                ...(retired
                  ? [
                      {
                        value: user.role,
                        label: `${roleLabel(user.role, user.role_name, roles)} — ${t("retired")}`,
                      },
                    ]
                  : []),
                ...assignable.map((r) => ({ value: r.role, label: r.name })),
              ]}
              error={fields?.role}
              hint={retired ? t("retiredHint") : undefined}
            />
          )}

          {/* What the role actually holds, so a picker is not a name with no
              meaning. Read out of `/roles`, which is §45's matrix published. */}
          <ListRow className="flex flex-col items-start gap-1">
            <span className="text-footnote text-label-secondary">{t("capabilities")}</span>
            <span className="flex flex-wrap gap-1">
              {(roles.find((r) => r.role === role)?.capabilities ?? []).map((capability) => (
                <StatusBadge key={capability} tone="neutral">
                  <Ltr numeric={false}>{capability}</Ltr>
                </StatusBadge>
              ))}
              {roles.find((r) => r.role === role) === undefined ? (
                <span className="text-caption text-label-tertiary">{t("capabilitiesUnknown")}</span>
              ) : null}
            </span>
          </ListRow>
        </ListGroup>

        <CredentialsSection user={user} locale={locale} onChanged={() => void refetch()} />

        <ListGroup title={t("dangerous")} footnote={t("dangerousNote")}>
          {deleteBlock !== null ? (
            <ListRow className="tone-warning tonal flex flex-col items-start gap-2">
              <span className="text-footnote">{deleteBlock.message}</span>
              {deleteBlock.orders !== null ? (
                <span className="text-caption">
                  <Isolate numeric>{t("ownsOrders", { count: deleteBlock.orders })}</Isolate>
                </span>
              ) : null}
              {user.status === "active" ? (
                <Button variant="tinted" onClick={() => setConfirming("suspend")}>
                  {t("suspend")}
                </Button>
              ) : null}
            </ListRow>
          ) : null}

          <ListRow className="flex flex-col items-stretch gap-2">
            <Button
              variant="tinted"
              onClick={() => setConfirming(user.status === "active" ? "suspend" : "activate")}
              disabled={me}
              fullWidth
            >
              {user.status === "active" ? t("suspend") : t("reactivate")}
            </Button>
            {me ? (
              <span className="text-caption text-label-tertiary">{t("refusal.ownSuspend")}</span>
            ) : (
              <span className="text-caption text-label-tertiary">{t("suspendNote")}</span>
            )}
          </ListRow>

          <ListRow className="flex flex-col items-stretch gap-2">
            <Button
              variant="destructive"
              onClick={() => setConfirming("delete")}
              disabled={me}
              fullWidth
            >
              {t("delete")}
            </Button>
            <span className="text-caption text-label-tertiary">
              {me ? t("refusal.ownDelete") : t("deleteNote")}
            </span>
          </ListRow>
        </ListGroup>
      </div>

      {dirty ? (
        <div className="save-bar material-bar hairline-t fixed inset-x-0 z-20">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
            <Button
              variant="plain"
              onClick={() => {
                setDraft({
                  first_name: user.first_name,
                  last_name: user.last_name,
                  email: user.email,
                });
                setRole(user.role);
                setFields(null);
                setFailure(null);
              }}
              disabled={saving}
              className="flex-1"
            >
              {t("revert")}
            </Button>
            <Button variant="filled" onClick={() => void save()} loading={saving} className="flex-1">
              {t("save")}
            </Button>
          </div>
        </div>
      ) : null}

      <ActionSheet
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={confirming === null ? "" : t(`confirm.${confirming}Title`)}
        description={
          confirming === null
            ? undefined
            : t(`confirm.${confirming}Body`, { name: staffName(user) })
        }
        actions={
          confirming === null
            ? []
            : [
                {
                  label: t(confirming === "delete" ? "delete" : confirming === "suspend" ? "suspend" : "reactivate"),
                  tone: confirming === "activate" ? ("default" as const) : ("destructive" as const),
                  onSelect: () => {
                    if (confirming === "delete") void remove();
                    else void setStatus(confirming === "suspend" ? "suspended" : "active");
                  },
                },
              ]
        }
      />
    </Scaffold>
  );
}
