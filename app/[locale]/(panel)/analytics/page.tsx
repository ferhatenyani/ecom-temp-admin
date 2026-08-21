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
import { analyticsParams } from "@/lib/analytics";
import { canSeeMoney, has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import type { Session } from "@/lib/session/seal";
import { AnalyticsScreen, type Loaded } from "./AnalyticsScreen";
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
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_view_analytics" />
        </div>
      </Scaffold>
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
  let failed: string | null = null;
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
       * A 400 lands here too, and on this endpoint it is usually the range: a
       * bad `range` answers `details.params.range`, a bad date answers
       * `details.fields.date_from`. Both are the API's own sentence and both are
       * actionable, so both are rendered rather than flattened into "something
       * went wrong".
       */
      const api = error instanceof ApiError ? error : null;
      failed =
        api?.params?.range ??
        api?.fields?.date_from ??
        api?.fields?.date_to ??
        api?.apiMessage ??
        null;
    }
  }

  return (
    <AnalyticsScreen
      locale={locale}
      query={query}
      loaded={loaded}
      forbidden={forbidden}
      failed={failed}
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
      generatedAt={typeof meta?.generated_at === "string" ? meta.generated_at : null}
    />
  );
}
