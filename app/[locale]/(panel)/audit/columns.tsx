"use client";

import type { ReactNode } from "react";
import type { AuditRow } from "@/lib/api/schemas/audit";
import { actionTone, isSystemActor } from "@/lib/audit";
import { formatDate } from "@/lib/format/date";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Dot } from "@/components/ui/Badge";
import { rowOpenerId, type Column } from "@/components/ui/DataTable";

/**
 * The trail's column definition — one source, two presentations.
 *
 * It replaces `AuditRow.tsx`, which drew one iOS inset row at every width and,
 * more importantly, drew a **variable-height third tier** inside it: the row
 * carried its own metadata, so twenty rows stood at twenty different heights.
 * That is the thing a table exists to avoid — a column of unequal rows cannot be
 * scanned, and scanning is the entire job here. The metadata moved to the peek,
 * which is where the record's surface belongs; the arguments that file made
 * about *how* to render each field are carried over rather than restated.
 *
 * ## Four columns, and `#id` is not one of them
 *
 * action (the identifying cell) · actor · resource · when. The row's `id` gets
 * no column: §3.1's shipping amendment is that rendering a primary key at a
 * shopkeeper is a key pretending to be a name, and this one is not even a handle
 * — there is **no `GET /audit-logs/{id}`**, so it addresses nothing. It is not
 * in the peek either, for the same reason.
 *
 * ## The action renders as itself, and that is measured rather than lazy
 *
 * **85 distinct actions** on this install across 23 resource types, growing with
 * every subsystem the backend adds; every one of them contains a `.`, which is a
 * `next-intl` path separator, and the defect 14b shipped was exactly this —
 * event names used as flat message keys, every one resolving to a path that does
 * not exist, seven of eight e2e tests still passing because the key path renders
 * as plausible-looking text. `product.updated` is an identifier: it is the exact
 * string `?action=` takes, it is what somebody quotes into a bug report, and it
 * goes in `Ltr` for the same reason a SKU does.
 *
 * The **resource type** is translated, because it is the vocabulary of a control
 * — `?resource_type=` is a filter this screen offers — and a picker has to say
 * something in the reader's language. One this build has no name for renders as
 * itself, which is how `ac_banner` (a CMS delete path recording a WordPress post
 * type where every sibling records `banner`) stays visible as the oddity it is.
 *
 * ## No `sortKey` on any column, and that is the finding rather than an omission
 *
 * `AuditRepository.php:50` ends in a literal `ORDER BY id DESC` with no branch
 * anywhere near it — a fact read from the source, which the notifications branch
 * records as a stronger kind of fact than a pair of responses that agreed, and
 * `tests/Api/audit.php:376-379` is the backend's own positive control. The table
 * is append-only, so its id order *is* its time order. `DataTable` gates
 * `aria-sort` on `sortKey && onSortChange`, so with neither present every header
 * honestly announces nothing.
 *
 * ## The date is absolute, and never `formatWhen`
 *
 * A relative stamp cannot be server-rendered — the notifications branch's
 * hydration finding — and this table is the one place it would bite hardest,
 * because the trail's newest rows are *seconds* old: every authenticated request
 * the panel makes can write one. It is also the wrong reading. This is a
 * forensic record being reconciled against something else, and "il y a 2
 * minutes" is not a timestamp anybody can line up with a server log.
 */

export type AuditColumnContext = {
  locale: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  /** Whether this build has a name for a resource type — `t.has`, passed in so
      the cell functions stay free of hooks. */
  hasResourceName: (type: string) => boolean;
};

/** The DOM id of a row's opener, in one place: the cell renders it and the peek
    hands focus back to it. See DESIGN.md §3.2 and DECISIONS.md §10. */
export function auditOpenerId(id: number): string {
  return rowOpenerId("audit", id);
}

/** The resource type in the reader's language, or as itself. */
export function resourceName(row: AuditRow, ctx: AuditColumnContext): string {
  return ctx.hasResourceName(row.resource_type)
    ? ctx.t(`resource.${row.resource_type}`)
    : row.resource_type;
}

/** The actor: a login, or the system named as a state rather than as a zero. */
function actorCell(row: AuditRow, ctx: AuditColumnContext): ReactNode {
  return isSystemActor(row) ? (
    ctx.t("systemActor")
  ) : (
    /* A login is an identifier and reorders inside Arabic text without
       isolation. `numeric={false}` because it is not a figure. */
    <Ltr numeric={false} className="block max-w-48 truncate">
      {row.actor_login}
    </Ltr>
  );
}

/**
 * The object the entry is about: its type in words, then its id as an
 * identifier.
 *
 * The id is rendered on **every** row that carries one, `"0"` included — the
 * trail is the one screen where showing less than arrived is the wrong failure.
 * What `"0"` does not get is a *link*, and that is `AuditPeek`'s job rather than
 * this cell's: `?resource_id=0` answers the whole collection, so an affordance
 * offering it would report a narrowing that did not happen.
 */
