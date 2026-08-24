"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CouponDetail, RestrictionRef, Restrictions } from "@/lib/api/schemas/coupon";
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
import { formatDate, formatWhen } from "@/lib/format/date";
import { useOnline } from "@/lib/use-online";
import { useHydrated } from "@/lib/use-hydrated";
import { PageHeader, PageBody } from "@/components/ui/PageHeader";
import {
  DateField,
  ErrorSummary,
  NumberField,
  ReadOnlyField,
  SaveBar,
  Select,
  Switch,
  TextArea,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Notice, StaleBanner } from "@/components/ui/States";
import { Menu, type MenuAction } from "@/components/ui/Menu";
import { ConfirmDialog } from "@/components/ui/Confirm";
import { IconButton } from "@/components/ui/Button";
import { Icon } from "@/components/primitives/Icon";
import { Ltr, Isolate } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { RestrictionPicker } from "./RestrictionPicker";

/**
 * The whole coupon as a form — create and edit, one component.
 *
 * A coupon has no variations, no media and no option set, so the create screen is
 * this screen with an empty object behind it. That is why `POST /coupons` is on
 * the proxy allowlist while `POST /products` is not: there, create would have been
 * a different and much larger screen.
 *
 * ## `PageBody width="form"`, not `DetailGrid`
 *
 * §2.3 lists a coupon in the 640px form row, and it belongs there rather than in
 * the two-column detail row the product screen uses. A product is a record with
 * an unboundedly-growing main body — descriptions, attributes, a variation list —
 * beside a fixed block of reference material to glance at while reading it. A
 * coupon has no read-only half at all: its dates and its id are three lines, and
 * `usage_count` belongs beside the limits it counts against rather than in an
 * aside that would exist to hold it.
 *
 * ## The write payload is a named subset, never the GET body
 *
 * The products branch measured what happens otherwise: a PATCH carrying only
 * read-only fields is a 400 with no `details` at all. On a coupon it is worse,
 * because **a coupon refuses a read-only key rather than dropping it** — the
 * opposite of a product's rule — and `restrictions` is the trap: it is emitted on
 * every single-coupon response *including the answer to the write itself*, so the
 * obvious "save what I was given" round trip 400s on the field the API had just
 * handed over. `id`, `usage_count`, `used_by`, `date_created` and `date_modified`
 * are refused the same way.
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

/**
 * What the form knows about a restriction id: the name to print, and whether the
 * API said the id resolves to nothing.
 *
 * **This map is the fix for a real defect.** The rows used to take their ids from
 * the draft and their *names* from `coupon.restrictions` — the last **saved**
 * response — and then render the names whenever there were any and the draft's
 * count beside them. Add a product to coupon 302, which already carries one, and
 * the row showed one old name with a trailing "2". Two sources of truth for one
 * row, and the count was the only half that moved.
 *
 * So there is one source: seeded from the saved response, extended by every
 * picker commit — the picker already knows the names it displayed — and rebuilt
 * from the answer to each save, which is the API resolving them afresh.
 *
 * **An id in neither source renders as its id and does not claim `missing`.**
 * `missing` is a measured API fact, and inventing it would tell somebody a
 * product had been deleted when all that happened is that this browser has never
 * seen its name.
 */
type RefName = { name: string | null; missing: boolean };

function seedRefNames(restrictions: Restrictions): Map<number, RefName> {
  const map = new Map<number, RefName>();
  // Through `RESTRICTION_FIELDS` rather than `Object.values`: the schema is a
  // `looseObject`, so its index signature is `unknown` and `Object.values` would
  // hand back `unknown[]`.
  for (const field of RESTRICTION_FIELDS) {
    for (const ref of restrictions[field] as RestrictionRef[]) {
      map.set(ref.id, { name: ref.name, missing: ref.missing });
    }
  }
  return map;
}

/**
 * A field's DOM id, so `ErrorSummary` can link a failure to the control it is
 * about — which is the whole reason every control in `Form.tsx` takes one.
 *
 * `date_expires` keeps the shorter `coupon-expires`: it is the one id on this
 * form that predates the redesign and is asserted **by name** in
 * `e2e/coupons.spec.ts`, which reads the expiry through it to prove the ISO/`Y-m-d`
 * asymmetry has been resolved before the value reaches the control.
 */
function fieldId(key: string): string {
  return key === "date_expires" ? "coupon-expires" : `coupon-${key}`;
}

