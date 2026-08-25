"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Coupon } from "@/lib/api/schemas/coupon";
import {
  discount,
  isExpired,
  isShippingOnly,
  restrictionCount,
  threshold,
  usage,
} from "@/lib/coupons";
import { formatDate } from "@/lib/format/date";
import { formatMoney, formatPercent } from "@/lib/format/money";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { Badge } from "@/components/ui/Badge";
import type { Column } from "@/components/ui/DataTable";

/**
 * The Coupons column definition — one source, two presentations.
 *
 * `DataTable` renders these as a real table at `md` and up and `RecordList`
 * renders the three-line form below it, so a phone and a monitor cannot drift
 * apart about which fields identify a coupon. It replaces `CouponRow.tsx`, which
 * drew one iOS inset row at every width; its two measured editorial decisions —
 * the zero-amount case and the description cascade — are carried over below and
 * are the reason this file is not a mechanical column list.
 *
 * ## The identifying cell is a real `<a href>`, and only in the table
 *
 * **There is no peek drawer**, for the reason `customers/columns.tsx` records
 * about its own: a single coupon is the list row **plus `restrictions`**, and
 * that resolved block is precisely what somebody would open a preview *for*. A
 * free peek would show nothing the row does not already carry and a useful one
 * spends a request per open. Orders and products preview for free because there
 * `GET /{id}` returns the list row exactly; `lib/api/schemas/coupon.ts` measures
 * that this collection is not that shape.
 *
 * So the row navigates — and because it navigates, the code is an anchor rather
 * than a span in a clickable row: that is the keyboard path, the middle click and
 * "open in new tab", none of which a `<div onClick>` has. It stops propagation so
 * one click does not push twice.
 *
 * The anchor is deliberately only in the **table**. `RecordList` navigates
 * through the stretched overlay button `DataTable` already gives it, so a row is
 * one anchor and not two — both presentations are in the DOM at every width, and
 * a link in each would double every `a[href*="/coupons/"]` a suite counts.
 *
 * ## Three sortable columns, out of nine
 *
 * `orderby` takes `date`, `id`, `code` and `usage`, and — re-measured 2026-08-25
 * against a positive control, after this file recorded the whole set as
 * validated-then-ignored — **all four sort, in both directions**. Three of them
 * are columns here, so `code`, `usage` and `id` carry a `sortKey` and the list
 * passes `onSortChange`. That pair is what puts `aria-sort` on those three
 * headers and, just as deliberately, keeps it off the other six: the primitive
 * gates the attribute on `sortKey && onSortChange`, and a `sortKey` on
 * `description`, `discount`, `type`, `minimum`, `expires` or `restrictions`
 * would announce a sortability the API does not have. That exact defect was
 * found on the products branch and is DECISIONS.md §2.
 *
 * None of the three declares `sortDirections`. All eight combinations were
 * measured, so the default `none → asc → desc → none` cycle is fully backed;
 * that prop exists for products' `title`, where only ascending ever was.
 *
 * **`date` gets no column and no control**, and not for want of evidence. It is
 * `date_created`; the only date on this list is `expires` (`date_expires`),
 * which is a different field and one the API cannot sort by. Adding a "created"
 * column purely to hang a sort on would be chrome. `date` stays the resting
 * order, which the third click on any sorted header returns to by dropping
 * `orderby` from the URL. `query.ts` carries the measurement and the trap behind
 * the old reading.
 *
 * ## No row-actions `Menu`
 *
 * It would hold one item. Trash and permanent delete both need the coupon's
 * `code` typed or confirmed against the record, and both live in the detail's own
 * header menu where the thing being deleted is on screen. A trailing 40px column
 * repeating "open" is not an action.
 *
 * ## Status is a badge on the code, not a column
 *
 * `publish` is the whole shop; a column of "Publié" marks nothing, and
 * `COUPON_STATUS_TONE` makes it neutral for exactly that reason. **Draft is the
 * one status worth marking** — the default list carries drafts, because no
 * `?status=` returns publish *and* draft, so a draft sits among live coupons and
 * is otherwise indistinguishable from one that discounts something.
 *
 * **Expiry is not a status and gets a badge of its own.** The API accepts a past
 * date without complaint — measured — so an expired coupon reads back as
 * `publish` and would otherwise look live.
 */

export type CouponColumnContext = {
  locale: string;
  currency: string;
  t: (key: string, values?: Record<string, string | number>) => string;
  /**
   * One clock for the whole list, taken once per render rather than per row.
   *
   * Every row asks whether its expiry has passed. `new Date()` inside a cell
   * would give twenty slightly different answers, re-derive on every keystroke in
   * the search box, and make the expiry rendering untestable — a `Date` created
   * inside a leaf component is not something a test can pin.
   */
  now: Date;
};

