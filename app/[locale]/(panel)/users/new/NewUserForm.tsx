"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Role, StaffUser } from "@/lib/api/schemas/staff";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { assignableRoles, grantableRoles, missingForGrant } from "@/lib/staff";
import { useOnline } from "@/lib/use-online";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  ErrorSummary,
  SaveBar,
  Select,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { Notice } from "@/components/ui/States";
import { useToast } from "@/components/primitives/Toast";

/**
 * A new staff account.
 *
 * ## Its own screen, and `NewUserForm.tsx:16-38` already argued it with three
 * measured reasons
 *
 * Not the detail form against an empty object, which is the choice `CouponForm`
 * made the other way:
 *
 *   `username` is **write-once**. Required on create (`UserInput.php:41`) and
 *   refused **by name** on update (`:58`) — "A login is an identity, not a
 *   field." — so the same control would have to be a text input on one path and a
 *   read-only row on the other.
 *
 *   `role` is **required** on create and optional on update. An account with no
 *   role is a customer created through the wrong door, and the API says exactly
 *   that: *"Required. An account with no role is a customer, and customers are
 *   managed at /customers."*
 *
 *   The whole second half of the detail — credentials, suspension, deletion — is
 *   meaningless against an account that does not exist yet, and the create flow's
 *   real next step is minting the first credential, which needs the id.
 *
 * So this creates and then **navigates to the detail**, where the credential
 * section is. That is the onboarding path §87 was built for, in two screens.
 *
 * A fourth reason has since arrived: `status` is **"Unknown field."** on a POST.
 * A shared component would have to render the status card and then explain why it
 * does nothing.
 *
 * ## `POST /users` answers 201
 *
 * `UserController.php:200`. `lib/staff.ts` and `lib/api/schemas/staff.ts` both
 * said 200 until 2026-08-29, and this is the carried-forward "last create pinned
 * at 200 and never measured" family arriving again. Nothing branches on it, which
 * is how it survived: `acWrite` treats every 2xx alike.
 *
 * ## Four fields, and the two that came off
 *
 * `first_name` and `last_name` are writable on create and are **not** collected,
 * matching the detail — `UserDetail.tsx` carries the argument. They surface
 * nowhere: not on a row, not in `search_columns`, not on any other screen, and 67
 * of 69 accounts have neither. `display_name` is collected instead, because it is
 * the name every surface in this panel actually renders, and it is optional — the
 * API substitutes the login when it is blank, so the field says so rather than
 * being marked required and defaulting silently.
 */
