"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type {
  ApplicationPassword,
  MintedApplicationPassword,
  StaffUserDetail,
} from "@/lib/api/schemas/staff";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import { credentialConflict, neverUsed } from "@/lib/staff";
import { formatDate } from "@/lib/format/date";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Overlay";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { Notice } from "@/components/ui/States";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";

/**
 * A staff member's devices, and the one screen in this panel that shows a secret.
 *
 * **This is why §87 exists.** WordPress displays an application password exactly
 * once, at creation, in wp-admin — the dashboard PLAN §52 says routine
 * administration must not require. So onboarding somebody means opening a
 * WordPress dashboard, or it means this.
 *
 * Module scope with explicit props, not nested in `UserDetail`: it holds the
 * minted secret in state, and a component declared inside another gets a new
 * identity on every parent render and remounts. `RetrySection` shipped exactly
 * that defect on 14b — a successful action's own refetch re-rendered the parent
 * and discarded the result panel it had just set — and the e2e caught it as a
 * race that passed four runs before failing once. **A nested component holding
 * `useState` has that bug**, and this one holds the least recoverable state in
 * the panel: a credential that cannot be read again.
 *
 * ## The secret is a `Modal`, and the primitive change is the point
 *
 * It was a `Sheet`, which §3.1 deleted. The replacement is not mechanical: §3.1
 * gives a `Modal` to *"a task that must be finished or abandoned"* and a `Drawer`
 * to *"context beside the page"*, and this is the purest example of the first in
 * the whole panel. The value **cannot be read again** — not on the collection,
 * not on `GET /users/{id}`, not in the audit row, which was checked for it rather
 * than assumed clean — so a person who dismisses this without copying has lost
 * it, and a surface that reads as "context" beside a page invites exactly that.
 * `sm` (400): it holds one line of prose and one 24-character string.
 *
 * There is no reveal affordance anywhere else in this panel, because there is
 * nothing to reveal.
 *
 * ## The mint answers 201
 *
 * `UserController.php:267`, ADMIN_PANEL.md §87's own example, and the harness all
 * agree; `lib/staff.ts` said 200 until 2026-08-29 and was the only source that
 * did. Nothing branches on it — `acWrite` treats every 2xx alike — which is how a
 * wrong comment survives a year.
 *
 * ## Two 409s on one route, and they are different sentences
 *
 * A duplicate name is a validation error on the field. A suspended account is a
 * fact about the account: the credential would answer **401 at every route**
 * including `/auth/me` and `/health`, so issuing one would be handing somebody a
 * key to a locked door. It belongs at the top of the section with the reactivate
 * action beside it — which is why this component takes `onReactivate` rather than
 * telling the reader to scroll down and find the button themselves. Rendering
 * both as a toast would make the second look like a typo.
 *
 * The refusal is also **pre-empted**: the controls are absent on a suspended
 * account with the reason in their place, per §3.3, so the 409 is only reachable
 * by a race. It is still handled, because that race is real — a second tab.
 */
