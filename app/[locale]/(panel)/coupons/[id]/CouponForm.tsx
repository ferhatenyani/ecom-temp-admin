"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CouponDetail, RestrictionRef } from "@/lib/api/schemas/coupon";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import {
  COUPON_STATUSES,
  DISCOUNT_TYPES,
  RESTRICTION_KIND,
  RESTRICTION_FIELDS,
  isExclusion,
  type CouponStatus,
  type DiscountType,
  type RestrictionField,
} from "@/lib/coupon-status";
import {
  discountsPerProduct,
  expiryInputValue,
  missingRefs,
  normalizeCode,
  refLabel,
  usage,
} from "@/lib/coupons";
import { formatDate } from "@/lib/format/date";
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
import { ActionSheet } from "@/components/primitives/ActionSheet";
import { Button } from "@/components/primitives/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { StatusBadge } from "@/components/primitives/StatusBadge";
import { useToast } from "@/components/primitives/Toast";
import { useHydrated } from "@/lib/use-hydrated";
import { RestrictionPicker } from "./RestrictionPicker";

/**
 * The whole coupon as a form — create and edit, one component.
 *
 * A coupon has no variations, no media and no option set, so the create screen is
 * this screen with an empty object behind it. That is why `POST /coupons` is on
 * the proxy allowlist while `POST /products` is not: there, create would have been
 * a different and much larger screen.
 */

type Draft = {
  code: string;
  status: CouponStatus;
  discount_type: DiscountType;
  amount: string;
  description: string;
  date_expires: string;
  minimum_amount: string;
  maximum_amount: string;
  usage_limit: string;
  usage_limit_per_user: string;
  limit_usage_to_x_items: string;
  individual_use: boolean;
  free_shipping: boolean;
  exclude_sale_items: boolean;
  email_restrictions: string;
} & Record<RestrictionField, number[]>;

function draftOf(coupon: CouponDetail): Draft {
  return {
    code: coupon.code,
    // A trashed coupon is readable and its status is not settable back to
    // `trash`; the picker offers the two live states and the banner says the rest.
    status: coupon.status === "trash" ? "draft" : coupon.status,
    discount_type: coupon.discount_type,
    amount: coupon.amount,
    description: coupon.description,
    /*
     * **The one field that cannot be bound to the response.** `date_expires` is
     * written as `Y-m-d` and read back as full ISO, and a date input given the ISO
     * form renders empty — then posts an empty string on the next save, which the
     * API reads as "clear the expiry". The round trip deletes a date nobody
     * touched. `expiryInputValue()` is the only thing allowed to fill this.
     */
    date_expires: expiryInputValue(coupon.date_expires),
    /*
     * `null` becomes `""`, and that is the correct direction. A threshold of null
     * is an **empty field**, never a zero: `"0.00"` cannot be read back from these
     * — the API folds a zero to null on the way in — so a form showing `0` where
     * there is no minimum would be inventing a restriction that then round-trips
     * back as one.
     */
    minimum_amount: coupon.minimum_amount ?? "",
    maximum_amount: coupon.maximum_amount ?? "",
    usage_limit: coupon.usage_limit === null ? "" : String(coupon.usage_limit),
    usage_limit_per_user:
      coupon.usage_limit_per_user === null ? "" : String(coupon.usage_limit_per_user),
    limit_usage_to_x_items:
      coupon.limit_usage_to_x_items === null ? "" : String(coupon.limit_usage_to_x_items),
    individual_use: coupon.individual_use,
    free_shipping: coupon.free_shipping,
    exclude_sale_items: coupon.exclude_sale_items,
    email_restrictions: coupon.email_restrictions.join("\n"),
    product_ids: coupon.product_ids,
    excluded_product_ids: coupon.excluded_product_ids,
    product_categories: coupon.product_categories,
    excluded_product_categories: coupon.excluded_product_categories,
  };
}

/**
 * A blank coupon, for the create screen.
 *
 * `amount` starts empty rather than at `"0"`. **`POST` requires it** — measured,
 * `{"code": "x"}` alone is a 400 naming `amount` — and prefilling a zero would
 * turn a required field into one a person can skip and accidentally publish a
 * coupon that discounts nothing. `fixed_cart` is the API's own default type.
 */
