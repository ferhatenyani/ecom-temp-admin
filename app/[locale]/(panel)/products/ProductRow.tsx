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
import { Ltr } from "@/components/primitives/Ltr";
import { StatusBadge, Dot } from "@/components/primitives/StatusBadge";

/**
 * One product, as a row.
 *
 * **No thumbnail, and that is measured rather than lazy.** All 28 products carry
 * `image_id: 0`, `image: null` and an empty gallery — the media library holds 30
 * fixtures and not one is attached to a product. A 44px image column would be 28
 * placeholder squares down the panel's second-most-used screen, and a column of
 * placeholders is worse than no column: it reads as a catalogue whose photography
 * failed to load rather than as one that has none. When products start carrying
 * images this row gains a leading thumbnail; until then the space belongs to the
 * name.
 *
 * Primary line: the name and the status badge, and the badge only when the status
 * is not `publish`. 27 of 28 products are published, so a badge on every row would
 * mark nothing — the exception is what a person is scanning for.
 *
 * Secondary line: SKU, stock, and the price. The SKU is `Ltr`-isolated because a
 * SKU is exactly the identifier the bidi algorithm reorders inside Arabic text —
 * `AC-BIJ-002` is a different SKU once its segments move, and nothing errors.
 */
export function ProductRow({
  product,
  locale,
  currency,
}: {
  product: Product;
  locale: string;
  /**
   * The shop's currency, from `meta.facets.price.currency`. A product carries no
   * currency of its own — unlike an order, which does — so it is threaded down
   * from the one place the API states it rather than guessed at each call site.
   */
  currency: string;
}) {
  const t = useTranslations("products");
  const tStatus = useTranslations("productStatus");
  const tStock = useTranslations("stockStatus");

  const price = effectivePrice(product);
  const discounted = isDiscounted(product);
  const quantity = stockQuantity(product);
  const stock = product.stock_status as StockStatus;
  const showBadge = product.status !== "publish";

  return (
    <span className="flex min-w-0 flex-col gap-1 py-1">
      {/*
        `min-h-6` is load-bearing, not padding. The badge is 24px tall and the
        name's line box is 22px, so without it a row carrying a badge is two
        pixels taller than one that does not — and 27 of 28 products are
        published, so the list would be a run of 79px rows with an 81px row
        wherever a draft appears. Two pixels is invisible per row and obvious as a
        stutter down a scrolling list, and it would also put every row 2px off the
        skeleton that precedes it.
      */}
      <span className="flex min-h-6 min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-headline text-label">
          {product.name}
        </span>
        {/* The badge carries the word, so colour is never the only signal. */}
        {showBadge ? (
          <StatusBadge tone={PRODUCT_STATUS_TONE[product.status as ReadableStatus]}>
            {tStatus(product.status)}
          </StatusBadge>
        ) : null}
      </span>

      {/*
        Four things compete for one line at 390px, so the priority is explicit:
        the price never shrinks (it is why the row is being read), the stock never
        shrinks (it is the one number a stockroom is checking), and the SKU
        absorbs the squeeze — it is the longest and the least urgent of the three.

        `items-center`, not `items-baseline` as the order row uses, and that is
        measured rather than stylistic: the stock dot is an empty inline-block, so
        under baseline alignment it contributes its own margin-box bottom as a
        baseline and pushed the line box from 20px to 21px. One pixel per row is
        invisible on screen and is exactly 8px of layout shift over an eight-row
        skeleton — the defect this list is supposed to have designed out.
      */}
      <span className="flex min-w-0 items-center gap-2">
        <Ltr className="min-w-0 flex-1 truncate text-subhead text-label-secondary">
          {product.sku || t("noSku")}
        </Ltr>

        <span className="flex shrink-0 items-center gap-1 text-subhead text-label-secondary">
          <Dot tone={STOCK_TONE[stock] ?? "warning"} />
          {/*
            The quantity when the product manages stock, the status word when it
            does not — 8 of 28 do not, and "—" on a third of the list says
            nothing. The dot always sits beside a word or a number, never alone.
          */}
          {quantity !== null ? (
            <Ltr numeric>{t("inStock", { count: quantity })}</Ltr>
          ) : (
            <span>{tStock(stock)}</span>
          )}
        </span>

        {price === null ? (
          /* A published product with no price at all — measured on
             AC-SEO-NOPRICE. Named, never rendered as 0,00 DA: a price of nothing
             and no price are different problems and only one of them is free. */
          <span className="shrink-0 text-subhead text-label-tertiary">{t("noPrice")}</span>
        ) : (
          <span className="flex shrink-0 items-baseline gap-1.5">
            {discounted ? (
              <Ltr className="text-caption text-label-tertiary line-through">
                {formatMoney(product.regular_price, currency, locale)}
              </Ltr>
            ) : null}
            <Ltr className="text-subhead text-label">
              {formatMoney(price, currency, locale)}
            </Ltr>
          </span>
        )}
      </span>
    </span>
  );
}
