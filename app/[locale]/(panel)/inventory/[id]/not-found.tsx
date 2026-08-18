import { getLocale, getTranslations } from "next-intl/server";
import { Scaffold } from "@/components/patterns/Scaffold";
import { Icon } from "@/components/primitives/Icon";

/**
 * A 404 on an inventory id, and it is a destination people will actually reach.
 *
 * The ledger names 155 distinct products and only 23 of them are still in
 * `/inventory` — the rest were created and deleted by the backend's own test
 * fixtures. Tapping a product id in the movements list is therefore a real path
 * to a product that no longer exists, which is why the ledger row renders an id
 * rather than pretending it can find a name, and why this screen is not a
 * defensive branch.
 */
export default async function InventoryItemNotFound() {
  // A not-found boundary receives no params, so the locale comes from next-intl's
  // request scope rather than from a prop.
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tInventory = await getTranslations({ locale, namespace: "inventory" });

  return (
    <Scaffold
      title={tInventory("title")}
      back={{ href: `/${locale}/inventory`, label: tInventory("title") }}
    >
      <div className="px-4">
        <div className="rounded-lg bg-surface px-6 py-12 text-center">
          <Icon name="alert" className="mx-auto size-8 text-label-tertiary" />
          <h2 className="mt-4 text-title-3 text-label">{t("notFoundTitle")}</h2>
          <p className="mt-2 text-body text-label-secondary">
            {tInventory("detail.notFound")}
          </p>
        </div>
      </div>
    </Scaffold>
  );
}
