import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/session/read";
import { acFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import {
  attributeTerms as attributeTermsSchema,
  globalAttributes as globalAttributesSchema,
  productCategories as productCategoriesSchema,
  productList,
  productListMeta,
  type AttributeTerm,
  type GlobalAttribute,
  type ProductCategory,
} from "@/lib/api/schemas/product";
import { has } from "@/lib/capabilities";
import { ForbiddenState } from "@/components/ui/States";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import { ProductsList } from "./ProductsList";
import { queryFromParams, toApiParams } from "./query";

/**
 * The products list.
 *
 * A Server Component fetches page one with the sealed credential and streams it,
 * so first paint carries data. Everything after — filters, facets, paging —
 * belongs to TanStack Query on the client.
 *
 * **The vocabularies are fetched here too, and they are the reason this page has
 * four requests rather than one.** A facet group omits its zero-count values, so
 * `meta.facets` is a set of counts and not a list of choices; the choices come
 * from `/product-categories` and `/attributes/{id}/terms`, which are unfiltered
 * and complete. Without them, selecting a category deletes every other category
 * from the filter sheet and the only way back out is the browser's back button —
 * the exact dead end docs/ADMIN_PANEL.md's facet rule exists to prevent.
 *
 * They are reference data — six categories and two attributes today — and they
 * change when someone edits an attribute, which is a different screen on a
 * different branch. So they are fetched once per navigation and handed to the
 * client, never refetched per filter change.
 */
export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const raw = await searchParams;
  const { session, me } = await requireSession(locale);

  // Capabilities decide what renders, never what is permitted. A Support Agent
  // who types this URL gets a clean forbidden screen; the route would refuse
  // them anyway, and measured, `GET /products` answers 403 for that role.
  if (!has(me, "ac_manage_products")) {
    const t = await getTranslations("products");
    return (
      <div className="min-h-dvh bg-ui-canvas">
        <PageHeader title={t("title")} />
        <PageBody width="detail">
          <ForbiddenState capability="ac_manage_products" />
        </PageBody>
      </div>
    );
  }

  // `searchParams` arrives as a record of string | string[]; the query model
  // speaks URLSearchParams, which is also what the client writes back.
  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") incoming.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) incoming.set(key, value[0]);
  }
  const query = queryFromParams(incoming);

  const [initial, categories, attributes] = await Promise.all([
    acFetch(productList, session, `/products?${toApiParams(query)}`).catch(
      (error: unknown) => {
        // A failed first page renders through the client's error state rather
        // than crashing the route; the client retries against the same URL.
        if (error instanceof ApiError) return null;
        throw error;
      },
    ),
    acFetch(productCategoriesSchema, session, "/product-categories?per_page=100")
      .then((r) => r.data)
      .catch(() => [] as ProductCategory[]),
    acFetch(globalAttributesSchema, session, "/attributes")
      .then((r) => r.data)
      .catch(() => [] as GlobalAttribute[]),
  ]);

  /**
   * Terms, one request per attribute.
   *
   * `GET /attributes` is unpaginated and omits usage — a shop has a handful —
   * and the terms live behind `/attributes/{id}/terms`, which is where the
   * zero-count values are. Measured: `pa_matiere` has six terms and the facet
   * reports five, because no product carries "Cuir".
   */
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

  const meta = initial?.meta ? productListMeta.safeParse(initial.meta) : null;

  return (
    <ProductsList
      locale={locale}
      initialQuery={query}
      initialProducts={initial?.data ?? null}
      initialTotal={meta?.success ? meta.data.total : null}
      initialFacets={meta?.success ? (meta.data.facets ?? null) : null}
      categories={categories}
      attributes={attributes}
      terms={Object.fromEntries(termLists)}
      /*
       * **A second capability on this screen, and it gates a control rather
       * than the screen.** The gate above is `ac_manage_products`; this is
       * `ac_manage_content`, which every `/media` route sits behind —
       * `MediaController::registerRoutes()` builds one guard for the upload, the
       * listing, the item and its usage.
       *
       * The two do not travel together. `Permissions\Capabilities::roles()`
       * gives `ac_manage_products` without `ac_manage_content` to **Manager**
       * and **Product Manager**, and `Users\UserRoles::assignable()` is
       * `[ac_super_admin, ac_manager]` — so the majority of the accounts this
       * shop can still create hold products and not content, and the media
       * picker inside the create drawer would answer 403 for exactly them.
       * `NewProductDrawer` degrades to an attachment-id field on this flag and
       * argues the whole thing.
       *
       * Resolved here rather than in the client because capabilities arrive
       * with the session: `has()` reads `/auth/me`'s list, which the server
       * already holds, and a client that asked again would spend a request to
       * learn something the page was rendered with.
       */
      canPickMedia={has(me, "ac_manage_content")}
    />
  );
}
