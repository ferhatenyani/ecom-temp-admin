import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import {
  attributeTerms as attributeTermsSchema,
  globalAttributes as globalAttributesSchema,
  product as productSchema,
  productCategories as productCategoriesSchema,
  variationList,
  type AttributeTerm,
  type GlobalAttribute,
  type Variation,
} from "@/lib/api/schemas/product";
import { has } from "@/lib/capabilities";
import { formatWhen } from "@/lib/format/date";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ForbiddenState } from "@/components/ui/States";
import { Isolate } from "@/components/primitives/Ltr";
import { ProductDetail } from "./ProductDetail";
import { DeleteAction } from "./DeleteAction";

/** Shared by the "no global attribute" and the "could not load" branches. */
const EMPTY_VOCABULARY: {
  attributes: GlobalAttribute[];
  terms: Record<string, AttributeTerm[]>;
} = { attributes: [], terms: {} };

/**
 * The product detail — the panel's only real editing surface, on the new system.
 *
 * ## One screen, not two
 *
 * An **editable detail on `DetailGrid`**, not a 640px form. §2.3's "Form, 640px"
 * row names settings, a coupon and a user: pages that are *only* a form. A
 * product is a record with an unboundedly-growing main body — descriptions,
 * attributes, a variation list — beside a fixed block of reference material, which
 * is the two-column detail shape, and the peek drawer on the list already covers
 * the glanceable half. Main carries identity, pricing, inventory, descriptions,
 * SEO and the two read-only sections; the aside carries status, visibility,
 * categories and the record's dates.
 *
 * ## The write path is a named subset, not the GET body
 *
 * `docs/API.md` is designed for a whole-object PATCH: read-only fields are
 * dropped on write rather than refused, so a GET body round-trips — verified
 * against the live API, all 32 keys of a product with an option set answered 200.
 *
 * One measured exception, and it is why `ProductDetail` sends a **named subset**:
 * a PATCH containing only read-only fields answers 400 `"No supported fields were
 * provided."` **with no `details` at all**. So "drop what is read-only" cannot be
 * the client's only rule — the day the API marks one more field read-only, a
 * subtract-what-is-read-only client sends an empty write and renders an error
 * naming nothing.
 *
 * ## The fetch wave
 *
 * Sub-resources in parallel, each failing alone, with `null` ("this section could
 * not load") distinct from `[]` ("there is nothing here") — the rule the order
 * detail follows.
 *
 * **The attribute-terms requests are folded into the same wave**, and the vocabulary
 * is not fetched at all unless this product carries a *global* attribute. Both are
 * corrections to the screen this replaces, which fired `/attributes` in the first
 * wave and then awaited one `/attributes/{id}/terms` per attribute in a second —
 * an extra round-trip wave on every render, including the 26 simple products and
 * the two variable ones, none of which read a term list at all:
 * `describeAttribute` and `variationLabel` consult `terms` only for an attribute
 * with `id !== 0`, and a local attribute's options are already human strings.
 * Per-section failure isolation survives intact — the outer `catch` covers
 * `/attributes` itself and each term list still catches alone, so one dead
 * taxonomy costs its own labels and nothing else.
 */
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("products");

  const back = { href: `/${locale}/products`, label: t("title") };

  if (!has(me, "ac_manage_products")) {
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader title={t("title")} back={back} divided={false} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_products" />
        </PageBody>
      </div>
    );
  }

  const numericId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) notFound();

  let product;
  try {
    product = (await acFetch(productSchema, session, `/products/${numericId}`)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  /**
   * True when a term list would actually be read. A local attribute (`id: 0`)
   * carries free strings rather than slugs and has no shared vocabulary at all,
   * so the 26 simple products *and* the two variable ones need none of this.
   */
  const needsVocabulary = product.attributes.some((attribute) => attribute.id !== 0);

  const [variations, categories, vocabulary] = await Promise.all([
    /*
     * Only for a variable product: measured, `GET /products/{id}/variations` on a
     * simple product answers 200 with `[]`, so the request would work and simply
     * be waste on 26 of 28 products.
     */
    product.variations.length > 0
      ? acFetch(variationList, session, `/products/${numericId}/variations?per_page=100`)
          .then((r) => r.data)
          .catch(() => null)
      : Promise.resolve([] as Variation[]),

    /*
     * `null` on failure rather than `[]`, and that changed with this branch
     * because the categories *changed*: they are a writable multi-select now, and
     * an empty vocabulary rendered as a list of unticked boxes is a control that
     * invites someone to save a product with no categories at all. Failed and
     * empty have to be told apart before either is drawn.
     */
    acFetch(productCategoriesSchema, session, "/product-categories?per_page=100")
      .then((r) => r.data)
      .catch(() => null),

    /*
     * The definitions and their terms as one unit, so the second request wave runs
     * beside the two above instead of after them. The terms genuinely depend on
     * the ids, so there are still two hops — but they are two hops inside one
     * branch of the `Promise.all` rather than two waves across the whole page.
     *
     * A failure here degrades to printing the stored value — `pa_matiere`, and a
     * term slug — which is information rather than an absence, so this is `[]`/`{}`
     * and not a `null` the section would have to render as a hole.
     */
    needsVocabulary
      ? acFetch(globalAttributesSchema, session, "/attributes")
          .then(async (r) => {
            const attributes = r.data;
            const termLists = await Promise.all(
              attributes.map((attribute) =>
                acFetch(
                  attributeTermsSchema,
                  session,
                  `/attributes/${attribute.id}/terms?per_page=100`,
                )
                  .then((terms) => [attribute.taxonomy, terms.data] as const)
                  .catch(() => [attribute.taxonomy, [] as AttributeTerm[]] as const),
              ),
            );
            return { attributes, terms: Object.fromEntries(termLists) };
          })
          .catch(() => EMPTY_VOCABULARY)
      : Promise.resolve(EMPTY_VOCABULARY),
  ]);

  /**
   * When this render happened, for §3.7's stale marker.
   *
   * The same reasoning the order detail records: this is a Server Component, so
   * the age of what is on screen is the age of *this* render. `react-hooks/purity`
   * flags `Date.now()` in a component body and is right about the client case it
   * is written for; an async Server Component runs once per request and never
   * re-renders, so reading the clock here is part of the fetch rather than part of
   * the render. Recording it in a mount effect instead gives an age that stops
   * moving after `router.refresh()`, which re-renders the server tree without
   * remounting the client one.
   */
  // eslint-disable-next-line react-hooks/purity -- see above: a Server Component renders once per request.
  const fetchedAt = Date.now();

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={product.name}
        subtitle={
          <Isolate>{formatWhen(product.date_modified, locale)}</Isolate>
        }
        back={back}
        /* A detail page omits the rule and lets the first card do the
           separating — §2.4. */
        divided={false}
        /*
         * **Delete is here, in a `Menu`, and the save is not.** §2.4 puts a detail
         * screen's action in the header because below `lg` the aside drops beneath
         * a body whose length is the record's. The save is the documented
         * exception: §3.4 legislates a long form's save as a sticky bar that
         * appears only when the form is dirty, and the header rule is about a
         * control acting on the record's *state*, which a save is not.
         */
        actions={
          <DeleteAction productId={product.id} locale={locale} name={product.name} />
        }
      />

      <PageBody width="split">
        <ProductDetail
          locale={locale}
          product={product}
          fetchedAt={fetchedAt}
          variations={variations}
          categories={categories}
          attributes={vocabulary.attributes}
          terms={vocabulary.terms}
        />
      </PageBody>
    </div>
  );
}
