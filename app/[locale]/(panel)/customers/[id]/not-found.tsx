import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";

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
 *
 * `EmptyState` rather than `ErrorState`, and the difference is not cosmetic:
 * `ErrorState` opens with "something went wrong" and offers a retry, and neither
 * is true here. Nothing went wrong and there is nothing to retry. The way out is
 * the header's back link, which is rendered at every width.
 */
export default async function CustomerNotFound() {
  // A not-found boundary receives no params, so the locale comes from next-intl's
  // request scope rather than from a prop.
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "states" });
  const tCustomers = await getTranslations({ locale, namespace: "customers" });

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("notFoundTitle")}
        back={{ href: `/${locale}/customers`, label: tCustomers("title") }}
        divided={false}
      />
      <PageBody width="detail">
        <EmptyState icon="alert" message={tCustomers("notFound")} />
      </PageBody>
    </div>
  );
}
