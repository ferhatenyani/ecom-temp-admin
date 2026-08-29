"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Role, StaffUser } from "@/lib/api/schemas/staff";
import { STATUS_TONE, isRetiredRole, roleLabel, staffName } from "@/lib/staff";
import { formatDate } from "@/lib/format/date";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Badge } from "@/components/ui/Badge";
import type { Column } from "@/components/ui/DataTable";

/**
 * The staff column definition — one source, two presentations.
 *
 * `DataTable` renders these as a real table at `md`+ and `RecordList` renders the
 * three-line form below it, so a phone and a monitor cannot drift apart about
 * which fields identify an account. It replaces `UserRow.tsx`, which drew one iOS
 * inset row at every width; that file's two arguments — the login is an
 * identifier and belongs in `Ltr`, and no date belongs on the row — are carried
 * over below rather than restated, and the second one is **reversed** with a
 * reason.
 *
 * ## The identifying cell is a real `<a href>`, and only in the table
 *
 * **There is no peek drawer, and no `rowOpenerId`.** `GET /users/{id}` is the
 * list row plus exactly one key — `application_passwords` — and that key is the
 * credential manager, which is not why a list reader opens a row. The detail also
 * holds three write surfaces (identity, role, status) a 400px drawer would cramp
 * and a delete that types the login. So the row navigates, and because it
 * navigates the name is an anchor rather than a span in a clickable row: that is
 * the keyboard path, the middle click and "open in new tab", none of which a
 * `<div onClick>` has. §3.2 says to omit `rowOpenerId` exactly here — the cell is
 * already a link and following it is what clicking the row does, so wrapping it
 * in a `<button>` would be nested interactive content. Customers' and
 * notifications' argument, a third time.
 *
 * The anchor is deliberately only in the **table**. `RecordList` navigates
 * through the stretched overlay button `DataTable` already gives it, so a row is
 * one anchor and not two — both presentations are in the DOM at every width, and
 * a link in each would double every `a[href*="/users/"]` a suite counts. That is
 * not hypothetical here: `e2e/admin.spec.ts:220-224` already records a near-miss
 * where the create button's anchor matched before any row.
 *
 * ## Four columns sort, and `ID` is not one of them
 *
 * `query.ts` carries the measurement: ten requests, ten distinct sequences over
 * all 69 rows, and a 400 for anything outside the enum. `display_name`,
 * `user_email`, `user_login` and `registered` each carry a `sortKey`, the list
 * passes `onSortChange`, and those four headers announce `aria-sort`. The role
 * and status columns carry none, because the API cannot sort either and a header
 * that says otherwise is the defect DECISIONS.md §2 records — `DataTable` gates
 * the attribute on `sortKey && onSortChange`, so with no key those two honestly
 * announce nothing.
 *
 * **`registered` declares `["desc", "asc"]` and that is a correctness fix rather
 * than a preference.** It is the resting order, so the list arrives at
 * `{registered, desc}` and that header opens announcing *descending* — which is
 * true. With the default `["asc", "desc"]` cycle its next click would be `desc →`
 * off the end `→ null`, and `null` restores the default pair, which is
 * `registered desc` again: a header whose click provably changes nothing.
 * Declaring the cycle the other way round makes it `desc ⇄ asc`, two states that
 * both re-order the list, with `aria-sort` true in each. The other three rest
 * unsorted and keep the ordinary three-state cycle, whose third click drops
 * `orderby` from the URL and returns here.
 *
 * ## The date came back, and the reason is the sort
 *
 * `UserRow.tsx` deliberately carried no date: *"a staff list is a list of people,
 * and the useful second line is who they are and whether they can sign in."* That
 * was right for one inset row at every width and is wrong for a table, because
 * `registered` is the collection's resting order and the strongest of the four
 * sorts — a list sorted newest-first by a field it does not display is a list
 * whose order has no visible cause. So `registered` is a column, at the end,
 * where a date belongs.
 *
 * It stays off the phone's three lines for exactly the original reason.
 *
 * ## `formatDate`, never `formatWhen`
 *
 * The relative form would be a hydration mismatch on a server-rendered first page
 * — the trap `notifications/columns.tsx` documents at length — and it would buy
 * nothing: these rows are days and months old, where `formatWhen` falls back to
 * the absolute form anyway. Avoiding the hook is the simpler correctness.
 */

