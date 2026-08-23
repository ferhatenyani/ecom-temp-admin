import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { orderList, wilayas as wilayasSchema, type Wilaya } from "@/lib/api/schemas/order";
import { canManageOrders } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { OrdersList } from "./OrdersList";
import { PER_PAGE, type OrdersQuery } from "./query";

/**
 * The orders list. The most-used screen in the panel.
 *
 * A Server Component fetches page one with the sealed credential and streams it,
 * so first paint carries data and there is no spinner on navigation. Everything
 * after this — filters, pagination, polling — belongs to TanStack Query on the
 * client.
 *
 * Rebuilt on the new design system — the first screen to be. See DESIGN.md.
 */
export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; search?: string }>;
}) {
  const { locale } = await params;
  const { status, search } = await searchParams;
  const { session, me } = await requireSession(locale);

  // Capabilities decide what renders, never what is permitted. A user who types
  // this URL without the capability gets a clean forbidden screen rather than a
  // broken one — and the route would refuse them anyway.
  if (!canManageOrders(me)) {
    const t = await getTranslations("orders");
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader title={t("title")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_orders" />
        </PageBody>
      </div>
    );
  }

  const query: OrdersQuery = {
    status: status ?? "",
    search: search ?? "",
    page: 1,
    perPage: PER_PAGE,
  };

  // The wilaya table is reference data — 69 rows, both scripts on each — and is
  // what turns a `state` of "16" into `Alger` or `الجزائر`.
  const [initial, geography] = await Promise.all([
    acFetch(orderList, session, "/orders", {
      query: { per_page: query.perPage, page: 1, status: query.status, search: query.search },
    }).catch((error: unknown) => {
      // A failed first page is rendered by the client's error state rather than
      // crashing the route; the client will retry against the same URL.
      if (error instanceof ApiError) return null;
      throw error;
    }),
    acFetch(wilayasSchema, session, "/locations/wilayas").catch(() => null),
  ]);

  const wilayaList: Wilaya[] = geography?.data ?? [];

  return (
    <OrdersList
      locale={locale}
      initialQuery={query}
      initialOrders={initial?.data ?? null}
      initialTotal={typeof initial?.meta?.total === "number" ? initial.meta.total : null}
      wilayas={wilayaList}
    />
  );
}
