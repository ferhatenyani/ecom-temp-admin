"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import type {
  AttributeTerm,
  GlobalAttribute,
  Product,
  ProductCategory,
  ProductSeo,
  Variation,
} from "@/lib/api/schemas/product";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
// From the dependency-free module, not the schema: this is a client component,
// and importing these through the Zod schema ships Zod's runtime to the browser.
import {
  CATALOG_VISIBILITIES,
  PRODUCT_STATUSES,
  PRODUCT_STATUS_TONE,
  PRODUCT_TYPES,
  STOCK_STATUSES,
  type ProductStatus,
} from "@/lib/product-status";
import { formatMoney } from "@/lib/format/money";
import { formatDate, formatWhen } from "@/lib/format/date";
import { useOnline } from "@/lib/use-online";
import { DetailGrid } from "@/components/ui/Detail";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Notice, SectionError, StaleBanner } from "@/components/ui/States";
import {
  CheckRow,
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
import { Isolate, Ltr } from "@/components/primitives/Ltr";
import { useToast } from "@/components/primitives/Toast";
import { ProductMedia } from "./ProductMedia";
import { ProductAttributes } from "./ProductAttributes";
import { ProductVariations } from "./ProductVariations";

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
 * `attributes` is **still** deliberately absent from what this form sends, and
 * the reason has hardened rather than expired. Replacing a variable product's
 * attribute list drops its *variation* attribute, and WooCommerce then clears
 * every variation's attribute map — measured on products 12 and 21, whose three
 * and two variations came back with `attributes: {}` and could no longer be told
 * apart. Read from source since: `ProductRepository::update()` is
 * `set_attributes($this->buildAttributes(…))`, a whole-list replace with no merge
 * of any kind, and `VariationService::variationAttributes()` makes a variation's
 * combination meaningful only while the parent still marks that attribute for
 * variations.
 *
 * **The attribute list is editable now, and it is `ProductAttributes` that edits
 * it — a separate card with a separate write.** That separation is the point.
 * Every key in *this* list is sent on every save of this form, which is right for
 * a name and a price and is exactly wrong for the attribute list: it would
 * rewrite the whole mapping whenever somebody fixed a typo in a description, so
 * any drift between what this page read and what is now stored would destroy
 * variations on an unrelated save. `ProductAttributes` PATCHes `{attributes: […]}`
 * alone, only when its own card is dirty, always with the complete list, and asks
 * before the three edits that orphan rows. `variable-product.ts` carries the
 * whole argument.
 *
 * `options` is absent for the reason the warning banner now states outright — see
 * the `options_problems` block further down. `tag_ids` is absent because nothing
 * on this screen edits it and **a field the form sends but never shows is a field
 * it can silently clobber**.
 *
 * **`image_id` and `gallery_image_ids` are here and are new**, and they arrive by
 * satisfying that same rule rather than by being excused from it: both are on
 * screen, in `ProductMedia` beside the descriptions, with a control apiece. The
 * rule is the reason they were absent and it is the reason the way to add them
 * was to draw them — not to start sending two more keys quietly.
 *
 * Which leaves exactly one key in `Draft` with no control, and it is not one:
 * `seo` travels whole (see below) and three of its five parts are edited on
 * screen while `robots` and `overrides` are shown read-only. Every other key in
 * this list has a visible control. That is the invariant this docblock exists to
 * keep, and the list being written out by hand is what makes it checkable.
 *
 * `image_id` is a **string** on the draft where the API takes a number, which is
 * `stock_quantity`'s trick for a different reason. There it keeps an empty box
 * distinguishable from a count of zero. Here it keeps a *typo* reachable:
 * `Number("12a")` is `NaN` and `JSON.stringify(NaN)` is `null`, and `null` is one
 * of the three values `ProductInput` reads as *clear the featured image* — so a
 * body built through `Number()` would answer 200 and quietly detach the picture
 * for text nobody meant as a number. The string rides as typed, the API answers
 * *"Must be an attachment id, or 0 to clear."*, and it binds to the control like
 * any other refusal. `new-product.ts` names the same trap as the `?? 0` one and
 * takes the other way out of it, because a create that drops the key gets a 201
 * with nothing to say.
 *
 * `gallery_image_ids` is **not sorted**, and that is the one place it parts
 * company with `category_ids` two fields up. Order is preserved end to end —
 * `array_unique` keeps first position, `set_gallery_image_ids()` stores a
 * sequence, the presenter reads it back in order — and it is the order the
 * storefront shows the pictures in. `ProductMedia`'s docblock carries the three
 * hops. Sorting a gallery by attachment id would rearrange the shop.
 *
 * **`seo` is here and is new**, and it travels whole. `mustBeSeo` on the mock and
 * the live API both refuse a partial block — `title`, `description`, `canonical`,
 * `overrides` and a `robots` carrying `index`, `follow` and `directive` all have
 * to be present — and partial behaviour is unmeasured anyway, so the draft holds
 * the entire object and writes back the parts nothing on screen edited exactly as
 * they were read.
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
  seo: ProductSeo;
  image_id: string;
  gallery_image_ids: number[];
};

