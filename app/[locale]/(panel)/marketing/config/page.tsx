import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { marketingConfig } from "@/lib/api/schemas/campaign";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ListGroup, ListRow, ListValueRow } from "@/components/primitives/GroupedList";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Ltr } from "@/components/primitives/Ltr";

/**
 * The pixel configuration: what is set up, and what this screen deliberately
 * cannot show.
 *
 * **A read-only screen, and that is the whole design.** `GET /marketing/config`
 * serves the *public* pixel id — the Conversions API token appears in no
 * response, ever — and `POST /marketing/events/purchase` is the storefront's,
 * not the panel's, so there is nothing here to edit and nothing to send. Saying
 * so is the screen's job: an operator looking for "where do I paste the token"
 * needs to be told it is not here rather than to hunt.
 *
 * Measured on this shop: `enabled: false`, `providers: []`. So the ordinary state
 * is "nothing configured", and it renders as a statement rather than as an empty
 * table.
 */
export default async function MarketingConfigPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("campaigns");

  if (!has(me, "ac_manage_marketing")) {
    return (
      <Scaffold title={t("marketing.title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_marketing" />
        </div>
      </Scaffold>
    );
  }

  const config = await acFetch(marketingConfig, session, "/marketing/config");
  const data = config.data;

  return (
    <Scaffold
      title={t("marketing.title")}
      back={{ href: `/${locale}/marketing`, label: t("hubTitle") }}
    >
      <div className="mx-auto max-w-3xl px-4">
        <ListGroup footnote={t("marketing.tokenNote")}>
          <ListRow>
            <span className="text-body text-label-secondary">{t("marketing.title")}</span>
            <StatusBadge tone={data.enabled ? "success" : "neutral"} className="ms-auto">
              {data.enabled ? t("marketing.enabled") : t("marketing.disabled")}
            </StatusBadge>
          </ListRow>
          {data.providers.length === 0 ? (
            <ListRow>
              <span className="text-footnote text-label-secondary">
                {t("marketing.noProviders")}
              </span>
            </ListRow>
          ) : (
            data.providers.map((provider, index) => (
              <ListValueRow
                key={index}
                label={t("marketing.providers")}
                value={<Ltr numeric={false}>{String(provider)}</Ltr>}
              />
            ))
          )}
        </ListGroup>

        {/*
          The two event lists, side by side because the distinction is the point:
          the browser reports `PageView`, `Search` and `ViewContent` and the
          server reports what it witnessed. An event name is a vendor identifier —
          `Ltr`, never translated.
        */}
        <ListGroup title={t("marketing.browserEvents")} footnote={t("marketing.storefrontNote")}>
          <ListRow className="flex-wrap gap-2">
            {data.browser_events.map((event) => (
              <Ltr
                key={event}
                numeric={false}
                className="rounded-full bg-surface-2 px-2 py-1 font-mono text-caption text-label"
              >
                {event}
              </Ltr>
            ))}
          </ListRow>
        </ListGroup>

        <ListGroup title={t("marketing.serverEvents")}>
          <ListRow className="flex-wrap gap-2">
            {data.server_events.map((event) => (
              <Ltr
                key={event}
                numeric={false}
                className="rounded-full bg-surface-2 px-2 py-1 font-mono text-caption text-label"
              >
                {event}
              </Ltr>
            ))}
          </ListRow>
        </ListGroup>
      </div>
    </Scaffold>
  );
}
