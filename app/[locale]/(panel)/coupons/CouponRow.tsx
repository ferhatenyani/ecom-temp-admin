"use client";

import { useTranslations } from "next-intl";
import type { Coupon } from "@/lib/api/schemas/coupon";
import { COUPON_STATUS_TONE } from "@/lib/coupon-status";
import { discount, isExpired, isShippingOnly, restrictionCount, threshold } from "@/lib/coupons";
import { formatMoney, formatPercent } from "@/lib/format/money";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { Ltr } from "@/components/primitives/Ltr";

/**
 * One coupon.
 *
 * **The code is the row's identity and it is an identifier**, so `Ltr` — a code
 * inside Arabic text reorders without isolation and the person reads back
 * something that will not work at the till. It is also always lower case, because
 * the API folds it on save.
 *
 * The trailing figure is the discount, which is what a person scanning this list
 * is looking for. Two things stop it being a plain number:
 *
 *   a percentage and a dinar amount are different units and are rendered
 *   differently, and
 *
 *   **`amount: "0.00"` is a real coupon.** The `livraison` fixture is exactly
 *   that — zero off, free shipping — so a row reading "0 DA" would be accurate
 *   and useless. `isShippingOnly()` catches it and the row says what the coupon
 *   actually does.
 *
 * Geometry matches `StockRow`, `MovementRow` and `CustomerRow`, so `RowSkeleton`
 * is honest here too.
 */
export function CouponRow({
  coupon,
  currency,
  locale,
  now,
}: {
  coupon: Coupon;
  currency: string;
  locale: string;
  /** Injected so the expiry rendering is not a hostage to the clock in a test. */
  now: Date;
}) {
  const t = useTranslations("coupons");
  const value = discount(coupon);
  const minimum = threshold(coupon.minimum_amount);
  const expired = isExpired(coupon.date_expires, now);
  const restrictions = restrictionCount(coupon);

  return (
    <div className="flex w-full items-center gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-6 items-center gap-2">
          <Ltr numeric={false} className="truncate text-body text-label">
            {coupon.code}
          </Ltr>

          {/* Draft is the one status worth marking: it is in the default list —
              no `?status=` returns publish *and* draft — so a draft coupon sits
              among live ones and looks identical without this. */}
          {coupon.status !== "publish" ? (
            <StatusBadge tone={COUPON_STATUS_TONE[coupon.status]} className="shrink-0">
              {t(`status.${coupon.status}`)}
            </StatusBadge>
          ) : null}

          {/* Expiry is not a status. The API accepts a past date without
              complaint — measured — so an expired coupon reads as `publish` and
              would otherwise look live. */}
          {expired ? (
            <StatusBadge tone="danger" className="shrink-0">
              {t("expired")}
            </StatusBadge>
          ) : null}
        </div>

        <div className="flex items-center gap-2 text-footnote text-label-secondary">
          {coupon.description !== "" ? (
            /* A description is user content in whichever language it was typed.
               `dir="auto"` so the ellipsis lands at its own end — a French
               description in the Arabic list would otherwise be clipped from the
               front, which is the defect the inventory branch measured. */
            <span dir="auto" className="truncate">
              {coupon.description}
            </span>
          ) : minimum.set ? (
            <span className="truncate">
              <Ltr>{t("minimumShort", { amount: formatMoney(minimum.value, currency, locale) })}</Ltr>
            </span>
          ) : restrictions > 0 ? (
            <span className="truncate">{t("restrictedShort", { count: restrictions })}</span>
          ) : (
            <span className="truncate text-label-tertiary">{t("noDescription")}</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5 text-end">
        {isShippingOnly(coupon) ? (
          // Not "0 DA". The whole effect of this coupon is the shipping.
          <span className="text-subhead text-label">{t("freeShipping")}</span>
        ) : (
          <Ltr className="text-title-3 text-label">
            {value.kind === "percent"
              ? formatPercent(value.value, locale)
              : formatMoney(value.value, currency, locale)}
          </Ltr>
        )}
        <span className="text-caption text-label-tertiary">
          {t(`type.${coupon.discount_type}`)}
        </span>
      </div>
    </div>
  );
}
