import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { inventoryList } from "@/lib/api/schemas/inventory";
import { listMeta } from "@/lib/api/envelope";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/patterns/States";
import { Scaffold } from "@/components/patterns/Scaffold";
import { InventoryScreen } from "./InventoryScreen";
import { lowStockParams, queryFromParams, stockParams } from "./query";

/**
 * The inventory section.
 *
 * A Server Component fetches the first page with the sealed credential and
 * streams it, so first paint carries data — the same arrangement orders and
 * products use. Everything after belongs to TanStack Query on the client.
 *
 * The ledger is deliberately **not** prefetched here. The screen opens on low
 * stock, and paying for 20 movement rows plus a summary on every visit to a
 * screen that shows neither is two requests against a 600/min budget shared
 * across every tab this person has open.
 */
export default async function InventoryPage({
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
    const t = await getTranslations("inventory");
    return (
      <Scaffold title={t("title")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_inventory" />
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

  const initial =
    query.view === "moves"
      ? null
      : await acFetch(
          inventoryList,
          session,
          query.view === "low"
            ? `/inventory/low-stock?${lowStockParams(query)}`
            : `/inventory?${stockParams(query)}`,
        ).catch((error: unknown) => {
          // A failed first page renders through the client's error state rather
          // than crashing the route; the client retries against the same URL.
          if (error instanceof ApiError) return null;
          throw error;
        });

  const meta = initial?.meta ? listMeta.safeParse(initial.meta) : null;

  return (
    <InventoryScreen
      locale={locale}
      initialQuery={query}
      initialItems={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
      /*
       * The signed-in id, which is the one piece of identity every role can read
       * — `/auth/me` is 200 for all of them. It is what lets a ledger row say
       * "Vous" and what `?actor_id=` is set to for "mes mouvements". It is not
       * enough to name anybody else; see `movementActor()`.
       */
      meId={me?.id ?? null}
    />
  );
}
