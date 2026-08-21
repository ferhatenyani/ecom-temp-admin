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
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { TextField } from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Sheet } from "@/components/primitives/Sheet";
import { ActionSheet } from "@/components/primitives/ActionSheet";
import { StatusBadge } from "@/components/primitives/StatusBadge";
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
 */
export function CredentialsSection({
  user,
  locale,
  onChanged,
}: {
  user: StaffUserDetail;
  locale: string;
  onChanged: () => void;
}) {
  const t = useTranslations("staff");
  const toast = useToast();

  const [name, setName] = useState("");
  const [minting, setMinting] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintedApplicationPassword | null>(null);
  const [revoking, setRevoking] = useState<ApplicationPassword | null>(null);
  const [copied, setCopied] = useState(false);

  const suspended = user.status === "suspended";

  async function mint() {
    setMinting(true);
    setNameError(undefined);
    setBlocked(null);

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
        /*
         * **Two 409s on one route, and they are different sentences.** A
         * duplicate name is a validation error on the field; a suspended account
         * is a fact about the account and belongs at the top of the section with
         * the reactivate action beside it. Rendering both as a toast would make
         * the second look like a typo.
         */
        const conflict = credentialConflict(error.details);
        if (conflict.kind === "name") setNameError(error.message);
        else setBlocked(error.message);
      } else {
        setNameError((error as Error).message);
      }
    } finally {
      setMinting(false);
    }
  }

  async function revoke(password: ApplicationPassword) {
    try {
      await acWrite("DELETE", `/users/${user.id}/application-passwords/${password.uuid}`);
      toast.show(t("credentialRevoked"));
      onChanged();
    } catch (error) {
      toast.show((error as Error).message);
    } finally {
      setRevoking(null);
    }
  }

  return (
    <>
      <ListGroup title={t("credentials")} footnote={t("credentialsNote")}>
        {blocked !== null ? (
          <ListRow className="tone-danger tonal">
            <span className="text-footnote">{blocked}</span>
          </ListRow>
        ) : null}

        {user.application_passwords.length === 0 ? (
          <ListRow>
            <span className="text-footnote text-label-secondary">{t("noCredentials")}</span>
          </ListRow>
        ) : (
          user.application_passwords.map((password) => (
            <ListRow key={password.uuid} className="flex items-center gap-3">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
                {/* A device name is prose somebody typed — `dir="auto"`, or
                    `truncate` clips from the wrong end in the other locale. */}
                <span className="min-w-0 truncate text-body text-label" dir="auto">
                  {password.name}
                </span>
                <span className="flex items-center gap-2 text-caption text-label-secondary">
                  <Isolate>{t("credentialCreated", { when: formatDate(password.created, locale) })}</Isolate>
                  {neverUsed(password) ? (
                    <StatusBadge tone="neutral">{t("neverUsed")}</StatusBadge>
                  ) : (
                    <Isolate>
                      {t("lastUsed", { when: formatDate(password.last_used, locale, false) })}
                    </Isolate>
                  )}
                </span>
              </span>
              <Button variant="destructive" onClick={() => setRevoking(password)}>
                {t("revoke")}
              </Button>
            </ListRow>
          ))
        )}

        <TextField
          label={t("credentialName")}
          value={name}
          onChange={setName}
          error={nameError}
          hint={t("credentialNameHint")}
          placeholder={t("credentialNamePlaceholder")}
          disabled={suspended}
        />

        <ListRow>
          <Button
            variant="tinted"
            onClick={() => void mint()}
            loading={minting}
            disabled={name.trim() === "" || suspended}
            fullWidth
          >
            {t("mint")}
          </Button>
        </ListRow>

        {/*
          The refusal named rather than a greyed control with nothing beside it.
          Measured: minting for a suspended account is a 409 — the credential
          would answer 401 at every route, so a screen that issued one and said
          nothing would be handing somebody a key to a locked door.
        */}
        {suspended ? (
          <ListRow>
            <span className="text-caption text-label-tertiary">{t("mintSuspended")}</span>
          </ListRow>
        ) : null}
      </ListGroup>

      {/*
        The secret, once. `Sheet` rather than a toast or an inline panel: it is
        modal on purpose — the value cannot be read again, and a person who
        scrolls past it has lost it. There is no reveal affordance anywhere else
        in this panel, because there is nothing to reveal.
      */}
      <Sheet
        open={minted !== null}
        onOpenChange={(open) => {
          if (!open) setMinted(null);
        }}
        title={t("secretTitle")}
        description={t("secretWarning")}
        footer={
          <Button variant="filled" onClick={() => setMinted(null)} fullWidth>
            {t("secretDone")}
          </Button>
        }
      >
        {minted !== null ? (
          <div className="flex flex-col gap-3">
            <p className="text-footnote text-label-secondary" dir="auto">
              {minted.name}
            </p>

            <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
              {/* A credential is the purest identifier there is: `Ltr`, tabular,
                  and it must never be reordered by an Arabic paragraph. */}
              <Ltr className="min-w-0 flex-1 select-all break-all text-body text-label">
                {minted.password}
              </Ltr>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(minted.password);
                  setCopied(true);
                }}
                aria-label={t("copy")}
                className="tap-44 press flex size-11 shrink-0 items-center justify-center rounded-full text-accent"
              >
                <Icon name={copied ? "check" : "note"} className="size-5" />
              </button>
            </div>

            {copied ? (
              <p role="status" className="text-caption tonal-fg tone-success">
                {t("copied")}
              </p>
            ) : null}

            <p className="text-caption text-label-tertiary">{t("secretLost")}</p>
          </div>
        ) : null}
      </Sheet>

      <ActionSheet
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={t("revokeTitle")}
        description={revoking !== null ? t("revokeBody", { name: revoking.name }) : undefined}
        actions={
          revoking !== null
            ? [
                {
                  label: t("revoke"),
                  tone: "destructive" as const,
                  onSelect: () => void revoke(revoking),
                },
              ]
            : []
        }
      />
    </>
  );
}
