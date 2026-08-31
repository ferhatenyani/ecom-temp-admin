"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { BrowserApiError, acWrite } from "@/lib/api/browser";
import type { Product, ProductCategory } from "@/lib/api/schemas/product";
import { useOnline } from "@/lib/use-online";
import { formatBytes } from "@/lib/media";
import { Drawer } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { MediaPicker } from "@/components/ui/MediaPicker";
import { MAX_BYTES, MediaUploadFields, useMediaUpload } from "@/components/ui/MediaUpload";
import {
  CheckRow,
  ErrorSummary,
  NumberField,
  Section,
  Select,
  Switch,
  TextArea,
  TextField,
  type FormFailure,
} from "@/components/ui/Form";
import { Icon } from "@/components/primitives/Icon";
import { useToast } from "@/components/primitives/Toast";
import {
  CREATABLE_STATUSES,
  CREATABLE_STOCK_STATUSES,
  CREATABLE_TYPES,
  buildPayload,
  draftProblems,
  emptyDraft,
  type ProductDraft,
} from "./new-product";

/**
 * Create a product. `POST /products`.
 *
 * ## Why the panel has this at all, and why it did not until now
 *
 * `POST /products` has existed, been guarded and been covered by the backend's
 * own suite the whole time. What was missing was a screen, and
 * `lib/api/allowlist.ts` therefore refused the route on the rule the whole file
 * follows — *a route no screen reaches is a route nobody can reach by guessing a
 * URL* — while `ProductsList`'s empty state said so where the primary action
 * would be: *"a 'New product' button here would be a button that 404s."*
 *
 * The reason no screen existed is written into the shape of this one. A product
 * is the largest record in the shop: variations, option sets, attributes and SEO
 * are four separate editors on the detail screen, three of them cannot honestly
 * be filled in before the product exists, and a create form that tried to carry
 * all four is a form nobody finishes building. So this drawer is **the core
 * only** — name, type, status, SKU, the two prices, both descriptions,
 * categories, stock and one image — and the 201 routes straight to the detail,
 * which is where the other four already live. `new-product.ts` argues each
 * omission by name.
 *
 * ## A `Drawer`, and both extra screens are **steps** rather than overlays
 *
 * §3.1 gives the Drawer *"a create form long enough to need room"*, which this
 * is: five sections and a picture. `md` rather than `sm`, because the category
 * list and the description boxes both want the width.
 *
 * §3.1 also says overlays are **never nested** — *"a modal that needs a second
 * modal is a modal that needs steps"* — and this form needs two things that used
 * to be overlays. `BannerDrawer` is the pattern for the first and it is copied
 * rather than reinvented: the body swaps to `MediaPicker`, the drawer keeps its
 * frame, the title says which step you are on, and the footer carries the one
 * control that step has. Picking *is* the commit, so there is no confirm beside
 * the back button.
 *
 * The second is new. **`UploadModal` could not simply be opened from inside the
 * picker**, because a `Modal` over a `Drawer` is the same stacked overlay in a
 * different vocabulary — and at the 340px floor both are full screen, so the
 * second erases the first with nothing to say it is still there, which is the
 * exact defect `MediaPicker`'s own docblock records being repaired. So the
 * upload became a third **step**: `components/ui/MediaUpload.tsx` holds the hook
 * and the fields, `media/UploadModal.tsx` is now a thin `Modal` around the same
 * two, and this drawer renders them under its own footer. Nothing was copied and
 * the library screen is unchanged.
 *
 * The three steps are a line rather than a tree — form → picker → upload — and
 * each step's footer goes back exactly one. A finished upload lands back on the
 * **picker**, not on the form: the file is now in the library, and the tile the
 * person just made is what they came to choose.
 *
 * ## The capability gap, which is real by role and hits the role that matters
 *
 * `/media` is `ac_manage_content` on every verb — `MediaController::registerRoutes()`
 * builds one `Permissions::callback(Capabilities::MANAGE_CONTENT)` and hangs the
 * upload, the listing, the item and its usage on it — while this route is
 * `ac_manage_products`. Two capabilities, and the roles that hold the second and
 * not the first are, read from `Permissions\Capabilities::roles()`:
 *
 *     ac_manager          Manager           products, inventory, orders,
 *                                           customers, coupons, shipping,
 *                                           analytics — **no content**
 *     ac_product_manager  Product Manager   products, inventory, analytics
 *
 * **This is not the shipping gap.** `orders/CarrierFields.tsx` documents one
 * that is *"real in kind and empty in practice"* — no role reaches it — and
 * builds its fallback as a guard. This one is the opposite on the one measure
 * that decides how loudly a fallback should speak: `Users\UserRoles::assignable()`
 * returns exactly `[ac_super_admin, ac_manager]`, so **Manager is the only
 * non-administrator role this API still hands out**, and Manager cannot read the
 * media library. Every staff account created from now on that is not a Super
 * Admin lands in this state. `Product Manager` is retired and still held by
 * existing accounts, which adds a second population to the same hole.
 *
 * The panel already measured the consequence from the other side —
 * `MediaPicker`: *"a Manager is 403 on `GET /media`"* — so the picker would
 * render a `ForbiddenState` inside this drawer for the majority of the people
 * whose job products are.
 *
 * So the image control degrades to an **attachment-id field that says why**,
 * which is `ProductPicker`'s shape for the order drawer's `ac_manage_products`
 * hole, and the API still validates it:
 * `ProductRepository::assertImageAttachment()` refuses an id that is not an
 * image attachment with *"{id} is not an image attachment."* under
 * `fields.image_id`, which binds to that field like any other refusal. Worse
 * than a picker, and much better than a `ForbiddenState` shown to the role the
 * shop runs on.
 *
 * **Widening `ac_manage_content` is not the fix** and is not attempted here: it
 * would hand every product manager the CMS, the banners, the FAQs and the
 * homepage. The backend answer, if this bites often, is a
 * `/products/eligible-media` behind `ac_manage_products` — the
 * `/coupons/eligible-products` precedent, which exists because a Marketing
 * Manager is 403 on `/products` while holding `ac_manage_coupons`.
 *
 * ## What this form does about `type`, and the half that is not what it looks like
 *
 * `VARIABLE_OMITS` in `new-product.ts` carries the argument. In short: a
 * variable product's **parent carries no price** — measured, `regular_price` is
 * `""` on every variable row — and `ProductInput` will nonetheless accept one,
 * because it has no branch on `type` at all. So the two price controls are
 * hidden when `variable` is chosen and the keys are omitted, with the reason on
 * screen rather than in this comment. **Stock is not the same case**: both
 * variable products in the catalogue carry an ordinary `manage_stock` /
 * `stock_quantity` pair, so the inventory block stays for both types.
 *
 * ## On 201, the detail — and the 201 is what says where
 *
 * `ProductController::store()` is `Response::success(ProductPresenter::toArray($product), 201)`,
 * read from source, and the presenter's first key is `id`. So the answer carries
 * the whole product and the drawer routes on the id it was given rather than
 * re-reading the list or guessing a URL. The backend's own suite pins both
 * halves — *"create a simple product"* expects 201 and *"the created product has
 * an id"* asserts `data.id > 0`.
 */
