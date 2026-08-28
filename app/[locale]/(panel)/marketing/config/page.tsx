import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { marketingConfig } from "@/lib/api/schemas/campaign";
import { has } from "@/lib/capabilities";
import { ErrorState, ForbiddenState, Notice } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Ltr } from "@/components/primitives/Ltr";

/**
 * The pixel configuration: what is set up, and what this screen deliberately
 * cannot show.
 *
 * ## A read-only report, and that is the whole design
 *
 * `GET /marketing/config` serves the *public* pixel id — the Conversions API
 * token appears in no response, ever — and `POST /marketing/events/purchase` is
 * the storefront's, not the panel's. So there is nothing here to edit and nothing
 * to send, and `lib/api/allowlist.ts` refuses every verb but `GET` deliberately.
 * Saying so is the screen's job: an operator looking for "where do I paste the
 * token" needs to be told it is not here rather than to hunt for a form.
 *
 * ## Its main state is a disabled integration
 *
 * Measured on this shop and on the one the panel is built against: `enabled:
 * false`, `providers: []`. That is not an edge case to design around — it is what
 * every reader will actually see — so the screen leads with it as a statement
 * rather than rendering an empty table under a green badge. The `Notice` says the
 * tracking is off and what it would take, **naming nothing that does not exist in
 * this panel**: there is no settings screen for it here, so the sentence points
 * at the shop's own configuration and stops.
 *
 * ## The five states, and the two that cannot exist
 *
 * `loading.tsx` is the first. The forbidden state is
 * `ac_manage_marketing` — reachable, and the run's third instance of a section
 * whose capability slug had no label until the content branch added it. The error
 * state is real: this route takes **no arguments at all** (`?per_page=1` and
 * `?zzz=1` are both a 200 with the identical object), so nothing the reader does
 * can provoke a 400, but a network failure or a 500 can and the retry is a
 * reload. There is no empty state and no stale marker: the payload is one object
 * that always exists, and this is a Server Component with no writes, nothing
 * polling and no refresh control — §3.7 as amended on the customers branch.
 */
export default async function MarketingConfigPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("campaigns");

  const header = (
    <PageHeader
      title={t("marketing.title")}
      back={{ href: `/${locale}/marketing`, label: t("hubTitle") }}
    />
  );

  if (!has(me, "ac_manage_marketing")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {header}
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_marketing" />
        </PageBody>
      </div>
    );
  }

  const config = await acFetch(marketingConfig, session, "/marketing/config").catch(
    (error: unknown) => {
      if (error instanceof ApiError) return null;
      throw error;
    },
  );

  if (config === null) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {header}
        <PageBody width="detail">
          {/* No `onRetry`: a Server Component cannot re-fetch itself, and a button
              that reloaded the page would be a reload wearing a retry's clothes.
              The navigation is the retry. */}
          <ErrorState message={t("marketing.unavailable")} />
        </PageBody>
      </div>
    );
  }

  const data = config.data;

  return (
    <div className="min-h-dvh bg-ui-canvas">
      {header}
      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          {/*
            The screen's actual state, first and in the reader's language. Not a
            `danger` tone: an unconfigured pixel is a choice a shop is entitled to
            have made, not a fault.
          */}
          {!data.enabled ? (
            <Notice tone="info" title={t("marketing.noPixel")}>
              <p className="text-ui-label">{t("marketing.disabledNote")}</p>
            </Notice>
          ) : null}

          <Card title={t("marketing.title")} footnote={t("marketing.tokenNote")}>
            <DataList>
              <DataRow label={t("marketing.trackingLabel")}>
                <Badge tone={data.enabled ? "success" : "neutral"}>
                  {data.enabled ? t("marketing.enabled") : t("marketing.disabled")}
                </Badge>
              </DataRow>
              <DataRow label={t("marketing.providers")}>
                {data.providers.length === 0 ? (
                  <span className="text-ui-muted">{t("marketing.noProviders")}</span>
                ) : (
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {data.providers.map((provider, index) => (
                      /* A provider is a vendor's own name — `Ltr`, never
                         translated. Nobody translates "Meta". */
                      <Ltr key={index} numeric={false} className="font-mono">
                        {String(provider)}
                      </Ltr>
                    ))}
                  </span>
                )}
              </DataRow>
            </DataList>
          </Card>

          {/*
            The two event lists, and the distinction is the point: the browser
            reports what a shopper did on the storefront and the server reports
            what it witnessed. An event name is a vendor identifier — `Ltr`, never
            translated — and the panel sends neither list, which is what the
            footnotes say.
          */}
          <Card title={t("marketing.browserEvents")} footnote={t("marketing.storefrontNote")}>
            <EventList events={data.browser_events} empty={t("marketing.noEvents")} />
          </Card>

          <Card title={t("marketing.serverEvents")} footnote={t("marketing.serverNote")}>
            <EventList events={data.server_events} empty={t("marketing.noEvents")} />
          </Card>
        </div>
      </PageBody>
    </div>
  );
}

/**
 * One list of event names.
 *
 * An empty list is stated rather than rendered as a blank row: a shop with the
 * integration off could legitimately report none, and an empty box would read as
 * a failed fetch.
 */
function EventList({ events, empty }: { events: string[]; empty: string }) {
  if (events.length === 0) {
    return <p className="text-ui-label text-ui-muted">{empty}</p>;
  }

  return (
    <ul className="flex flex-wrap gap-1.5">
      {events.map((event) => (
        <li
          key={event}
          className="rounded-ui-md border border-ui-line bg-ui-surface-2 px-2 py-0.5"
        >
          <Ltr numeric={false} className="font-mono text-ui-label text-ui-fg">
            {event}
          </Ltr>
        </li>
      ))}
    </ul>
  );
}
