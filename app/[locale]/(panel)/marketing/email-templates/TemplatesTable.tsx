"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { EmailTemplate } from "@/lib/api/schemas/campaign";
import { tokenLiteral } from "@/lib/campaigns";
import { formatDate } from "@/lib/format/date";
import {
  DataTable,
  TableFooter,
  useTablePreferences,
  type Column,
} from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { toUrlParams, type TemplatesQuery } from "./query";

/**
 * The template table — read-only, and the whole of its interactivity is the pager.
 *
 * ## A client component that holds no cache
 *
 * `DataTable` needs a hook, so the table cannot be a Server Component; but this
 * one fetches nothing, keeps nothing and writes nothing. `page.tsx` fetches on
 * the server and the pager is a `router.push`, so what is on screen is exactly as
 * old as the navigation that produced it — which is why **there is no stale
 * marker and no refresh control here**, per §3.7 as amended on the customers
 * branch. The half of that rule which does the real work, "every write control
 * disabled with that same reason", has nothing to disable: this screen has no
 * writes at all.
 *
 * ## No sort, no row opener, no row action
 *
 * `?orderby=` is accepted and ignored — see `query.ts` — so no column declares a
 * `sortKey` and `DataTable` puts `aria-sort` on nothing. And there is nothing
 * behind a row: no detail route, no editor, and the two facts worth having are
 * already in the cells. A row that opens nothing must not wear a pointer cursor,
 * so no `onRowClick` is passed and no opener is rendered.
 *
 * ## The two computed fields are why the screen exists
 *
 * **`unknown_tokens`** — `{{firstname}}` is not `{{first_name}}` and renders
 * *empty*, invisible in a body that has a name in it from another token. The API
 * computes it on the template itself rather than only on a campaign's preview,
 * which is the earliest place it can be surfaced: before a campaign ever uses it.
 *
 * **`has_unsubscribe_token`** — and **false is correct**. The API appends the link
 * when the body has none, so rendering the absence as a warning would teach
 * somebody to add a second one. It is a plain line either way, never a badge.
 */
export function TemplatesTable({
  locale,
  templates,
  total,
  query,
}: {
  locale: string;
  templates: EmailTemplate[];
  total: number;
  query: TemplatesQuery;
}) {
  const t = useTranslations("campaigns");
  const tA11y = useTranslations("a11y");
  const router = useRouter();

  const columns = buildColumns(locale, t);
  const preferences = useTablePreferences("email-templates", columns);

  const commit = (next: TemplatesQuery) => {
    const params = toUrlParams(next);
    router.push(
      `/${locale}/marketing/email-templates${params.size > 0 ? `?${params}` : ""}`,
      { scroll: false },
    );
  };

  return (
    <DataTable
      preferences={preferences}
      rows={templates}
      columns={columns}
      rowKey={(template) => String(template.id)}
      rowLabel={(template) => tA11y("templateName", { name: template.name })}
      record={(template) => templateRecord(template, locale, t)}
      footer={
        <TableFooter
          page={query.page}
          perPage={query.perPage}
          total={total}
          onPageChange={(page) => commit({ ...query, page })}
          onPerPageChange={(perPage) => commit({ ...query, perPage, page: 1 })}
        />
      }
    />
  );
}

type T = (key: string, values?: Record<string, string | number>) => string;

function buildColumns(locale: string, t: T): Column<EmailTemplate>[] {
  return [
    {
      key: "name",
      /* `columns.name`, the plain noun. `field.name` is "Nom interne" and belongs
         to a *campaign* — the name nobody outside the panel ever sees — where a
         template's name is the one wp-admin shows its author. */
      header: t("columns.name"),
      required: true,
      cell: (template) => (
        <span className="flex min-w-0 items-center gap-2">
          {/* Authored in wp-admin by a person, so `dir="auto"`. */}
          <span dir="auto" className="block max-w-64 truncate">
            {template.name}
          </span>
          {template.unknown_tokens.length > 0 ? (
            <Badge tone="warning">
              <Isolate numeric>
                {t("template.unknownTokens", { count: template.unknown_tokens.length })}
              </Isolate>
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "subject",
      header: t("field.subject"),
      /* Carries `{{tokens}}` verbatim as authored — they resolve only when a
         campaign renders. */
      cell: (template) => (
        <span dir="auto" className="block max-w-56 truncate">
          {template.subject}
        </span>
      ),
    },
    {
      key: "tokens",
      header: t("template.tokensColumn"),
      /*
       * One run, not a wrapping row of chips. A first draft drew each token as
       * its own pill in a `flex-wrap` span; the 768px dark capture is what showed
       * the cost — the two-token row wrapped to a second line and stood taller
       * than the 48px §1.4 specifies, so one row in three was a different height
       * from its neighbours. `.ui-td` is `nowrap` and the wrapping was the inner
       * span's own. The count is already on the name's badge; this column is the
       * *names*, and one truncating line says them.
       */
      cell: (template) =>
        template.unknown_tokens.length === 0 ? null : (
          <Ltr
            numeric={false}
            className="block max-w-56 truncate font-mono text-ui-warning-fg"
          >
            {template.unknown_tokens.map(tokenLiteral).join(" · ")}
          </Ltr>
        ),
    },
    {
      key: "unsubscribe",
      header: t("template.unsubscribeColumn"),
      /* **Absent is correct**, so this reads as a statement of what will happen
         rather than as a defect — a plain word and never a badge.

         Two words rather than two sentences, and the 1440 capture is why: the
         full explanations ran the five columns past the card, so `modified` was
         reachable only by scrolling. The sentence they replace is a footnote
         under the table, said once instead of once per row. */
      cell: (template) => (
        <span className="block max-w-40 truncate">
          {template.has_unsubscribe_token
            ? t("template.unsubscribePresent")
            : t("template.unsubscribeMissing")}
        </span>
      ),
    },
    {
      key: "modified",
      header: t("template.modified"),
      /* Nullable on the wire: a template WordPress has never revised carries
         none, and `formatDate` renders that as an em dash rather than as an
         invented date. */
      cell: (template) => <Isolate>{formatDate(template.modified_at, locale, false)}</Isolate>,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * The name with its warning badge identifies the row; the subject is what the
 * template is *for*; and the third line is the unsubscribe statement, which is the
 * fact that most often surprises somebody reading a template they did not write.
 */
function templateRecord(
  template: EmailTemplate,
  locale: string,
  t: T,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  return {
    primary: (
      <>
        <span dir="auto" className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg">
          {template.name}
        </span>
        {template.unknown_tokens.length > 0 ? (
          <Badge tone="warning">
            <Isolate numeric>
              {t("template.unknownTokens", { count: template.unknown_tokens.length })}
            </Isolate>
          </Badge>
        ) : null}
      </>
    ),
    secondary: (
      <span dir="auto" className="min-w-0 flex-1 truncate">
        {template.subject}
      </span>
    ),
    meta: (
      <>
        <span className="min-w-0 truncate">
          {template.has_unsubscribe_token
            ? t("template.unsubscribePresent")
            : t("template.unsubscribeMissing")}
        </span>
        <span className="ms-auto shrink-0 text-ui-compact text-ui-fg">
          <Isolate>{formatDate(template.modified_at, locale, false)}</Isolate>
        </span>
      </>
    ),
  };
}
