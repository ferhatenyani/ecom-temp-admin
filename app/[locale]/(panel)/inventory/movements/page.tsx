import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { has } from "@/lib/capabilities";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { MovementsScreen } from "./MovementsScreen";

/**
 * The stock movement ledger, as its own route.
 *
 * `MovementsScreen` carries the argument for the split. What this file adds is
 * the two things only the server can supply: the capability gate, and the
 * signed-in id.
 *
 * **`meId` is the one piece of identity every role can read** — `/auth/me` is 200
 * for all of them — and it is what lets a row say "Vous" and what `?actor_id=` is
 * set to for "mes mouvements". It is not enough to name anybody else; see
 * `movementActor()` in lib/inventory.ts for the measurement that settles why.
 */
export default async function MovementsPage({
  params,
}: {
  /** `params` is a Promise in Next 16, like `searchParams` and `cookies()`. */
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { me } = await requireSession(locale);
  const t = await getTranslations("inventory");

  /*
   * The same gate as the stock list, and measured the same way: a Support Agent
   * holds no `ac_manage_inventory` and every route in this section answers 403
   * for them — `/inventory`, `/low-stock` and `/movements` alike. A 403 is a
   * screen state and never a logout.
   */
  if (!has(me, "ac_manage_inventory")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader
          title={t("ledger.title")}
          back={{ href: `/${locale}/inventory`, label: t("title") }}
          divided={false}
        />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_inventory" />
        </PageBody>
      </div>
    );
  }

  return <MovementsScreen locale={locale} meId={me?.id ?? null} />;
}
