import { getLocale, getTranslations } from "next-intl/server";
import { Scaffold } from "@/components/patterns/Scaffold";
import { Icon } from "@/components/primitives/Icon";

/**
 * A 404 in the panel means gone. (On the storefront's `/account/orders/{id}` the
 * same status means "not yours" — a distinction worth keeping in mind when this
 * component is reused.)
 */
export default async function OrderNotFound() {
  // A not-found boundary receives no params, so the locale comes from next-intl's
  // request scope rather than from a prop.
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tDetail = await getTranslations({ locale, namespace: "orders.detail" });

  return (
    <Scaffold
      title={tDetail("back")}
      back={{ href: `/${locale}/orders`, label: tDetail("back") }}
    >
      <div className="px-4">
        <div className="rounded-lg bg-surface px-6 py-12 text-center">
          <Icon name="alert" className="mx-auto size-8 text-label-tertiary" />
          <h2 className="mt-4 text-title-3 text-label">{t("notFoundTitle")}</h2>
          <p className="mt-2 text-body text-label-secondary">{t("notFoundBody")}</p>
        </div>
      </div>
    </Scaffold>
  );
}
