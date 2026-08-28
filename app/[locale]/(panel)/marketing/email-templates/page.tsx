import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { emailTemplateList } from "@/lib/api/schemas/campaign";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Isolate } from "@/components/primitives/Ltr";
import { TemplatesTable } from "./TemplatesTable";
import { listParams, queryFromParams } from "./query";

/**
 * Email templates, read-only.
 *
 * **There is no editor here and that is not an omission.** §85 makes a template
 * an `ac_email_template` post authored in wp-admin, *where the revisions and the
 * media library already are*, and gives the API two read routes and no write —
 * which `lib/api/allowlist.ts` mirrors deliberately. So this screen reads them
 * and says where to write one; the alternative is a form that cannot save, which
 * is worse than no form.
 *
 * What it adds over wp-admin is the two checks the API computes on the template
 * itself rather than only on a campaign's preview: the **unknown tokens** that
 * will render empty, and whether the body carries its own **unsubscribe link** —
 * where absent is *correct*, because the API appends one. `TemplatesTable`
 * carries both arguments.
 *
 * ## A Server Component, and the client half holds nothing
 *
 * The fetch is here and the table below is a client component only because
 * `DataTable` needs a hook: it caches nothing, writes nothing and refetches
 * nothing, so what is on screen is exactly as old as the navigation. **No stale
 * marker and no refresh control** — §3.7 as amended on the customers branch, and
 * the half of that rule which does the real work has nothing to disable.
 *
 * ## One empty state, and the missing half has no producer
 *
 * §3.7 as amended on the media branch. This route's whole query contract is
 * paging — `?search=`, `?status=` and `?orderby=` are accepted and ignored,
 * measured — so there is no control that could return "nothing matching this
 * filter", and this screen ships one half and says so here. A page past the end
 * *is* reachable and gets its own state and its own action, which is the
 * inventory branch's lesson about a report with no way back.
 *
 * **Re-read this whenever a control is added**, which is the point of the
 * sentence living in the file the new control would land in.
 */
export default async function EmailTemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("campaigns");

  const header = (subtitle?: React.ReactNode) => (
    <PageHeader
      title={t("templates")}
      back={{ href: `/${locale}/marketing`, label: t("hubTitle") }}
      subtitle={subtitle}
    />
  );

  if (!has(me, "ac_manage_marketing")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {header()}
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_marketing" />
        </PageBody>
      </div>
    );
  }

  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") incoming.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) incoming.set(key, value[0]);
  }
  const query = queryFromParams(incoming);

  const result = await acFetch(
    emailTemplateList,
    session,
    `/email-templates?${listParams(query)}`,
  ).catch((error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  });

  if (result === null) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {header()}
        <PageBody width="full">
          {/* No `onRetry`: a Server Component cannot re-fetch itself, and a button
              that reloaded the page would be a reload wearing a retry's clothes. */}
          <ErrorState message={t("template.unavailable")} />
        </PageBody>
      </div>
    );
  }

  const templates = result.data;
  const meta = result.meta ? listMeta.safeParse(result.meta) : null;
  const total = meta?.success ? meta.data.total : templates.length;
  const overPaged = templates.length === 0 && query.page > 1;

  return (
    <div className="min-h-dvh bg-ui-canvas">
      {header(
        <span data-testid="templates-count">
          <Isolate>{t("template.count", { total })}</Isolate>
        </span>,
      )}
      <PageBody width="full">
        {templates.length === 0 ? (
          <EmptyState
            icon={overPaged ? "search" : "note"}
            message={overPaged ? t("empty.pastEnd") : t("empty.templates")}
            detail={overPaged ? undefined : t("template.readOnly")}
            /* A **navigation**, not a handler: this is a Server Component and
               `States.tsx` is `"use client"`, so a function cannot cross the
               boundary. `EmptyState.action.href` exists for exactly this. */
            action={
              overPaged
                ? {
                    label: t("empty.firstPage"),
                    href: `/${locale}/marketing/email-templates`,
                  }
                : undefined
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            <TemplatesTable
              locale={locale}
              templates={templates}
              total={total}
              query={query}
            />
            {/*
              Two footnotes, said once rather than once per row. The unsubscribe
              column is two words because the sentence behind them ran the table
              past its own card at 1440 — and the sentence is the same for every
              row anyway, which is the content branch's `dataHint` lesson: nine
              copies of one fact down a document is a fact nobody reads.
            */}
            <p className="text-ui-label text-ui-subtle">{t("template.unsubscribeNote")}</p>
            <p className="text-ui-label text-ui-subtle">{t("template.readOnly")}</p>
          </div>
        )}
      </PageBody>
    </div>
  );
}