export function NewUserForm({
  locale,
  myCapabilities,
  roles,
}: {
  locale: string;
  /** See `UserDetail` — `guardAssignable()`'s mirror. Empty means "unknown". */
  myCapabilities: readonly string[];
  roles: Role[];
}) {
  const t = useTranslations("staff");
  const tStates = useTranslations("states");
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();

  const assignable = assignableRoles(roles);
  const offerable =
    myCapabilities.length === 0 ? assignable : grantableRoles(assignable, myCapabilities);
  const withheld = assignable.filter((role) => !offerable.includes(role));

  const [draft, setDraft] = useState({
    username: "",
    email: "",
    display_name: "",
    /*
     * No default. A role is required and the two are not interchangeable —
     * `ac_super_admin` carries thirteen capabilities including this one, and a
     * form that pre-selected it would make the most privileged account in the
     * shop the easiest one to create by accident.
     */
    role: "",
  });
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);

  const set = (key: keyof typeof draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const complete =
    draft.username.trim() !== "" && draft.email.trim() !== "" && draft.role !== "";

  const FIELD_LABELS: Record<string, string> = {
    username: t("field.username"),
    email: t("field.email"),
    display_name: t("field.display_name"),
    role: t("field.role"),
    first_name: t("field.first_name"),
    last_name: t("field.last_name"),
    status: t("field.status"),
  };

  /**
   * §3.4's summary. A 400 lists **every** bad field at once, including two this
   * form does not render and one — `status` — the API refuses by name on a POST.
   * Those are listed as text rather than as links to nowhere.
   */
  const failures: FormFailure[] = Object.entries(fields).map(([key, message]) => ({
    id: key in draft ? `new-${key}` : undefined,
    label: FIELD_LABELS[key] ?? key,
    message,
  }));

  const blocked = online ? undefined : tStates("offlineWrites");

  async function create() {
    setSaving(true);
    setFields({});
    setTopError(null);

    try {
      const created = await acWrite<StaffUser>("POST", "/users", {
        username: draft.username.trim(),
        email: draft.email.trim(),
        /* Sent only when set. Blank is a legal value the API substitutes the
           login for, so sending `""` and sending nothing are the same act — and
           the shorter payload is the one whose 400 cannot name a field the person
           did not fill in. */
        ...(draft.display_name.trim() === ""
          ? {}
          : { display_name: draft.display_name.trim() }),
        role: draft.role,
      });
      toast.show(t("created"));
      router.push(`/${locale}/users/${created.id}`);
    } catch (error) {
      if (error instanceof BrowserApiError) {
        /*
         * A 409 keys `details` by the field that collided — `{username: "…"}` or
         * `{email: "…"}` — not by `fields`, so it does not arrive through the
         * getter. Bound by hand here so a taken username lands on its own control
         * rather than in a banner above a form that looks fine.
         */
        if (error.status === 409) {
          const key = typeof error.details.username === "string" ? "username" : "email";
          setFields({ [key]: error.message });
        } else {
          setFields(error.fields ?? {});
          /*
           * A 403 with no fields is `guardAssignable()` arriving anyway — the
           * picker below does not offer a role the caller cannot grant, so this
           * is a race or a session whose capabilities did not resolve. **Its own
           * words are kept**: the sentence names the capabilities that are
           * missing, and a translated "rôle refusé" would throw that away.
           */
          if (error.fields === null) setTopError(error.message);
        }
      } else {
        setTopError((error as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  const chosen = offerable.find((role) => role.role === draft.role);

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("newUser")}
        back={{ href: `/${locale}/users`, label: t("title") }}
        /* A detail page omits the rule and lets the first card do the separating
           — §2.4. */
        divided={false}
      />

      <PageBody width="form">
        <div className="flex flex-col gap-4">
          <ErrorSummary failures={failures} />

          {topError !== null ? (
            <Notice role="alert" tone="danger" title={tStates("errorTitle")}>
              <p className="text-ui-label">{topError}</p>
            </Notice>
          ) : null}

          <Card title={t("identity")} footnote={t("usernameNote")}>
            <div className="flex min-w-0 flex-col gap-4">
              <TextField
                id="new-username"
                label={t("field.username")}
                value={draft.username}
                onChange={(value) => set("username", value)}
                error={fields.username}
                hint={t("hint.username")}
                /* A login is an identifier — never reordered by an Arabic
                   paragraph, and typed left to right whatever the panel's
                   direction. */
                isolate
                disabled={saving}
              />
              <TextField
                id="new-email"
                label={t("field.email")}
                value={draft.email}
                onChange={(value) => set("email", value)}
                error={fields.email}
                isolate
                inputMode="email"
                disabled={saving}
              />
              <TextField
                id="new-display_name"
                label={t("field.display_name")}
                value={draft.display_name}
                onChange={(value) => set("display_name", value)}
                error={fields.display_name}
                /* Optional, and the hint says what happens when it is left
                   empty rather than leaving somebody to discover it on the list
                   afterwards. */
                hint={t("hint.display_nameOptional")}
                disabled={saving}
              />
            </div>
          </Card>

          <Card title={t("roleSection")} footnote={t("assignableNote")}>
            <div className="flex min-w-0 flex-col gap-4">
              <Select
                id="new-role"
                label={t("field.role")}
                value={draft.role}
                onChange={(value) => set("role", value)}
                /*
                  **Only roles that can actually be granted**, filtered twice.
                  `/roles` publishes seven and five are retired; assigning one is a
                  400 naming it as retired rather than as unknown, because it
                  exists, it is published on that very route, and 50 of 69 accounts
                  hold one. `grantableRoles` is the second filter and mirrors
                  `guardAssignable()`'s 403, which is unreachable for a Super Admin
                  and is precisely the refusal §87 built the guard for.
                */
                options={[
                  { value: "", label: t("role.choose") },
                  ...offerable.map((role) => ({ value: role.role, label: role.name })),
                ]}
                error={fields.role}
                hint={t("hint.role")}
                disabled={saving}
              />

              {withheld.length > 0 ? (
                <p className="text-ui-label text-ui-subtle">
                  {t("roleWithheld", {
                    roles: withheld.map((role) => role.name).join(" · "),
                    capabilities: [
                      ...new Set(
                        withheld.flatMap((role) => missingForGrant(role, myCapabilities)),
                      ),
                    ]
                      .map((slug) =>
                        tStates.has(`capability.${slug}`)
                          ? tStates(`capability.${slug}`)
                          : slug,
                      )
                      .join(" · "),
                  })}
                </p>
              ) : null}
            </div>
          </Card>

          {/* What the chosen role holds, **before** it is granted rather than
              after — translated, never as raw slugs. The detail carries the same
              card and the same open-vocabulary fallback. */}
          {/*
            `noPasswordNote` is this card's **footnote** rather than a paragraph
            of its own between the last card and the bar, and that is a defect the
            captures found rather than a preference. `SaveBar` is
            `sticky bottom-0 z-10`, so on a form this short it is pulled up to the
            viewport's foot and painted over whatever sits below the last card —
            photographed at 1440 in both locales, with the note's second line
            underneath it. Nothing may follow the bar's own flex item; anything
            that would have is a footnote on the card above it.

            It belongs here on its own merits too: the card answers "what will
            this account be able to do", and the note answers the question that
            follows it — "and how do they get in".
          */}
          <Card
            title={t("capabilities")}
            description={
              chosen === undefined ? undefined : t("capabilitiesOf", { role: chosen.name })
            }
            footnote={t("noPasswordNote")}
          >
            {chosen === undefined ? (
              <p className="text-ui-label text-ui-muted">{t("capabilitiesNone")}</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {chosen.capabilities.map((slug) => (
                  <li key={slug}>
                    <Badge tone="neutral">
                      {tStates.has(`capability.${slug}`)
                        ? tStates(`capability.${slug}`)
                        : slug}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/*
            `persistent`, per §3.4's own note: there is nothing to compare a blank
            object against, so "unsaved changes" is the wrong frame and the bar
            carries no discard — there is nothing to revert a blank form to. The
            back link is the way out. `saveLabel` is "Créer", which is what the
            suite clicks.

            `blockedReason` covers both gates the primary has: offline, and a form
            that is not yet complete. Both are stated on the control rather than
            leaving a dimmed button with no explanation — §3.3.
          */}
          <SaveBar
            dirty={false}
            persistent
            saving={saving}
            onSave={() => void create()}
            saveLabel={t("create")}
            saveId="new-user-save"
            blockedReason={blocked ?? (complete ? undefined : t("createIncomplete"))}
          />
        </div>
      </PageBody>
    </div>
  );
}
