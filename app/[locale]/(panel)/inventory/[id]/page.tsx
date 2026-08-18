import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { inventoryItem, movementList } from "@/lib/api/schemas/inventory";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ItemDetail } from "./ItemDetail";

/** `params` is a Promise in Next 16, like `searchParams` and `cookies()`. */
export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { session, me } = await requireSession(locale);

  if (!has(me, "ac_manage_inventory")) {
    const t = await getTranslations("inventory");
    return (
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_inventory" />
        </div>
      </Scaffold>
    );
  }

  // The route is `\d+` at the proxy and the API's own pattern; anything else
  // never reaches either.
  if (!/^\d+$/.test(id)) notFound();

  const item = await acFetch(inventoryItem, session, `/inventory/${id}`).catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    },
  );

  /**
   * This item's five most recent movements, fetched here so first paint carries
   * them.
   *
   * Its own failure, swallowed to `null`: the ledger is context under the two
   * things this screen is for, and a movements outage must not take the quantity
   * and the adjustment down with it.
   */
  const movements = await acFetch(
    movementList,
    session,
    `/inventory/movements?product_id=${id}&per_page=5`,
  )
    .then((r) => r.data)
    .catch(() => null);

  return (
    <ItemDetail
      locale={locale}
      initialItem={item.data}
      initialMovements={movements}
      meId={me.id}
    />
  );
}
