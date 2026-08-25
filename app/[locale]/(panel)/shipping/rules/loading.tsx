import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { DetailGrid } from "@/components/ui/Detail";
import { CardSkeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for the tariff.
 *
 * It draws the **split**, which is the whole reason this is worth having rather
 * than a spinner: the real screen is a rules card beside a resolver card, and a
 * single-column placeholder would throw the aside down the page and then pull it
 * back up the moment the data landed. `DetailGrid` is the same primitive the real
 * screen uses, so the two collapse identically at `lg`.
 *
 * **Three rows in the rules card**, because this shop's tariff is three rules —
 * national, wilaya, commune — and the seed is what a first visit gets.
 *
 * **Two rows in the resolver**, because that is its resting shape: two pickers
 * and nothing else. Its answer block does not exist until a destination is
 * chosen, so a placeholder drawing one would promise content the loaded screen
 * does not show.
 */
export default async function ShippingRulesLoading() {
  const t = await getTranslations("shipping");
  const label = t("loading");
  /* `loading.tsx` takes no props, and the back link is 28px of header the real
     screen renders at every width — omitting it here would settle the whole page
     upward the moment the data arrived. `getLocale()` is how a file with no
     `params` addresses a localised route. */
  const locale = await getLocale();

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("rulesTitle")}
        subtitle={label}
        back={{ href: `/${locale}/shipping`, label: t("title") }}
      />
      <PageBody width="split">
        <DetailGrid
          main={<CardSkeleton rows={3} label={label} />}
          aside={<CardSkeleton rows={2} label={label} />}
        />
      </PageBody>
    </div>
  );
}
