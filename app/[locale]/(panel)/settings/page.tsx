import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { settings as settingsSchema, type Settings } from "@/lib/api/schemas/settings";
import { canManageSettings } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { SettingsForm } from "./SettingsForm";

/**
 * The shop's own configuration — `ac_manage_settings`, **Super Admin alone**.
 *
 * Measured 2026-08-21: a Manager holding ten other management capabilities is
 * **403 on both verbs**. ADMIN_PANEL.md calls that the boundary that stops an
 * Admin escalating, and asks that the forbidden state name Super Admin rather
 * than the capability string — which `ForbiddenState` already does through
 * `states.capability.*`.
 *
 * ## The refusal is no longer discarded, which is DECISIONS.md §11's defect
 *
 * This read ended in `.catch(() => null)` for **any** `ApiError`, so a 403 the
 * capability check had not predicted rendered as *"Les réglages n'ont pas pu être
 * lus."* — an error state where the forbidden state belongs, with no retry and no
 * capability named. That is exactly the dashboard's shape and it is fixed the
 * same way: **status decides which state**, and the message travels to the one
 * that can use it.
 *
 * The gate above is for *rendering*; this is the authority. Both exist because
 * `me.capabilities` is what the session was minted with and the API is what is
 * true now — a capability revoked mid-session passes the first and fails the
 * second, and the reader is entitled to the honest screen either way.
 *
 * A `NetworkError` carries no HTTP status and no sentence a shopkeeper can act
 * on, only a base URL, so it reaches the screen as `failure: null` — the generic
 * error state with its retry, which is the only useful thing to offer for it.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("settings");

  const refused = (
    <div className="min-h-dvh bg-ui-canvas">
      {/* No back link: settings is a top-level nav route, not a detail screen.
          `divided={false}` because this is a form page and the first card closes
          the header block — §2.4. */}
      <PageHeader title={t("title")} divided={false} />
      <PageBody width="form">
        <ForbiddenState capability="ac_manage_settings" />
      </PageBody>
    </div>
  );

  if (!canManageSettings(me)) return refused;

  let document: Settings | null = null;
  let failure: string | null = null;

  try {
    const response = await acFetch(settingsSchema, session, "/settings");
    document = response.data;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 403) return refused;

      /*
       * The API's own sentence, in `ErrorState.detail` rather than in place of
       * the panel's line. This route has no refusal the panel mirrors — unlike
       * the dashboard's three about a custom window — so there is nothing to ask
       * a mirror about, and `detail` is §3.7-4's slot for genuinely foreign text.
       */
      failure = error.apiMessage;
    }
  }

  /**
   * When this render happened, for §3.7's fifth state.
   *
   * `react-hooks/purity` flags reading the clock in a component body and is right
   * about the client case it is written for; an async Server Component runs once
   * per request and never re-renders, so this is part of the fetch rather than
   * part of the render — the same note the coupon, product and order details
   * carry.
   */
  // eslint-disable-next-line react-hooks/purity -- see above: a Server Component renders once per request.
  const fetchedAt = Date.now();

  return (
    <SettingsForm
      locale={locale}
      initial={document}
      failure={failure}
      fetchedAt={fetchedAt}
    />
  );
}
