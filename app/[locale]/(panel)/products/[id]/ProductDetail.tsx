"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type {
  AttributeTerm,
  GlobalAttribute,
  Product,
  ProductCategory,
  Variation,
} from "@/lib/api/schemas/product";
import {
  CATALOG_VISIBILITIES,
  PRODUCT_STATUSES,
  PRODUCT_STATUS_TONE,
  PRODUCT_TYPES,
  STOCK_STATUSES,
  STOCK_TONE,
  type ProductStatus,
  type ReadableStatus,
  type StockStatus,
} from "@/lib/product-status";
import { describeAttribute, priceSpan, variationLabel } from "@/lib/products";
import { formatMoney } from "@/lib/format/money";
import { formatWhen } from "@/lib/format/date";
import { Scaffold } from "@/components/patterns/Scaffold";
import { SectionError } from "@/components/patterns/States";
import { ListGroup, ListRow, ListValueRow } from "@/components/primitives/GroupedList";
import {
  DecimalField,
  ReadOnlyField,
  SelectField,
  SwitchField,
  TextAreaField,
  TextField,
} from "@/components/primitives/Field";
import { Button } from "@/components/primitives/Button";
import { StatusBadge, Dot } from "@/components/primitives/StatusBadge";
import { Ltr } from "@/components/primitives/Ltr";
import { Icon } from "@/components/primitives/Icon";
import { useToast } from "@/components/primitives/Toast";
import { DeleteAction } from "./DeleteAction";

/**
 * The fields the panel writes.
 *
 * Named explicitly rather than derived by dropping known-read-only keys from the
 * GET body, for a measured reason: a PATCH whose every key is read-only answers
 * **400 `"No supported fields were provided."` with no `details`**, so a
 * subtract-what-is-read-only rule fails silently the day the API marks one more
 * field read-only — the panel would send an empty write and render an error with
 * nothing in it. An explicit list cannot do that.
 *
 * Measured writable, one field at a time, against the live API: `name`, `slug`,
 * `type`, `status`, `featured`, `catalog_visibility`, `sku`, `description`,
 * `short_description`, `regular_price`, `sale_price`, `manage_stock`,
 * `stock_quantity`, `stock_status`, `weight`, `category_ids`, `seo`, `options`,
 * `attributes`, `tag_ids`, `image_id`, `gallery_image_ids`.
 *
 * Measured **dropped**: `price`, `on_sale`, `permalink`, `image`, `gallery`,
 * `variations`, `id`, `date_created`, `date_modified`, `bundle`,
 * `options_problems`.
 *
 * `attributes` is deliberately absent from what this form sends, and that is a
 * correctness decision rather than a scope one: replacing a variable product's
 * attribute list drops its *variation* attribute, and WooCommerce then clears
 * every variation's attribute map — measured on products 12 and 21, whose three
 * and two variations came back with `attributes: {}` and could no longer be told
 * apart. Editing attributes belongs with the attributes screen, which can build
 * the whole list rather than a partial one.
 */
type Draft = {
  name: string;
  slug: string;
  status: ProductStatus;
  type: string;
  sku: string;
  featured: boolean;
  catalog_visibility: string;
  short_description: string;
  description: string;
  regular_price: string;
  sale_price: string;
  manage_stock: boolean;
  stock_quantity: string;
  stock_status: string;
  weight: string;
  category_ids: number[];
};

function draftOf(product: Product): Draft {
  return {
    name: product.name,
    slug: product.slug,
    status: (product.status === "trash" ? "draft" : product.status) as ProductStatus,
    type: product.type,
    sku: product.sku,
    featured: product.featured,
    catalog_visibility: product.catalog_visibility,
    short_description: product.short_description,
    description: product.description,
    regular_price: product.regular_price,
    sale_price: product.sale_price,
    manage_stock: product.manage_stock,
    // A string all the way to the wire, so an empty field is empty rather than 0.
    stock_quantity: product.stock_quantity === null ? "" : String(product.stock_quantity),
    stock_status: product.stock_status,
    weight: product.weight,
    category_ids: product.category_ids,
  };
}