function resourceCell(row: AuditRow, ctx: AuditColumnContext): ReactNode {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <Isolate numeric={false} className="min-w-0 truncate">
        {resourceName(row, ctx)}
      </Isolate>
      {/* `shrink-0` with a cap rather than `shrink`: when the line is short the
          **type** gives way and the id survives whole, because the id is the
          identifier — measured at 340, `Compte d'équi… 7…` is a row that has
          told the reader nothing. The cap keeps a 64-character id from setting
          the line's minimum width. */}
      {row.resource_id === "" ? null : (
        <Ltr numeric={false} className="max-w-40 shrink-0 truncate text-ui-subtle">
          {row.resource_id}
        </Ltr>
      )}
    </span>
  );
}

export function buildColumns(ctx: AuditColumnContext): Column<AuditRow>[] {
  const { locale, t } = ctx;

  return [
    {
      key: "action",
      header: t("field.action"),
      /* The identifier. Never hideable, and the cell `DataTable` wraps in the
         row's opener button. */
      required: true,
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          {/* Decorative, `aria-hidden` inside `Dot` — the action text beside it
              is what carries the meaning, and four verb endings earn a colour so
              that a page of updates reads as a page of updates rather than as a
              wall of green. */}
          <Dot tone={actionTone(row.action)} />
          <Ltr numeric={false} className="block max-w-64 truncate">
            {row.action}
          </Ltr>
        </span>
      ),
    },
    {
      key: "actor",
      header: t("field.actor"),
      cell: (row) => actorCell(row, ctx),
    },
    {
      key: "resource",
      header: t("field.resource"),
      cell: (row) => resourceCell(row, ctx),
    },
    {
      key: "when",
      header: t("field.when"),
      align: "end",
      /* `Isolate`, never `Ltr`: `Intl` puts U+200F marks inside an Arabic date on
         purpose and forcing a direction over them renders the parts out of
         order. `created_at` has no offset, so it goes through `formatDate` —
         `new Date()` would shift every row by the host's offset with nothing on
         screen to show it. */
      cell: (row) => <Isolate>{formatDate(row.created_at, locale)}</Isolate>,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * Which three is editorial rather than "the first three columns", and here they
 * are the same four facts redistributed: the action identifies the entry, the
 * actor answers *who*, and the object and the timestamp close the line that
 * places it. The metadata is on none of them and is not a gap — it is the peek,
 * at every width, because it is the one field with no shape a line can hold.
 *
 * **Where the timestamp goes took three attempts and one real measurement**, and
 * the measurement is the only part worth keeping. Attempt one put it beside the
 * action, which is what the table does and what reads perfectly at 1440: at the
 * 340px floor the identifier truncated at eleven characters, and
 * `cms.banner_updated` and `cms.banner_deleted` both rendered `cms.banne…`.
 * Attempt two moved it beside the actor, and the actor lost instead —
 * `ac_panel_su…` is `ac_panel_super_admin` **or** `ac_panel_support_agent`, and
 * a row that names the wrong person is worse than one that names nobody.
 *
 * Attempt three measured the three lines instead of estimating them. At 340 the
 * card's content box is **264px in French and 260px in Arabic**, and the three
 * lines were using 256 / 264 / 90 of it: line two was clipping two of six logins
 * while line three carried a single short phrase and 150px of nothing. So the
 * stamp goes on **line three**, beside the object, where it fits with room to
 * spare (`Compte d'équipe 774` + `17 août 2026, 12:48` is 251 of 264), and the
 * actor gets a line to itself and never truncates. Line one was already right.
 *
 * The two guesses agreed with each other and were both wrong. The `<li>` was
 * there to be measured the whole time.
 */
export function auditRecord(
  row: AuditRow,
  ctx: AuditColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { locale } = ctx;

  return {
    primary: (
      <>
        <Dot tone={actionTone(row.action)} />
        {/* `--text-subheading`, which is the line box `RecordListSkeleton` draws
            for line one (`h-5.5`) — a smaller class here makes every placeholder
            row taller than the row that replaces it. */}
        <Ltr
          numeric={false}
          className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg"
        >
          {row.action}
        </Ltr>
      </>
    ),
    secondary: <span className="min-w-0 flex-1 truncate">{actorCell(row, ctx)}</span>,
    meta: (
      <>
        <span className="min-w-0 flex-1">{resourceCell(row, ctx)}</span>
        <span className="shrink-0">
          <Isolate>{formatDate(row.created_at, locale)}</Isolate>
        </span>
      </>
    ),
  };
}

/** The row's accessible name — "product.updated, 18 août 2026 à 02:41". */
export function auditRowLabel(
  row: AuditRow,
  ctx: AuditColumnContext,
  tA11y: (key: string, values?: Record<string, string | number>) => string,
): string {
  return tA11y("auditEntry", {
    action: row.action,
    date: formatDate(row.created_at, ctx.locale),
  });
}