export function NewProductDrawer({
  open,
  onOpenChange,
  categories,
  canPickMedia,
  onCreated,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The vocabulary the list already fetched. `[]` when it could not load. */
  categories: ProductCategory[];
  /** `ac_manage_content`, which every `/media` route sits behind — see above. */
  canPickMedia: boolean;
  onCreated: (product: Product) => void;
  returnFocusTo?: string;
}) {
  const t = useTranslations("products.create");
  /* The field labels are `products.detail`'s. They are the same twelve words on
     both screens, and a second set under `products.create` would be two
     translations of one label that can only ever drift apart. The drawer's own
     strings — its title, its steps, its three local refusals — are `create`'s,
     because they belong to this form and to nothing else. */
  const tDetail = useTranslations("products.detail");
  const tProducts = useTranslations("products");
  const tStatus = useTranslations("productStatus");
  const tStock = useTranslations("stockStatus");
  const tMedia = useTranslations("media");
  const tUi = useTranslations("ui");
  const tStates = useTranslations("states");

  const toast = useToast();
  const online = useOnline();
  /* `useLocale()` rather than a prop, which is `ProductPicker`'s call: every
     other string in here comes from `useTranslations`, which reads the same
     provider, and threading a locale through a caller for one formatted byte
     count is a prop nobody remembers. */
  const locale = useLocale();

  const [step, setStep] = useState<Step>("form");
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  /** Keyed the way the API keys its own failures, so one map serves both. */
  const [fields, setFields] = useState<Record<string, string>>({});
  /** A refusal with no field to bind to — the SKU 409 is not one; see below. */
  const [refusal, setRefusal] = useState<string | null>(null);
  /**
   * What the picker last handed over, for the thumbnail alone.
   *
   * Held beside `draft.imageId` rather than derived from it, because it cannot
   * be: an attachment id does not carry a URL, and resolving one would be a
   * `GET /media/{id}` against the very route this drawer's fallback exists
   * because some readers cannot call. `BannerDrawer` keeps the pair for the same
   * reason. `null` on the fallback path, where nothing knows what the id points
   * at — and the row then says the id rather than drawing a broken square.
   */
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  /*
   * The upload step's state. Declared here rather than inside the step so a
   * half-filled upload survives a trip back to the picker and forward again —
   * the hook is the panel's whole memory, and unmounting it would throw away a
   * chosen file and an alt text somebody had typed.
   *
   * On success it steps **back to the picker** rather than to the form: the file
   * is in the library now, and the tile the person just made is the one they
   * came to choose. It is deliberately not auto-selected — the API answers the
   * row, so selecting it would be one line — because an upload and a choice are
   * two decisions and this drawer has been careful not to make one imply the
   * other anywhere else either.
   */
  const upload = useMediaUpload(() => setStep("picker"));

  /* Re-seeded when the drawer opens rather than by a `key` on the parent, which
     is `NewOrderDrawer`'s trick and the same reason: an effect would clear the
     form one frame after it appeared. */
  const [seededFor, setSeededFor] = useState(open);
  if (open !== seededFor) {
    setSeededFor(open);
    if (open) {
      setStep("form");
      setDraft(emptyDraft());
      setFields({});
      setRefusal(null);
      setImageUrl(null);
      upload.reset();
    }
  }

  const patch = (next: Partial<ProductDraft>) =>
    setDraft((current) => ({ ...current, ...next }));

  const create = useMutation({
    mutationFn: () => acWrite<Product>("POST", "/products", buildPayload(draft)),
    onSuccess: (product) => {
      toast.show(t("created", { name: product.name }));
      onOpenChange(false);
      onCreated(product);
    },
    onError: (error: unknown) => {
      if (error instanceof BrowserApiError) {
        /* A 400 lists every bad field at once and each binds to its own
           control; a toast with the first message throws the rest away. */
        if (error.fields) {
          setFields(error.fields);
          setRefusal(null);
          return;
        }

        /*
         * **A taken SKU is a 409 and it names the SKU under `details.sku`, not
         * under `details.fields`** — the same asymmetry `ProductDetail` measured
         * on the PATCH, and it comes from the same guard:
         * `ProductService::guardSku()` runs before the write on both verbs.
         *
         * There are **two** of them, and the second is the reason the message is
         * rendered verbatim rather than replaced by `skuTaken`:
         *
         *     That SKU is already in use.               details.sku
         *     That SKU belongs to a product in the      details.sku,
         *     trash.                                    details.trashed_product_id
         *
         * The trash one exists because WooCommerce's own insert otherwise threw
         * from inside `save()` and surfaced as a 500 — the backend's suite pins
         * it by name — and it is the case a person cannot possibly work out for
         * themselves, because nothing in any listing shows the product holding
         * the code. A generic "that SKU is taken" would throw away the only half
         * that tells them where to look. `skuTaken` stays as the floor for a 409
         * that arrives with no message at all.
         */
        if (error.status === 409 && typeof error.details.sku === "string") {
          setFields({ sku: error.message || tDetail("skuTaken") });
          setRefusal(null);
          return;
        }

        setFields({});
        setRefusal(error.message);
        return;
      }

      setFields({});
      setRefusal(error instanceof Error ? error.message : t("failed"));
    },
  });

  function submit() {
    const local = draftProblems(draft, {
      name: t("problem.name"),
      stock: t("problem.stock"),
      image: t("problem.image"),
    });

    setRefusal(null);

    if (Object.keys(local).length > 0) {
      setFields(local);
      return;
    }

    setFields({});
    create.mutate();
  }

  const toggleCategory = (id: number, on: boolean) =>
    setDraft((current) => ({
      ...current,
      categoryIds: on
        ? [...current.categoryIds, id].sort((a, b) => a - b)
        : current.categoryIds.filter((current) => current !== id),
    }));

  const variable = draft.type === "variable";

  /**
   * Which keys have a control on screen right now, and can therefore be linked.
   *
   * Three of them come and go, which is why this is computed rather than a
   * constant: the two price fields are absent on a variable product, the
   * quantity is absent while the shelf is not counted, and the category group is
   * absent when the vocabulary failed to load. `ProductDetail` builds the same
   * set for the same reason, and §3.4's rule is why it matters — a link that
   * goes nowhere is worse than a line that does not claim to.
   */
  const linkable = new Set<string>([
    "name",
    "sku",
    "type",
    "status",
    "short_description",
    "description",
    "manage_stock",
    "stock_status",
    "image_id",
    ...(variable ? [] : ["regular_price", "sale_price"]),
    ...(draft.manageStock ? ["stock_quantity"] : []),
    ...(categories.length > 0 ? ["category_ids"] : []),
  ]);

  /**
   * Every refusal on screen, as `ErrorSummary` takes them.
   *
   * A field the form renders gets a link; anything else — a key from a 400 the
   * drawer has no control for, or an orphan message — is listed as text. The
   * orphan case is live rather than theoretical here: `seo.canonical`,
   * `options.groups[0].choices[2].id` and `attributes[0].id` are all keys this
   * route can answer with and this form has no control for, because the four
   * editors it deliberately omits are exactly the ones with nested field paths.
   * `FIELD_LABELS` covers every key this form can produce; anything else falls
   * back to the raw name, which is the only part of a genuinely unknown field
   * worth carrying.
   */
  const FIELD_LABELS: Record<string, string> = {
    name: tDetail("name"),
    sku: tDetail("sku"),
    type: tDetail("type"),
    status: tDetail("status"),
    regular_price: tDetail("regularPrice"),
    sale_price: tDetail("salePrice"),
    short_description: tDetail("shortDescription"),
    description: tDetail("description"),
    category_ids: tDetail("categories"),
    manage_stock: tDetail("manageStock"),
    stock_quantity: tDetail("stockQuantity"),
    stock_status: tDetail("stockStatus"),
    image_id: tDetail("image"),
  };

  const failures: FormFailure[] = [
    ...(refusal ? [{ message: refusal }] : []),
    ...Object.entries(fields).map(([key, message]) => ({
      id: linkable.has(key) ? fieldId(key) : undefined,
      label: FIELD_LABELS[key] ?? key,
      message,
    })),
  ];

  const ready = draft.name.trim() !== "";
  const blocked = online ? null : tStates("offlineWrites");

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      returnFocusTo={returnFocusTo}
      title={
        step === "picker"
          ? tMedia("pickTitle")
          : step === "upload"
            ? tMedia("uploadTitle")
            : t("title")
      }
      description={
        step === "upload"
          ? tMedia("uploadDescription", { max: formatBytes(MAX_BYTES, locale) })
          : step === "form"
            ? t("description")
            : undefined
      }
      footer={
        step === "picker" ? (
          <>
            {/* Back first in DOM order, like every cancel in this panel: it is
                the first tab stop, and `flex-col-reverse` puts the forward
                control away from the thumb on a phone. */}
            <Button variant="secondary" onClick={() => setStep("form")}>
              {t("image.back")}
            </Button>
            {/* `plus`, which is the icon the media library's own upload button
                wears — there is no `upload` in the sprite and inventing one for
                a second entry point to the same act would be two glyphs for one
                thing. */}
            <Button variant="secondary" icon="plus" onClick={() => setStep("upload")}>
              {tMedia("upload")}
            </Button>
          </>
        ) : step === "upload" ? (
          <>
            <Button
              variant="secondary"
              onClick={() => setStep("picker")}
              disabled={upload.busy}
            >
              {t("image.backToPicker")}
            </Button>
            <Button
              onClick={() => void upload.send()}
              loading={upload.busy}
              /* `UploadModal`'s rule, inherited rather than re-decided: only the
                 two things that genuinely stop a send. A local verdict is
                 advisory — `lib/media.ts` argues that the browser is not the
                 authority on the cap — and never reaches here. */
              disabled={!upload.ready || blocked !== null}
              title={blocked ?? undefined}
            >
              {tMedia("upload")}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              {tUi("cancel")}
            </Button>
            {/* Not disabled while offline, unlike the upload beside it and
                unlike `ProductDetail`'s save bar. `NewOrderDrawer` makes the
                same call for the same reason: this is a form somebody is in the
                middle of, a failed write comes back as a refusal the summary
                renders, and taking the button away mid-typing on a browser that
                reports the *interface* rather than reachability is worse than
                one wasted request. An upload is different — it is megabytes and
                a progress bar. */}
            <Button
              onClick={submit}
              loading={create.isPending}
              disabled={!ready}
              title={ready ? undefined : t("problem.name")}
            >
              {t("submit")}
            </Button>
          </>
        )
      }
    >
      {step === "picker" ? (
        <MediaPicker
          onPick={(item) => {
            patch({ imageId: String(item.id) });
            setImageUrl(item.url);
            setStep("form");
          }}
        />
      ) : step === "upload" ? (
        <MediaUploadFields upload={upload} idPrefix={`${ID_PREFIX}-upload`} />
      ) : (
        <div className="flex flex-col gap-4">
          <ErrorSummary failures={failures} />

          {/* ──────────────────────────────────────────────────── identité ─── */}
          <Section title={tDetail("identity")}>
            <div className="flex flex-col gap-3">
              <TextField
                id={fieldId("name")}
                label={tDetail("name")}
                value={draft.name}
                onChange={(next) => patch({ name: next })}
                error={fields.name}
                disabled={create.isPending}
              />
              <TextField
                id={fieldId("sku")}
                label={tDetail("sku")}
                value={draft.sku}
                onChange={(next) => patch({ sku: next })}
                error={fields.sku}
                isolate
                hint={tDetail("skuHint")}
                disabled={create.isPending}
              />
              {/*
                No `slug` control, and that is one of the five fields this form
                leaves to the detail — `new-product.ts` lists them. WordPress
                derives a slug from the name on the first publish, and a slug
                typed before the name is settled is a URL nobody chose.
              */}
              <Select
                id={fieldId("type")}
                label={tDetail("type")}
                value={draft.type}
                onChange={(next) => patch({ type: next })}
                options={CREATABLE_TYPES.map((value) => ({
                  value,
                  label: tProducts(`type.${value}`),
                }))}
                hint={variable ? t("typeVariable") : undefined}
                error={fields.type}
                disabled={create.isPending}
              />
              <Select
                id={fieldId("status")}
                label={tDetail("status")}
                value={draft.status}
                onChange={(next) => patch({ status: next })}
                options={CREATABLE_STATUSES.map((value) => ({
                  value,
                  label: tStatus(value),
                }))}
                hint={t("statusHint")}
                error={fields.status}
                disabled={create.isPending}
              />
            </div>
          </Section>

          {/* ───────────────────────────────────────────────────────── prix ─── */}
          {/*
            Hidden outright on a variable product rather than disabled, and the
            section goes with the fields: two greyed boxes still show whatever
            was typed into them before the type changed, and a number on screen
            that will not be sent is worse than no number at all.
            `new-product.ts`'s `VARIABLE_OMITS` carries the measurement — the
            parent of a variable product holds `regular_price: ""` and the API
            will nonetheless store what it is sent.
          */}
          {variable ? (
            <Section title={tDetail("pricing")}>
              <p className="text-ui-body text-ui-muted">{t("pricingVariable")}</p>
            </Section>
          ) : (
            <Section title={tDetail("pricing")}>
              <div className="flex flex-wrap gap-3">
                <NumberField
                  id={fieldId("regular_price")}
                  label={tDetail("regularPrice")}
                  value={draft.regularPrice}
                  onChange={(next) => patch({ regularPrice: next })}
                  error={fields.regular_price}
                  disabled={create.isPending}
                />
                <NumberField
                  id={fieldId("sale_price")}
                  label={tDetail("salePrice")}
                  value={draft.salePrice}
                  onChange={(next) => patch({ salePrice: next })}
                  /* The API's own sentence when the pair is inverted — "Cannot
                     be higher than the regular price." — rendered rather than
                     pre-empted. `new-product.ts` argues why there is no local
                     copy of that comparison. */
                  error={fields.sale_price}
                  disabled={create.isPending}
                />
              </div>
            </Section>
          )}

          {/* ────────────────────────────────────────────────────── stocks ─── */}
          <Section title={tDetail("inventory")}>
            <div className="flex flex-col gap-3">
              <Switch
                id={fieldId("manage_stock")}
                label={tDetail("manageStock")}
                checked={draft.manageStock}
                onChange={(next) => patch({ manageStock: next })}
                hint={tDetail("manageStockHint")}
                error={fields.manage_stock}
              />
              {draft.manageStock ? (
                <TextField
                  id={fieldId("stock_quantity")}
                  label={tDetail("stockQuantity")}
                  value={draft.stockQuantity}
                  onChange={(next) => patch({ stockQuantity: next })}
                  /* Empty is a real value here and is sent as `null`: nothing
                     being counted and a count of zero are different facts about
                     a shelf, and `buildPayload` keeps them apart. */
                  hint={t("stockHint")}
                  error={fields.stock_quantity}
                  inputMode="numeric"
                  isolate
                  disabled={create.isPending}
                />
              ) : null}
              <Select
                id={fieldId("stock_status")}
                label={tDetail("stockStatus")}
                value={draft.stockStatus}
                onChange={(next) => patch({ stockStatus: next })}
                options={CREATABLE_STOCK_STATUSES.map((value) => ({
                  value,
                  label: tStock(value),
                }))}
                error={fields.stock_status}
                disabled={create.isPending}
              />
            </div>
          </Section>

          {/* ────────────────────────────────────────────────── description ─── */}
          <Section title={tDetail("descriptions")} footnote={tDetail("htmlNote")}>
            <div className="flex flex-col gap-3">
              <TextArea
                id={fieldId("short_description")}
                label={tDetail("shortDescription")}
                value={draft.shortDescription}
                onChange={(next) => patch({ shortDescription: next })}
                error={fields.short_description}
                rows={2}
              />
              <TextArea
                id={fieldId("description")}
                label={tDetail("description")}
                value={draft.description}
                onChange={(next) => patch({ description: next })}
                error={fields.description}
                rows={5}
              />
            </div>
          </Section>

          {/* ─────────────────────────────────────────────────── catégories ─── */}
          <Section title={tDetail("categories")}>
            {categories.length === 0 ? (
              /* The list page fetches this vocabulary and falls back to `[]` on
                 a failed read, so an empty list here means either "the shop has
                 no categories" or "the request failed" — and this form cannot
                 tell them apart. It says the smaller, true thing and offers no
                 boxes, which is the honest half of `ProductDetail`'s
                 `SectionError`. Nothing is lost: categories are writable on the
                 detail this create routes to. */
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
                className="ui-ring -mx-2 flex flex-col gap-1 rounded-ui-md outline-none"
              >
                {categories.map((category) => (
                  <CheckRow
                    key={category.id}
                    checked={draft.categoryIds.includes(category.id)}
                    onChange={(on) => toggleCategory(category.id, on)}
                    label={category.name}
                    count={category.count}
                    disabled={create.isPending}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* ───────────────────────────────────────────────────────── image ─── */}
          <Section
            title={tDetail("image")}
            footnote={canPickMedia ? t("image.galleryLater") : undefined}
          >
            {canPickMedia ? (
              /* `BannerDrawer`'s row, which is the panel's one shape for "an
                 attachment is or is not on this record": a thumbnail or a
                 placeholder, a sentence, a remove, and the control that opens
                 the step. */
              <div className="flex items-center gap-3">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt=""
                    className="size-12 shrink-0 rounded-ui-md border border-ui-line bg-ui-surface-2 object-cover"
                  />
                ) : (
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-ui-md border border-ui-line bg-ui-surface-2">
                    <Icon name="image" className="size-4 text-ui-subtle" />
                  </span>
                )}

                <span className="min-w-0 flex-1 text-ui-label text-ui-muted">
                  {imageUrl ? t("image.attached") : t("image.none")}
                </span>

                {imageUrl ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={create.isPending}
                    onClick={() => {
                      /* `""` and not `"0"`. `0` is the API's *clear the featured
                         image* value and there is nothing on an unsaved product
                         to clear, so both readings send no key — see
                         `parseAttachmentId`. */
                      patch({ imageId: "" });
                      setImageUrl(null);
                    }}
                  >
                    {t("image.remove")}
                  </Button>
                ) : null}

                <Button
                  id={fieldId("image_id")}
                  variant="secondary"
                  size="sm"
                  disabled={create.isPending}
                  onClick={() => setStep("picker")}
                >
                  {imageUrl ? t("image.change") : t("image.choose")}
                </Button>
              </div>
            ) : (
              /*
                The `ac_manage_content` fallback — the docblock argues why it is
                a live path rather than a guard, and why it therefore says the
                whole sentence rather than a terse one. Somebody who cannot read
                the library can still attach an id they know, and the API checks
                it: `assertImageAttachment()` answers "{id} is not an image
                attachment." under `fields.image_id`, which binds to this very
                control.
              */
              <TextField
                id={fieldId("image_id")}
                label={t("image.manualId")}
                hint={t("image.manualIdWhy")}
                value={draft.imageId}
                onChange={(next) => patch({ imageId: next })}
                error={fields.image_id}
                isolate
                inputMode="numeric"
                disabled={create.isPending}
              />
            )}
          </Section>
        </div>
      )}
    </Drawer>
  );
}

/** Form, picker, upload — a line, and each step's footer goes back exactly one. */
type Step = "form" | "picker" | "upload";

/** This form's DOM id namespace. The detail screen's is `product-`. */
const ID_PREFIX = "new-product";

/**
 * The DOM id for one of the API's field names.
 *
 * A function rather than `ProductDetail`'s map-free `product-${key}`, because
 * this form's keys carry underscores and its ids are hyphenated — and because
 * the two screens must not mint the same id: they are never mounted together
 * today, and `id` is document-wide, which is exactly the kind of "cannot happen"
 * that stops being true silently.
 */
function fieldId(key: string): string {
  return `${ID_PREFIX}-${key.replace(/_/g, "-")}`;
}
