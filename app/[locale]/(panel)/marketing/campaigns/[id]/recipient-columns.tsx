"use client";

import type { ReactNode } from "react";
import type { Recipient } from "@/lib/api/schemas/campaign";
import { recipientError, recipientLabel, recipientSentAt, recipientTone } from "@/lib/campaigns";
import { formatDate } from "@/lib/format/date";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Badge } from "@/components/ui/Badge";
import type { Column } from "@/components/ui/DataTable";

/**
 * The frozen recipients of a sent campaign — one column definition, two
 * presentations, exactly as every other list in the panel.
 *
 * ## Nothing sorts, and no header claims otherwise
 *
 * `GET /campaigns/{id}/recipients` registers **no `orderby` argument at all**:
 * `?orderby=zzz` is a **200** here where the same value on `/campaigns` one level
 * up is a 400, because the parameter reaches nothing and is therefore not
 * validated either. Two routes on one resource, two answers to the same wrong
 * value. So no column carries a `sortKey`, the list passes no `onSortChange`, and
 * `DataTable` puts `aria-sort` on nothing — which is the pair that keeps the
 * table honest, and the exact defect DECISIONS.md §2 records finding on products.
 *
 * ## No opener, and no row action
 *
 * There is nothing behind a recipient row: no detail route, no write, and the two
 * facts a person wants — why it failed, and when it went — are already in the
 * cells. So the table takes no `onRowClick` and needs no `rowOpenerId`; a row that
 * opens nothing must not wear a pointer cursor.
 */

/**
 * `t` carries `has` because **the status vocabulary is open**.
 *
 * `RECIPIENT_STATUSES` is the three this drain writes today, not a contract the
 * API publishes — §15 records that the shop is likely moving to a different mail
 * path, and a `delivered` or a `bounced` is the ordinary next value. The schema
 * takes a plain string for that reason, and both readers below degrade: an
 * unfamiliar status keeps its own name and takes the neutral tone rather than
 * printing `campaigns.recipient.delivered` into a `Badge`.
 */
export type RecipientColumnContext = {
  locale: string;
  t: {
    (key: string, values?: Record<string, string | number>): string;
    has: (key: string) => boolean;
  };
};

export function buildRecipientColumns(ctx: RecipientColumnContext): Column<Recipient>[] {
  const { locale, t } = ctx;

  return [
    {
      key: "email",
      header: t("recipients.email"),
      required: true,
      /* An address is an identifier and reorders inside Arabic without isolation.
         Capped, because `.ui-td` is `nowrap` and the fixture carries an
         80-character unbroken address whose cell would otherwise set the column's
         width. */
      cell: (row) => (
        <Ltr numeric={false} className="block max-w-72 truncate">
          {row.email}
        </Ltr>
      ),
    },
    {
      key: "status",
      header: t("field.status"),
      cell: (row) => (
        <Badge tone={recipientTone(row.status)}>{recipientLabel(row.status, t)}</Badge>
      ),
    },
    {
      key: "error",
      header: t("recipients.error"),
      /* The transport's own words, quoted rather than translated: it is evidence,
         and a translated generic would throw away the only actionable half.
         `dir="auto"` so a French or Arabic transport message lands the right way
         round. */
      cell: (row) => {
        const error = recipientError(row);
        return error === null ? null : (
          <span dir="auto" className="block max-w-72 truncate">
            {error}
          </span>
        );
      },
    },
    {
      key: "attempts",
      header: t("recipients.attemptsLabel"),
      align: "end",
      optional: true,
      /* Measured 0 on a sent row and 3 on a failed one, so a zero is a real
         answer rather than an absence and is printed. */
      cell: (row) => <Ltr>{row.attempts.toLocaleString(locale)}</Ltr>,
    },
    {
      key: "sentAt",
      header: t("recipients.sentAt"),
      cell: (row) => {
        const sentAt = recipientSentAt(row);
        return sentAt === null ? null : (
          /*
            **No offset on this one.** `"2026-08-21 17:31:12"` where the campaign's
            own stamps carry `+00:00` — `formatDate` reads it as UTC through
            `parseApiDate`, which is what the API means; `new Date()` would read it
            as local and be silently wrong by the host's offset.
          */
          <Isolate>{formatDate(sentAt, locale)}</Isolate>
        );
      },
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * The address identifies the row; the status is what somebody is scanning for;
 * and the third line is a cascade — the transport's refusal where there is one,
 * because that is the only place a failed send says *why*, and the timestamp
 * otherwise.
 */
export function recipientRecord(
  row: Recipient,
  ctx: RecipientColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { locale, t } = ctx;
  const error = recipientError(row);
  const sentAt = recipientSentAt(row);

  return {
    primary: (
      <>
        <Ltr
          numeric={false}
          className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg"
        >
          {row.email}
        </Ltr>
        <Badge tone={recipientTone(row.status)}>{recipientLabel(row.status, t)}</Badge>
      </>
    ),
    secondary:
      error !== null ? (
        <span dir="auto" className="min-w-0 flex-1 truncate">
          {error}
        </span>
      ) : sentAt !== null ? (
        <span className="min-w-0 flex-1 truncate">
          <Isolate>{formatDate(sentAt, locale)}</Isolate>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-ui-subtle">
          {t("recipients.notSentYet")}
        </span>
      ),
    meta: (
      <span className="ms-auto shrink-0 text-ui-compact text-ui-fg">
        <Isolate numeric>{t("recipients.attempts", { count: row.attempts })}</Isolate>
      </span>
    ),
  };
}
