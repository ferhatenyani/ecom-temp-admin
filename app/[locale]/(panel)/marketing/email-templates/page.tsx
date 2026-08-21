import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { emailTemplateList } from "@/lib/api/schemas/campaign";
import { has } from "@/lib/capabilities";
import { ForbiddenState, EmptyState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ListGroup, ListRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { formatDate } from "@/lib/format/date";
import { tokenLiteral } from "@/lib/campaigns";

/**
 * Email templates, read-only.
 *
 * **There is no editor here and that is not an omission.** §85 makes a template
 * an `ac_email_template` post authored in wp-admin, *where the revisions and the
 * media library already are*, and gives the API two read routes and no write. So
 * this screen reads them and says where to write one — the alternative being a
 * form that cannot save, which is worse than no form.
 *
 * What it adds over wp-admin is the two checks the API computes on the template
 * itself rather than only on a campaign's preview:
 *
 *   **unknown tokens** — `{{firstname}}` is not `{{first_name}}` and renders
 *   empty, invisible in a preview that has a name in it from another token. §85
 *   asks for this to be surfaced prominently, and on the template is the earliest
 *   place it can be: before a campaign ever uses it.
 *
 *   **the unsubscribe link** — absent is *correct*, because the API appends one.
 *   Rendering that as a warning would teach somebody to add a second.
 */
export default async function EmailTemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("campaigns");

  if (!has(me, "ac_manage_marketing")) {
    return (
      <Scaffold title={t("templates")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_marketing" />
        </div>
      </Scaffold>
    );
  }

  const result = await acFetch(
    emailTemplateList,
    session,
    "/email-templates?per_page=100",
  ).catch((error: unknown) => {
    if (error instanceof ApiError) return null;
    throw error;
  });

  const templates = result?.data ?? [];

  return (
    <Scaffold title={t("templates")} back={{ href: `/${locale}/marketing`, label: t("hubTitle") }}>
      <div className="mx-auto max-w-3xl px-4">
        <p className="mb-2 px-1 text-footnote text-label-secondary" data-testid="templates-count">
          <Isolate numeric>{t("template.count", { total: templates.length })}</Isolate>
        </p>

        {templates.length === 0 ? (
          <EmptyState message={t("empty.templates")} />
        ) : (
          <ListGroup footnote={t("template.readOnly")}>
            {templates.map((template) => (
              <ListRow key={template.id} className="flex-col items-stretch gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span dir="auto" className="min-w-0 truncate text-body text-label">
                    {template.name}
                  </span>
                  {template.unknown_tokens.length > 0 ? (
                    <StatusBadge tone="warning" className="ms-auto">
                      <Isolate numeric>
                        {t("template.unknownTokens", { count: template.unknown_tokens.length })}
                      </Isolate>
                    </StatusBadge>
                  ) : null}
                </div>

                <span dir="auto" className="truncate text-footnote text-label-secondary">
                  {template.subject}
                </span>

                {template.unknown_tokens.length > 0 ? (
                  <span className="flex flex-wrap gap-2">
                    {template.unknown_tokens.map((token) => (
                      <Ltr
                        key={token}
                        numeric={false}
                        className="tone-warning tonal rounded-sm px-2 py-0.5 font-mono text-caption"
                      >
                        {tokenLiteral(token)}
                      </Ltr>
                    ))}
                  </span>
                ) : null}

                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-label-tertiary">
                  {/*
                    **Absent is correct.** The API appends the link when the body
                    has none, so this reads as a statement of what will happen
                    rather than as a defect — hence a plain line and not a badge.
                  */}
                  <span className="flex items-center gap-1">
                    <Icon
                      name={template.has_unsubscribe_token ? "check" : "plus"}
                      className="size-3.5 shrink-0"
                    />
                    {template.has_unsubscribe_token
                      ? t("template.unsubscribePresent")
                      : t("template.unsubscribeMissing")}
                  </span>
                  {template.modified_at !== null ? (
                    <span className="ms-auto">
                      <Isolate>{formatDate(template.modified_at, locale, false)}</Isolate>
                    </span>
                  ) : null}
                </span>
              </ListRow>
            ))}
          </ListGroup>
        )}
      </div>
    </Scaffold>
  );
}
