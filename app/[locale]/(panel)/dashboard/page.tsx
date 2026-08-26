import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { overviewReport } from "@/lib/api/schemas/analytics";
import { analyticsParams, customRangeProblem, rangeFromParams } from "@/lib/analytics";
import type { DashboardFailure } from "./DashboardScreen";
import { canSeeMoney, has } from "@/lib/capabilities";
import { PageBody, PageHeader } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { DashboardScreen } from "./DashboardScreen";

/**
 * The dashboard — **one request, not the six the specification lists.**
 *
 * ADMIN_PANEL.md names `/analytics/overview`, `/orders`, `/products`,
 * `/customers`, `/cod` and `/shipping` for this screen. Measured 2026-08-21: the
 * overview *nests* all of them. Its payload carries `orders` (with `by_status`),
 * `customers`, `cod`, `shipping`, `inventory` and `revenue` as blocks, and every
 * figure the spec's five cards need is in there. The other five routes would add
 * five round trips, five failure modes and five cache entries to re-fetch numbers
 * this one already returned.
 *
 * The only thing overview lacks is `best_sellers`, which is not a dashboard card
 * — it is the products report, and the card that leads there is a link.
 *
 * ## The refusal is read rather than discarded
 *
 * This used to end in `.catch(() => null)`, which threw away the status, the code
 * and the message before anything could render them — so a 400 on a malformed
 * custom window and a network failure produced the identical screen, and neither
 * said what had happened. Two of the three are now load-bearing:
 *
 *   **status** — a 403 is a forbidden state, not an error state. It cannot be
 *   reached through the panel's own controls (the capability is checked above
 *   before anything is fetched), but a capability revoked between the session
 *   read and this request lands here, and "you are not allowed" is a different
 *   sentence from "it failed".
 *
 *   **message** — because this route answers with **two different refusal
 *   shapes**: a bad `range` is `details.params.range` and a bad custom window is
 *   `details.fields.date_*`, with a different top-level sentence on each path.
 *   `apiMessage` alone is "The reporting range is invalid." and the useful half —
 *   "Required when range is custom." — is in the details.
 *
 * A bad `range` cannot arrive: `rangeFromParams` resolves an unknown preset to
 * the API's own default rather than forwarding it. A bad custom *window* can, by
 * URL, which is why the path is real rather than defensive.
 *
 * ## The sentence is the panel's own wherever the panel has one
 *
 * **A first draft rendered the API's English straight into a French and Arabic
 * screen** — "The reporting range is invalid. Required when range is custom." —
 * which is the fourth time this run has had to fix that class after the provider
 * labels, `unavailable` and `scope_note`. What the "surface the API's own
 * message" rule protects is the *information*, never the provider's English.
 *
 * All three refusals this route can make about a custom window are already
 * mirrored in `customRangeProblem()`, with localised copy the range control
 * renders while somebody is still typing. So the panel asks its own mirror which
 * refusal this is rather than parsing the API's sentence for it — the sentence is
 * prose that can be reworded upstream, the window is a fact. `ErrorState.detail`
 * stays the slot for genuinely foreign text and gets the API's own words only
 * when the mirror has no answer, which is exactly the `unavailableLines()` rule.
 */
export default async function DashboardPage({
  params,
  searchParams,
}: {
  /** A Promise in Next 16, like `searchParams` and `cookies()`. */
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("analytics");

  const refused = (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader title={t("dashboardTitle")} />
      <PageBody width="wide">
        <ForbiddenState capability="ac_view_analytics" />
      </PageBody>
    </div>
  );

  if (!has(me, "ac_view_analytics")) return refused;

  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") incoming.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) incoming.set(key, value[0]);
  }
  const range = rangeFromParams(incoming);

  let report = null;
  let generatedAt: string | null = null;
  let cacheTtl: number | null = null;
  let failure: DashboardFailure | null = null;

  try {
    const response = await acFetch(overviewReport, session, "/analytics/overview", {
      query: analyticsParams(range),
    });
    report = response.data;
    const meta = response.meta;
    generatedAt = typeof meta?.generated_at === "string" ? meta.generated_at : null;
    cacheTtl = typeof meta?.cache_ttl === "number" ? meta.cache_ttl : null;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 403) return refused;

      /*
       * Which refusal this is, asked of the panel's own mirror rather than of
       * the API's prose. It is consulted only when the API has said the refusal
       * is about the two dates — `details.fields` naming one of them — so an
       * unrelated 400 can never be answered with a sentence about a window.
       */
      const fields = error.fields;
      const aboutTheWindow =
        range.preset === "custom" &&
        fields !== null &&
        ("date_from" in fields || "date_to" in fields);

      const problem = aboutTheWindow ? customRangeProblem(range.from, range.to) : null;

      /* The API's own words only where the mirror has none — the top-level
         sentence plus whichever details shape this refusal used. `fields` and
         `params` are both guarded against the bare-array form, so neither can
         put parameter *names* on screen posing as messages. */
      failure = {
        problem,
        sentence:
          problem !== null
            ? null
            : [error.apiMessage, ...Object.values(fields ?? error.params ?? {})].join(" "),
      };
    }
    /* A `NetworkError` reaches the screen as the generic failure with a retry,
       which is the only useful thing to offer for it — it carries no sentence a
       shopkeeper can act on, only the base URL. */
  }

  return (
    <DashboardScreen
      locale={locale}
      range={range}
      report={report}
      canMoney={canSeeMoney(me)}
      capabilities={me.capabilities}
      generatedAt={generatedAt}
      cacheTtl={cacheTtl}
      failure={failure}
    />
  );
}