export function CredentialsSection({
  user,
  locale,
  blocked,
  onChanged,
  onReactivate,
}: {
  user: StaffUserDetail;
  locale: string;
  /** §3.7: the offline sentence, or `undefined`. Disables every write here. */
  blocked?: string;
  onChanged: () => void;
  /** Absent on the acting user's own account, where reactivation is refused. */
  onReactivate?: () => void;
}) {
  const t = useTranslations("staff");
  const toast = useToast();

  const [name, setName] = useState("");
  const [minting, setMinting] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [conflict, setConflict] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintedApplicationPassword | null>(null);
  const [revoking, setRevoking] = useState<ApplicationPassword | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const suspended = user.status === "suspended";

  async function mint() {
    setMinting(true);
    setNameError(undefined);
    setConflict(null);

    try {
      const created = await acWrite<MintedApplicationPassword>(
        "POST",
        `/users/${user.id}/application-passwords`,
        { name: name.trim() },
      );
      setMinted(created);
      setCopied(false);
      setName("");
      onChanged();
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 409) {
        const kind = credentialConflict(error.details);
        if (kind.kind === "name") setNameError(error.message);
        else setConflict(error.message);
      } else if (error instanceof BrowserApiError) {
        setNameError(error.fields?.name ?? error.message);
      } else {
        setNameError((error as Error).message);
      }
    } finally {
      setMinting(false);
    }
  }

  async function revoke(password: ApplicationPassword) {
    setRevokeBusy(true);
    try {
      await acWrite("DELETE", `/users/${user.id}/application-passwords/${password.uuid}`);
      toast.show(t("credentialRevoked"));
      onChanged();
    } catch (error) {
      toast.show((error as Error).message);
    } finally {
      setRevokeBusy(false);
      setRevoking(null);
    }
  }

  const disabled = suspended || blocked !== undefined;

  return (
    <>
      <Card title={t("credentials")} footnote={t("credentialsNote")}>
        <div className="flex min-w-0 flex-col gap-4">
          {/*
            The 409 that is a fact about the account, not about the field, with
            the remedy beside it rather than a screen away. Only reachable by a
            race now that the controls below are absent, and kept for that race.
          */}
          {conflict !== null ? (
            <Notice role="alert" tone="danger" title={t("mintSuspended")}>
              {onReactivate ? (
                <div>
                  <Button size="sm" variant="secondary" onClick={onReactivate}>
                    {t("reactivate")}
                  </Button>
                </div>
              ) : null}
            </Notice>
          ) : null}

          {user.application_passwords.length === 0 ? (
            <p className="text-ui-label text-ui-muted">{t("noCredentials")}</p>
          ) : (
            <ul className="flex min-w-0 flex-col">
              {user.application_passwords.map((password) => (
                <li
                  key={password.uuid}
                  className="flex min-w-0 items-center gap-3 border-b border-ui-line py-2 last:border-b-0"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {/* A device name is prose somebody typed — `dir="auto"`, or
                        `truncate` clips from the wrong end in the other locale. */}
                    <span dir="auto" className="min-w-0 truncate text-ui-compact text-ui-fg">
                      {password.name}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-ui-label text-ui-muted">
                      <Isolate>
                        {t("credentialCreated", {
                          when: formatDate(password.created, locale, false),
                        })}
                      </Isolate>
                      {neverUsed(password) ? (
                        <Badge tone="neutral">{t("neverUsed")}</Badge>
                      ) : (
                        <Isolate>
                          {t("lastUsed", {
                            when: formatDate(password.last_used, locale, false),
                          })}
                        </Isolate>
                      )}
                    </span>
                  </span>
                  <IconButton
                    label={t("revokeNamed", { name: password.name })}
                    icon="trash"
                    variant="secondary"
                    size="sm"
                    onClick={() => setRevoking(password)}
                    disabled={blocked !== undefined}
                    title={blocked}
                  />
                </li>
              ))}
            </ul>
          )}

          {/*
            **Absent rather than disabled on a suspended account**, with the reason
            in their place — §3.3, the same treatment the three self-refusals get
            one card up. Measured: minting for a suspended account is a 409, and a
            credential issued to one answers 401 at every route.

            Offline is the other gate and it is a *disabled* control rather than an
            absent one, deliberately: the act is possible and the moment is not,
            which is what `title` says. §3.7's fifth state, not §3.3's dead control.
          */}
          {suspended ? (
            <p className="text-ui-label text-ui-muted">{t("mintSuspended")}</p>
          ) : (
            <>
              <TextField
                label={t("credentialName")}
                value={name}
                onChange={setName}
                error={nameError}
                hint={t("credentialNameHint")}
                placeholder={t("credentialNamePlaceholder")}
                disabled={minting || blocked !== undefined}
              />
              <div className="flex justify-end">
                <Button
                  onClick={() => void mint()}
                  loading={minting}
                  disabled={name.trim() === "" || disabled}
                  title={blocked ?? (name.trim() === "" ? t("credentialNameRequired") : undefined)}
                >
                  {t("mint")}
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      {/*
        The secret, once. A `Modal` and not a `Drawer`: a task that must be
        finished or abandoned. See the docblock.
      */}
      <Modal
        open={minted !== null}
        onOpenChange={(open) => {
          if (!open) setMinted(null);
        }}
        title={t("secretTitle")}
        description={t("secretWarning")}
        size="sm"
        footer={
          <Button onClick={() => setMinted(null)}>{t("secretDone")}</Button>
        }
      >
        {minted !== null ? (
          <div className="flex min-w-0 flex-col gap-3">
            <p dir="auto" className="text-ui-label text-ui-muted">
              {minted.name}
            </p>

            <div className="flex items-center gap-2 rounded-ui-md border border-ui-line bg-ui-surface-2 px-3 py-2">
              {/* A credential is the purest identifier there is: `Ltr`, tabular,
                  and it must never be reordered by an Arabic paragraph.
                  `select-all` so one click takes the whole string, and
                  `break-all` because 24 characters with no space in them have no
                  break opportunity at 340px. */}
              <Ltr className="min-w-0 flex-1 select-all break-all text-ui-body text-ui-fg">
                {minted.password}
              </Ltr>
              <IconButton
                label={t("copy")}
                icon={copied ? "check" : "note"}
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(minted.password);
                  setCopied(true);
                }}
              />
            </div>

            {copied ? (
              <p role="status" className="text-ui-label text-ui-success-fg">
                {t("copied")}
              </p>
            ) : null}

            <p className="text-ui-label text-ui-subtle">{t("secretLost")}</p>
          </div>
        ) : null}
      </Modal>

      {/*
        Revoking is destructive and **not** irreversible in the sense §3.1's typing
        guard protects: the credential is gone, but nothing is lost that minting
        another does not replace, and the device name is not an identifier of the
        record so much as a label on it. So: a `ConfirmDialog`, `danger`, cancel
        focused, and no typing. The delete on the card below is the one act here
        that types.
      */}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={t("revokeTitle")}
        body={revoking === null ? "" : t("revokeBody", { name: revoking.name })}
        confirmLabel={t("revoke")}
        loading={revokeBusy}
        onConfirm={() => {
          if (revoking !== null) void revoke(revoking);
        }}
      />
    </>
  );
}
