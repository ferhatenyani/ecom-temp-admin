import { getLocale, getTranslations } from "next-intl/server";
import { Scaffold } from "@/components/patterns/Scaffold";
import { Icon } from "@/components/primitives/Icon";

/**
 * A 404 on a product means gone — and here that is a real destination rather
 * than a defensive branch: `?force=true` removes permanently, and the next GET
 * of the same id answers 404. A trashed product does **not** land here; it reads
 * back with a 200 and `status: "trash"`, which the detail screen renders with a
 * banner rather than as an absence.
 */
export default async function ProductNotFound() {
  // A not-found boundary receives no params, so the locale comes from next-intl's
  // request scope rather than from a prop.
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tProducts = await getTranslations({ locale, namespace: "products" });

  return (
    <Scaffold
      title={tProducts("title")}
      back={{ href: `/${locale}/products`, label: tProducts("title") }}
    >
      <div className="px-4">
        <div className="rounded-lg bg-surface px-6 py-12 text-center">
          <Icon name="alert" className="mx-auto size-8 text-label-tertiary" />
          <h2 className="mt-4 text-title-3 text-label">{t("notFoundTitle")}</h2>
          <p className="mt-2 text-body text-label-secondary">
            {tProducts("detail.notFound")}
          </p>
        </div>
      </div>
    </Scaffold>
  );
}
