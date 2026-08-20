import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import {
  codStatistics as codStatisticsSchema,
  paymentMethods as methodsSchema,
  payments as paymentsSchema,
  type CodStatistics,
  type Payment,
  type PaymentMethod,
} from "@/lib/api/schemas/payment";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { PaymentsScreen } from "./PaymentsScreen";

/**
 * The transactions ledger, and the COD funnel beside it.
 *
 * **Two capabilities on one screen, and they are not the same readership.**
 * `/payments` is `ac_manage_payments` — the Super Admin tier alone after the
 * collapse — while `/cod/statistics` is `ac_view_analytics`, which every staff
 * account holds. So the COD card renders for a reader who cannot see a single
 * transaction on the same page, which is the only place on this branch where
 * that happens and the reason the two are separate sections rather than one.
 *
 * A Manager reaching this URL gets the forbidden state for payments and still
 * sees the COD figures, because refusing them a report they are entitled to in
 * order to keep one screen tidy would be the panel inventing a rule the API does
 * not have.
 */
export default async function PaymentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("payments");

  const canPay = has(me, "ac_manage_payments");
  const canSeeStats = has(me, "ac_view_analytics");

  const [paymentsResult, methodsResult, statisticsResult] = await Promise.all([
    canPay
      ? acFetch(paymentsSchema, session, "/payments", { query: { per_page: 20, page: 1 } })
          .then((r) => ({
            data: r.data,
            total: typeof r.meta?.total === "number" ? r.meta.total : 0,
          }))
          .catch(() => null)
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

  if (!canPay && !canSeeStats) {
    return (
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_payments" />
        </div>
      </Scaffold>
    );
  }

  return (
    <Scaffold title={t("title")}>
      <PaymentsScreen
        locale={locale}
        canPay={canPay}
        initialPayments={(paymentsResult?.data ?? []) as Payment[]}
        total={paymentsResult?.total ?? 0}
        paymentsFailed={canPay && paymentsResult === null}
        methods={methodsResult ?? []}
        statistics={(statisticsResult ?? null) as CodStatistics | null}
      />
    </Scaffold>
  );
}
