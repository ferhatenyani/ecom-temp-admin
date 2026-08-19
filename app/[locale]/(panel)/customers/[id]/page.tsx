import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { customerDetail } from "@/lib/api/schemas/customer";
import { canSeeMoney, has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { SHOP_CURRENCY } from "@/lib/format/money";
import { CustomerDetail } from "./CustomerDetail";

/** `params` is a Promise in Next 16, like `searchParams` and `cookies()`. */
export default async function CustomerPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { session, me } = await requireSession(locale);

  if (!has(me, "ac_manage_customers")) {
    const t = await getTranslations("customers");
    return (
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_customers" />
        </div>
      </Scaffold>
    );
  }

  // The route is `\d+` at the proxy and in the API's own pattern; anything else
  // never reaches either.
  if (!/^\d+$/.test(id)) notFound();

  /*
   * A staff id here is a 404, not a leak. `GET /customers/1` — the administrator —
   * answers `404 "No customer with that id."`, because the repository filters on
   * `role: customer`; all 16 rows in the list are customers and there is no
   * parameter that widens it (`?role=administrator` is ignored with a 200 and the
   * same 16 rows). Staff accounts are §87's `/users`, on a different branch.
   */
  const customer = await acFetch(customerDetail, session, `/customers/${id}`).catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    },
  );

  return (
    <CustomerDetail
      locale={locale}
      customer={customer.data}
      currency={SHOP_CURRENCY}
      /*
       * **The money gate is the panel's decision, not the API's.**
       *
       * Measured 2026-08-19: a Support Agent reads `total_revenue: "2100.00"` from
       * this endpoint with a 200. The API does not gate it, so showing it would
       * have been defensible and doing nothing would have been the default.
       *
       * It is gated anyway, and here is the reasoning. `canSeeMoney()` is a
       * compound rule — `ac_view_analytics` **and** `ac_manage_orders` — and every
       * one of the six panel roles holds the first, so the rule turns entirely on
       * the second. Of the four roles that can read a customer, the three that can
       * also read orders pass; the Support Agent alone fails. That is not an
       * accident of capability naming: a Support Agent cannot open a single one of
       * this customer's orders, so a lifetime-revenue figure would be the only
       * money in the panel they can see and the only one they cannot check.
       *
       * The counts, the status breakdown and both order links stay — they are what
       * a support call actually needs — so the card degrades to a narrower report
       * rather than to an empty box.
       */
      canSeeMoney={canSeeMoney(me)}
    />
  );
}
