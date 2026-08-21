import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { has } from "@/lib/capabilities";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ForbiddenState } from "@/components/patterns/States";
import { PageForm } from "../[...path]/PageForm";

/**
 * Create, which is the edit form against an empty page.
 *
 * A static `new` segment beats the sibling catch-all in Next's route matching,
 * so this is reachable and `/content/pages/new` never resolves to a page whose
 * slug happens to be "new". A page actually called `new` is still addressable at
 * `/content/pages/new/…` only if it has a parent — a root page with that slug
 * would be shadowed, which is the one cost of this arrangement and is worth it
 * against making create a query parameter.
 */
export default async function NewContentPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { me } = await requireSession(locale);

  if (!has(me, "ac_manage_content")) {
    const t = await getTranslations("content");
    return (
      <Scaffold title={t("pages.newTitle")}>
        <div className="px-4">
          <ForbiddenState capability="ac_manage_content" />
        </div>
      </Scaffold>
    );
  }

  return <PageForm locale={locale} page={null} mode="create" />;
}
