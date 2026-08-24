import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { inventoryList } from "@/lib/api/schemas/inventory";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { InventoryList } from "./InventoryList";
import { lowStockParams, queryFromParams, stockParams } from "./query";

/**
 * The stock list.
 *
 * A Server Component fetches the first page with the sealed credential and
 * streams it, so first paint carries data — the same arrangement orders,
 * products and customers use. Everything after belongs to TanStack Query on the
 * client.
 *
 * The ledger is a route of its own now (`/inventory/movements`) rather than a
 * third view of this one, so the question of whether to prefetch it here does
 * not arise: nothing on this screen shows a movement.
 */
export default async function InventoryPage({
  params,
  searchParams,
}: {
  /** `params` is a Promise in Next 16, like `searchParams` and `cookies()`. */
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("inventory");

  /*
   * Capabilities decide what renders, never what is permitted.
   *
   * `ac_manage_inventory` is held by Super Admin, Admin, Manager and Product
   * Manager — and not by Support Agent or Order Manager. Measured: a Support
   * Agent's credential answers 403 on every route in this section, so this screen
   * is what that person sees instead of a page of failed requests. The route
   * would refuse them regardless; this is the difference between a clean refusal
   * and a broken screen.
   */
  if (!has(me, "ac_manage_inventory")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader title={t("title")} divided={false} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_inventory" />
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
    inventoryList,
    session,
    query.view === "low"
      ? `/inventory/low-stock?${lowStockParams(query)}`
      : `/inventory?${stockParams(query)}`,
  ).catch((error: unknown) => {
    // A failed first page renders through the client's error state rather than
    // crashing the route; the client retries against the same URL.
    if (error instanceof ApiError) return null;
    throw error;
  });

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <InventoryList
      locale={locale}
      initialQuery={query}
      initialItems={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
    />
  );
}
