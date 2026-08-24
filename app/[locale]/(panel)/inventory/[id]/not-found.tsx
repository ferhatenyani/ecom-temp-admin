import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
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
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={tInventory("title")}
        back={{ href: `/${locale}/inventory`, label: tInventory("title") }}
        divided={false}
      />
      <PageBody width="detail">
        <div className="ui-card flex flex-col items-center px-6 py-12 text-center">
          <Icon name="alert" className="size-6 text-ui-subtle" />
          <h2 className="mt-3 text-ui-subheading text-ui-fg">{t("notFoundTitle")}</h2>
          <p className="mt-1.5 max-w-96 text-ui-body text-ui-muted">
            {tInventory("detail.notFound")}
          </p>
        </div>
      </PageBody>
    </div>
  );
}
