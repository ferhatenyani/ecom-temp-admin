import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import {
  codReport,
  customersReport,
  ordersReport,
  productsReport,
  revenueReport,
  shippingReport,
} from "@/lib/api/schemas/analytics";
import { analyticsParams, customRangeProblem } from "@/lib/analytics";
import { canSeeMoney, has } from "@/lib/capabilities";
import { PageBody, PageHeader } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import type { Session } from "@/lib/session/seal";
import { AnalyticsScreen, type AnalyticsFailure, type Loaded } from "./AnalyticsScreen";
import { queryFromParams, VIEW_ROUTE, type View } from "./query";

/**
 * One view, one schema, one route — resolved by a switch rather than by indexing
 * a map of schemas.
 *
 * A `Record<View, ZodType>` looks tidier and does not typecheck: TypeScript
 * collapses the map's value to a union of six schema types, `acFetch` binds its
 * generic to whichever member comes first, and every other report is then a
 * mismatch. The switch keeps each call's schema concrete, which is also what
 * makes the `Loaded` union safe to build — a view cannot be paired with another
 * view's payload.
 */
async function read(
  view: View,
  session: Session,
  query: Record<string, string>,
): Promise<{ loaded: Loaded; meta: Record<string, unknown> | null }> {
  const path = VIEW_ROUTE[view];

  switch (view) {
    case "revenue": {
      const r = await acFetch(revenueReport, session, path, { query });
      return { loaded: { view, data: r.data }, meta: r.meta };
    }
    case "orders": {
      const r = await acFetch(ordersReport, session, path, { query });
      return { loaded: { view, data: r.data }, meta: r.meta };
    }
    case "products": {
      const r = await acFetch(productsReport, session, path, { query });
      return { loaded: { view, data: r.data }, meta: r.meta };
    }
    case "customers": {
      const r = await acFetch(customersReport, session, path, { query });
      return { loaded: { view, data: r.data }, meta: r.meta };
    }
    case "shipping": {
      const r = await acFetch(shippingReport, session, path, { query });
      return { loaded: { view, data: r.data }, meta: r.meta };
    }
    case "cod": {
      const r = await acFetch(codReport, session, path, { query });
      return { loaded: { view, data: r.data }, meta: r.meta };
    }
  }
}

/**
 * The six reports.
 *
 * One request per screen and no client refetch on top of it: **the API caches
 * server-side for 60 s** (`meta.cache_ttl`, and `AC_ANALYTICS_CACHE_TTL` behind
 * it), so a poll would spend the panel's rate-limit budget re-reading a cached
 * answer. The window is URL state, so changing it is a navigation and the server
 * fetches again — which is the only refresh this screen needs.
 *
 * The cache is keyed by capability, which had to be checked rather than assumed:
 * `docs/SECURITY_AUDIT.md` claims it, and a shared key would serve a money
 * payload to a caller who is refused one. Measured 2026-08-21 inside a single TTL
 * window and in both orders — a Super Admin and a caller without
 * `ac_manage_orders` each got their own answer, twice, and the Super Admin's
 * second call came back from cache with the money intact. The claim holds.
 */
export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("analytics");

  if (!has(me, "ac_view_analytics")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader title={t("title")} />
        <PageBody width="wide">
          <ForbiddenState capability="ac_view_analytics" />
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
  const search = analyticsParams(query.range);

  let loaded: Loaded | null = null;
  let forbidden: string | null = null;
  let failure: AnalyticsFailure | null = null;
  let meta: Record<string, unknown> | null = null;

  try {
    const response = await read(query.view, session, search);
    meta = response.meta;
    loaded = response.loaded;
  } catch (error) {
    if (error instanceof ApiError && error.isForbidden) {
      /*
       * Only `/analytics/revenue` can reach this, and it is the money gate
       * arriving as the API enforces it. **The capability it names comes off the
       * response** — `meta.money_requires`, `"ac_manage_orders"`, which is not in
       * the specification — and not out of a constant here, the same discipline
       * as rendering a 409's `allowed` list rather than the panel's own idea of
       * which moves are legal.
       *
       * A 403 body carries no `meta`, so the fallback is `canSeeMoney()`'s own
       * capability. That is the panel guessing, and it only ever runs when the
       * server declined to say.
       */
      forbidden = "ac_manage_orders";
    } else {
      /*
       * A 400 lands here too, and on this endpoint it is about the window: a bad
       * `range` answers `details.params.range`, a bad custom date answers
       * `details.fields.date_from`, with a different top-level sentence on each
       * path.
       *
       * **The sentence rendered is the panel's own wherever the panel has one**,
       * which is the dashboard branch's correction arriving here. A first draft
       * of that screen put the API's English — "The reporting range is invalid.
       * Required when range is custom." — straight into a French and Arabic
       * panel, and this screen has been doing exactly that since it shipped. What
       * "surface the API's own message" protects is the *information*, never the
       * provider's English, and all three refusals this route makes about a
       * custom window are already mirrored in `customRangeProblem()` with
       * localised copy the range control renders while somebody is still typing.
       *
       * So the panel asks its own mirror which refusal this is rather than
       * parsing the API's prose for it — a sentence can be reworded upstream, a
       * window is a fact — and consults it only when `details.fields` names one
       * of the two dates, so an unrelated 400 can never be answered with a
       * sentence about a window. `ErrorState.detail` keeps the API's own words
       * for everything else, which is exactly `unavailableLines()`'s rule.
       *
       * A bad `range` cannot arrive: `rangeFromParams` resolves an unknown preset
       * to the API's own default rather than forwarding it. A bad custom
       * *window* can, by URL, which is why the path is real rather than
       * defensive.
       */
      const api = error instanceof ApiError ? error : null;
      const fields = api?.fields ?? null;
      const aboutTheWindow =
        query.range.preset === "custom" &&
        fields !== null &&
        ("date_from" in fields || "date_to" in fields);

      const problem = aboutTheWindow
        ? customRangeProblem(query.range.from, query.range.to)
        : null;

      failure = {
        problem,
        sentence:
          problem !== null || api === null
            ? null
            : [api.apiMessage, ...Object.values(fields ?? api.params ?? {})].join(" "),
      };
    }
    /* A `NetworkError` reaches the screen as the generic failure with a retry,
       which is the only useful thing to offer for it — it carries no sentence a
       shopkeeper can act on, only the base URL. */
  }

  return (
    <AnalyticsScreen
      locale={locale}
      query={query}
      loaded={loaded}
      forbidden={forbidden}
      failure={failure}
      /*
       * `canSeeMoney(me)` decides what the screen lays out; the *presence* of a
       * money field decides what it prints. The two agree on this install and the
       * response is the authority when they ever do not — which is why both
       * travel rather than one being derived from the other.
       */
      canMoney={canSeeMoney(me)}
      moneyVisible={meta?.money_visible === true}
      moneyRequires={
        typeof meta?.money_requires === "string" ? meta.money_requires : null
      }
      capabilities={me.capabilities}
      generatedAt={typeof meta?.generated_at === "string" ? meta.generated_at : null}
      /* Read at last. It is why the stamp above it may be behind the navigation:
         the report sits behind a 60-second server cache, and the API publishes
         both halves of that fact. */
      cacheTtl={typeof meta?.cache_ttl === "number" ? meta.cache_ttl : null}
    />
  );
}