/**
 * What the coupon takes off, as the row's headline figure.
 *
 * Two things stop it being a plain number, and both are measured:
 *
 *   a percentage and a dinar amount are different units and are formatted
 *   differently — `${amount} %` put `10.00 %` on the French list, a raw decimal
 *   point where French writes a comma; and
 *
 *   **`amount: "0.00"` is a real coupon.** The `livraison` fixture is exactly
 *   that — zero off, free shipping — so a cell reading "0,00 DA" would be
 *   accurate and useless. `isShippingOnly()` catches it and the cell says what
 *   the coupon actually does. That is the inverse of the threshold fields on the
 *   same object, where zero is stored as null and can never read back.
 */
function discountText(coupon: Coupon, ctx: CouponColumnContext): ReactNode {
  const { locale, currency, t } = ctx;

  if (isShippingOnly(coupon)) {
    // Not "0 DA". The whole effect of this coupon is the shipping.
    return <span className="truncate">{t("freeShipping")}</span>;
  }

  const value = discount(coupon);
  return (
    <Ltr>
      {value.kind === "percent"
        ? formatPercent(value.value, locale)
        : formatMoney(value.value, currency, locale)}
    </Ltr>
  );
}

export function buildColumns(ctx: CouponColumnContext): Column<Coupon>[] {
  const { locale, currency, t, now } = ctx;

  return [
    {
      key: "code",
      header: t("columns.code"),
      required: true,
      /* Alphabetical on the folded code, both directions measured. Required, so
         this header can never be the sorted-but-hidden one. */
      sortKey: "code",
      cell: (coupon) => (
        <span className="flex min-w-0 items-center gap-2">
          <Link
            href={`/${locale}/coupons/${coupon.id}`}
            /* The row navigates too. Without this the anchor's click bubbles and
               the same push happens twice. */
            onClick={(event) => event.stopPropagation()}
            className="ui-ring min-w-0 rounded-ui-md hover:underline"
          >
            {/*
              `Ltr`, and `numeric={false}`: a code is an identifier — inside
              Arabic text it reorders without isolation and the person reads back
              something that will not work at the till — but it is not a figure.

              Capped, and the cap is measured rather than chosen: `.ui-td` is
              `white-space: nowrap` and an auto-layout table sizes a column to its
              widest cell, so an uncapped code sets the column's width.
              `promotion-de-fin-dannee-boutique-artisanale-algerienne-2026` is a
              fixture for exactly that. The full code is one click away, and it is
              the title of the screen this cell links to.
            */}
            <Ltr numeric={false} className="block max-w-64 truncate">
              {coupon.code}
            </Ltr>
          </Link>

          {coupon.status !== "publish" ? (
            <Badge tone="warning">{t(`status.${coupon.status}`)}</Badge>
          ) : null}

          {isExpired(coupon.date_expires, now) ? (
            <Badge tone="danger">{t("expired")}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "description",
      header: t("columns.description"),
      /* A description is user content in whichever language it was typed.
         `dir="auto"` so the ellipsis lands at its own end — a French description
         in the Arabic list would otherwise be clipped from the front, which is
         the defect the inventory branch measured on product names. */
      cell: (coupon) =>
        coupon.description !== "" ? (
          <span dir="auto" className="block max-w-64 truncate">
            {coupon.description}
          </span>
        ) : null,
    },
    {
      key: "discount",
      header: t("columns.discount"),
      align: "end",
      cell: (coupon) => discountText(coupon, ctx),
    },
    {
      key: "type",
      header: t("columns.type"),
      cell: (coupon) => t(`type.${coupon.discount_type}`),
    },
    {
      key: "minimum",
      header: t("columns.minimum"),
      align: "end",
      optional: true,
      /* `null` is an empty field, never a zero: the API folds a `0` to null on
         the way in, so `"0.00"` cannot be read back here and a cell printing
         `0,00 DA` would be inventing a threshold. */
      cell: (coupon) => {
        const minimum = threshold(coupon.minimum_amount);
        return minimum.set ? (
          <Ltr>{formatMoney(minimum.value, currency, locale)}</Ltr>
        ) : null;
      },
    },
    {
      key: "usage",
      header: t("columns.usage"),
      align: "end",
      /* **Numeric, not lexical** — `desc` answers 99, 50, 5, 1, and the mock
         carries a `usage_count: 9` fixture against a 37 so a string comparison
         fails there rather than on screen. The cell can render either a bare
         count or "n / limit"; the sort is on `usage_count` in both cases. */
      sortKey: "usage",
      /* Moved by `POST /cart/coupons` on the storefront and by nothing in this
         panel. `usageOf` is a translated sentence carrying two numbers, so it is
         `Isolate` rather than `Ltr`; a bare count is a figure and is `Ltr`. */
      cell: (coupon) => {
        const redemptions = usage(coupon);
        return redemptions.limited ? (
          <Isolate numeric>
            {t("usageOf", {
              count: redemptions.count,
              limit: redemptions.limit,
            })}
          </Isolate>
        ) : (
          <Ltr>{redemptions.count}</Ltr>
        );
      },
    },
    {
      key: "expires",
      header: t("columns.expires"),
      /* `Isolate`, never `Ltr`: a formatted date is not an identifier. ICU puts
         RTL marks inside the Arabic form on purpose and forcing `dir="ltr"` over
         them renders the date wrong — see primitives/Ltr.tsx. `formatDate`
         renders a null as an em dash rather than as an invented date, which here
         means "no expiry" and is the common case. */
      cell: (coupon) => (
        <Isolate>{formatDate(coupon.date_expires, locale, false)}</Isolate>
      ),
    },
    {
      key: "restrictions",
      header: t("columns.restrictions"),
      align: "end",
      optional: true,
      /* The count across all four fields. Nothing here can say whether one of
         them points at a deleted product — the list route does not emit
         `restrictions`, only the single-coupon routes do — so the cell reports
         the number and the detail reports the health of it. */
      cell: (coupon) => {
        const count = restrictionCount(coupon);
        return count > 0 ? <Ltr>{count}</Ltr> : null;
      },
    },
    {
      key: "id",
      header: t("columns.id"),
      align: "end",
      /*
       * Off by default, which the customers list does not do with its own id.
       *
       * There the id is the one short, stable, quotable handle on a row whose
       * name may be a login. A coupon's *code* is already that — unique, typed by
       * shoppers, and what a colleague would say down a phone — so the numeric id
       * is machinery and only earns its place when somebody is reading a URL.
       *
       * Being optional makes its sort reachable only once the column is shown,
       * and hiding it again while it is the active sort leaves the list ordered
       * with no header saying so. That is an **incompleteness, not the products
       * defect**: there the *default* `orderby=date` sat on a hidden column, so
       * every first paint announced "none" on every header while the panel had
       * explicitly asked for a sort. Here the resting order is `date`, which no
       * column claims and no control offers, so "none" on every visible header
       * is true — and the only route to the gap is to sort by id and then
       * deliberately hide the column you just sorted by.
       */
      optional: true,
      sortKey: "id",
      cell: (coupon) => <Ltr className="text-ui-subtle">{coupon.id}</Ltr>,
    },
  ];
}

/**
 * The three lines shown below `md`.
 *
 * Which three is an editorial choice rather than "the first three columns": on a
 * phone a person is identifying the coupon (the code, with the two badges that
 * change what it means), working out what it is *for* (the description, or the
 * next most telling fact when there is none), and reading what it takes off.
 *
 * **The second line is a cascade, and it is `CouponRow`'s.** A coupon with no
 * description is not a coupon with nothing to say: its minimum spend, or the
 * number of products it is restricted to, is what distinguishes it from the row
 * above. Only when none of those exist does the line admit there is nothing.
 */
export function couponRecord(
  coupon: Coupon,
  ctx: CouponColumnContext,
): { primary: ReactNode; secondary: ReactNode; meta: ReactNode } {
  const { locale, currency, t, now } = ctx;
  const minimum = threshold(coupon.minimum_amount);
  const restrictions = restrictionCount(coupon);

  return {
    primary: (
      <>
        <Ltr
          numeric={false}
          className="min-w-0 flex-1 truncate text-ui-subheading text-ui-fg"
        >
          {coupon.code}
        </Ltr>
        {coupon.status !== "publish" ? (
          <Badge tone="warning">{t(`status.${coupon.status}`)}</Badge>
        ) : null}
        {isExpired(coupon.date_expires, now) ? (
          <Badge tone="danger">{t("expired")}</Badge>
        ) : null}
      </>
    ),
    secondary:
      coupon.description !== "" ? (
        <span dir="auto" className="min-w-0 flex-1 truncate">
          {coupon.description}
        </span>
      ) : minimum.set ? (
        <span className="min-w-0 flex-1 truncate">
          <Isolate numeric>
            {t("minimumShort", {
              amount: formatMoney(minimum.value, currency, locale),
            })}
          </Isolate>
        </span>
      ) : restrictions > 0 ? (
        <span className="min-w-0 flex-1 truncate">
          <Isolate numeric>{t("restrictedShort", { count: restrictions })}</Isolate>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-ui-subtle">
          {t("noDescription")}
        </span>
      ),
    meta: (
      <>
        <span className="min-w-0 truncate">{t(`type.${coupon.discount_type}`)}</span>
        {/* `--text-compact` on the trailing figure, and it is a measurement
            rather than emphasis: `RecordListSkeleton` draws its third line at
            1.25rem because the migrated screens put a compact-sized value there,
            and the taller child wins the line box. Left at the meta row's own
            `--text-label` the card measures 94px against the placeholder's 96. */}
        <span className="ms-auto shrink-0 text-ui-compact text-ui-fg">
          {discountText(coupon, ctx)}
        </span>
      </>
    ),
  };
}
