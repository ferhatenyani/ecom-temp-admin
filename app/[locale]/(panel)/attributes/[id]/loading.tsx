import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { CardSkeleton, FormSkeleton, Skeleton } from "@/components/ui/Skeleton";

/**
 * The route-level skeleton for one attribute.
 *
 * **Three cards, because the real screen is three** — the settings form, the
 * term list, the add-a-term form — and the order matters more than the count: a
 * placeholder that drew the list first would move the settings block down by a
 * card's height at the moment the data arrived.
 *
 * The settings shape is written out rather than counted. `FormSkeleton` takes a
 * list of field shapes and this form is not four identical boxes: two text
 * fields with hints, two `read` rows for the taxonomy and the type — which are
 * shown read-only and are not controls — then the sort select and the archive
 * switch. Passing `6` would draw six boxes and promise six controls, two of
 * which never arrive.
 *
 * The title is the section's rather than the attribute's: the name is what this
 * route is still fetching, and a skeleton that guessed it would be showing data
 * it does not have.
 */
export default async function AttributeLoading() {
  const t = await getTranslations("attributes");
  const label = t("loading");
  const locale = await getLocale();

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={t("title")}
        subtitle={label}
        back={{ href: `/${locale}/attributes`, label: t("back") }}
        actions={<Skeleton className="size-9 rounded-ui-md" />}
      />
      <PageBody width="detail">
        <div className="flex flex-col gap-4">
          <FormSkeleton
            fields={["hinted", "hinted", "read", "read", "hinted", "field"]}
            label={label}
          />
          <CardSkeleton rows={4} label={label} footnote={1} />
          <FormSkeleton fields={["hinted", "hinted"]} label={label} />
        </div>
      </PageBody>
    </div>
  );
}