export function ProductDetail({
  locale,
  product: initial,
  variations,
  categories,
  attributes,
  terms,
}: {
  locale: string;
  product: Product;
  variations: Variation[] | null;
  categories: ProductCategory[];
  attributes: GlobalAttribute[];
  terms: Record<string, AttributeTerm[]>;
}) {
  const t = useTranslations("products");
  const tDetail = useTranslations("products.detail");
  const tStatus = useTranslations("productStatus");
  const tStock = useTranslations("stockStatus");
  const tVisibility = useTranslations("catalogVisibility");
  const router = useRouter();
  const toast = useToast();

  const [product, setProduct] = useState(initial);
  const [draft, setDraft] = useState(() => draftOf(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    // Clearing this field's error on edit, and only this field's: the API lists
    // every bad field at once and the others are still wrong.
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(product));
  const currency = "DZD";
  const money = (value: string) => formatMoney(value, currency, locale);

  async function save() {
    setSaving(true);
    setErrors({});
    setTopError(null);

    const body: Record<string, unknown> = {
      ...draft,
      // Only when the product manages stock. Measured: `stock_quantity` is
      // silently dropped when `manage_stock` is false — a 200 with the field
      // ignored — so sending it there would look like a save that worked.
      ...(draft.manage_stock
        ? { stock_quantity: draft.stock_quantity === "" ? null : Number(draft.stock_quantity) }
        : {}),
    };
    if (!draft.manage_stock) delete body.stock_quantity;

    const response = await fetch(`/api/ac/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as {
      success?: boolean;
      data?: Product;
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    };

    setSaving(false);

    if (response.ok && payload.success !== false && payload.data) {
      setProduct(payload.data);
      setDraft(draftOf(payload.data));
      toast.show(tDetail("saved"));
      // The list's cached page is now stale in one row. Refreshing the route is
      // cheaper and more honest than patching a cache entry by hand.
      router.refresh();
      return;
    }

    const details = payload.error?.details ?? {};

    /**
     * A 400 lists **every** bad field, so all of them are rendered onto their
     * own rows rather than collapsed into one line — measured, four fields came
     * back in a single response. The messages are the API's English; they name
     * the problem precisely and a translated generic would throw that away.
     */
    const fields = details.fields as Record<string, string> | undefined;
    if (fields && Object.keys(fields).length > 0) {
      setErrors(fields);
      // A field the form does not render still has to be reachable, or the
      // person sees a refusal with no cause anywhere on screen.
      const orphans = Object.entries(fields).filter(([key]) => !(key in draft));
      if (orphans.length > 0) {
        setTopError(orphans.map(([key, message]) => `${key}: ${message}`).join(" · "));
      }
      return;
    }

    /**
     * A duplicate SKU is a **409**, not a 400, and it names the SKU under
     * `details.sku` rather than under `details.fields`. Measured:
     * `{"code":"conflict","message":"That SKU is already in use.","details":{"sku":"AC-TAP-001"}}`.
     * Mapped onto the SKU field, because that is the field the person has to
     * change, and the 409's own message is worth surfacing verbatim.
     */
    if (response.status === 409 && typeof details.sku === "string") {
      setErrors({ sku: payload.error?.message ?? tDetail("skuTaken") });
      return;
    }

    setTopError(payload.error?.message ?? tDetail("saveFailed"));
  }

  const span = priceSpan((variations ?? []).map((v) => v.price));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const termMap = new Map(Object.entries(terms));

  return (
    <Scaffold
      title={product.name}
      back={{ href: `/${locale}/products`, label: t("title") }}
    >
      <div className="mx-auto max-w-3xl px-4">
        {/*
          `options_problems` first, because it is the only thing on this screen
          that means something is broken *right now*. The API sends it only when
          the stored option document has a group it could not read, and a cart
          holding this product is already refusing to check out.
        */}
        {product.options_problems && product.options_problems.length > 0 ? (
          <div
            role="alert"
            className="tone-warning tonal mb-6 flex flex-col gap-2 rounded-lg px-4 py-3"
          >
            <span className="flex items-center gap-2 text-headline">
              <Icon name="alert" className="size-4 shrink-0" />
              {tDetail("optionsProblemsTitle")}
            </span>
            <span className="text-footnote text-label">
              {tDetail("optionsProblemsBody")}
            </span>
            <ul className="flex flex-col gap-1">
              {product.options_problems.map((problem) => (
                <li key={problem} className="text-footnote text-label-secondary">
                  {problem}
                </li>
              ))}
            </ul>
            {/*
              The part that is easy to get wrong and expensive to discover:
              saving from this screen writes back only the groups the API could
              read, so the unreadable ones are gone for good. Measured — after
              one whole-object round trip `options_problems` disappeared and the
              two broken groups with it.
            */}
            <span className="text-footnote text-label">
              {tDetail("optionsProblemsSaving")}
            </span>
          </div>
        ) : null}

        {product.status === "trash" ? (
          <div role="status" className="tone-danger tonal mb-6 rounded-lg px-4 py-3">
            <span className="text-footnote">{tDetail("trashed")}</span>
          </div>
        ) : null}

        {topError ? (
          <div role="alert" className="tone-danger tonal mb-6 rounded-lg px-4 py-3">
            <span className="text-footnote">{topError}</span>
          </div>
        ) : null}

        {/* ------------------------------------------------ identity --- */}
        <ListGroup title={tDetail("identity")}>
          <TextField
            label={tDetail("name")}
            value={draft.name}
            onChange={(v) => set("name", v)}
            error={errors.name}
          />
          <TextField
            label={tDetail("sku")}
            value={draft.sku}
            onChange={(v) => set("sku", v)}
            error={errors.sku}
            isolate
            hint={tDetail("skuHint")}
          />
          <TextField
            label={tDetail("slug")}
            value={draft.slug}
            onChange={(v) => set("slug", v)}
            error={errors.slug}
            isolate
            hint={draft.slug === "" ? tDetail("slugEmpty") : undefined}
          />
          <SelectField
            label={tDetail("status")}
            value={draft.status}
            onChange={(v) => set("status", v)}
            options={PRODUCT_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))}
            error={errors.status}
          />
          <SelectField
            label={tDetail("type")}
            value={draft.type}
            onChange={(v) => set("type", v)}
            options={PRODUCT_TYPES.map((s) => ({ value: s, label: t(`type.${s}`) }))}
            error={errors.type}
            hint={product.variations.length > 0 ? tDetail("typeHasVariations") : undefined}
          />
          <SelectField
            label={tDetail("visibility")}
            value={draft.catalog_visibility}
            onChange={(v) => set("catalog_visibility", v)}
            options={CATALOG_VISIBILITIES.map((s) => ({ value: s, label: tVisibility(s) }))}
            error={errors.catalog_visibility}
          />
          <SwitchField
            label={tDetail("featured")}
            checked={draft.featured}
            onChange={(v) => set("featured", v)}
          />
        </ListGroup>

        {/* ------------------------------------------------- pricing --- */}
        <ListGroup
          title={tDetail("pricing")}
          footnote={
            product.type === "variable" ? tDetail("pricingVariable") : undefined
          }
        >
          <DecimalField
            label={tDetail("regularPrice")}
            value={draft.regular_price}
            onChange={(v) => set("regular_price", v)}
            error={errors.regular_price}
          />
          <DecimalField
            label={tDetail("salePrice")}
            value={draft.sale_price}
            onChange={(v) => set("sale_price", v)}
            error={errors.sale_price}
          />
          {/*
            The effective price is computed by the API and refused on write —
            measured, `price` is silently dropped. Shown as a read-only row
            because on a variable product it is the only place the resolved
            figure appears, and because a form with a regular price of "" beside
            a list row reading 12 500 DA is otherwise unexplainable.
          */}
          <ReadOnlyField
            label={tDetail("effectivePrice")}
            value={
              product.price === "" ? (
                <span className="text-label-tertiary">{t("noPrice")}</span>
              ) : (
                <Ltr>{money(product.price)}</Ltr>
              )
            }
            reason={tDetail("effectivePriceReason")}
          />
          <DecimalField
            label={tDetail("weight")}
            value={draft.weight}
            onChange={(v) => set("weight", v)}
            error={errors.weight}
          />
        </ListGroup>

        {/* ----------------------------------------------- inventory --- */}
        <ListGroup title={tDetail("inventory")}>
          <SwitchField
            label={tDetail("manageStock")}
            checked={draft.manage_stock}
            onChange={(v) => set("manage_stock", v)}
            hint={tDetail("manageStockHint")}
          />
          {draft.manage_stock ? (
            <TextField
              label={tDetail("stockQuantity")}
              value={draft.stock_quantity}
              onChange={(v) => set("stock_quantity", v)}
              error={errors.stock_quantity}
              inputMode="numeric"
              isolate
            />
          ) : null}
          <SelectField
            label={tDetail("stockStatus")}
            value={draft.stock_status}
            onChange={(v) => set("stock_status", v)}
            options={STOCK_STATUSES.map((s) => ({ value: s, label: tStock(s) }))}
            error={errors.stock_status}
          />
        </ListGroup>

        {/* --------------------------------------------- description --- */}
        <ListGroup title={tDetail("descriptions")} footnote={tDetail("htmlNote")}>
          <TextAreaField
            label={tDetail("shortDescription")}
            value={draft.short_description}
            onChange={(v) => set("short_description", v)}
            error={errors.short_description}
            rows={3}
          />
          <TextAreaField
            label={tDetail("description")}
            value={draft.description}
            onChange={(v) => set("description", v)}
            error={errors.description}
            rows={6}
          />
        </ListGroup>

        {/* ---------------------------------------------- categories --- */}
        <ListGroup title={tDetail("organisation")}>
          <ReadOnlyField
            label={tDetail("categories")}
            value={
              product.category_ids.length === 0
                ? "—"
                : product.category_ids
                    .map((id) => categoryName.get(id) ?? String(id))
                    .join(" · ")
            }
            reason={tDetail("categoriesLater")}
          />
          {/*
            Attributes are read-only here, and the reason is on screen rather
            than in a comment: replacing the list on a variable product clears
            every variation's attribute map, so a partial editor is worse than
            none. The attributes screen owns this.
          */}
          <ReadOnlyField
            label={tDetail("attributes")}
            value={
              product.attributes.length === 0 ? (
                "—"
              ) : (
                <span className="flex flex-col gap-1">
                  {product.attributes.map((attribute) => {
                    const described = describeAttribute(attribute, attributes, termMap);
                    return (
                      <span key={attribute.name} className="flex flex-wrap gap-1.5">
                        <span className="text-label-secondary">{described.label} :</span>
                        <span>{described.values.join(", ")}</span>
                        {!described.global ? (
                          <StatusBadge tone="neutral">{tDetail("localAttribute")}</StatusBadge>
                        ) : null}
                      </span>
                    );
                  })}
                </span>
              )
            }
            reason={
              product.attributes.some((a) => a.id === 0)
                ? tDetail("localAttributeReason")
                : tDetail("attributesLater")
            }
          />
        </ListGroup>

        {/* ---------------------------------------------- variations --- */}
        {product.variations.length > 0 ? (
          <ListGroup
            title={tDetail("variations")}
            footnote={
              span
                ? tDetail("variationSpan", { min: money(span.min), max: money(span.max) })
                : tDetail("variationsReadOnly")
            }
          >
            {variations === null ? (
              <ListRow>
                <SectionError>{tDetail("sectionFailed")}</SectionError>
              </ListRow>
            ) : (
              variations.map((v) => (
                <ListRow key={v.id}>
                  <span className="flex min-w-0 flex-1 flex-col gap-1 py-1">
                    <span className="flex min-h-6 min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-body text-label">
                        {variationLabel(v, product, termMap).join(" · ") ||
                          tDetail("variationNoAttributes")}
                      </span>
                      {v.status !== "publish" ? (
                        <StatusBadge
                          tone={PRODUCT_STATUS_TONE[v.status as ReadableStatus] ?? "neutral"}
                        >
                          {tStatus(v.status)}
                        </StatusBadge>
                      ) : null}
                    </span>
                    <span className="flex min-w-0 items-baseline gap-2">
                      <Ltr className="min-w-0 flex-1 truncate text-subhead text-label-secondary">
                        {/* `""` means the variation inherits its parent's SKU;
                            the API reports what is stored so a read body can be
                            written back, and the panel says which it is. */}
                        {v.sku || tDetail("skuInherited")}
                      </Ltr>
                      <span className="flex shrink-0 items-center gap-1 text-subhead text-label-secondary">
                        <Dot tone={STOCK_TONE[v.stock_status as StockStatus] ?? "warning"} />
                        {v.manage_stock && v.stock_quantity !== null ? (
                          <Ltr numeric>{t("inStock", { count: v.stock_quantity })}</Ltr>
                        ) : (
                          <span>{tStock(v.stock_status)}</span>
                        )}
                      </span>
                      <Ltr className="shrink-0 text-subhead text-label">
                        {money(v.price)}
                      </Ltr>
                    </span>
                  </span>
                </ListRow>
              ))
            )}
          </ListGroup>
        ) : null}

        {/* ----------------------------------------------------- SEO --- */}
        <ListGroup
          title={tDetail("seo")}
          footnote={
            product.seo.overrides.length === 0 ? tDetail("seoDerived") : undefined
          }
        >
          <ReadOnlyField label={tDetail("seoTitle")} value={product.seo.title || "—"} />
          <ReadOnlyField
            label={tDetail("seoDescription")}
            value={product.seo.description || "—"}
          />
          <ReadOnlyField
            label={tDetail("seoRobots")}
            value={<Ltr numeric={false}>{product.seo.robots.directive}</Ltr>}
          />
          {product.seo.canonical ? (
            <ReadOnlyField
              label={tDetail("seoCanonical")}
              value={<Ltr numeric={false}>{product.seo.canonical}</Ltr>}
            />
          ) : null}
        </ListGroup>

        {/* -------------------------------------------------- record --- */}
        <ListGroup title={tDetail("record")}>
          <ListRow>
            <span className="text-body text-label-secondary">{tDetail("status")}</span>
            <span className="ms-auto">
              <StatusBadge tone={PRODUCT_STATUS_TONE[product.status]}>
                {tStatus(product.status)}
              </StatusBadge>
            </span>
          </ListRow>
          <ListValueRow
            label={tDetail("modified")}
            value={<Ltr>{formatWhen(product.date_modified, locale)}</Ltr>}
          />
          <ListValueRow
            label={tDetail("identifier")}
            value={<Ltr numeric>{product.id}</Ltr>}
          />
        </ListGroup>

        <DeleteAction productId={product.id} locale={locale} name={product.name} />
      </div>

      {/*
        The save bar. Fixed above the tab bar rather than at the foot of a long
        form: this form is nine sections tall at 390px, and a save button that
        has to be scrolled to is a save button people lose.
      */}
      {dirty ? (
        <div className="save-bar material-bar hairline-t fixed inset-x-0 z-20">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
            <Button
              variant="plain"
              onClick={() => {
                setDraft(draftOf(product));
                setErrors({});
                setTopError(null);
              }}
            >
              {tDetail("discard")}
            </Button>
            <Button
              onClick={() => void save()}
              loading={saving}
              fullWidth
              className="flex-1"
            >
              {saving ? tDetail("saving") : tDetail("save")}
            </Button>
          </div>
        </div>
      ) : null}
    </Scaffold>
  );
}