export function CouponForm({
  locale,
  initialCoupon,
  fetchedAt,
  mode,
}: {
  locale: string;
  initialCoupon: CouponDetail;
  /**
   * When the server render that produced `initialCoupon` happened, for §3.7's
   * stale marker. Absent on create, where there is no fetch and nothing that can
   * age — a blank object is exactly as old as the form around it.
   */
  fetchedAt?: number;
  mode: "create" | "edit";
}) {
  const t = useTranslations("coupons");
  const tStates = useTranslations("states");
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  /*
   * The restriction rows are the one control on this form that `Form.tsx` does
   * not draw, so they carry its guard themselves. A tap landing in the window
   * between first paint and hydration opens nothing and reports nothing — and
   * **WebKit hydrates slowly enough for that window to be real**, which is why
   * `e2e/coupons.spec.ts` waits on `toBeEnabled()` before clicking one. Chromium
   * closed it before every click; WebKit did not.
   */
  const hydrated = useHydrated();

  const [coupon, setCoupon] = useState(initialCoupon);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initialCoupon));
  const [refNames, setRefNames] = useState(() => seedRefNames(initialCoupon.restrictions));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<RestrictionField | null>(null);
  const [deleting, setDeleting] = useState<"trash" | "force" | null>(null);

  /**
   * Where the keyboard goes when the delete confirm closes.
   *
   * The dialog is opened from a `Menu` item, which Radix unmounts the moment it
   * is selected — so the opener the overlay recorded is detached by the time it
   * would be focused, Radix's own fallback targets a trigger ref a controlled
   * dialog never sets, and focus lands on `<body>`.
   */
  const menuTriggerId = useId();

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(coupon));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const trashed = coupon.status === "trash";
  const stale = missingRefs(coupon.restrictions);
  const redemptions = usage(coupon);
  const offlineReason = online ? undefined : tStates("offlineWrites");

  /**
   * How this locale joins a short list of names.
   *
   * `Intl.ListFormat`, not `.join("، ")`. The literal that stood here was an
   * **Arabic** comma, hardcoded, and it ran in both locales — so a French reader
   * saw "Tapis et Textiles، Burnous en laine". A list separator is locale data,
   * and this is the platform API that holds it.
   *
   * `narrow` `conjunction` is CLDR's shortest enumeration: commas in French, و in
   * Arabic. `unit` was measured first and is wrong here — its narrow form joins
   * with a **bare space** in French, which for a list of product names is no
   * separator at all.
   */
  const LIST = new Intl.ListFormat(locale, { style: "narrow", type: "conjunction" });

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
      // The API has just resolved every id afresh, so its answer replaces what
      // the pickers contributed rather than merging with it.
      setRefNames(seedRefNames(saved.restrictions));
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
       * control *and* listed in the summary at the top. The messages are the
       * API's English; they name the problem precisely and a translated generic
       * would throw that away. Only the label is localised.
       */
      const fields = error.fields;
      if (fields !== null && Object.keys(fields).length > 0) {
        setErrors(fields);
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

  /* ------------------------------------------------- the failures, summarised --- */

  /**
   * §3.4: a form that failed submission shows a summary at the top listing each
   * failure as a link to its field, with focus moved to it.
   *
   * **This is the second of the two defects this branch exists to fix, and it was
   * a silent failed save.** A 400 on a restriction id — `{"product_ids":[101,8842]}`
   * on coupon 305, which the mock reproduces — set `errors` and then computed
   * "orphans" as the keys *not* in the draft. `product_ids` **is** in the draft,
   * so there were no orphans, the top-level message never ran, and the four
   * restriction rows read `errors` nowhere. Net: the refusal cleared `saving`,
   * left the bar dirty, and put nothing whatsoever on screen.
   *
   * Every writable key gets a label, not only the rendered ones, because a 400
   * names fields this form does not show and the name alone reads as machinery.
   * A key outside the set falls back to itself: a genuinely unknown field is a
   * bug report, and its name is the only part of it worth carrying.
   *
   * Everything writable here has a control on screen — including the four
   * restriction rows, which are `<button>`s and therefore focusable link targets
   * — so `id` is set for all of them and the orphan case is `FIELD_LABELS`'
   * fallback rather than a branch.
   */
  const FIELD_LABELS: Record<string, string> = {
    code: t("field.code"),
    status: t("field.status"),
    discount_type: t("field.discount_type"),
    amount: t("field.amount"),
    description: t("field.description"),
    date_expires: t("field.date_expires"),
    minimum_amount: t("field.minimum_amount"),
    maximum_amount: t("field.maximum_amount"),
    usage_limit: t("field.usage_limit"),
    usage_limit_per_user: t("field.usage_limit_per_user"),
    limit_usage_to_x_items: t("field.limit_usage_to_x_items"),
    individual_use: t("field.individual_use"),
    free_shipping: t("field.free_shipping"),
    exclude_sale_items: t("field.exclude_sale_items"),
    email_restrictions: t("field.email_restrictions"),
    product_ids: t("restriction.product_ids"),
    excluded_product_ids: t("restriction.excluded_product_ids"),
    product_categories: t("restriction.product_categories"),
    excluded_product_categories: t("restriction.excluded_product_categories"),
  };

  const failures: FormFailure[] = Object.entries(errors).map(([key, message]) => ({
    id: key in FIELD_LABELS ? fieldId(key) : undefined,
    label: FIELD_LABELS[key] ?? key,
    message,
  }));

  /* ---------------------------------------------------------- restrictions --- */

  /** The names on one restriction row, joined the way `LIST` joins a list. */
  function restrictionSummary(ids: number[]): string {
    const labels = ids.map((id) => {
      const known = refNames.get(id);
      if (known === undefined) {
        /* Neither the API nor a picker has named this id in this session. It is
           printed as an id — never as a name, and never as `missing`, which is a
           thing the API says and not a thing a client may infer. */
        return t("restriction.unknownOne", { id });
      }
      /* `refLabel` is the one authority on "a name, or the honest absence of
         one", so the rule that an id must never be printed *as* a name lives in
         one place rather than being restated here. */
      const label = refLabel({ id, name: known.name, missing: known.missing });
      return label.named ? label.text : t("restriction.missingOne", { id });
    });

    return LIST.format(labels);
  }

  /* ----------------------------------------------------------------- view --- */

  const deleteActions: MenuAction[] = [
    /* Only for a live coupon: a DELETE on an already-trashed one answers 200
       again and changes nothing, so the item would be a control that cannot act. */
    ...(trashed
      ? []
      : [
          {
            key: "trash",
            label: t("trash"),
            icon: "trash" as const,
            destructive: true,
            disabled: offlineReason !== undefined,
            onSelect: () => setDeleting("trash"),
          },
        ]),
    {
      key: "force",
      label: t("deleteForever"),
      icon: "close" as const,
      destructive: true,
      disabled: offlineReason !== undefined,
      onSelect: () => setDeleting("force"),
    },
  ];

  return (
    <div className="min-h-dvh bg-ui-canvas">
      <PageHeader
        title={mode === "create" ? t("createTitle") : coupon.code}
        back={{ href: `/${locale}/coupons`, label: t("title") }}
        /* A detail page omits the rule and lets the first section do the
           separating — §2.4. */
        divided={false}
        /*
         * **Delete is here, in a `Menu`, and the save is not.** §2.4 puts a detail
         * screen's action in the header; §3.4 legislates a long form's save
         * separately as a sticky bar that appears when the form is dirty. The
         * header rule is about a control acting on the record's *state*, which a
         * save is not.
         */
        actions={
          mode === "edit" ? (
            <Menu
              label={t("actions")}
              align="end"
              actions={deleteActions}
              trigger={
                <IconButton
                  id={menuTriggerId}
                  label={t("actions")}
                  icon="more"
                  variant="secondary"
                  disabled={saving}
                />
              }
            />
          ) : undefined
        }
      />

      <PageBody width="form">
        <div className="flex flex-col gap-4">
          {/*
            §3.7's fifth state. This screen holds a record fetched once on the
            server and then edits it in the browser, so what is on screen can
            outlive the fetch that produced it — and the half of the rule that
            does the real work has something to disable here: the save bar below
            and the two delete items in the header menu all go off with this same
            reason.
          */}
          {!online && fetchedAt !== undefined ? (
            <StaleBanner time={formatWhen(new Date(fetchedAt).toISOString(), locale)} />
          ) : null}

          <ErrorSummary failures={failures} />

          {/* A failure with nothing per-field to say — a network error, a 500, a
              refused DELETE. Inline and standing, never a toast: §3.1 says an
              error a person must act on is not one. */}
          {topError !== null ? (
            <Notice role="alert" tone="danger" title={tStates("errorTitle")}>
              <p className="text-ui-label">{topError}</p>
            </Notice>
          ) : null}

          {/*
            A trashed coupon still reads back 200 with `status: "trash"` — only
            `?force=true` gives a 404 — so this screen is reachable for one and has
            to say what it is looking at. It also keeps its code, which is why
            recreating that code answers 409 rather than succeeding.

            **And it says what saving would do.** The status control has no trash
            option, because `?status=trash` is refused on write, so the form opens
            already coerced to `draft`. Coercing silently would make the next save
            an untrash nobody asked for; saying so turns the same coercion into the
            restore path, which is otherwise a thing this panel cannot do at all.
          */}
          {trashed ? (
            <Notice tone="danger" title={t("status.trash")}>
              <p className="text-ui-label">{t("trashedBanner")}</p>
            </Notice>
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
            <Notice tone="warning" title={t("staleTitle")}>
              <p className="text-ui-label">
                <Isolate numeric>{t("staleRestrictions", { count: stale.length })}</Isolate>
              </p>
              <p className="text-ui-label">
                {LIST.format(
                  stale.map((ref: RestrictionRef) =>
                    t("restriction.missingOne", { id: ref.id }),
                  ),
                )}
              </p>
            </Notice>
          ) : null}

          {/* Cards, not `Form.tsx`'s `Section`: `Card.tsx` records the split —
              `Section` is a bordered group sized to sit *inside* an overlay, at
              `--text-subheading` so it does not compete with a Drawer's own
              title, and a card on a page is the page's structure and takes
              `--text-heading` per §3.4 and 20px of padding per §1.4. It is also
              the box model `FormSkeleton` is measured against, which is what lets
              the three `loading.tsx` files match first paint. */}
          <div className="flex flex-col gap-4">
            <Card title={t("section.basics")}>
              <div className="flex min-w-0 flex-col gap-4">
                <TextField
                  id={fieldId("code")}
                  name="code"
                  label={t("field.code")}
                  value={draft.code}
                  /*
                   * Folded as the user types, so what they see is what will be
                   * stored. WooCommerce lower-cases every code on save and the
                   * duplicate check runs on the folded form, which is why
                   * `BIENVENUE10` collides with `bienvenue10` — a field that showed
                   * the typed case would make that 409 look like a bug.
                   *
                   * `toLowerCase()` and not `normalizeCode()`: the trim belongs on
                   * submit. Trimming mid-keystroke moves the caret.
                   */
                  onChange={(value) => set("code", value.toLowerCase())}
                  error={errors.code}
                  hint={t("hint.code")}
                  isolate
                />
                <Select<DiscountType>
                  id={fieldId("discount_type")}
                  label={t("field.discount_type")}
                  value={draft.discount_type}
                  onChange={(value) => set("discount_type", value)}
                  options={DISCOUNT_TYPES.map((value) => ({
                    value,
                    label: t(`type.${value}`),
                  }))}
                  error={errors.discount_type}
                />
                <NumberField
                  id={fieldId("amount")}
                  name="amount"
                  label={
                    draft.discount_type === "percent"
                      ? t("field.amountPercent")
                      : t("field.amount")
                  }
                  value={draft.amount}
                  onChange={(value) => set("amount", value)}
                  error={errors.amount}
                  hint={draft.discount_type === "percent" ? t("hint.percent") : t("hint.amount")}
                />
                <TextArea
                  id={fieldId("description")}
                  label={t("field.description")}
                  value={draft.description}
                  onChange={(value) => set("description", value)}
                  error={errors.description}
                  rows={2}
                />
                <Select<CouponStatus>
                  id={fieldId("status")}
                  label={t("field.status")}
                  value={draft.status}
                  onChange={(value) => set("status", value)}
                  options={COUPON_STATUSES.map((value) => ({
                    value,
                    label: t(`status.${value}`),
                  }))}
                  error={errors.status}
                  hint={t("hint.status")}
                />
              </div>
            </Card>

            <Card title={t("section.validity")}>
              <div className="flex min-w-0 flex-col gap-4">
                <DateField
                  id={fieldId("date_expires")}
                  label={t("field.date_expires")}
                  value={draft.date_expires}
                  onChange={(value) => set("date_expires", value)}
                  /*
                    **A native date input follows the *browser's* locale and there is
                    no way to change it** — the Arabic form renders `mm/dd/yyyy`, a
                    US ordering in a right-to-left screen. `lang` is the only hint
                    the platform offers, `<html lang>` already carries it and the
                    control inherits it, and Chromium was measured on 2026-08-19 not
                    to honour it anyway. The control's internals cannot be styled or
                    relabelled either.

                    So the value is echoed underneath in the page's own language and
                    a person can confirm the date they set without having to trust a
                    format they do not recognise, which is the part that matters.

                    `Isolate`, not `Ltr`: this is `Intl`-formatted, and forcing a
                    direction over the marks it inserts renders an Arabic date as
                    `17ص 12:03 .2026/08/`.
                  */
                  echo={
                    draft.date_expires !== "" ? (
                      <Isolate>{formatDate(draft.date_expires, locale, false)}</Isolate>
                    ) : undefined
                  }
                  error={errors.date_expires}
                  hint={t("hint.expiry")}
                />
                <NumberField
                  id={fieldId("minimum_amount")}
                  name="minimum_amount"
                  label={t("field.minimum_amount")}
                  value={draft.minimum_amount}
                  onChange={(value) => set("minimum_amount", value)}
                  error={errors.minimum_amount}
                  /*
                   * "Leave empty for none" and not "0 for none". A negative value is
                   * refused by name — it used to answer 200 and silently erase a real
                   * threshold — and an empty field is the way to clear one.
                   */
                  hint={t("hint.threshold")}
                />
                <NumberField
                  id={fieldId("maximum_amount")}
                  name="maximum_amount"
                  label={t("field.maximum_amount")}
                  value={draft.maximum_amount}
                  onChange={(value) => set("maximum_amount", value)}
                  error={errors.maximum_amount}
                  hint={t("hint.maximumAmount")}
                />
              </div>
            </Card>

            <Card title={t("section.limits")}>
              <div className="flex min-w-0 flex-col gap-4">
                <TextField
                  id={fieldId("usage_limit")}
                  name="usage_limit"
                  label={t("field.usage_limit")}
                  value={draft.usage_limit}
                  onChange={(value) => set("usage_limit", value)}
                  error={errors.usage_limit}
                  hint={t("hint.unlimited")}
                  inputMode="numeric"
                  isolate
                />
                {mode === "edit" ? (
                  /*
                   * **Beside the limit it counts against, not as a lonely row.** That
                   * is where the number means something: 37 is unremarkable and
                   * "37 sur 50" is a coupon two thirds spent.
                   *
                   * Read-only, and not a field the panel could write if it wanted to:
                   * `usage_count` is moved by `POST /cart/coupons` on the storefront
                   * and by nothing else — the API refuses it on write rather than
                   * dropping it. `used_by` is emitted by no response at all, so *who*
                   * redeemed a coupon is unanswerable and this row does not imply it
                   * is knowable elsewhere in the panel.
                   */
                  <ReadOnlyField
                    label={t("field.usage_count")}
                    value={
                      redemptions.limited ? (
                        <Isolate numeric>
                          {t("usageOf", {
                            count: redemptions.count,
                            limit: redemptions.limit,
                          })}
                        </Isolate>
                      ) : (
                        <Ltr>{redemptions.count}</Ltr>
                      )
                    }
                    reason={t("hint.usageCount")}
                  />
                ) : null}
                <TextField
                  id={fieldId("usage_limit_per_user")}
                  name="usage_limit_per_user"
                  label={t("field.usage_limit_per_user")}
                  value={draft.usage_limit_per_user}
                  onChange={(value) => set("usage_limit_per_user", value)}
                  error={errors.usage_limit_per_user}
                  hint={t("hint.unlimited")}
                  inputMode="numeric"
                  isolate
                />
                <TextField
                  id={fieldId("limit_usage_to_x_items")}
                  name="limit_usage_to_x_items"
                  label={t("field.limit_usage_to_x_items")}
                  value={draft.limit_usage_to_x_items}
                  onChange={(value) => set("limit_usage_to_x_items", value)}
                  error={errors.limit_usage_to_x_items}
                  hint={t("hint.unlimited")}
                  inputMode="numeric"
                  isolate
                />
              </div>
            </Card>

            <Card title={t("section.behaviour")}>
              <div className="flex min-w-0 flex-col gap-4">
                <Switch
                  id={fieldId("free_shipping")}
                  label={t("field.free_shipping")}
                  checked={draft.free_shipping}
                  onChange={(checked) => set("free_shipping", checked)}
                  hint={t("hint.freeShipping")}
                  error={errors.free_shipping}
                />
                <Switch
                  id={fieldId("individual_use")}
                  label={t("field.individual_use")}
                  checked={draft.individual_use}
                  onChange={(checked) => set("individual_use", checked)}
                  hint={t("hint.individualUse")}
                  error={errors.individual_use}
                />
                <Switch
                  id={fieldId("exclude_sale_items")}
                  label={t("field.exclude_sale_items")}
                  checked={draft.exclude_sale_items}
                  onChange={(checked) => set("exclude_sale_items", checked)}
                  hint={t("hint.excludeSaleItems")}
                  error={errors.exclude_sale_items}
                />
              </div>
            </Card>

            <Card
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
              <div className="flex min-w-0 flex-col gap-4">
                {RESTRICTION_FIELDS.map((field) => {
                  const ids = draft[field];
                  const problem = errors[field];

                  return (
                    <button
                      key={field}
                      id={fieldId(field)}
                      type="button"
                      onClick={() => setPicker(field)}
                      disabled={!hydrated}
                      aria-busy={!hydrated || undefined}
                      /* `aria-describedby` and not `aria-invalid`: the latter is
                         not supported on the button role, and the refusal is
                         carried by the danger border, the message wired here, and
                         the summary at the top of the form. */
                      aria-describedby={problem ? `${fieldId(field)}-error` : undefined}
                      className={`ui-field ui-interactive ui-hover-fill ui-ring flex w-full cursor-pointer items-center gap-2.5 rounded-ui-md border px-2 py-1.5 text-start disabled:cursor-not-allowed disabled:opacity-50 ${
                        problem ? "border-ui-danger-fg" : "border-ui-line"
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-2 text-ui-compact text-ui-fg">
                          <span className="min-w-0 truncate">{t(`restriction.${field}`)}</span>
                          {isExclusion(field) ? (
                            <Badge tone="warning">{t("restriction.excludes")}</Badge>
                          ) : null}
                        </span>
                        <span className="min-w-0 text-ui-caption text-ui-subtle">
                          {ids.length === 0 ? (
                            /*
                              **Empty means the opposite thing on the two kinds of
                              row, and one word cannot serve both.** On an
                              inclusion row no ids means the coupon applies to
                              every product — "Tous". On an exclusion row it means
                              nothing is excluded, and "Tous" there reads as *all
                              products are excluded*, which is the inverse of the
                              truth and is what a brand-new coupon claimed on both
                              of its exclusion rows.
                            */
                            isExclusion(field) ? t("restriction.none") : t("restriction.any")
                          ) : (
                            /* The names, from the one map the form keeps — see
                               `RefName`. Two lines rather than one: at 640px a row
                               restricted to three products is three names, and a
                               single clipped line would show the first and imply
                               there is nothing else. `dir="auto"` because these are
                               user-typed product names, and the list is then clipped
                               from the name's own end in both locales rather than
                               from the paragraph's. */
                            <span dir="auto" className="line-clamp-2">
                              {restrictionSummary(ids)}
                            </span>
                          )}
                        </span>
                      </span>
                      <Ltr className="shrink-0 text-ui-caption text-ui-subtle">{ids.length}</Ltr>
                      <Icon
                        name="chevron"
                        flipInRtl
                        className="size-4 shrink-0 text-ui-subtle"
                      />
                    </button>
                  );
                })}

                {/*
                  The refusals, under the rows they belong to.

                  **This is the first of the two defects this branch exists to
                  fix.** A 400 naming `product_ids` was bound into `errors` and
                  then read by nothing: the rows consulted it nowhere, and the
                  fallback that would have surfaced it only fired for keys *not*
                  in the draft — which `product_ids` is. So the refusal cleared
                  `saving`, left the bar dirty, and put nothing on screen at all.

                  The message is the API's own English: "No product was found for:
                  8842." names the offending id, which is the only actionable part
                  and the part a translated generic would throw away. The field is
                  not repeated here — the row it sits under is labelled — and
                  `ErrorSummary` at the top of the form is where the pairing
                  happens, because there the row is off screen.
                */}
                {RESTRICTION_FIELDS.filter((field) => errors[field]).map((field) => (
                  <p
                    key={field}
                    id={`${fieldId(field)}-error`}
                    className="flex items-start gap-1.5 text-ui-label text-ui-danger-fg"
                  >
                    <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
                    <span className="min-w-0">{errors[field]}</span>
                  </p>
                ))}
              </div>
            </Card>

            <Card title={t("section.emails")} footnote={t("hint.emails")}>
              <div className="flex min-w-0 flex-col gap-4">
                <TextArea
                  id={fieldId("email_restrictions")}
                  label={t("field.email_restrictions")}
                  value={draft.email_restrictions}
                  onChange={(value) => set("email_restrictions", value)}
                  error={errors.email_restrictions}
                  rows={3}
                />
              </div>
            </Card>

            {mode === "edit" ? (
              <Card title={t("section.record")}>
                <div className="flex min-w-0 flex-col gap-4">
                  <ReadOnlyField label={t("field.id")} value={<Ltr>{coupon.id}</Ltr>} />
                  <ReadOnlyField
                    label={t("field.created")}
                    // `Intl` formatted, so `Isolate` — `Ltr` over an Arabic date's
                    // RLMs renders `17ص 12:03 .2026/08/`.
                    value={<Isolate>{formatDate(coupon.date_created, locale, false)}</Isolate>}
                  />
                  <ReadOnlyField
                    label={t("field.modified")}
                    value={<Isolate>{formatDate(coupon.date_modified, locale, false)}</Isolate>}
                  />
                </div>
              </Card>
            ) : null}
          </div>

          {/*
            The save bar. §3.4: a long form gets a sticky footer that appears when
            the form is dirty — plus the pinned variant, which is what `persistent`
            is for and what these two cases need.

            **Create**: there is nothing to compare a blank object against, so
            "unsaved changes" is the wrong frame and the bar carries no discard —
            there is nothing to revert a blank form to. The back link is the way
            out. `saveLabel` is "Créer", which is what the suite clicks.

            **A trashed coupon**: the form opens already coerced to `draft` and
            therefore clean, and saving is the only restore path this panel has.
            Gating it on dirtiness would mean changing some unrelated field first.
          */}
          <SaveBar
            dirty={dirty}
            persistent={mode === "create" || trashed}
            saving={saving}
            onSave={() => void save()}
            onDiscard={
              mode === "edit"
                ? () => {
                    setDraft(draftOf(coupon));
                    setErrors({});
                    setTopError(null);
                  }
                : undefined
            }
            saveLabel={mode === "create" ? t("create") : undefined}
            /* §3.7: the write control is disabled with the same reason the stale
               marker gives, rather than failing at the network and blaming
               itself. */
            blockedReason={offlineReason}
          />
        </div>
      </PageBody>

      {picker !== null ? (
        <RestrictionPicker
          open
          onOpenChange={(open) => {
            if (!open) setPicker(null);
          }}
          kind={RESTRICTION_KIND[picker]}
          title={t(`restriction.${picker}`)}
          selected={draft[picker]}
          returnFocusTo={fieldId(picker)}
          onCommit={(ids, names) => {
            set(picker, ids);
            /* The picker is the only thing that knows the name of an id it has
               just added; the form cannot resolve one without a request. */
            setRefNames((current) => {
              const next = new Map(current);
              for (const [id, name] of names) next.set(id, { name, missing: false });
              return next;
            });
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={deleting === "force" ? t("confirm.deleteTitle") : t("confirm.trashTitle")}
        /*
         * Two different confirmations, because they are two different acts. A
         * trash is reversible and keeps the code — recreating it answers 409 —
         * while `?force=true` is permanent and frees the code. Nothing in the two
         * responses distinguishes them: both answer `{id, deleted: true}`.
         */
        body={deleting === "force" ? t("confirm.deleteBody") : t("confirm.trashBody")}
        confirmLabel={deleting === "force" ? t("deleteForever") : t("trash")}
        loading={saving}
        /*
         * §3.1: an irreversible act requires the record's identifier to be typed.
         * Only the permanent path asks — making the trash type it too would train
         * the typing away, and the trash is recoverable from this very screen.
         */
        requireTyped={
          deleting === "force"
            ? { value: coupon.code, label: t("confirm.typeCode", { code: coupon.code }) }
            : undefined
        }
        returnFocusTo={menuTriggerId}
        onConfirm={() => void remove(deleting === "force")}
      />
    </div>
  );
}