export const BLANK: CouponDetail = {
  id: 0,
  code: "",
  status: "publish",
  discount_type: "fixed_cart",
  amount: "",
  description: "",
  date_expires: null,
  minimum_amount: null,
  maximum_amount: null,
  usage_limit: null,
  usage_limit_per_user: null,
  limit_usage_to_x_items: null,
  usage_count: 0,
  individual_use: false,
  free_shipping: false,
  exclude_sale_items: false,
  product_ids: [],
  excluded_product_ids: [],
  product_categories: [],
  excluded_product_categories: [],
  email_restrictions: [],
  date_created: "",
  date_modified: null,
  restrictions: {
    product_ids: [],
    excluded_product_ids: [],
    product_categories: [],
    excluded_product_categories: [],
  },
};

export function CouponForm({
  locale,
  initialCoupon,
  mode,
}: {
  locale: string;
  initialCoupon: CouponDetail;
  mode: "create" | "edit";
}) {
  const t = useTranslations("coupons");
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();

  const [coupon, setCoupon] = useState(initialCoupon);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initialCoupon));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<RestrictionField | null>(null);
  const [deleting, setDeleting] = useState<"trash" | "force" | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(coupon));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const trashed = coupon.status === "trash";
  const stale = missingRefs(coupon.restrictions);
  const redemptions = usage(coupon);

  /* ----------------------------------------------------------------- save --- */

  async function save() {
    setSaving(true);
    setErrors({});
    setTopError(null);

    /*
     * A named subset, never "the GET body minus what looks read-only".
     *
     * The products branch measured what happens otherwise: a PATCH carrying only
     * read-only fields is a 400 with no `details` at all. `restrictions` is the
     * new instance of that hazard here — it is emitted on every single-coupon
     * response and refused on write, and the backend's own suite caught a
     * round-trip failure the day it was added.
     */
    const body: Record<string, unknown> = {
      code: normalizeCode(draft.code),
      status: draft.status,
      discount_type: draft.discount_type,
      amount: draft.amount,
      description: draft.description,
      // `null` clears; `""` also clears, and both are accepted. `null` is sent
      // because it is what the read shape uses for "no expiry".
      date_expires: draft.date_expires === "" ? null : draft.date_expires,
      minimum_amount: draft.minimum_amount === "" ? null : draft.minimum_amount,
      maximum_amount: draft.maximum_amount === "" ? null : draft.maximum_amount,
      usage_limit: draft.usage_limit === "" ? null : Number(draft.usage_limit),
      usage_limit_per_user:
        draft.usage_limit_per_user === "" ? null : Number(draft.usage_limit_per_user),
      limit_usage_to_x_items:
        draft.limit_usage_to_x_items === "" ? null : Number(draft.limit_usage_to_x_items),
      individual_use: draft.individual_use,
      free_shipping: draft.free_shipping,
      exclude_sale_items: draft.exclude_sale_items,
      email_restrictions: draft.email_restrictions
        .split(/[\n,]/)
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry !== ""),
      product_ids: draft.product_ids,
      excluded_product_ids: draft.excluded_product_ids,
      product_categories: draft.product_categories,
      excluded_product_categories: draft.excluded_product_categories,
    };

    try {
      const saved = await acWrite<CouponDetail>(
        mode === "create" ? "POST" : "PATCH",
        mode === "create" ? "/coupons" : `/coupons/${coupon.id}`,
        body,
      );

      setSaving(false);

      if (mode === "create") {
        toast.show(t("created"));
        router.replace(`/${locale}/coupons/${saved.id}`);
        return;
      }

      setCoupon(saved);
      setDraft(draftOf(saved));
      toast.show(t("saved"));
      // The list's cached page is now stale in one row. Refreshing the route is
      // cheaper and more honest than patching a cache entry by hand.
      router.refresh();
    } catch (error) {
      setSaving(false);

      if (!(error instanceof BrowserApiError)) {
        setTopError(String(error));
        return;
      }

      /*
       * **A duplicate code is a 409 with `details.code`, not a 400 with
       * `details.fields`** — the same shape a duplicate SKU has on products, and
       * handled the same way: bound to the field it is about, so the message
       * appears under the input the person has to change rather than at the top
       * of a long form.
       *
       * The code in `details.code` is the *lower-cased* form, which is what
       * collided: submitting `BIENVENUE10` conflicts with the stored
       * `bienvenue10` and the message names the second. Echoing the API's value
       * rather than the typed one is what makes the conflict make sense.
       */
      if (error.status === 409) {
        const conflicting = (error.details as { code?: string }).code;
        setErrors({ code: t("duplicateCode", { code: conflicting ?? draft.code }) });
        return;
      }

      /*
       * A 400 lists **every** bad field at once, so each one is bound to its own
       * control rather than collapsed into one line. The messages are the API's
       * English; they name the problem precisely and a translated generic would
       * throw that away. Only the label is localised.
       */
      const fields = error.fields;
      if (fields !== null && Object.keys(fields).length > 0) {
        setErrors(fields);

        // A field the form does not render still has to be reachable, or the
        // person sees a refusal with no cause anywhere on screen.
        const orphans = Object.entries(fields).filter(([key]) => !(key in draft));
        if (orphans.length > 0) {
          setTopError(orphans.map(([key, message]) => `${key}: ${message}`).join(" · "));
        }
        return;
      }

      setTopError(error.message);
    }
  }

  /* --------------------------------------------------------------- delete --- */

  async function remove(force: boolean) {
    setDeleting(null);
    setSaving(true);

    try {
      await acWrite("DELETE", `/coupons/${coupon.id}${force ? "?force=true" : ""}`);
      setSaving(false);
      toast.show(force ? t("deleted") : t("trashed"));
      router.push(`/${locale}/coupons`);
      router.refresh();
    } catch (error) {
      setSaving(false);
      setTopError(error instanceof Error ? error.message : String(error));
    }
  }

  /* ----------------------------------------------------------------- view --- */

  return (
    <Scaffold
      title={mode === "create" ? t("createTitle") : coupon.code}
      back={{ href: `/${locale}/coupons`, label: t("title") }}
    >
      <div className="mx-auto max-w-3xl px-4">
        {topError ? <SectionError>{topError}</SectionError> : null}

        {/*
          A trashed coupon still reads back 200 with `status: "trash"` — only
          `?force=true` gives a 404 — so this screen is reachable for one and has
          to say what it is looking at. It also keeps its code, which is why
          recreating that code answers 409 rather than succeeding.
        */}
        {trashed ? (
          <div className="tonal tone-danger mb-4 rounded-lg px-4 py-3">
            <p className="text-body">{t("trashedBanner")}</p>
          </div>
        ) : null}

        {/*
          Stale restrictions, surfaced rather than silently kept.
          A product deleted after the coupon was written leaves an id resolving to
          nothing; the API reports it as `missing` instead of dropping it, because
          a client that dropped it would delete the restriction on the next save.
          A coupon restricted to something that no longer exists applies to
          nothing and is otherwise indistinguishable from one that works.
        */}
        {stale.length > 0 ? (
          <div className="tonal tone-warning mb-4 rounded-lg px-4 py-3">
            <p className="text-body">
              <Isolate numeric>{t("staleRestrictions", { count: stale.length })}</Isolate>
            </p>
            <p className="mt-1 text-footnote">
              {stale.map((ref: RestrictionRef) => `#${ref.id}`).join(" · ")}
            </p>
          </div>
        ) : null}

        <ListGroup title={t("section.basics")}>
          <TextField
            label={t("field.code")}
            value={draft.code}
            /*
             * Folded as the user types, so what they see is what will be stored.
             * WooCommerce lower-cases every code on save and the duplicate check
             * runs on the folded form, which is why `BIENVENUE10` collides with
             * `bienvenue10` — a field that showed the typed case would make that
             * 409 look like a bug.
             */
            onChange={(value) => set("code", value.toLowerCase())}
            error={errors.code}
            hint={t("hint.code")}
            isolate
            disabled={trashed}
            name="code"
          />
          <SelectField<DiscountType>
            label={t("field.discount_type")}
            value={draft.discount_type}
            onChange={(value) => set("discount_type", value)}
            options={DISCOUNT_TYPES.map((value) => ({ value, label: t(`type.${value}`) }))}
            error={errors.discount_type}
            disabled={trashed}
          />
          <DecimalField
            label={
              draft.discount_type === "percent" ? t("field.amountPercent") : t("field.amount")
            }
            value={draft.amount}
            onChange={(value) => set("amount", value)}
            error={errors.amount}
            hint={draft.discount_type === "percent" ? t("hint.percent") : t("hint.amount")}
            disabled={trashed}
            name="amount"
          />
          <TextAreaField
            label={t("field.description")}
            value={draft.description}
            onChange={(value) => set("description", value)}
            error={errors.description}
            rows={2}
            disabled={trashed}
          />
          <SelectField<CouponStatus>
            label={t("field.status")}
            value={draft.status}
            onChange={(value) => set("status", value)}
            options={COUPON_STATUSES.map((value) => ({
              value,
              label: t(`status.${value}`),
            }))}
            error={errors.status}
            hint={t("hint.status")}
            disabled={trashed}
          />
        </ListGroup>

        <ListGroup title={t("section.validity")} footnote={t("hint.expiry")}>
          <div className="list-row flex flex-col gap-1 px-4 py-2.5">
            <label htmlFor="coupon-expires" className="text-footnote text-label-secondary">
              {t("field.date_expires")}
            </label>
            {/*
              A native date input rather than `TextField`. The control's own value
              format is `YYYY-MM-DD`, which is exactly what the API accepts on
              write — the mismatch is entirely on the *read* side, and
              `expiryInputValue()` has already resolved it.
             */}
            <input
              id="coupon-expires"
              type="date"
              /*
                **A native date input follows the *browser's* locale, and there
                is no way to change it.** The Arabic form renders `mm/dd/yyyy` —
                a US ordering in a right-to-left screen. `lang` is set because it
                is the only hint the platform offers and some engines honour it;
                measured on Chromium 2026-08-19, this one does not. The control's
                internals cannot be styled or relabelled either.
                
                So the placeholder is left as the platform's and the value is
                echoed underneath, formatted for the page. A person can then
                confirm the date they set without having to trust a format they
                do not recognise, which is the part that actually matters.
              */
              lang={locale}
              value={draft.date_expires}
              onChange={(event) => set("date_expires", event.target.value)}
              disabled={trashed || !hydrated}
              aria-busy={!hydrated || undefined}
              aria-invalid={errors.date_expires ? true : undefined}
              className="min-h-11 w-full bg-transparent text-body text-label outline-none disabled:opacity-40"
            />
            {/* The value in the page's own language — see above. `Isolate`, not
                `Ltr`: this is `Intl`-formatted, and forcing a direction over the
                marks it inserts renders an Arabic date as `17ص 12:03 .2026/08/`. */}
            {draft.date_expires !== "" ? (
              <span className="text-caption text-label-secondary">
                <Isolate>{formatDate(draft.date_expires, locale, false)}</Isolate>
              </span>
            ) : null}
            {errors.date_expires ? (
              <span className="text-footnote text-danger">{errors.date_expires}</span>
            ) : null}
          </div>
          <DecimalField
            label={t("field.minimum_amount")}
            value={draft.minimum_amount}
            onChange={(value) => set("minimum_amount", value)}
            error={errors.minimum_amount}
            /*
             * "Leave empty for none" and not "0 for none". A negative value is now
             * refused by name — it used to answer 200 and silently erase a real
             * threshold — and an empty field is the way to clear one.
             */
            hint={t("hint.threshold")}
            disabled={trashed}
            name="minimum_amount"
          />
          <DecimalField
            label={t("field.maximum_amount")}
            value={draft.maximum_amount}
            onChange={(value) => set("maximum_amount", value)}
            error={errors.maximum_amount}
            hint={t("hint.maximumAmount")}
            disabled={trashed}
            name="maximum_amount"
          />
        </ListGroup>

        <ListGroup title={t("section.limits")}>
          <TextField
            label={t("field.usage_limit")}
            value={draft.usage_limit}
            onChange={(value) => set("usage_limit", value)}
            error={errors.usage_limit}
            hint={t("hint.unlimited")}
            inputMode="numeric"
            disabled={trashed}
            name="usage_limit"
          />
          <TextField
            label={t("field.usage_limit_per_user")}
            value={draft.usage_limit_per_user}
            onChange={(value) => set("usage_limit_per_user", value)}
            error={errors.usage_limit_per_user}
            hint={t("hint.unlimited")}
            inputMode="numeric"
            disabled={trashed}
            name="usage_limit_per_user"
          />
          <TextField
            label={t("field.limit_usage_to_x_items")}
            value={draft.limit_usage_to_x_items}
            onChange={(value) => set("limit_usage_to_x_items", value)}
            error={errors.limit_usage_to_x_items}
            hint={t("hint.unlimited")}
            inputMode="numeric"
            disabled={trashed}
            name="limit_usage_to_x_items"
          />
          {mode === "edit" ? (
            /*
             * Read-only, and it is not a field the panel could write if it wanted
             * to: `usage_count` is moved by `POST /cart/coupons` on the storefront
             * and by nothing else. `used_by` is emitted by no response at all, so
             * *who* redeemed a coupon is unanswerable and this row does not imply
             * it is knowable elsewhere in the panel.
             */
            <ReadOnlyField
              label={t("field.usage_count")}
              value={
                <Ltr numeric>
                  {redemptions.limited
                    ? t("usageOf", { count: redemptions.count, limit: redemptions.limit })
                    : String(redemptions.count)}
                </Ltr>
              }
              reason={t("hint.usageCount")}
            />
          ) : null}
        </ListGroup>

        <ListGroup title={t("section.behaviour")}>
          <SwitchField
            label={t("field.free_shipping")}
            checked={draft.free_shipping}
            onChange={(checked) => set("free_shipping", checked)}
            hint={t("hint.freeShipping")}
            disabled={trashed}
          />
          <SwitchField
            label={t("field.individual_use")}
            checked={draft.individual_use}
            onChange={(checked) => set("individual_use", checked)}
            hint={t("hint.individualUse")}
            disabled={trashed}
          />
          <SwitchField
            label={t("field.exclude_sale_items")}
            checked={draft.exclude_sale_items}
            onChange={(checked) => set("exclude_sale_items", checked)}
            hint={t("hint.excludeSaleItems")}
            disabled={trashed}
          />
        </ListGroup>

        {/* ------------------------------------------------- the restrictions --- */}

        <ListGroup
          title={t("section.restrictions")}
          /*
           * **`fixed_product` is the only type that discounts per product.** The
           * other two apply to the cart and use the product list as a *condition*.
           * A shop that sets "500 DA off these two products" on a `fixed_cart`
           * coupon takes 500 DA off the whole basket, and nothing on screen would
           * otherwise say so.
           */
          footnote={
            discountsPerProduct(draft.discount_type)
              ? t("hint.perProduct")
              : t("hint.perCart")
          }
        >
          {RESTRICTION_FIELDS.map((field) => {
            const ids = draft[field];
            const refs = coupon.restrictions[field];

            return (
              <button
                key={field}
                type="button"
                disabled={trashed || !hydrated}
                onClick={() => setPicker(field)}
                className="list-row press-row flex min-h-11 w-full items-center gap-3 px-4 py-3 text-start disabled:opacity-40"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-body text-label">
                    {t(`restriction.${field}`)}
                    {isExclusion(field) ? (
                      <StatusBadge tone="warning" className="shrink-0">
                        {t("restriction.excludes")}
                      </StatusBadge>
                    ) : null}
                  </span>
                  <span className="text-footnote text-label-secondary">
                    {ids.length === 0 ? (
                      <span className="text-label-tertiary">{t("restriction.any")}</span>
                    ) : (
                      /*
                        The names, resolved by the API, and never a bare id where a
                        name goes — an id printed as a label reads as a product
                        called 8842. An unresolvable id is rendered as its own
                        thing, with the id as evidence rather than as a name.

                        `dir="auto"` because these are user-typed product names,
                        and the list is clipped from the name's own end in both
                        locales rather than from the paragraph's.
                      */
                      <span dir="auto" className="line-clamp-2">
                        {refs.length > 0
                          ? refs
                              .map((ref) => {
                                const label = refLabel(ref);
                                return label.named
                                  ? label.text
                                  : t("restriction.missingOne", { id: ref.id });
                              })
                              .join("، ")
                          : t("restriction.selected", { count: ids.length })}
                      </span>
                    )}
                  </span>
                </span>
                <Ltr className="shrink-0 text-footnote text-label-tertiary">{ids.length}</Ltr>
                <Icon name="chevron" flipInRtl className="size-4 shrink-0 text-label-tertiary" />
              </button>
            );
          })}
        </ListGroup>

        <ListGroup title={t("section.emails")} footnote={t("hint.emails")}>
          <TextAreaField
            label={t("field.email_restrictions")}
            value={draft.email_restrictions}
            onChange={(value) => set("email_restrictions", value)}
            error={errors.email_restrictions}
            rows={3}
            disabled={trashed}
          />
        </ListGroup>

        {mode === "edit" ? (
          <ListGroup title={t("section.record")}>
            <ListValueRow label={t("field.id")} value={<Ltr>{coupon.id}</Ltr>} />
            <ListValueRow
              label={t("field.created")}
              // `Intl` formatted, so `Isolate` — `Ltr` over an Arabic date's RLMs
              // renders `17ص 12:03 .2026/08/`.
              value={<Isolate>{formatDate(coupon.date_created, locale, false)}</Isolate>}
            />
            {coupon.date_modified !== null ? (
              <ListValueRow
                label={t("field.modified")}
                value={<Isolate>{formatDate(coupon.date_modified, locale, false)}</Isolate>}
              />
            ) : null}
          </ListGroup>
        ) : null}

        {mode === "edit" && !trashed ? (
          <ListGroup title={t("section.danger")}>
            <ListRow>
              <Button
                variant="plain"
                onClick={() => setDeleting("trash")}
                disabled={saving}
                className="w-full text-danger"
              >
                {t("trash")}
              </Button>
            </ListRow>
          </ListGroup>
        ) : null}

        {trashed ? (
          <ListGroup title={t("section.danger")}>
            <ListRow>
              <Button
                variant="plain"
                onClick={() => setDeleting("force")}
                disabled={saving}
                className="w-full text-danger"
              >
                {t("deleteForever")}
              </Button>
            </ListRow>
          </ListGroup>
        ) : null}
      </div>

      {/*
        The save bar appears when the form is dirty, and on create it is present
        from the start — there is nothing to compare a new coupon against and the
        person needs somewhere to go.
      */}
      {(dirty || mode === "create") && !trashed ? (
        /*
          `.save-bar`, not a hand-rolled `bottom-0`. Both this and the tab bar are
          `fixed … bottom-0 z-20`, and the tab bar comes later in the document, so
          it painted on top and the save button was **physically untappable** at
          phone widths — Playwright reported the inventory tab intercepting the
          click, which is exactly what a thumb would have hit.

          The utility already exists for the product form and solves it properly:
          it sits one tab-bar height above the bottom edge, and at `md` — where
          the tab bar becomes a sidebar — it drops to the edge and insets by the
          sidebar's width instead.
        */
        <div className="save-bar material-bar hairline-t fixed inset-x-0 z-20">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
            <Button
              variant="plain"
              onClick={() =>
                mode === "create" ? router.push(`/${locale}/coupons`) : setDraft(draftOf(coupon))
              }
              disabled={saving}
              className="flex-1"
            >
              {mode === "create" ? t("cancel") : t("revert")}
            </Button>
            <Button
              variant="filled"
              onClick={() => void save()}
              loading={saving}
              className="flex-1"
            >
              {mode === "create" ? t("create") : t("save")}
            </Button>
          </div>
        </div>
      ) : null}

      {picker !== null ? (
        <RestrictionPicker
          open
          onOpenChange={(open) => {
            if (!open) setPicker(null);
          }}
          kind={RESTRICTION_KIND[picker]}
          title={t(`restriction.${picker}`)}
          selected={draft[picker]}
          onCommit={(ids) => set(picker, ids)}
        />
      ) : null}

      <ActionSheet
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={deleting === "force" ? t("confirm.deleteTitle") : t("confirm.trashTitle")}
        /*
         * Two different confirmations, because they are two different acts. A
         * trash is reversible and keeps the code — recreating it answers 409 —
         * while `?force=true` is permanent and frees the code. The products
         * branch set this precedent and the wording differs for the same reason.
         */
        description={
          deleting === "force" ? t("confirm.deleteBody") : t("confirm.trashBody")
        }
        actions={[
          {
            label: deleting === "force" ? t("deleteForever") : t("trash"),
            tone: "destructive" as const,
            onSelect: () => void remove(deleting === "force"),
          },
        ]}
      />
    </Scaffold>
  );
}
