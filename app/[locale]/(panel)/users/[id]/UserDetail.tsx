"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import type { Role, StaffUserDetail } from "@/lib/api/schemas/staff";
import { BrowserApiError, acWrite, acRead } from "@/lib/api/browser";
import {
  assignableRoles,
  deleteConflictCount,
  grantableRoles,
  isRetiredRole,
  isSelf,
  missingForGrant,
  roleLabel,
  staffName,
  STATUS_TONE,
} from "@/lib/staff";
import { useOnline } from "@/lib/use-online";
import { formatDate, formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  ErrorSummary,
  ReadOnlyField,
  SaveBar,
  Select,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { Notice, StaleBanner } from "@/components/ui/States";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { CredentialsSection } from "./CredentialsSection";
import { userKey } from "../query";

/**
 * One staff account, and **the refusals rendered as absent controls with a
 * reason** rather than as disabled ones.
 *
 * ## The refusals, and why they are absences now
 *
 * The previous build disabled the three self-refusals and stated the reason
 * beside them, on the argument that §87 calls the refusals the security model and
 * a Super Admin should be able to see it. That argument is right and is kept —
 * the *sentence* is the security model, and all three are still on screen,
 * verbatim, which is what `e2e/admin.spec.ts` asserts.
 *
 * What changed is the control. §3.3 is unconditional: **a control that cannot act
 * is not rendered.** A dimmed "Suspendre" on your own account is a button the
 * panel knows will never work, offered anyway, and the whole run has been taking
 * those off screens — the notifications retry on a `sent` row, the shipping
 * terminal parcel, the segment count without `ac_manage_customers`. This screen
 * was the last one arguing the other way, and the reason it could is that it
 * conflated the refusal with the control: keeping the explanation does not
 * require keeping a dead button under it.
 *
 * `UserService.php` guards all three — own role `:335-341`, own suspend `:147`,
 * own delete `:170` — and **the delete guard runs before the id is resolved**, so
 * `DELETE /users/{me}` is a 403 even for an id that is not a staff account. The
 * refusal is about who you are, never about what exists.
 *
 * Two more refusals are *asked* rather than known, because the panel cannot know
 * either without the request: a role the caller may not grant
 * (`guardAssignable()`, mirrored locally in `lib/staff.ts` so the picker does not
 * offer it) and an account that owns orders (below). That split is the same one
 * the analytics money gate makes.
 *
 * ## Per-section actions, not one page primary
 *
 * §2.4 puts a detail screen's primary action in the header, and that rule is
 * written about a record with **one** state-changing act — an order's next
 * status, a notification's retry. This screen has four, they are unrelated, and
 * three of them are destructive: suspending, revoking a credential and deleting
 * are not variants of one primary. Collecting them into a header menu would put
 * the delete two pixels from the suspend and both of them a screen away from the
 * section that explains what they do.
 *
 * So each act sits in its own card, which is also where its own refusal, its own
 * confirmation and its own 409 land. §2.4 is not being broken: the rule's
 * premise — one primary — is not met here, and this docblock is the record of
 * that judgement.
 *
 * **The identity edits are the one exception and they keep a `SaveBar`**, because
 * they are the one thing on this screen that *is* a long form: two free-text
 * fields accumulating changes, saved once, every save reversible by saving again.
 * §3.4 legislates that separately from §2.4 for exactly this reason. The role is
 * deliberately **not** under that bar: it is a separately audited security event
 * (`user.role_changed` carries `from` and `to`, where an email change records a
 * field name and no value), it is the only write on this card that can answer
 * 403, and one press labelled "Enregistrer" doing both a typo fix and an
 * escalation is a press whose refusal has two possible causes.
 *
 * ## `display_name` is editable and `first_name`/`last_name` are not
 *
 * **This reverses the previous build and it fixes a defect.** That form edited
 * `first_name` and `last_name` and never `display_name` — but WordPress keeps the
 * three independent, so typing "Karim Benali" into the name fields renamed
 * nobody: `staffName()` reads `display_name`, the list kept showing the old
 * value, and the save answered 200. An edit that appears to rename somebody and
 * does not is worse than no edit.
 *
 * All three are writable (`STAFF_UPDATE_FIELDS`). The two that came off are the
 * two that surface nowhere: they are not in `search_columns` — `?search=Benali`
 * is zero rows against the account named Benali — they are on no row, no column
 * and no other screen, and **67 of 69 accounts have neither set**. So the control
 * for them would be a pair of inputs that change nothing anybody can see, which
 * is the same class of thing as a filter the API ignores. They remain writable
 * through the API; the panel offers no control and says so here.
 *
 * ## The fifth state, both halves
 *
 * This screen holds a client cache and **writes**, so §3.7's exemption does not
 * apply: the marker reports the age and every write control on the page — the
 * save bar, the role change, the suspension, the delete and the credential mint —
 * is disabled with that same sentence rather than failing at the network and
 * blaming itself. It does not poll: an account changes when somebody in the room
 * changes it, and the list next door carries the same paragraph.
 */
export function UserDetail({
  locale,
  meId,
  myCapabilities,
  initial,
  roles,
}: {
  locale: string;
  meId: number | null;
  /**
   * The caller's own capabilities, for `guardAssignable()`'s mirror.
   *
   * Empty is treated as "unknown" rather than as "none": a session whose
   * capability list did not resolve must not silently empty the role picker, so
   * the guard is skipped and the API's 403 is what refuses — the panel does not
   * get to be stricter than the thing it is a client of.
   */
  myCapabilities: readonly string[];
  initial: StaffUserDetail;
  roles: Role[];
}) {
  const t = useTranslations("staff");
  const tStates = useTranslations("states");
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();

  const { data: user, refetch, dataUpdatedAt } = useQuery({
    queryKey: userKey(initial.id),
    queryFn: async () => (await acRead<StaffUserDetail>(`/users/${initial.id}`)).data,
    initialData: initial,
  });

  /* ------------------------------------------------------------- identity --- */

  const [draft, setDraft] = useState({
    display_name: initial.display_name,
    email: initial.email,
  });
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);

  /* ----------------------------------------------------------------- role --- */

  const me = isSelf(user.id, meId);
  const wordpress = user.is_administrator;
  const retired = isRetiredRole(user.role, roles);

  /*
   * The two independent reasons a role cannot be given, applied together.
   * `assignable` is a property of the matrix; `grantable` is a property of the
   * caller. A picker filtered on only one of them offers a choice the API
   * answers with a paragraph — which is what §3.3 removes.
   */
  const assignable = assignableRoles(roles);
  const offerable =
    myCapabilities.length === 0 ? assignable : grantableRoles(assignable, myCapabilities);
  const withheld = assignable.filter((role) => !offerable.includes(role));

  /*
   * `""` means "leave the role alone", and it exists for exactly one case: an
   * account holding one of the five retired roles, which the picker must not
   * offer and must not silently replace. 50 of 69 accounts are in that state, and
   * a picker that pre-selected `ac_manager` for them would change a role nobody
   * asked to change on the next save.
   */
  const currentIsOfferable = offerable.some((role) => role.role === user.role);
  const [role, setRole] = useState(currentIsOfferable ? user.role : "");
  const [changingRole, setChangingRole] = useState(false);
  const roleDirty = role !== "" && role !== user.role;

  /* --------------------------------------------------------------- status --- */

  const [confirming, setConfirming] = useState<"suspend" | "activate" | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  /* --------------------------------------------------------------- delete --- */

  const [deleting, setDeleting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [ownsOrders, setOwnsOrders] = useState<number | null | "unknown">(null);

  /* ---------------------------------------------------------------- state --- */

  /* §3.7's fifth state. `navigator.onLine` is certain in one direction only, and
     that is the direction every write on this page is gated on. */
  const blocked = online ? undefined : tStates("offlineWrites");
  const stale = !online && dataUpdatedAt > 0;

  const identityDirty =
    draft.display_name !== user.display_name || draft.email !== user.email;

  const FIELD_LABELS: Record<string, string> = {
    display_name: t("field.display_name"),
    email: t("field.email"),
    role: t("field.role"),
    status: t("field.status"),
    first_name: t("field.first_name"),
    last_name: t("field.last_name"),
    username: t("field.username"),
  };

  /**
   * §3.4's summary. A 400 names **every** bad field at once, including ones this
   * form does not render — `first_name` and `last_name` are writable and have no
   * control here — so an orphan is listed as text rather than as a link to
   * nowhere. `FIELD_LABELS` covers them anyway, because the API's key alone reads
   * as machinery.
   */
  const failures: FormFailure[] = Object.entries(fields).map(([key, message]) => ({
    id: key === "display_name" || key === "email" ? `user-${key}` : undefined,
    label: FIELD_LABELS[key] ?? key,
    message,
  }));

  /* ----------------------------------------------------------------- acts --- */

  async function patch(payload: Record<string, string>, done: () => void) {
    setFields({});
    setTopError(null);
    try {
      await acWrite("PATCH", `/users/${user.id}`, payload);
      await refetch();
      done();
    } catch (error) {
      if (error instanceof BrowserApiError) {
        setFields(error.fields ?? {});
        /*
         * A 403 here is a self-refusal or `guardAssignable()` arriving anyway — a
         * second tab, a stale render, a role whose capabilities widened — and a
         * 409 is a duplicate address bound to its own field below. Both carry a
         * sentence worth showing whole, and the 403 has no `details` to bind to.
         * **The 403's own words are kept**: it names the capabilities the caller
         * lacks, and a translated "rôle refusé" would throw that away, which is
         * the same argument `Field` makes about the retired-role 400.
         */
        if (error.fields === null) {
          setTopError(
            error.status === 409 && typeof error.details.email === "string"
              ? null
              : error.message,
          );
          if (error.status === 409 && typeof error.details.email === "string") {
            setFields({ email: error.message });
          }
        }
      } else {
        setTopError((error as Error).message);
      }
      throw error;
    }
  }

  async function saveIdentity() {
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (draft.display_name !== user.display_name) payload.display_name = draft.display_name;
      if (draft.email !== user.email) payload.email = draft.email;
      await patch(payload, () => toast.show(t("saved")));
    } catch {
      /* Rendered above; the throw only stops the success path. */
    } finally {
      setSaving(false);
    }
  }

  async function applyRole() {
    setChangingRole(true);
    try {
      await patch({ role }, () => toast.show(t("roleChanged")));
    } catch {
      /* Rendered above. */
    } finally {
      setChangingRole(false);
    }
  }

  async function setStatus(next: "active" | "suspended") {
    setStatusBusy(true);
    try {
      await patch({ status: next }, () =>
        toast.show(next === "suspended" ? t("suspended") : t("reactivated")),
      );
    } catch {
      /* Rendered above. */
    } finally {
      setStatusBusy(false);
      setConfirming(null);
    }
  }

  async function remove() {
    setRemoving(true);
    setTopError(null);
    try {
      await acWrite("DELETE", `/users/${user.id}`);
      toast.show(t("deleted"));
      router.push(`/${locale}/users`);
    } catch (error) {
      setDeleting(false);
      if (error instanceof BrowserApiError && error.status === 409) {
        /*
         * **The one 409 on this screen worth getting right.** The API's sentence
         * is *"That account owns orders and cannot be deleted. Suspend it
         * instead: PATCH /users/{id} with {"status":"suspended"}."* — English,
         * and its remedy is a raw HTTP call. Neither is renderable at a
         * shopkeeper, so the panel says the same thing in its own words with the
         * count, and offers the suspension as a **button** rather than as an
         * instruction. That is the sixth time this run has fixed this class.
         *
         * `details.orders` is a count and may be absent; `"unknown"` is the
         * branch that says the fact without inventing the number.
         */
        setOwnsOrders(deleteConflictCount(error.details) ?? "unknown");
      } else {
        setTopError((error as Error).message);
      }
    } finally {
      setRemoving(false);
    }
  }

  /* ------------------------------------------------------------ rendering --- */

  const shownRole = roles.find((entry) => entry.role === (role === "" ? user.role : role));
  const suspended = user.status === "suspended";

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={staffName(user)}
        back={{ href: `/${locale}/users`, label: t("title") }}
        /* A detail page omits the rule and lets the first card do the separating
           — §2.4. There is no header action: see the docblock. */
        divided={false}
      />

      <PageBody width="form">
        <div className="flex flex-col gap-4">
          {stale ? (
            <StaleBanner time={formatWhen(new Date(dataUpdatedAt).toISOString(), locale)} />
          ) : null}

          <ErrorSummary failures={failures} />

          {/* A failure with nothing per-field to say — a 403, a network error.
              Inline and standing, never a toast: §3.1 says an error a person must
              act on is not one. */}
          {topError !== null ? (
            <Notice role="alert" tone="danger" title={tStates("errorTitle")}>
              <p className="text-ui-label">{topError}</p>
            </Notice>
          ) : null}

          {/* --------------------------------------------------- identity --- */}
          <Card title={t("identity")} footnote={t("namesNote")}>
            <div className="flex min-w-0 flex-col gap-4">
              <TextField
                id="user-display_name"
                label={t("field.display_name")}
                value={draft.display_name}
                onChange={(value) => setDraft((d) => ({ ...d, display_name: value }))}
                hint={t("hint.display_name")}
                error={fields.display_name}
                disabled={saving}
              />
              <TextField
                id="user-email"
                label={t("field.email")}
                value={draft.email}
                onChange={(value) => setDraft((d) => ({ ...d, email: value }))}
                error={fields.email}
                disabled={saving}
                /* An address is an identifier: forcing LTR keeps an Arabic
                   paragraph from reordering it, and a mail read back wrong goes
                   to a stranger. */
                isolate
                inputMode="email"
              />
              {/*
                The username is the identity, not a field. `user_login` is refused
                **by name** — "A login is an identity, not a field. Create the
                account with the username you want." — so a control here would be
                a control that 400s, which is a bug report waiting to be filed.
              */}
              <ReadOnlyField
                label={t("field.username")}
                value={<Ltr numeric={false}>{user.username}</Ltr>}
                reason={t("readOnly.username")}
              />
              <ReadOnlyField
                label={t("field.date_created")}
                value={<Isolate>{formatDate(user.date_created, locale, false)}</Isolate>}
              />
            </div>
          </Card>

          {/* ------------------------------------------------------- role --- */}
          <Card title={t("roleSection")} description={t("roleNote")}>
            <div className="flex min-w-0 flex-col gap-4">
              {/*
                The role the account holds, stated **only where the picker below
                cannot state it** — which is the acting user, a WordPress
                administrator, and any account on one of the five retired roles.

                Rendering it unconditionally is what the first build of this card
                did, and the capture showed why not: on an ordinary account it put
                "Rôle — Manager" directly above "Nouveau rôle — [Manager]", which
                is the same value twice in eighty pixels with the second one
                editable. That is the defect the inventory branch found with a
                product name and the notifications record avoids by dropping an
                event row above its key.
              */}
              {me || wordpress || !currentIsOfferable ? (
                <ReadOnlyField
                  label={t("field.role")}
                  value={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Isolate numeric={false}>
                        {roleLabel(user.role, user.role_name, roles)}
                      </Isolate>
                      {retired ? <Badge tone="neutral">{t("retired")}</Badge> : null}
                      {wordpress ? <Badge tone="warning">{t("wordpress")}</Badge> : null}
                    </span>
                  }
                  reason={
                    me
                      ? t("refusal.ownRole")
                      : wordpress
                        ? t("refusal.wordpress")
                        : retired
                          ? t("retiredHint")
                          : undefined
                  }
                />
              ) : null}

              {/*
                **Absent, not disabled**, on the two accounts whose role cannot
                change — §3.3, and the reason is on the line above where the value
                is. A `<select>` nobody can open is worse than a sentence.

                `getByLabel("Rôle")` having count 0 on your own account is what the
                suite asserts, and it is asserted because the reason is what
                teaches the rule.
              */}
              {me || wordpress ? null : (
                <>
                  <Select
                    /*
                      "Rôle" when this control *is* the account's role, and
                      "Nouveau rôle" only when a read-only line above already
                      states one the picker cannot represent. A picker labelled
                      "new role" with nothing calling itself the old one is a
                      label describing a comparison the screen is not making.
                    */
                    label={currentIsOfferable ? t("field.role") : t("field.newRole")}
                    value={role}
                    onChange={setRole}
                    /*
                      **Only roles that can actually be granted.** Two filters,
                      two different facts: `assignable` is the matrix's — five of
                      seven are retired, and assigning one is a 400 naming it as
                      retired rather than as unknown — and `grantable` is the
                      caller's, `guardAssignable()`'s 403 mirrored locally so the
                      refusal is never reached from a control.

                      A retired role is **never** offered here, not even as a
                      disabled option: a list whose items cannot be chosen is a
                      list that has to explain itself item by item, and the one
                      that matters is already stated above as the account's own.
                    */
                    options={[
                      ...(currentIsOfferable
                        ? []
                        : [{ value: "", label: t("role.keep") }]),
                      ...offerable.map((entry) => ({ value: entry.role, label: entry.name })),
                    ]}
                    hint={t("hint.newRole")}
                    error={fields.role}
                    disabled={changingRole}
                  />

                  {/*
                    Appears when the value differs, the way every save in this
                    panel does. Not a `SaveBar`: this is one field committing one
                    separately audited act, and §3.4's bar is for a screen of
                    fields committed together — see the docblock.
                  */}
                  {roleDirty ? (
                    <div className="flex justify-end">
                      <Button
                        onClick={() => void applyRole()}
                        loading={changingRole}
                        disabled={blocked !== undefined}
                        title={blocked}
                      >
                        {t("applyRole")}
                      </Button>
                    </div>
                  ) : null}

                  {/*
                    Said once, where it applies. `guardAssignable()` is unreachable
                    for a Super Admin — who holds every capability — so this line
                    renders for nobody on this shop today and is the whole point of
                    the mirror: a refusal the panel cannot explain is the defect
                    this run exists to prevent.
                  */}
                  {withheld.length > 0 ? (
                    <p className="text-ui-label text-ui-subtle">
                      {t("roleWithheld", {
                        roles: withheld.map((entry) => entry.name).join(" · "),
                        capabilities: [
                          ...new Set(
                            withheld.flatMap((entry) => missingForGrant(entry, myCapabilities)),
                          ),
                        ]
                          .map((slug) => capabilityName(slug, tStates))
                          .join(" · "),
                      })}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </Card>

          {/* ----------------------------------------------- capabilities --- */}
          {/*
            **Read-only, and translated — which is a live defect this build
            fixes.** The previous screen printed the raw slugs (`ac_manage_orders`)
            as badges while `states.capability.<slug>` has held a French and an
            Arabic name for all thirteen since the content branch. Nobody outside
            this repository calls a permission `ac_manage_orders`.

            Where a slug has no key it renders as itself, which is the
            open-vocabulary rule `providerLabel` and `recipientLabel` already
            follow: the matrix is the server's and a fourteenth capability must
            show as *something* rather than blanking a badge.
          */}
          <Card
            title={t("capabilities")}
            description={
              shownRole === undefined
                ? t("capabilitiesUnknown")
                : t("capabilitiesOf", { role: shownRole.name })
            }
            footnote={roleDirty ? t("capabilitiesPending") : undefined}
          >
            {shownRole === undefined ? (
              <p className="text-ui-label text-ui-muted">{t("capabilitiesUnknown")}</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {shownRole.capabilities.map((slug) => (
                  <li key={slug}>
                    <Badge tone="neutral">{capabilityName(slug, tStates)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ------------------------------------------------ credentials --- */}
          <CredentialsSection
            user={user}
            locale={locale}
            blocked={blocked}
            onChanged={() => void refetch()}
            onReactivate={me ? undefined : () => setConfirming("activate")}
          />

          {/* ----------------------------------------------------- status --- */}
          <Card title={t("statusSection")} footnote={t("suspendNote")}>
            <DataList>
              <DataRow label={t("field.status")}>
                <Badge tone={STATUS_TONE[user.status]}>{t(`status.${user.status}`)}</Badge>
              </DataRow>
            </DataList>

            {/*
              Absent on your own account, with the reason in its place. The
              sentence is the security model; the dimmed button was never part of
              it. §3.3.
            */}
            {me ? (
              <p className="mt-3 text-ui-label text-ui-muted">{t("refusal.ownSuspend")}</p>
            ) : (
              <div className="mt-3 flex justify-end">
                <Button
                  variant={suspended ? "primary" : "secondary"}
                  onClick={() => setConfirming(suspended ? "activate" : "suspend")}
                  disabled={blocked !== undefined}
                  title={blocked}
                >
                  {suspended ? t("reactivate") : t("suspend")}
                </Button>
              </div>
            )}
          </Card>

          {/* ----------------------------------------------------- delete --- */}
          <Card title={t("dangerous")} footnote={me ? undefined : t("deleteNote")}>
            {/*
              The 409, in the panel's own words. The API's sentence is English and
              its remedy is a raw `PATCH`; this says the same fact with the count
              and offers the suspension as a control.
            */}
            {ownsOrders !== null ? (
              <div className="mb-3">
                <Notice role="alert" tone="warning" title={t("deleteOwnsOrdersTitle")}>
                  <p className="text-ui-label">
                    {ownsOrders === "unknown" ? (
                      t("deleteOwnsOrdersBodyUnknown")
                    ) : (
                      <Isolate>{t("deleteOwnsOrdersBody", { count: ownsOrders })}</Isolate>
                    )}
                  </p>
                  {!suspended ? (
                    <div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setConfirming("suspend")}
                        disabled={blocked !== undefined}
                        title={blocked}
                      >
                        {t("suspend")}
                      </Button>
                    </div>
                  ) : null}
                </Notice>
              </div>
            ) : null}

            {me ? (
              <p className="text-ui-label text-ui-muted">{t("refusal.ownDelete")}</p>
            ) : (
              <div className="flex justify-end">
                <Button
                  id="user-delete"
                  variant="destructive"
                  icon="trash"
                  onClick={() => setDeleting(true)}
                  disabled={blocked !== undefined}
                  title={blocked}
                >
                  {t("delete")}
                </Button>
              </div>
            )}
          </Card>

          {/*
            §3.4's bar, for the identity fields alone. `dirty` only — there is no
            `persistent` case here: this is an edit of a record that already
            exists, so a bar on an untouched form would offer to save nothing.
          */}
          <SaveBar
            dirty={identityDirty}
            saving={saving}
            onSave={() => void saveIdentity()}
            onDiscard={() => {
              setDraft({ display_name: user.display_name, email: user.email });
              setFields({});
              setTopError(null);
            }}
            /* §3.7: the write control is disabled with the same reason the stale
               marker gives, rather than failing at the network and blaming
               itself. */
            blockedReason={blocked}
          />
        </div>
      </PageBody>

      {/*
        Suspension and reactivation are **reversible**, so they confirm without
        typing — §3.1's type-to-confirm guard is for an irreversible act. The tone
        matches the outcome rather than the gesture: taking somebody's access away
        is `destructive`, giving it back is `primary`.
      */}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={confirming === null ? "" : t(`confirm.${confirming}Title`)}
        body={confirming === null ? "" : t(`confirm.${confirming}Body`, { name: staffName(user) })}
        confirmLabel={confirming === "activate" ? t("reactivate") : t("suspend")}
        tone={confirming === "activate" ? "primary" : "destructive"}
        loading={statusBusy}
        onConfirm={() => void setStatus(confirming === "activate" ? "active" : "suspended")}
      />

      {/*
        **Delete types the `user_login`**, which §3.1 as amended asks for exactly
        here: only where the record has an identifier a person would recognise. A
        shipping rule had none and was exempted; a username is unique, always
        present, already on the row above, and is the string the audit trail
        records — so it is one somebody can read off the screen and type back.
      */}
      <ConfirmDialog
        open={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(false);
        }}
        title={t("confirm.deleteTitle")}
        body={t("confirm.deleteBody", { name: staffName(user) })}
        confirmLabel={t("delete")}
        loading={removing}
        requireTyped={{
          value: user.username,
          label: t("confirm.typeLogin", { login: user.username }),
        }}
        returnFocusTo="user-delete"
        onConfirm={() => void remove()}
      />
    </div>
  );
}

/**
 * A capability in the reader's language, or as itself.
 *
 * `states.capability.*` names all thirteen in both locales. A fourteenth is one
 * `add()` away on the backend and must render rather than blank — the same
 * open-vocabulary rule `roleLabel()` follows for a role `/roles` never published.
 */
function capabilityName(
  slug: string,
  tStates: ReturnType<typeof useTranslations<"states">>,
): string {
  return tStates.has(`capability.${slug}`) ? tStates(`capability.${slug}`) : slug;
}