export type UserColumnContext = {
  locale: string;
  /** `/roles`, the label source. Empty when that request failed; see `roleLabel`. */
  roles: readonly Role[];
  /** The acting user's id, or `null`. Marks the one row whose controls differ. */
  meId: number | null;
  t: (key: string, values?: Record<string, string | number>) => string;
};

/** The status badge, which every presentation of an account carries. */
function StatusBadge({ user, t }: { user: StaffUser; t: UserColumnContext["t"] }) {
  return <Badge tone={STATUS_TONE[user.status]}>{t(`status.${user.status}`)}</Badge>;
}

/**
 * The acting user's own row, marked.
 *
 * **It is the row whose controls differ**, and the old screen already did this:
 * three of the six refusals are about self, and a person who cannot find their
 * own account cannot discover why the buttons on it are missing. `info` rather
 * than a fifth colour — `Badge` has five tones and this is not a status, so it
 * borrows the one that means "about you" without claiming success or danger.
 */
function YouBadge({ t }: { t: UserColumnContext["t"] }) {
  return <Badge tone="info">{t("you")}</Badge>;
}

/**
 * What an account's role is called, with the two facts that qualify it.
 *
 * `roleLabel()` resolves the published matrix first, then the row's own
 * `role_name`, then the raw key — never a blank, which matters because 50 of 69
 * rows hold a role the picker cannot offer and 2 hold one `/roles` does not
 * describe at all.
 */
function RoleCell({ user, ctx }: { user: StaffUser; ctx: UserColumnContext }) {
  const { roles, t } = ctx;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {/* A role name is prose the shop chose — `Isolate`, not `Ltr`: forcing a
          direction on "Responsable des commandes" inside the Arabic panel lays
          it out from the wrong end. */}
      <Isolate numeric={false} className="min-w-0 truncate">
        {roleLabel(user.role, user.role_name, roles)}
      </Isolate>
      {isRetiredRole(user.role, roles) ? (
        <Badge tone="neutral">{t("retired")}</Badge>
      ) : null}
      {/* Named on the row rather than only on the record, because these two are
          the accounts the role *filter* cannot reach — `/roles` publishes no
          `administrator` — so the list is the only place the fact is visible.
          `query.ts` argues the filter's shape. */}
      {user.is_administrator ? <Badge tone="warning">{t("wordpress")}</Badge> : null}
    </span>
  );
}

