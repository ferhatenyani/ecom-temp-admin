"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Product } from "@/lib/api/schemas/product";
import {
  PRODUCT_STATUS_TONE,
  STOCK_TONE,
  type ReadableStatus,
  type StockStatus,
} from "@/lib/product-status";
import { effectivePrice, isDiscounted, stockQuantity } from "@/lib/products";
import { formatMoney } from "@/lib/format/money";
import { formatDate } from "@/lib/format/date";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Drawer } from "@/components/ui/Overlay";
import { ButtonLink } from "@/components/ui/Button";
import { Badge, Dot } from "@/components/ui/Badge";
import type { ProductColumnContext } from "./columns";

/**
 * The product preview drawer.
 *
 * **It costs no request.** `lib/api/schemas/product.ts` records the measurement:
 * `GET /products` and `GET /products/{id}` return the same object, key for key,
 * across all 28 products. So everything below comes from data the list already
 * holds, and opening a preview is instant and does not spend against the 600/min
 * read budget.
 *
 * It is a *preview*, not a second detail screen — deliberately the fields a table
 * has no room for, with a link to the full page for anything else. Duplicating
 * the detail layout here is how two screens start drifting.
 */
export function ProductPeek({
  product,
  ctx,
  onOpenChange,
}: {
  product: Product | null;
  ctx: ProductColumnContext;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("products");
  const tDetail = useTranslations("products.detail");
  const tStatus = useTranslations("productStatus");
  const tStock = useTranslations("stockStatus");
  const { locale, currency, categoryName, inStock, typeLabel } = ctx;

  const price = product ? effectivePrice(product) : null;
  const quantity = product ? stockQuantity(product) : null;
  const categories =
    product?.category_ids.map((id) => categoryName.get(String(id)) ?? String(id)) ?? [];

  return (
    <Drawer
      open={product !== null}
      onOpenChange={onOpenChange}
      title={product?.name ?? ""}
      size="sm"
      headerExtra={
        product ? (
          <ButtonLink
            href={`/${locale}/products/${product.id}`}
            variant="secondary"
            size="sm"
            iconEnd="external"
          >
            {t("openFull")}
          </ButtonLink>
        ) : null
      }
    >
      {product ? (
        <dl className="flex flex-col">
          <Row label={tDetail("status")}>
            <Badge tone={PRODUCT_STATUS_TONE[product.status as ReadableStatus]}>
              {tStatus(product.status)}
            </Badge>
          </Row>
          <Row label={tDetail("sku")}>
            {product.sku ? (
              /* `break-all` rather than truncate: there is a 60-character SKU in
                 this catalogue, and the whole point of opening the preview is to
                 read the value the table had to cut. */
              <Ltr className="block break-all">{product.sku}</Ltr>
            ) : (
              <span className="text-ui-subtle">{t("noSku")}</span>
            )}
          </Row>
          <Row label={tDetail("type")}>{typeLabel(product.type)}</Row>

          {price === null ? (
            <Row label={tDetail("effectivePrice")}>
              <span className="text-ui-subtle">{t("noPrice")}</span>
            </Row>
          ) : (
            <>
              {isDiscounted(product) ? (
                <Row label={tDetail("regularPrice")}>
                  <Ltr className="text-ui-subtle line-through">
                    {formatMoney(product.regular_price, currency, locale)}
                  </Ltr>
                </Row>
              ) : null}
              <Row label={tDetail("effectivePrice")}>
                <Ltr className="text-ui-subheading text-ui-fg">
                  {formatMoney(price, currency, locale)}
                </Ltr>
              </Row>
            </>
          )}

          <Row label={tDetail("inventory")}>
            <span className="inline-flex items-center justify-end gap-1.5">
              <Dot tone={STOCK_TONE[product.stock_status as StockStatus] ?? "warning"} />
              {quantity !== null ? (
                <Isolate>{inStock(quantity)}</Isolate>
              ) : (
                <span>{tStock(product.stock_status)}</span>
              )}
            </span>
          </Row>

          {categories.length > 0 ? (
            <Row label={tDetail("categories")}>
              <span dir="auto">{categories.join(", ")}</span>
            </Row>
          ) : null}

          {/* Only when true. A row reading "Non" for both flags on every product
              in the shop is two rows of nothing. */}
          {product.featured ? (
            <Row label={tDetail("featured")}>
              <Badge tone="info">{t("featuredYes")}</Badge>
            </Row>
          ) : null}
          {product.on_sale ? (
            <Row label={t("filter.onSale")}>
              <Badge tone="info">{t("featuredYes")}</Badge>
            </Row>
          ) : null}

          <Row label={tDetail("created")}>
            <Isolate>{formatDate(product.date_created, locale)}</Isolate>
          </Row>
          <Row label={tDetail("modified")}>
            <Isolate>{formatDate(product.date_modified, locale)}</Isolate>
          </Row>
          <Row label={tDetail("identifier")}>
            <Ltr className="text-ui-subtle">{product.id}</Ltr>
          </Row>
        </dl>
      ) : null}
    </Drawer>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ui-line py-2 last:border-b-0">
      <dt className="shrink-0 text-ui-label text-ui-muted">{label}</dt>
      <dd className="min-w-0 text-end text-ui-compact text-ui-fg">{children}</dd>
    </div>
  );
}
