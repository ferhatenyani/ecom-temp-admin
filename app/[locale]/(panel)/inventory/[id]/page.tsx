import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { inventoryItem, movementList } from "@/lib/api/schemas/inventory";
import { has } from "@/lib/capabilities";
import { adjustTarget, itemLabel } from "@/lib/inventory";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { ButtonLink } from "@/components/ui/Button";
import { ItemDetail } from "./ItemDetail";
import { itemMovementsPath } from "./query";

/**
 * One item's stock.
 *
 * ## The ledger is read for the id that holds the shelf, not the one in the URL
 *
 * **This was a live defect and it is the first of the three this branch fixes.**
 * The seed below used to ask for `?product_id={id}` — the tapped id — and
 * `lib/inventory.ts:24-27` says exactly what that costs: `stock_managed_by_id` is
 * "the id the backend writes the *movement* against — `StockLedger::stockManagedId()`
 * — so a ledger filtered by the tapped id would come back empty while the stock
 * demonstrably moved."
 *
 * It was latent because every one of the 33 rows in this shop reports
 * `stock_managed_by_id === id`. Fixture 9032 does not: it is a variation
 * inheriting its parent's stock, its `manage_stock` is the string `"parent"`, and
 * its movements are recorded against 104. Opening it showed an empty ledger under
 * a card that says the quantity lives on the parent — two halves of the same
 * screen disagreeing about where the stock is.
 *
 * The request therefore waits on the item rather than going out beside it. That
 * is a real serialisation and it is unavoidable: `adjustTarget()` is a function of
 * the row, and the row has to arrive before anything can know which shelf to ask
 * about.
 *
 * ## `params` is a Promise in Next 16, like `searchParams` and `cookies()`.
 */
export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("inventory");

  if (!has(me, "ac_manage_inventory")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader
          title={t("title")}
          back={{ href: `/${locale}/inventory`, label: t("title") }}
          divided={false}
        />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_inventory" />
        </PageBody>
      </div>
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

  const target = adjustTarget(item.data);

  /**
   * This shelf's most recent movements, fetched here so first paint carries them.
   *
   * Its own failure, swallowed to `null`: the ledger is context under the two
   * things this screen is for, and a movements outage must not take the quantity
   * and the adjustment down with it. `null` (this section could not load) stays
   * distinct from `[]` (nothing has moved this shelf) — the order detail's
   * arrangement, and the second of the three defects this branch fixes, since one
   * `SectionError` used to serve both.
   */
  const movements = await acFetch(movementList, session, itemMovementsPath(target))
    .then((response) => response.data)
    .catch(() => null);

  const { product } = itemLabel(item.data);

  /**
   * When this render happened, for §3.7's stale marker.
   *
   * `react-hooks/purity` flags `Date.now()` in a component body and is right
   * about the client case it is written for; an async Server Component runs once
   * per request and never re-renders, so reading the clock here is part of the
   * fetch rather than part of the render. Recording it in a mount effect instead
   * gives an age that stops moving after `router.refresh()`, which re-renders the
   * server tree without remounting the client one.
   */
  // eslint-disable-next-line react-hooks/purity -- see above: a Server Component renders once per request.
  const fetchedAt = Date.now();

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        /* The record's own name. `PageHeader` puts `dir="auto"` on the heading,
           so a French product name in the Arabic panel resolves its own
           direction and the ellipsis lands at the name's end. */
        title={product}
        back={{ href: `/${locale}/inventory`, label: t("title") }}
        /* A detail page omits the rule and lets the first card do the
           separating — §2.4. */
        divided={false}
        /*
         * **The ledger, and not the adjustment.** §2.4 puts a detail screen's
         * action in the header because below `lg` the aside collapses beneath a
         * body whose length is the record's. The adjustment is deliberately not
         * that control: it is an inline card in the main column, because the 409
         * it can answer — "this product tracks no stock" — is fixed by the
         * settings card one section below it on this same screen, and an overlay
         * would put that fix behind a dismiss.
         *
         * Filtered to the id that holds the shelf, for the same reason the seed
         * above is.
         */
        actions={
          <ButtonLink
            href={`/${locale}/inventory/movements?product_id=${target}`}
            variant="secondary"
            icon="list"
          >
            {t("detail.allMovements")}
          </ButtonLink>
        }
      />

      <PageBody width="split">
        <ItemDetail
          locale={locale}
          initialItem={item.data}
          initialMovements={movements}
          fetchedAt={fetchedAt}
          meId={me?.id ?? null}
        />
      </PageBody>
    </div>
  );
}
