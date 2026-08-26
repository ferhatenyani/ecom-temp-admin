import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { listMeta } from "@/lib/api/envelope";
import {
  codStatistics as codStatisticsSchema,
  paymentMethods as methodsSchema,
  payments as paymentsSchema,
  type PaymentMethod,
} from "@/lib/api/schemas/payment";
import { has } from "@/lib/capabilities";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { CodFunnel } from "./CodFunnel";
import { PaymentsLedger } from "./PaymentsLedger";
import { listParams, queryFromParams } from "./query";

/**
 * The transactions ledger, and the COD funnel below it.
 *
 * **Two capabilities on one screen, and they are not the same readership.**
 * `/payments` is `ac_manage_payments` — the Super Admin tier alone after the
 * collapse — while `/cod/statistics` is `ac_view_analytics`, which every staff
 * account holds. Measured 2026-08-26: a Manager is 403 on `/payments`,
 * `/payments/methods` and `/payments/{id}` and 200 on `/cod/statistics`. So the
 * COD report renders for a reader who cannot see a single transaction on the same
 * page, which is the only place in the panel where that happens and the reason
 * this is one route with two sections rather than two routes.
 *
 * A Manager reaching this URL gets the forbidden state for payments and still
 * sees the COD figures, because refusing them a report they are entitled to in
 * order to keep one screen tidy would be the panel inventing a rule the API does
 * not have.
 *
 * A Server Component fetches page one with the sealed credential and streams it,
 * so first paint carries data — the arrangement orders, products, inventory,
 * customers, coupons and shipping all use.
 */
export default async function PaymentsPage({
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
  const t = await getTranslations("payments");

  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") incoming.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) incoming.set(key, value[0]);
  }

  const canPay = has(me, "ac_manage_payments");
  const canSeeStats = has(me, "ac_view_analytics");
  const query = queryFromParams(incoming);

  /*
   * Three reads in parallel, each failing alone.
   *
   * A failed **payments** page renders through the client's error state rather
   * than crashing the route, and the client retries against the same URL — which
   * is also what makes the empty state and the error state two different
   * sentences now. The methods list is chrome for the rows and the picker: a
   * label falls back to its own name, so its failure is not worth taking the
   * screen down for. The COD report is a whole section and is simply absent when
   * it fails, rather than replacing the ledger with a failure that is not the
   * ledger's.
   */
  const [initial, methodsResult, statistics] = await Promise.all([
    canPay
      ? acFetch(paymentsSchema, session, `/payments?${listParams(query)}`).catch(
          (error: unknown) => {
            if (error instanceof ApiError) return null;
            throw error;
          },
        )
      : Promise.resolve(null),
    canPay
      ? acFetch(methodsSchema, session, "/payments/methods")
          .then((r) => r.data)
          .catch(() => [] as PaymentMethod[])
      : Promise.resolve([] as PaymentMethod[]),
    canSeeStats
      ? acFetch(codStatisticsSchema, session, "/cod/statistics")
          .then((r) => r.data)
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const funnel =
    statistics === null ? null : <CodFunnel statistics={statistics} locale={locale} />;

  if (!canPay) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        {/* No subtitle, so `payments-count` is absent rather than reporting a
            total nobody was allowed to read. */}
        <PageHeader title={t("title")} />
        <PageBody width="full">
          <ForbiddenState capability="ac_manage_payments" />
          {/* Still rendered, and this is the whole argument for one route. */}
          {funnel ? <div className="mt-6">{funnel}</div> : null}
        </PageBody>
      </div>
    );
  }

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <PaymentsLedger
      locale={locale}
      initialQuery={query}
      initialPayments={initial === null ? null : initial.data}
      initialTotal={meta?.success ? meta.data.total : null}
      methods={methodsResult}
      funnel={funnel}
    />
  );
}
