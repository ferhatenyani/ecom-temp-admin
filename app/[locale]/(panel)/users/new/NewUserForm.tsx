"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Role, StaffUser } from "@/lib/api/schemas/staff";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { assignableRoles } from "@/lib/staff";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { SelectField, TextField } from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { useToast } from "@/components/primitives/Toast";

/**
 * A new staff account.
 *
 * Its own screen rather than the detail form against an empty object, which is
 * the choice `CouponForm` made the other way. Three things differ enough to make
 * one component wrong here:
 *
 *   `username` is **write-once**. It is a required field on create and refused
 *   by name on update — "A login is an identity, not a field" — so the same
 *   control would have to be a text field on one path and a read-only row on the
 *   other.
 *
 *   `role` is **required** on create. An account with no role is a customer
 *   created through the wrong door, and the API says exactly that: *"Required.
 *   An account with no role is a customer, and customers are managed at
 *   /customers."*
 *
 *   The whole second half of the detail — credentials, suspension, deletion —
 *   is meaningless against an account that does not exist yet, and the create
 *   flow's real next step is minting the first credential, which needs the id.
 *
 * So this creates and then **navigates to the detail**, where the credential
 * section is. That is the onboarding path §87 was built for, in two screens.
 */
export function NewUserForm({ locale, roles }: { locale: string; roles: Role[] }) {
  const t = useTranslations("staff");
  const router = useRouter();
  const toast = useToast();

  const assignable = assignableRoles(roles);

  const [draft, setDraft] = useState({
    username: "",
    email: "",
    first_name: "",
    last_name: "",
    /*
     * No default. A role is required and the two are not interchangeable —
     * `ac_super_admin` carries thirteen capabilities including this one, and a
     * form that pre-selected it would make the most privileged account in the
     * shop the easiest one to create by accident.
     */
    role: "",
  });
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const set = (key: keyof typeof draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const complete = draft.username.trim() !== "" && draft.email.trim() !== "" && draft.role !== "";

  async function create() {
    setSaving(true);
    setFields(null);
    setFailure(null);

    try {
      const created = await acWrite<StaffUser>("POST", "/users", {
        username: draft.username.trim(),
        email: draft.email.trim(),
        first_name: draft.first_name,
        last_name: draft.last_name,
        role: draft.role,
      });
      toast.show(t("created"));
      router.push(`/${locale}/users/${created.id}`);
    } catch (error) {
      if (error instanceof BrowserApiError) {
        /*
         * A 409 keys `details` by the field that collided — `{username: "…"}` or
         * `{email: "…"}` — not by `fields`, so it does not arrive through the
         * getter. Bound by hand here so a taken username lands on its own
         * control rather than in a banner above a form that looks fine.
         */
        if (error.status === 409) {
          const key = typeof error.details.username === "string" ? "username" : "email";
          setFields({ [key]: error.message });
        } else {
          setFields(error.fields);
          if (error.fields === null) setFailure(error.message);
        }
      } else {
        setFailure((error as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Scaffold title={t("newUser")} back={{ href: `/${locale}/users`, label: t("title") }}>
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

        <ListGroup title={t("identity")} footnote={t("usernameNote")}>
          <TextField
            label={t("field.username")}
            value={draft.username}
            onChange={(value) => set("username", value)}
            error={fields?.username}
            hint={t("hint.username")}
            isolate
          />
          <TextField
            label={t("field.email")}
            value={draft.email}
            onChange={(value) => set("email", value)}
            error={fields?.email}
            isolate
          />
          <TextField
            label={t("field.first_name")}
            value={draft.first_name}
            onChange={(value) => set("first_name", value)}
            error={fields?.first_name}
          />
          <TextField
            label={t("field.last_name")}
            value={draft.last_name}
            onChange={(value) => set("last_name", value)}
            error={fields?.last_name}
          />
        </ListGroup>

        <ListGroup title={t("roleSection")} footnote={t("assignableNote")}>
          <SelectField
            label={t("field.role")}
            value={draft.role}
            onChange={(value) => set("role", value)}
            /*
              **Only the two assignable roles.** `/roles` publishes seven and
              five are retired; assigning one is a 400 naming it as retired
              rather than as unknown, because it exists, it is published on that
              very route, and accounts hold it. Offering them here would be
              offering a choice the API answers with a paragraph.
            */
            options={[
              { value: "", label: t("role.choose") },
              ...assignable.map((role) => ({ value: role.role, label: role.name })),
            ]}
            error={fields?.role}
            hint={t("hint.role")}
          />

          {/* What the chosen role holds, before it is granted rather than after. */}
          <ListRow className="flex flex-col items-start gap-1">
            <span className="text-footnote text-label-secondary">{t("capabilities")}</span>
            <span className="text-caption text-label-tertiary" dir="auto">
              {draft.role === ""
                ? t("capabilitiesNone")
                : (assignable.find((r) => r.role === draft.role)?.capabilities ?? []).join(" · ")}
            </span>
          </ListRow>
        </ListGroup>

        <p className="mb-8 px-1 text-caption text-label-tertiary">{t("noPasswordNote")}</p>
      </div>

      <div className="save-bar material-bar hairline-t fixed inset-x-0 z-20">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Button
            variant="plain"
            onClick={() => router.push(`/${locale}/users`)}
            disabled={saving}
            className="flex-1"
          >
            {t("cancel")}
          </Button>
          <Button
            variant="filled"
            onClick={() => void create()}
            loading={saving}
            disabled={!complete}
            className="flex-1"
          >
            {t("create")}
          </Button>
        </div>
      </div>
    </Scaffold>
  );
}