function draftOf(product: Product): Draft {
  return {
    name: product.name,
    slug: product.slug,
    /*
     * `trash` is readable and not writable — a product is trashed by DELETE and
     * never by a PATCH, and `?status=trash` is a 400. So the picker's value is
     * coerced to the status the product would return to, and the *stored* status
     * is shown as a badge in the aside beside it.
     */
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
    /*
     * Sorted, and the sort is what makes the dirty check honest rather than
     * cosmetic: `dirty` is a structural comparison, so unticking a category and
     * re-ticking it would otherwise move the id to the end of the array and leave
     * a form that is identical to the stored record reporting unsaved changes. A
     * category list is a set on both sides of the wire, so ordering it costs
     * nothing.
     */
    category_ids: [...product.category_ids].sort((a, b) => a - b),
    // Spread, not rebuilt: `productSeo` is a loose object and any key the API
    // adds tomorrow travels back untouched rather than being dropped by a
    // hand-written literal.
    seo: { ...product.seo },
    /*
     * `0` reads as *no featured image* and is written back as `""`, which is the
     * same fact in the form's own vocabulary: an empty box is what "there is no
     * image" looks like, and a box reading `0` is a number somebody would have
     * to be told is not an id. `ProductInput` normalises `''`, `null` and `0` to
     * one value on the way back in, so the round trip is exact.
     */
    image_id: product.image_id === 0 ? "" : String(product.image_id),
    /*
     * Copied and **not sorted** — see the docblock. The dirty check is a
     * structural comparison, so this is also what makes reordering the gallery
     * register as a change at all: sorted, moving the third picture to the front
     * would produce an array identical to the stored one and a save bar that
     * never appeared.
     */
    gallery_image_ids: [...product.gallery_image_ids],
  };
}

/* ─────────────────────────────────────────────────────── the client's rules ───
 *
 * **English, and that is the point.** These three messages are quoted verbatim
 * from the live API — "A product name cannot be emptied.", "Must be a number.",
 * "Cannot be negative." — so a field that refuses locally and the same field
 * refused by the server say the identical sentence, and nobody has to wonder
 * whether they are looking at two different problems.
 *
 * **Nothing here is a rule the server does not hold**, and the principle stands
 * while **both of the facts this block used to rest it on were wrong**. They are
 * struck through rather than deleted, because each is a claim a reader would
 * otherwise carry away from a screen that no longer makes it:
 *
 * ~~"there is no `sale_price <= regular_price` check: nothing has measured
 * whether the API rejects an inverted pair"~~ — **overturned, read from source.**
 * `Products\ProductInput::validateSalePrice()` refuses the pair with *"Cannot be
 * higher than the regular price."* under `fields.sale_price`, whenever **both**
 * prices are in one payload — which on this form they always are, because the
 * draft sends every key. There is a second guard as well and it is asymmetric:
 * `ProductService::guardSalePriceAgainstStored()` is wired into `update()` and
 * **not** into `create()`, and compares a lone `sale_price` against the *stored*
 * regular price. This screen cannot reach it — a lone `sale_price` is a body it
 * never builds — so the pair-in-one-payload rule is the only one that fires
 * here, and it fires on the server.
 *
 * **No local copy of that comparison was added**, and that is now a decision
 * about a rule the server keeps rather than about one nobody had measured. Two
 * reasons, and the second is the load-bearing one: `validate` is per-field and a
 * cross-field comparison does not fit it, and `orders/new-order.ts`'s standing
 * argument about the three amount sentences applies — a second copy of a
 * comparison the server already makes can only become a second authority that
 * drifts. The API's sentence binds to `sale_price` like any other 400.
 *
 * ~~"`weight` gets no numeric rule either… the API validates it as a *string*,
 * so '1,5 kg' is accepted there"~~ — **overturned, read from source.**
 * `ProductInput::normalize()` runs `!is_numeric($payload['weight']) || (float)
 * $payload['weight'] < 0` and answers *"Must be a non-negative number."* — one
 * sentence for both failures. `''` and `null` clear it, which is why the rule
 * below returns on the empty string. So "1,5 kg" is a 400 and always has been:
 * the panel was carrying a permission the shop does not have, and the effect was
 * that somebody typing a unit into the box learned it from a failed save instead
 * of from the field. The mock refuses it now too, which is how this screen found
 * out.
 *
 * `weight()` is therefore a real rule and it is deliberately the **looser** of
 * the two directions: `Number.isFinite(Number(v))` where PHP runs `is_numeric`.
 * The two agree on everything a person types; where they part — `"0x1A"`, a
 * whitespace-only box — this accepts and the server refuses, which costs a round
 * trip. The other direction would print a refusal on a value that saves, and an
 * advisory rule that is wrong in *that* direction is worse than no rule at all.
 *
 * **They do not block the save**, and that is deliberate. The API is the
 * authority — the panel does not carry a second copy of the rules, which is the
 * same position `OrderActions` takes on the status table — so these speak on blur
 * to save a round trip and the request goes anyway. A `blockedReason` on the save
 * bar is reserved for a state the server cannot resolve at all, which is being
 * offline.
 */