export function buildColumns(ctx: UserColumnContext): Column<StaffUser>[] {
  const { locale, meId, t } = ctx;

  return [
    {
      key: "name",
      header: t("columns.name"),
      required: true,
      sortKey: "display_name",
      cell: (user) => (
        <span className="flex min-w-0 items-center gap-2">
          <Link
            href={`/${locale}/users/${user.id}`}
            /* The row navigates too. Without this the anchor's click bubbles and
               the same push happens twice. */
            onClick={(event) => event.stopPropagation()}
            className="ui-ring min-w-0 rounded-ui-md hover:underline"
          >
            {/* `dir="auto"`: a display name is whatever the person typed, and on
                64 of 69 rows it is the login — an ASCII run that would be clipped
                from its front inside the Arabic panel. `.ui-td` is `nowrap`, so
                the cap is what stops the 56-character fixture setting the
                column's width. */}
            <span dir="auto" className="block max-w-56 truncate">
              {staffName(user)}
            </span>
          </Link>
          {meId !== null && user.id === meId ? <YouBadge t={t} /> : null}
        </span>
      ),
    },
    {
      key: "username",
      header: t("columns.username"),
      sortKey: "user_login",
      /* The login is an identifier — it is `actor_login` in the audit trail and
         it is what somebody types into the sign-in form — so `Ltr`, and never
         around the whole row. `numeric={false}`: it is not a figure. */
      cell: (user) => (
        <Ltr numeric={false} className="block max-w-44 truncate">
          {user.username}
        </Ltr>
      ),
    },
    {
      key: "email",
      header: t("columns.email"),
      sortKey: "user_email",
      /*
       * **Off by default, and that is a measurement rather than taste.** Six
       * columns did not fit: at 1440 the status badge — the one thing anybody
       * scans this list for — sat outside the card's scroll container entirely,
       * and at 768 so did the role and the date. Photographed at both widths
       * before this line existed.
       *
       * The address is the column that had to go because it is the widest and the
       * least load-bearing of the three free-text ones. The login is already
       * beside it and is what the audit trail records; on this shop the address is
       * the login with a domain glued on, so the pair spends 400px saying one
       * thing. Somebody who wants to write to a colleague opens the record, and
       * the search field matches the address whether or not the column is shown.
       *
       * Being optional makes its sort reachable only once the column is shown —
       * and hiding it again while `user_email` is the active sort leaves the list
       * ordered by a column that is not there. That is the gap `coupons/columns.tsx`
       * records about `id`, and the same answer applies: the resting order is
       * `registered`, which is a *visible* column here, so the third click on any
       * header returns to something the reader can see, and the only route to the
       * gap is to sort by the address and then deliberately hide it.
       */
      optional: true,
      /* An address reorders inside Arabic text without isolation, and an address
         read back wrong is a mail to a stranger. The 81-character fixture on row
         413 is why this is capped as well as isolated. */
      cell: (user) => (
        <Ltr numeric={false} className="block max-w-56 truncate">
          {user.email}
        </Ltr>
      ),
    },
    {
      key: "role",
      header: t("columns.role"),
      /* No `sortKey`: `role` is not in `UserRepository::ORDERBY`. */
      cell: (user) => <RoleCell user={user} ctx={ctx} />,
    },
    {
      key: "registered",
      header: t("columns.registered"),
      align: "end",
      sortKey: "registered",
      /* See the docblock: this is the resting order, so the cycle is `desc ⇄ asc`
         and never passes through a third state that would restore the order it
         claims to have left. */
      sortDirections: ["desc", "asc"],
      /* `Isolate`, never `Ltr`: `Intl` puts U+200F marks inside an Arabic date on
         purpose, and forcing a direction over them renders the parts out of
         order. */
      cell: (user) => <Isolate>{formatDate(user.date_created, locale, false)}</Isolate>,
    },
    {
      key: "status",
      header: t("columns.status"),
      /* Status ends, per §3.2. Last, because it is the answer and the row reads
         towards it. */
      align: "end",
      cell: (user) => <StatusBadge user={user} t={t} />,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * Which three is editorial rather than "the first three columns": on a phone a
 * person is identifying the account (who it is, and whether they can sign in),
 * placing it (the login, which is the identity the audit trail uses), and
 * qualifying it (the role, and what is unusual about it).
 *
 * **The email is on none of the three and the date is on none of the three**, and
 * both absences are decisions. An address is the longest free-text field on the
 * screen — 81 characters on the overflow fixture — and it identifies nobody a
 * login has not already identified; the registration date is the resting order
 * rather than a fact anybody triages on, and below `md` there is no sort control
 * for it to explain. Both are on the record.
 */
export function userRecord(
  user: StaffUser,
  ctx: UserColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { meId, t } = ctx;

  return {
    primary: (
      <>
        <span dir="auto" className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg">
          {staffName(user)}
        </span>
        {meId !== null && user.id === meId ? <YouBadge t={t} /> : null}
        <StatusBadge user={user} t={t} />
      </>
    ),
    secondary: (
      <Ltr numeric={false} className="min-w-0 flex-1 truncate">
        {user.username}
      </Ltr>
    ),
    /* `--text-compact` on the trailing element, and it is a measurement rather
       than emphasis: `RecordListSkeleton` draws its third line at 1.25rem because
       the migrated screens put a compact-sized value there, and the taller child
       wins the line box. Left at the meta row's own `--text-label` the card
       measures 94px against the placeholder's 96. */
    meta: (
      <span className="ms-auto flex min-w-0 items-center gap-1.5 text-ui-compact text-ui-fg">
        <RoleCell user={user} ctx={ctx} />
      </span>
    ),
  };
}
