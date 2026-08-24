import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { customerList } from "@/lib/api/schemas/customer";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { CustomersList } from "./CustomersList";
import { listParams, queryFromParams } from "./query";

/**
 * The customer list.
 *
 * A Server Component fetches the first page with the sealed credential and
 * streams it, so first paint carries data — the arrangement orders, products and
 * inventory all use.
 */
export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);

  /*
   * **The roles invert between this screen and coupons, and that is new.**
   *
   * Measured 2026-08-19 across all six panel roles:
   *
   *                        /customers   /coupons
   *   Super Admin             200         200
   *   Manager                 200         200
   *   Support Agent           200         403   ←
   *   Marketing Manager       403   ←     200
   *   Order Manager           200         403
   *   Product Manager         403         403
   *
   * A **Support Agent can read customers** — they hold `ac_manage_customers`,
   * which is the thinnest role in the system holding anything — so the ready-made
   * forbidden fixture from the last two branches does not work here. For this
   * screen the refused roles are Marketing Manager and Product Manager; for
   * coupons it is the Support Agent, and the Marketing Manager is the inverse.
   *
   * A 403 is a screen state, never a logout. Only a 401 clears the session.
   */
  if (!has(me, "ac_manage_customers")) {
    const t = await getTranslations("customers");
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {/* No subtitle, so `customers-count` is absent rather than reporting a
            total nobody was allowed to read. The suite asserts that. */}
        <PageHeader title={t("title")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_customers" />
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

  const initial = await acFetch(
    customerList,
    session,
    `/customers?${listParams(query)}`,
  ).catch((error: unknown) => {
    // A failed first page renders through the client's error state rather than
    // crashing the route; the client retries against the same URL.
    if (error instanceof ApiError) return null;
    throw error;
  });

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <CustomersList
      locale={locale}
      initialQuery={query}
      initialCustomers={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
    />
  );
}