const MONEY = /^-?\d+(\.\d+)?$/;
const INTEGER = /^-?\d+$/;

function requiredName(value: string): string | undefined {
  return value.trim() === "" ? "A product name cannot be emptied." : undefined;
}

function money(value: string): string | undefined {
  // Clearing a price is how a sale ends, so the empty string is a real value.
  if (value === "") return undefined;
  if (!MONEY.test(value)) return "Must be a number.";
  return Number.parseFloat(value) < 0 ? "Cannot be negative." : undefined;
}

function quantity(value: string): string | undefined {
  if (value === "") return undefined;
  if (!INTEGER.test(value)) return "Must be a number.";
  return Number.parseInt(value, 10) < 0 ? "Cannot be negative." : undefined;
}

/**
 * `ProductInput::normalize()`'s weight rule, in the API's own sentence — one
 * message for both failures, because the source has one.
 *
 * `""` returns clean: an empty weight is how a weight is removed, and the source
 * reads `''` and `null` as the same *clear it*.
 */
function weight(value: string): string | undefined {
  if (value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? undefined
    : "Must be a non-negative number.";
}

export function ProductDetail({
  locale,
  product: initial,
  fetchedAt,
  variations,
  categories,
  attributes,
  terms,
  canPickMedia,
}: {
  locale: string;
  product: Product;
  /** When the server rendered this page. The age §3.7's stale marker reports. */
  fetchedAt: number;
  /** `null` means the section could not load; `[]` means there are none. */
  variations: Variation[] | null;
  /** `null` means the vocabulary could not load — see the note on the section. */
  categories: ProductCategory[] | null;
  attributes: GlobalAttribute[];
  terms: Record<string, AttributeTerm[]>;
  /**
   * `ac_manage_content`, resolved on the server from `/auth/me` — which is not
   * this route's capability. Every `/media` route sits behind it and this one
   * sits behind `ac_manage_products`, so the media controls degrade for a
   * Manager rather than rendering a `ForbiddenState` inside a product form.
   * `ProductMedia` carries the whole argument, and `ProductsList` takes the
   * identical prop for the create drawer.
   */
  canPickMedia: boolean;
}) {
  const t = useTranslations("products");
  const tDetail = useTranslations("products.detail");
  const tStatus = useTranslations("productStatus");
  const tStock = useTranslations("stockStatus");
  const tVisibility = useTranslations("catalogVisibility");
  const tStates = useTranslations("states");
  const router = useRouter();
  const toast = useToast();

  const [product, setProduct] = useState(initial);
  const [draft, setDraft] = useState(() => draftOf(initial));
  /** Keyed by the API's own field name, which is what a 400 sends. */
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** A refusal that names no field at all — the 400 with no `details`, a 500. */
  const [saveError, setSaveError] = useState<string | null>(null);

  const online = useOnline();

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    // Clearing this field's error on edit, and only this field's: the API lists
    // every bad field at once and the others are still wrong.
    clearError(key as string);
  };

  const clearError = (key: string) =>
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });

  /** The SEO block is one API field, so its three controls clear one key. */
  const setSeo = <K extends keyof ProductSeo>(key: K, value: ProductSeo[K]) => {
    setDraft((current) => ({ ...current, seo: { ...current.seo, [key]: value } }));
    clearError("seo");
  };

  const toggleCategory = (id: number, on: boolean) =>
    set(
      "category_ids",
      on
        ? [...draft.category_ids, id].sort((a, b) => a - b)
        : draft.category_ids.filter((current) => current !== id),
    );

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(product));
  const currency = "DZD";
  const asMoney = (value: string) => formatMoney(value, currency, locale);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { ...draft };

      /*
       * **`stock_quantity` is dropped in silence when the row manages no stock** —
       * a 200 with the field ignored, which looks exactly like a save that
       * worked. So the key is removed from the body rather than sent and the
       * answer trusted, and when it *is* sent an empty field goes as `null`
       * rather than as 0: nothing being counted and a count of zero are different
       * facts about a shelf.
       */
      if (draft.manage_stock) {
        body.stock_quantity =
          draft.stock_quantity === "" ? null : Number(draft.stock_quantity);
      } else {
        delete body.stock_quantity;
      }

      /*
       * **Trimmed and otherwise sent as typed — never through `Number()`.**
       * `ProductInput` runs `is_numeric()` and casts, so `"5001"` and `5001` are
       * one value to it and `""` is the *clear the featured image* value beside
       * `null` and `0`. What a cast here would do instead is turn `"12a"` into
       * `NaN`, which `JSON.stringify` writes as `null` — a 200 that silently
       * detaches the picture. The string keeps the refusal reachable, and the
       * refusal is a sentence naming the value back at the person who typed it.
       *
       * `gallery_image_ids` needs nothing: it is a `number[]` on the draft
       * because every value in it came from a picker or from the fetched body,
       * and the one place a person can type one — the capability fallback's add
       * box — parses before it appends.
       */
      body.image_id = draft.image_id.trim();

      return acWrite<Product>("PATCH", `/products/${product.id}`, body);
    },
    /* Cleared as the save starts, so a second failure with the same list passes
       through empty and `ErrorSummary` re-announces it. */
    onMutate: () => {
      setErrors({});
      setSaveError(null);
    },
    onSuccess: (next) => {
      if (!next) {
        setSaveError(tDetail("saveFailed"));
        return;
      }
      setProduct(next);
      setDraft(draftOf(next));
      toast.show(tDetail("saved"));
      // The list's cached page is now stale in one row. Refreshing the route is
      // cheaper and more honest than patching a cache entry by hand.
      router.refresh();
    },
    onError: (error: unknown) => {
      if (error instanceof BrowserApiError) {
        /**
         * A 400 lists **every** bad field, so all of them land on their own
         * controls rather than being collapsed into one line — measured, four
         * fields came back in a single response. The messages are the API's
         * English; they name the problem precisely and a translated generic
         * would throw that away.
         */
        const fields = error.fields;
        if (fields && Object.keys(fields).length > 0) {
          setErrors(fields);
          return;
        }

        /**
         * A duplicate SKU is a **409**, not a 400, and it names the SKU under
         * `details.sku` rather than under `details.fields`. Measured:
         * `{"code":"conflict","message":"That SKU is already in use.","details":{"sku":"AC-TAP-001"}}`.
         * Mapped onto the SKU field, because that is the field the person has to
         * change, and the 409's own message is worth surfacing verbatim.
         */
        if (error.status === 409 && typeof error.details.sku === "string") {
          setErrors({ sku: error.message || tDetail("skuTaken") });
          return;
        }

        setSaveError(error.message);
        return;
      }

      setSaveError(tDetail("saveFailed"));
    },
  });

  /* ─────────────────────────────────────────────── the failures, as a summary ──
   *
   * §3.4: a form that failed submission shows a summary at the top listing each
   * failure as a link to its field, with focus moved to it.
   *
   * **The orphan case is the one worth spelling out.** A 400 names every bad
   * field including ones this form does not render — `tag_ids` is writable and
   * has no control here, and `stock_quantity` has no control while the product
   * manages no stock — and there is nowhere to send a person for those.
   * `image_id` used to be on that list and is not any more, which is the visible
   * half of sub-task 5: it has a control now, so its refusal has somewhere to go.
   * `ErrorSummary` renders a failure with no `id` as text rather than as a
   * link, which is the honest half; the label is what stops it reading as
   * machinery. `FIELD_LABELS` therefore covers every *writable* key rather than
   * only the rendered ones, and a key outside that set falls back to the raw name
   * — a genuinely unknown field is a bug report, and the name is the only part of
   * it worth carrying.
   *
   * This replaces a hand-rolled banner that joined `key: message` pairs with
   * middots, which put `catalog_visibility` on screen as though it were a label.
   */
  const FIELD_LABELS: Record<string, string> = {
    name: tDetail("name"),
    slug: tDetail("slug"),
    sku: tDetail("sku"),
    type: tDetail("type"),
    status: tDetail("status"),
    featured: tDetail("featured"),
    catalog_visibility: tDetail("visibility"),
    regular_price: tDetail("regularPrice"),
    sale_price: tDetail("salePrice"),
    weight: tDetail("weight"),
    manage_stock: tDetail("manageStock"),
    stock_quantity: tDetail("stockQuantity"),
    stock_status: tDetail("stockStatus"),
    short_description: tDetail("shortDescription"),
    description: tDetail("description"),
    category_ids: tDetail("categories"),
    seo: tDetail("seo"),
    attributes: tDetail("attributes"),
    options: tDetail("options"),
    tag_ids: tDetail("tags"),
    image_id: tDetail("image"),
    gallery_image_ids: tDetail("gallery"),
  };

  const fieldId = (key: string) => `product-${key}`;

  const problems = product.options_problems ?? [];

  /*
   * Every category the product carries, even one the vocabulary does not list.
   * Without the union an id the `/product-categories` page did not return would
   * have no checkbox, so it would read as unticked and the next save would drop
   * it — a field cleared by a screen that never showed it.
   */
  const knownCategories = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const categoryRows: { id: number; name: string; count: number | null }[] = [
    ...(categories ?? []).map((c) => ({ id: c.id, name: c.name, count: c.count })),
    ...draft.category_ids
      .filter((id) => !knownCategories.has(id))
      .map((id) => ({ id, name: String(id), count: null })),
  ];

  /** Which keys have a control on screen right now, and can therefore be linked. */
  const linkable = new Set<string>([
    "name",
    "slug",
    "sku",
    "type",
    "status",
    "featured",
    "catalog_visibility",
    "regular_price",
    "sale_price",
    "weight",
    "manage_stock",
    "stock_status",
    "short_description",
    "description",
    "seo",
    /* Both unconditional: `ProductMedia` renders on every product and on both
       sides of the capability branch, so the two ids always have a target — the
       picker's button or the fallback's field for one, the gallery group for the
       other. */
    "image_id",
    "gallery_image_ids",
    ...(draft.manage_stock ? ["stock_quantity"] : []),
    ...(categories !== null && categoryRows.length > 0 ? ["category_ids"] : []),
  ]);

  const failures: FormFailure[] = Object.entries(errors).map(([key, message]) => ({
    id: linkable.has(key) ? fieldId(key) : undefined,
    label: FIELD_LABELS[key] ?? key,
    message,
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* §3.7's fifth state: the age of what is on screen, and the save bar
          disabled below with the same reason. */}
      {!online ? (
        <StaleBanner time={formatWhen(new Date(fetchedAt).toISOString(), locale)} />
      ) : null}

      {/*
        `options_problems` first, because it is the only thing on this screen that
        means something is broken *right now*. The API sends it only when the
        stored option document has a group it could not read, and a cart holding
        this product is already refusing to check out.
      */}
      {problems.length > 0 ? (
        <Notice role="alert" tone="warning" title={tDetail("optionsProblemsTitle")}>
          <p className="text-ui-label">{tDetail("optionsProblemsBody")}</p>
          <ul className="flex list-disc flex-col gap-1 ps-4 text-ui-label">
            {problems.map((problem) => (
              /* The API's own English, verbatim: it names the group by its
                 1-based position in the stored document, which is the only handle
                 there is — the broken group is absent from `options.groups`. */
              <li key={problem} dir="auto">
                {problem}
              </li>
            ))}
          </ul>
          {/*
            **The copy this branch corrected.** It used to say that saving from
            this screen rewrites only the readable groups and destroys the rest —
            which is true of a whole-body PATCH containing `options`
            (ADMIN_PANEL.md:1587-1596, and the mock reproduces it on product 208)
            and is *not* true of this form, whose `Draft` has never contained
            `options`. A warning about a destruction the screen cannot perform is
            a warning that trains people to distrust the ones that are real.
            Making the screen match the old copy instead was rejected: it would
            mean an edit to a price silently deleting two option groups, with no
            confirmation, as a side effect — which §3.1 would require a
            `ConfirmDialog` for even if it were something anybody had asked for.
          */}
          <p className="text-ui-label">{tDetail("optionsProblemsSafe")}</p>
        </Notice>
      ) : null}

      {product.status === "trash" ? (
        <Notice tone="danger" title={tDetail("trashedTitle")}>
          <p className="text-ui-label">{tDetail("trashed")}</p>
        </Notice>
      ) : null}

      {saveError ? (
        <Notice role="alert" tone="danger" title={tDetail("saveFailed")}>
          <p className="text-ui-label">{saveError}</p>
        </Notice>
      ) : null}

      <ErrorSummary failures={failures} />

      <DetailGrid
        main={
          <>
            {/* ------------------------------------------------ identity --- */}
            {/*
              **The footnote this card used to carry is gone**, and it is worth
              saying what it said: *"no image on this screen — the media library
              answers 403 for the Products permission, so neither the preview nor
              the choice of an image is offered here."* Half of that is still
              true and is the reason `ProductMedia` has a fallback at all; the
              conclusion drawn from it was not. A library a role cannot read is a
              reason to degrade the control, not to leave the two writable image
              fields off the only screen that edits a product.
            */}
            <Card title={tDetail("identity")}>
              <div className="flex flex-col gap-4">
                <TextField
                  id={fieldId("name")}
                  label={tDetail("name")}
                  value={draft.name}
                  onChange={(v) => set("name", v)}
                  error={errors.name}
                  validate={requiredName}
                />
                <TextField
                  id={fieldId("sku")}
                  label={tDetail("sku")}
                  value={draft.sku}
                  onChange={(v) => set("sku", v)}
                  error={errors.sku}
                  isolate
                  hint={tDetail("skuHint")}
                />
                <TextField
                  id={fieldId("slug")}
                  label={tDetail("slug")}
                  value={draft.slug}
                  onChange={(v) => set("slug", v)}
                  error={errors.slug}
                  isolate
                  hint={draft.slug === "" ? tDetail("slugEmpty") : undefined}
                />
                <Select
                  id={fieldId("type")}
                  label={tDetail("type")}
                  value={draft.type}
                  onChange={(v) => set("type", v)}
                  options={PRODUCT_TYPES.map((s) => ({ value: s, label: t(`type.${s}`) }))}
                  error={errors.type}
                  hint={
                    product.variations.length > 0
                      ? tDetail("typeHasVariations")
                      : undefined
                  }
                />
              </div>
            </Card>

            {/* ------------------------------------------------- pricing --- */}
            <Card
              title={tDetail("pricing")}
              /* A `description` and not a `footnote`: §3.4 wants help text
                 written before the problem rather than after it, and this is the
                 sentence that explains why both price fields on a variable
                 product are empty. Under the heading it is read first; under the
                 weight field it was read last, and looked like it belonged to
                 the weight. */
              description={
                product.type === "variable" ? tDetail("pricingVariable") : undefined
              }
            >
              <div className="flex flex-col gap-4">
                {/* The pair shares a row where there is room for it and wraps at
                    340px — `NumberField` carries the `flex-1` for exactly this. */}
                <div className="flex flex-wrap gap-4">
                  <NumberField
                    id={fieldId("regular_price")}
                    label={tDetail("regularPrice")}
                    value={draft.regular_price}
                    onChange={(v) => set("regular_price", v)}
                    error={errors.regular_price}
                    validate={money}
                  />
                  <NumberField
                    id={fieldId("sale_price")}
                    label={tDetail("salePrice")}
                    value={draft.sale_price}
                    onChange={(v) => set("sale_price", v)}
                    error={errors.sale_price}
                    validate={money}
                  />
                </div>
                {/*
                  The effective price is computed by the API and refused on write —
                  measured, `price` is silently dropped. Shown read-only because on
                  a variable product it is the only place the resolved figure
                  appears, and because a form with a regular price of "" beside a
                  list row reading 12 500 DA is otherwise unexplainable.
                */}
                <ReadOnlyField
                  label={tDetail("effectivePrice")}
                  value={
                    product.price === "" ? (
                      <span className="text-ui-subtle">{t("noPrice")}</span>
                    ) : (
                      <Ltr>{asMoney(product.price)}</Ltr>
                    )
                  }
                  reason={tDetail("effectivePriceReason")}
                />
                {/* `validate`, and it is **new**: this field carried no rule on
                    the strength of a claim that the API takes `weight` as a
                    string. It does not — *"Must be a non-negative number."*,
                    read from source — so "1,5 kg" was a 400 the panel let
                    somebody discover by pressing save. See the block above,
                    which strikes the old claim rather than erasing it. */}
                <NumberField
                  id={fieldId("weight")}
                  label={tDetail("weight")}
                  value={draft.weight}
                  onChange={(v) => set("weight", v)}
                  error={errors.weight}
                  validate={weight}
                />
              </div>
            </Card>

            {/* ----------------------------------------------- inventory --- */}
            <Card title={tDetail("inventory")}>
              <div className="flex flex-col gap-4">
                <Switch
                  id={fieldId("manage_stock")}
                  label={tDetail("manageStock")}
                  checked={draft.manage_stock}
                  onChange={(v) => set("manage_stock", v)}
                  hint={tDetail("manageStockHint")}
                  error={errors.manage_stock}
                />
                {draft.manage_stock ? (
                  <TextField
                    id={fieldId("stock_quantity")}
                    label={tDetail("stockQuantity")}
                    value={draft.stock_quantity}
                    onChange={(v) => set("stock_quantity", v)}
                    error={errors.stock_quantity}
                    validate={quantity}
                    inputMode="numeric"
                    isolate
                  />
                ) : null}
                <Select
                  id={fieldId("stock_status")}
                  label={tDetail("stockStatus")}
                  value={draft.stock_status}
                  onChange={(v) => set("stock_status", v)}
                  options={STOCK_STATUSES.map((s) => ({ value: s, label: tStock(s) }))}
                  error={errors.stock_status}
                />
              </div>
            </Card>

            {/* --------------------------------------------- description --- */}
            <Card title={tDetail("descriptions")} footnote={tDetail("htmlNote")}>
              <div className="flex flex-col gap-4">
                <TextArea
                  id={fieldId("short_description")}
                  label={tDetail("shortDescription")}
                  value={draft.short_description}
                  onChange={(v) => set("short_description", v)}
                  error={errors.short_description}
                  rows={3}
                />
                <TextArea
                  id={fieldId("description")}
                  label={tDetail("description")}
                  value={draft.description}
                  onChange={(v) => set("description", v)}
                  error={errors.description}
                  rows={6}
                />
              </div>
            </Card>

            {/* -------------------------------------------------- images --- */}
            {/*
              **After the descriptions rather than beside the name**, which is
              where an image usually goes and is the wrong place here. This is a
              tall block — a row per gallery entry, each carrying a 44px reorder
              pair — and it sits in a column that a shopkeeper opens to change a
              price or a stock count far more often than a picture. Putting it
              second would push both of those below the fold on a phone for the
              sake of the field they touch least. Filed with the descriptions
              instead, which is what it is: the product's content.

              The controls, the overlay and the capability branch are
              `ProductMedia`'s; the two draft keys and everything about what is
              sent stay here, which is the split this file's own docblock
              requires.
            */}
            <ProductMedia
              canPickMedia={canPickMedia}
              storedImage={product.image}
              storedGallery={product.gallery}
              imageId={draft.image_id}
              onImageIdChange={(next) => set("image_id", next)}
              galleryIds={draft.gallery_image_ids}
              onGalleryChange={(next) => set("gallery_image_ids", next)}
              imageError={errors.image_id}
              galleryError={errors.gallery_image_ids}
              disabled={save.isPending}
              fieldId={fieldId}
            />

            {/* ----------------------------------------------------- SEO --- */}
            {/*
              Writable, and the whole `seo` object goes back on every save — the
              API refuses a partial block and partial behaviour is unmeasured
              anyway, so `robots` and `overrides` are carried through exactly as
              they were read.

              `overrides` is *surfaced* rather than edited: it is the API's own
              record of which fields have stopped being derived from the product,
              and a person editing a title deserves to know that the title will
              now stay where they put it. Whether writing a field adds its name to
              that list is the API's business and has not been measured, so the
              panel reports what it was told and does not invent an entry.
            */}
            <Card
              title={tDetail("seo")}
              /* Under the heading rather than at the foot, and for a second
                 reason beyond §3.4's: the last control in this card carries its
                 own "derived from the product's status" line, and a card footnote
                 landed directly beneath it — two greyed sentences in a row, both
                 opening with the same word, describing different things. */
              description={
                draft.seo.overrides.length === 0
                  ? tDetail("seoDerived")
                  : tDetail("seoOverrides", {
                      fields: draft.seo.overrides.join(", "),
                    })
              }
            >
              <div className="flex flex-col gap-4">
                <TextField
                  id={fieldId("seo")}
                  label={tDetail("seoTitle")}
                  value={draft.seo.title}
                  onChange={(v) => setSeo("title", v)}
                  error={errors.seo}
                />
                <TextArea
                  label={tDetail("seoDescription")}
                  value={draft.seo.description}
                  onChange={(v) => setSeo("description", v)}
                  rows={2}
                />
                <TextField
                  label={tDetail("seoCanonical")}
                  value={draft.seo.canonical}
                  onChange={(v) => setSeo("canonical", v)}
                  isolate
                  hint={tDetail("seoCanonicalHint")}
                />
                {/* Read-only, and not for want of a control: `index` and `follow`
                    are booleans while `directive` is the sentence derived from
                    them, and nothing has measured whether the API recomputes one
                    from the other. Writing a toggle would risk storing a pair that
                    contradicts itself, which is worse than not offering it. */}
                <ReadOnlyField
                  label={tDetail("seoRobots")}
                  value={<Ltr numeric={false}>{draft.seo.robots.directive}</Ltr>}
                  reason={tDetail("seoRobotsReason")}
                />
              </div>
            </Card>

            {/* ---------------------------------------------- attributes --- */}
            {/*
              **Editable now, and it is its own card with its own write.** The
              footnote that used to sit here said the list was read-only because
              sending `attributes` on a variable product wipes every variation's
              attribute map. That is still true of a *partial* list — see the
              `Draft` docblock above and `variable-product.ts` — and the way to
              have the editor at all was to make a partial list unreachable, not
              to add one more key to this form.
            */}
            <ProductAttributes
              product={product}
              variations={variations}
              attributes={attributes}
              terms={terms}
              onSaved={(next) => {
                setProduct(next);
                /*
                 * The form's draft is re-seeded too, and it has to be: the write
                 * answered with the whole product, so anything the server derived
                 * from the attribute change — a variable product's `price`
                 * collapsing when its last variation axis went — is now stale in
                 * a form the person may not have touched.
                 */
                setDraft(draftOf(next));
              }}
            />

            {/* ---------------------------------------------- variations --- */}
            {/*
              **Editable now**, and the comment this replaces is exactly why it
              was not: *"`POST /products/{id}/variations` is refused by the
              panel's own allowlist and `tests/boundary.test.ts` asserts the
              refusal. A route no screen reaches must not be reachable by guessing
              a URL."* True at the time and no longer — `ProductVariations` is the
              screen, the four allowlist entries landed in the same change, and
              the boundary case that asserted the refusal was inverted beside
              them rather than deleted.

              **Rendered whenever the product has a variation axis, not only when
              it already has rows.** The old test was `product.variations.length >
              0`, which is right for a read-only list and wrong for an editor: a
              variable product whose axes were just chosen has no variations yet,
              and that is precisely the product that needs the generate button.
              `ProductVariations` decides what to say for each of those states.
            */}
            {product.type === "variable" || product.variations.length > 0 ? (
              <ProductVariations
                product={product}
                variations={variations}
                terms={terms}
                attributes={attributes}
                locale={locale}
              />
            ) : null}
          </>
        }
        aside={
          <>
            {/* --------------------------------------------- publication --- */}
            {/*
              Status, visibility and featured under **one** heading, and that is a
              correction made from the screenshot rather than from the spec. As
              two cards they read "Statut / Statut" and "Visibilité au catalogue /
              Visibilité au catalogue" — a card title and the only control's label
              are the same words twice, six pixels apart, on both. A heading that
              names the group instead lets each control keep the visible label
              §3.4 requires without the aside stuttering twice.
            */}
            <Card title={tDetail("publication")}>
              <div className="flex flex-col gap-4">
                <Select
                  id={fieldId("status")}
                  label={tDetail("status")}
                  value={draft.status}
                  onChange={(v) => set("status", v)}
                  options={PRODUCT_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))}
                  error={errors.status}
                />
                <Select
                  id={fieldId("catalog_visibility")}
                  label={tDetail("visibility")}
                  value={draft.catalog_visibility}
                  onChange={(v) => set("catalog_visibility", v)}
                  options={CATALOG_VISIBILITIES.map((s) => ({
                    value: s,
                    label: tVisibility(s),
                  }))}
                  error={errors.catalog_visibility}
                />
                <Switch
                  id={fieldId("featured")}
                  label={tDetail("featured")}
                  checked={draft.featured}
                  onChange={(v) => set("featured", v)}
                  error={errors.featured}
                />
              </div>
            </Card>

            {/* ----------------------------------------------- categories --- */}
            {/*
              **Writable, and it is the cheapest real feature on this screen**:
              `category_ids` is measured writable, the vocabulary is already
              fetched for the list's filter drawer, and a product's classification
              is the field a shopkeeper changes most often after its price.

              A failed vocabulary is a `SectionError` rather than an empty list of
              boxes, because an empty multi-select is indistinguishable from a
              product with no categories and one save would make that true.
            */}
            <Card title={tDetail("categories")}>
              {categories === null ? (
                <SectionError>{tDetail("sectionFailed")}</SectionError>
              ) : categoryRows.length === 0 ? (
                <p className="text-ui-body text-ui-muted">{tDetail("noCategories")}</p>
              ) : (
                <div
                  id={fieldId("category_ids")}
                  role="group"
                  aria-label={tDetail("categories")}
                  /* Focusable only as a target: `ErrorSummary` links a failure to
                     a DOM id and calls `.focus()`, and a bare `<div>` would
                     swallow that silently. `-1` keeps it out of the tab order. */
                  tabIndex={-1}
                  /*
                   * No cap and no inner scroller, which an earlier draft had at
                   * `max-h-64`: it cut the seventh category in half with nothing
                   * to say the list continued, and a scroll region nested inside
                   * a column that already scrolls traps the wheel and hides rows.
                   * The aside is a column; a long vocabulary makes it a long
                   * column, which is legible.
                   */
                  className="ui-ring -mx-2 flex flex-col gap-1 rounded-ui-md outline-none"
                >
                  {categoryRows.map((category) => (
                    <CheckRow
                      key={category.id}
                      checked={draft.category_ids.includes(category.id)}
                      onChange={(on) => toggleCategory(category.id, on)}
                      label={category.name}
                      count={category.count}
                    />
                  ))}
                </div>
              )}
            </Card>

            {/* --------------------------------------------------- record --- */}
            <Card title={tDetail("record")}>
              <DataList>
                <DataRow label={tDetail("storedStatus")}>
                  {/* The **stored** status beside the picker's draft value. They
                      differ on exactly one value — `trash`, which is readable and
                      not writable — and that is the case worth seeing, so the
                      label says *stored* rather than repeating "Statut" and
                      leaving a reader to work out why the two disagree. */}
                  <Badge tone={PRODUCT_STATUS_TONE[product.status]}>
                    {tStatus(product.status)}
                  </Badge>
                </DataRow>
                <DataRow label={tDetail("created")}>
                  {/* `Isolate`, not `Ltr`: ICU puts RTL marks inside the Arabic
                      form on purpose and forcing dir="ltr" over them renders the
                      date wrong. See primitives/Ltr.tsx. */}
                  <Isolate>{formatDate(product.date_created, locale)}</Isolate>
                </DataRow>
                <DataRow label={tDetail("modified")}>
                  <Isolate>{formatWhen(product.date_modified, locale)}</Isolate>
                </DataRow>
                <DataRow label={tDetail("identifier")}>
                  <Ltr>{product.id}</Ltr>
                </DataRow>
              </DataList>
            </Card>
          </>
        }
      />

      {/*
        The save bar. §3.4: a long form gets a sticky footer that appears only when
        the form is dirty — and it is a *sticky* bar in the form's own column, not
        the `position: fixed` one this screen used to carry, which had to know the
        tab bar's height, the safe-area inset and the sidebar's width.

        It sits after the grid rather than inside `main`, and that is the
        difference between working and nearly working: three of this form's
        controls are in the aside, which collapses **below** main at every width
        under `lg`, so a bar anchored to the main column would go out of view at
        exactly the moment someone ticked a category on a phone.
      */}
      <SaveBar
        dirty={dirty}
        saving={save.isPending}
        onSave={() => save.mutate()}
        onDiscard={() => {
          setDraft(draftOf(product));
          setErrors({});
          setSaveError(null);
        }}
        /* §3.7: the write control is disabled with the same reason the stale
           marker gives, rather than failing at the network and blaming itself. */
        blockedReason={online ? undefined : tStates("offlineWrites")}
      />
    </div>
  );
}
