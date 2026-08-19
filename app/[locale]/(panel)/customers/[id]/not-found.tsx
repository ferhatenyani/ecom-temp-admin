import { getLocale, getTranslations } from "next-intl/server";
import { Scaffold } from "@/components/patterns/Scaffold";
import { Icon } from "@/components/primitives/Icon";

/**
 * A 404 on a customer id.
 *
 * Reachable two ways, and one of them is a security property rather than a
 * mistake: **a staff id answers 404 here.** `GET /customers/1` — the
 * administrator — is `404 "No customer with that id."`, because the repository
 * filters on `role: customer`. So typing a user id into this URL lands on this
 * screen instead of disclosing whether that account exists, which is the answer
 * an id-guessing probe wants. The other way is the ordinary one: a customer
 * deleted since the list was rendered.
 */
export default async function CustomerNotFound() {
  // A not-found boundary receives no params, so the locale comes from next-intl's
  // request scope rather than from a prop.
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tCustomers = await getTranslations({ locale, namespace: "customers" });

  return (
    <Scaffold
      title={tCustomers("title")}
      back={{ href: `/${locale}/customers`, label: tCustomers("title") }}
    >
      <div className="px-4">
        <div className="rounded-lg bg-surface px-6 py-12 text-center">
          <Icon name="alert" className="mx-auto size-8 text-label-tertiary" />
          <h2 className="mt-4 text-title-3 text-label">{t("notFoundTitle")}</h2>
          <p className="mt-2 text-body text-label-secondary">{tCustomers("notFound")}</p>
        </div>
      </div>
    </Scaffold>
  );
}
