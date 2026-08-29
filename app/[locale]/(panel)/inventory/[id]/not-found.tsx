import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";

/**
 * A 404 on an inventory id, and it is a destination people will actually reach.
 *
 * The ledger names 155 distinct products and only 23 of them are still in
 * `/inventory` — the rest were created and deleted by the backend's own test
 * fixtures. Tapping a product id in the movements list is therefore a real path
 * to a product that no longer exists, which is why the ledger row renders an id
 * rather than pretending it can find a name, and why this screen is not a
 * defensive branch.
 *
 * **It hand-rolled a `ui-card` with an `Icon` and an `<h2>` inside it** while the
 * other eight panel not-found files call `EmptyState`, which is the same box with
 * the same padding drawn twice. It is `EmptyState` now, and the heading survives
 * through the `title` slot the primitive gained on the login branch — `StateFrame`
 * had carried it all along and only `ErrorState` and `ForbiddenState` could reach
 * it. Nothing on screen moves.
 */
export default async function InventoryItemNotFound() {
  // A not-found boundary receives no params, so the locale comes from next-intl's
  // request scope rather than from a prop.
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tInventory = await getTranslations({ locale, namespace: "inventory" });

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={tInventory("title")}
        back={{ href: `/${locale}/inventory`, label: tInventory("title") }}
        divided={false}
      />
      <PageBody width="detail">
        <EmptyState
          icon="alert"
          title={t("notFoundTitle")}
          message={tInventory("detail.notFound")}
        />
      </PageBody>
    </div>
  );
}
