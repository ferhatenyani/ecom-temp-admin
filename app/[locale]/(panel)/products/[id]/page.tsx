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
  type ProductCategory,
  type Variation,
} from "@/lib/api/schemas/product";
import { has } from "@/lib/capabilities";
import { Scaffold } from "@/components/patterns/Scaffold";
import { ForbiddenState } from "@/components/patterns/States";
import { ProductDetail } from "./ProductDetail";

/**
 * The product detail.
 *
 * **The form is built around the whole object, not a diff.** `docs/API.md` is
 * designed for it: read-only fields are dropped on write rather than refused, so
 * a GET body PATCHes back unchanged — verified against the live API, all 32 keys
 * of a product with an option set round-tripped with a 200. Diffing would buy
 * nothing and cost a whole class of partial-update bug.
 *
 * One measured exception, and it is the reason `ProductDetail` sends a named
 * subset rather than the literal GET body: **a PATCH containing only read-only
 * fields answers 400 `"No supported fields were provided."` with no `details` at
 * all.** So "drop what is read-only" cannot be the client's only rule — if it
 * drops everything, the request is refused with a message that names nothing and
 * the panel's own 400 handling has no field list to render.
 */
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const { session, me } = await requireSession(locale);
  const t = await getTranslations("products");

  if (!has(me, "ac_manage_products")) {
    return (
      <Scaffold
        title={t("title")}
        back={{ href: `/${locale}/products`, label: t("title") }}
      >
        <div className="px-4">
          <ForbiddenState capability="ac_manage_products" />
        </div>
      </Scaffold>
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
   * The sub-resources, in parallel, each failing alone — the same rule the order
   * detail follows. `null` means "this section could not load", which is
   * different from an empty array meaning "there is nothing here".
   *
   * Variations are fetched only for a variable product: measured, `GET
   * /products/{id}/variations` on a simple product answers 200 with `[]`, so the
   * request would work and simply be waste on 26 of 28 products.
   */
  const [variations, categories, attributes] = await Promise.all([
    product.variations.length > 0
      ? acFetch(variationList, session, `/products/${numericId}/variations?per_page=100`)
          .then((r) => r.data)
          .catch(() => null)
      : Promise.resolve([] as Variation[]),
    acFetch(productCategoriesSchema, session, "/product-categories?per_page=100")
      .then((r) => r.data)
      .catch(() => [] as ProductCategory[]),
    acFetch(globalAttributesSchema, session, "/attributes")
      .then((r) => r.data)
      .catch(() => [] as GlobalAttribute[]),
  ]);

  const termLists = await Promise.all(
    attributes.map((attribute) =>
      acFetch(
        attributeTermsSchema,
        session,
        `/attributes/${attribute.id}/terms?per_page=100`,
      )
        .then((r) => [attribute.taxonomy, r.data] as const)
        .catch(() => [attribute.taxonomy, [] as AttributeTerm[]] as const),
    ),
  );

  return (
    <ProductDetail
      locale={locale}
      product={product}
      variations={variations}
      categories={categories}
      attributes={attributes}
      terms={Object.fromEntries(termLists)}
    />
  );
}
