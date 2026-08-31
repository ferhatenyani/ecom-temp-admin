"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Product } from "@/lib/api/schemas/product";
// From the dependency-free module rather than the schema: this is a client
// component, and `lib/cms.ts` opens by refusing to pull Zod into the browser.
import { embeddedImageSrc } from "@/lib/cms";
import { formatBytes } from "@/lib/media";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Overlay";
import { Button, IconButton } from "@/components/ui/Button";
import { MediaPicker } from "@/components/ui/MediaPicker";
import { MAX_BYTES, MediaUploadFields, useMediaUpload } from "@/components/ui/MediaUpload";
import { Section, TextField } from "@/components/ui/Form";
import { Icon } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";
import { Reorder, moveItem } from "@/components/ui/Reorder";
import { parseAttachmentId } from "../new-product";

/**
 * The featured image and the gallery, on the product edit form.
 *
 * `ProductDetail` owns the draft and the body; this owns the two controls, the
 * overlay behind them and the capability branch in front of them. It is the
 * screen half of admin sub-task 5 and the edit half of sub-task 6.
 *
 * ## Why this is its own file
 *
 * `CarrierFields.tsx` and `ParcelFailure.tsx` on the previous step both record
 * the test, and it is not line count: **a block that is only markup stays in
 * its screen; a block that owns decisions gets a file so the decisions have
 * somewhere to be argued.** This one owns three — an overlay with two steps, a
 * URL cache that exists because an attachment id does not carry one, and the
 * `ac_manage_content` fallback — and `ProductDetail` is already the panel's
 * longest form with the longest docblock in the repository sitting on top of
 * it. The field list stayed there, which is the part that had to: `Draft` names
 * `image_id` and `gallery_image_ids` beside the other seventeen and this file
 * takes them as props, so nothing about *what is sent* moved out of the file
 * whose docblock argues it.
 *
 * ## A `Modal`, not a step — and that is the opposite of the create drawer
 *
 * `NewProductDrawer` makes the picker and the upload **steps**, and its
 * docblock, `MediaPicker`'s and `MediaUpload`'s all give the same reason:
 * DESIGN.md §3.1 forbids nested overlays — *"a modal that needs a second modal
 * is a modal that needs steps"* — and a `Modal` over a `Drawer` is that in a
 * different vocabulary, because at the 340px floor both are full screen and the
 * second erases the first.
 *
 * **`ProductDetail` is a route, so the antecedent is absent.** A `Modal` here is
 * one overlay over a page, which is exactly the shape §3.1 endorses for *"a task
 * that must be finished or abandoned"* and exactly what `media/UploadModal.tsx`
 * already is on the library screen. Nothing is nested, so nothing is refused.
 *
 * And a step would be actively worse *here*, for two reasons that are properties
 * of a route rather than of a drawer:
 *
 *  - **A drawer's frame survives a step; a page's does not.** The drawer keeps
 *    its header, its title and its footer while the body swaps, so "you are one
 *    level in, and here is the way back" is drawn for free. Swapping this page's
 *    body would take the `PageHeader`, the delete menu and the save bar off
 *    screen with it, and the way back would have to be re-drawn by hand.
 *  - **The browser's back button would lie.** On a route, Back means *leave the
 *    product*. A step that looked like a navigation and was not would send
 *    somebody out of a dirty form expecting to land on the picker they came
 *    from. A `Modal` closes on Escape and on the scrim, which is what a person
 *    expects of an overlay and what Radix already implements.
 *
 * The upload is still a **step inside the one Modal** rather than a second
 * overlay, which is §3.1 applied correctly rather than avoided: picker → upload,
 * one frame, and the footer goes back exactly one. That is the third caller of
 * `components/ui/MediaUpload.tsx` and the reason it was split out of
 * `UploadModal` at all — nothing here is copied.
 *
 * ## The capability gap is a live path, and this screen has the better half of it
 *
 * Every `/media` route is `ac_manage_content`; this one is `ac_manage_products`.
 * `Users\UserRoles::assignable()` returns exactly `[ac_super_admin, ac_manager]`
 * — read from source — so **Manager is the only non-administrator role this API
 * still hands out**, and a Manager holds `ac_manage_products` without
 * `ac_manage_content`. `MediaPicker` renders a `ForbiddenState` for them. So the
 * fallback is not a guard against a role nobody has; it is the path most staff
 * accounts take, and `NewProductDrawer`'s docblock argues the whole of it
 * (including why widening `ac_manage_content` is not the fix, and what a
 * `/products/eligible-media` behind `ac_manage_products` would be instead).
 *
 * **What the edit screen can do that the create drawer cannot** is show them the
 * pictures anyway. `ProductPresenter::toArray()` embeds `image` and `gallery`
 * beside the two writable id fields — *"Writable ids plus a read-only enriched
 * form, so a client has the URLs without a second request"* — so every image
 * already on the product arrives with its `src` in the body the page fetched,
 * through `/products/{id}` and not through `/media`. A Manager who cannot browse
 * the library can still see what is attached, reorder it and remove it; only
 * *choosing a new one* degrades to typing an id. The create drawer has no stored
 * body to read, which is why its fallback is a bare field.
 *
 * ## Order is preserved end to end, so nothing here sorts
 *
 * Read from source, all three hops: `ProductInput::normalize()` answers
 * `array_values(array_unique($ids))` — `array_unique` keeps the **first**
 * occurrence in place, so the order sent is the order kept;
 * `ProductRepository::apply()` hands that straight to
 * `$product->set_gallery_image_ids($ids)`, which WooCommerce stores as an
 * ordered list in `_product_image_gallery`; and `ProductPresenter::toArray()`
 * reads it back with `array_map('intval', $product->get_gallery_image_ids())`.
 *
 * That is the opposite of `category_ids`, which `ProductDetail` sorts on purpose
 * — a taxonomy is a set on both sides of the wire. A gallery is a **sequence**,
 * it is the order the storefront shows the pictures in, and sorting it by id
 * would silently rearrange the shop. So the draft holds it as read, appends at
 * the end, and offers `Reorder` — the panel's existing pair of buttons, chosen
 * over a drag on the argument that file already carries about touch and the
 * keyboard.
 *
 * ## The gallery picker is multi-select now, and the featured image is not
 *
 * This screen shipped with *"picking is the commit and the overlay closes"* for
 * both controls, and said what it cost: a second picture is a second trip
 * through the grid. Five gallery images were five. That sentence also named the
 * fix and where it belonged — a `selected` prop on `MediaGrid` — and refused to
 * build it *"for one screen's convenience"*. The convenience is now item 7 of
 * the fix round, so it is built, opt-in, and `MediaGrid`'s docblock carries the
 * reversal in full.
 *
 * **`image_id` is untouched by any of it**, and that is the shape of the data
 * rather than a scope decision: it is one attachment. A picker that let somebody
 * tick four tiles and then kept the last would be a control lying about what it
 * does. So `target` decides which contract the picker gets — `onPick` for the
 * image, `selection` for the gallery — and the two paths of this file's one
 * overlay stay as different as the two fields are.
 *
 * ### Five picks are one write, and it takes doing
 *
 * `onGalleryChange` replaces the whole array, so calling it once per pick would
 * hand it `[...galleryIds, id]` five times against a `galleryIds` that has not
 * re-rendered between the calls — four of the five would be dropped and the
 * fifth would look like a working feature. Confirming therefore computes one
 * array and calls it **once**. Downstream that is already one request:
 * `ProductDetail`'s draft is local until the save bar is pressed, and its
 * `save()` sends one `PATCH /products/{id}` carrying the whole body — so five
 * pictures cost one write to the API, and always did; what changes is that they
 * now cost one trip through the overlay too.
 *
 * ### What the picker is told about the gallery it is adding to
 *
 * `held={galleryIds}`, so the tiles already on the product are ticked, muted and
 * refused. That closes the loop on the sentence being reversed — *"a grid that
 * cannot say which tiles are already in"* — and it is why the picker path can no
 * longer earn `galleryDuplicate`: there is no press left that would.
 *
 * The selection is **the pick order**, appended in the order the tiles were
 * ticked, because that is the only order anybody authored. And it is emptied
 * when the picker opens rather than kept between openings: a basket that
 * remembered what you did not confirm last time is a control that acts on an
 * intention you already abandoned.
 */
export function ProductMedia({
  /** `ac_manage_content`, which every `/media` route sits behind — see above. */
  canPickMedia,
  /**
   * The embedded read shapes, straight from the fetched product. They are the
   * only source of a URL for an image that was already attached, and they are
   * **stale the moment the draft changes** — which is why they seed a cache
   * rather than being rendered directly.
   */
  storedImage,
  storedGallery,
  /**
   * `draft.image_id`, as a string. `""` means *no image*, and on this screen
   * that is a real edit rather than an omission — see `ProductDetail`'s
   * `save()`, which sends the empty string and lets the API read it as `0`.
   */
  imageId,
  onImageIdChange,
  /** `draft.gallery_image_ids`. Ordered, deduplicated, never sorted. */
  galleryIds,
  onGalleryChange,
  imageError,
  galleryError,
  disabled,
  /** `ProductDetail`'s own id namespace, so `ErrorSummary` can link both keys. */
  fieldId,
}: {
  canPickMedia: boolean;
  storedImage: Product["image"];
  storedGallery: Product["gallery"];
  imageId: string;
  onImageIdChange: (next: string) => void;
  galleryIds: number[];
  onGalleryChange: (next: number[]) => void;
  imageError?: string;
  galleryError?: string;
  disabled: boolean;
  fieldId: (key: string) => string;
}) {
  const t = useTranslations("products.detail");
  const tMedia = useTranslations("media");
  const tUi = useTranslations("ui");
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("picker");
  /** Which control opened the picker. The picker itself does not know or care. */
  const [target, setTarget] = useState<Target>("image");

  /**
   * The gallery basket: ticked in the grid, not yet in the draft.
   *
   * Above the picker because the panel is chromeless and the confirm is in the
   * `Modal`'s footer — `MediaPicker`'s docblock argues the ownership — and it is
   * an ordered array rather than a `Set` because what goes into the draft is a
   * sequence and the pick order is the one the operator chose.
   */
  const [chosen, setChosen] = useState<number[]>([]);

  /**
   * Every URL this screen has learned, keyed by attachment id.
   *
   * Held rather than derived, because an attachment id does not carry a URL and
   * resolving one would be a `GET /media/{id}` against the very route the
   * fallback exists because half the staff cannot call. `BannerDrawer` and
   * `NewProductDrawer` both keep the same pair for the same reason; this one is
   * a map rather than a single value because a gallery is many.
   *
   * It only ever *grows*. Removing an image from the draft does not forget its
   * URL, so putting the same one back — or discarding the form — redraws the
   * thumbnail instead of a placeholder.
   */
  const [picked, setPicked] = useState<Record<number, string>>({});

  /** The fallback's add box, and the one refusal only that box can earn. */
  const [manualGalleryId, setManualGalleryId] = useState("");
  const [badId, setBadId] = useState<string | null>(null);
  /**
   * *Already in the gallery* — separate from `badId`, and now reachable from one
   * path rather than two.
   *
   * It was written for both because the picker closed on a pick, so somebody who
   * chose a tile that was already in the list landed back on a form where
   * nothing had changed and nothing said why. **The picker cannot produce it any
   * more**: those tiles arrive as `held`, ticked and refused, so the press that
   * earned this message no longer exists. What is left is the capability
   * fallback's add box, where a person types an id and cannot see what is in the
   * gallery without looking up. `badId` binds to that field, where §3.4 wants
   * it; this stays a line in the group, which is also where a *future* second
   * path would find it.
   */
  const [duplicate, setDuplicate] = useState<string | null>(null);

  /*
   * On success it steps **back to the picker** rather than closing: the file is
   * in the library now, and the tile the person just made is the one they came
   * to choose. `NewProductDrawer` makes the identical call and argues it — an
   * upload and a choice are two decisions, so neither implies the other.
   */
  const upload = useMediaUpload(() => setStep("picker"));

  /**
   * Id → URL, for everything on screen right now.
   *
   * The stored body first and the session's picks over the top, because a pick
   * is newer than the fetch. Recomputed per render rather than memoised: it is
   * at most a couple of dozen entries and a stale cache here would draw the
   * wrong picture, which is the one failure this whole block exists to avoid.
   */
  const urls = new Map<number, string>();
  for (const item of [storedImage, ...storedGallery]) {
    if (!item) continue;
    const src = embeddedImageSrc(item);
    if (src !== null) urls.set(item.id, src);
  }
  for (const [id, url] of Object.entries(picked)) urls.set(Number(id), url);

  const remember = (id: number, url: string) =>
    setPicked((current) => ({ ...current, [id]: url }));

  const openPicker = (next: Target) => {
    setTarget(next);
    setStep("picker");
    setDuplicate(null);
    /* Emptied on the way in, not on the way out: closing on Escape, on the
       scrim and on Close are three exits and only one of them is a button this
       file draws. Resetting where the overlay is *opened* covers all of them. */
    setChosen([]);
    setOpen(true);
  };

  const currentImageId = imageId.trim();
  const currentImageUrl =
    /^\d+$/.test(currentImageId) ? (urls.get(Number(currentImageId)) ?? null) : null;

  /** The fallback's add box. One id, one refusal, one append. */
  const addToGallery = (id: number) => {
    /*
     * Refused rather than appended, because the API would collapse it silently:
     * `ProductInput::normalize()` runs `array_unique`, so a gallery sent with a
     * repeat comes back one entry shorter than the form drew. A control whose
     * result the server quietly rewrites is the defect this screen's docblock
     * calls a field that can silently clobber, in its smaller form.
     */
    if (galleryIds.includes(id)) {
      setDuplicate(t("galleryDuplicate"));
      return false;
    }
    setDuplicate(null);
    onGalleryChange([...galleryIds, id]);
    return true;
  };

  /**
   * The multi-select commit: **one** call, whatever was ticked.
   *
   * Not `chosen.forEach(addToGallery)`, and the difference is not style. Each
   * call would build its array from the `galleryIds` prop, which does not change
   * between them — five ticks would append the fifth and lose four, and the
   * screen would look like it worked for anybody who ticked one.
   *
   * The `filter` is belt and braces rather than a live path: `held` makes a tile
   * already in the gallery untickable, so `chosen` cannot hold one. It stays
   * because the alternative to filtering here is trusting a prop two components
   * away to keep a promise the API answers for — and the API's answer is
   * `array_unique`, i.e. a silent shortening.
   */
  const confirmGallery = () => {
    const additions = chosen.filter((id) => !galleryIds.includes(id));
    if (additions.length > 0) onGalleryChange([...galleryIds, ...additions]);
    setChosen([]);
    setOpen(false);
  };

  return (
    <>
      <Card
        title={t("images")}
        /*
         * Under the heading rather than at the foot, per §3.4: help text goes
         * before the problem, and this is the sentence that says which of the
         * two blocks below is the catalogue's picture and which is the product
         * page's set.
         *
         * **It says nothing about order, deliberately.** The first draft did,
         * and the gallery's own footnote says it again fifteen lines lower — two
         * grey sentences making the same claim, which is the defect the SEO card
         * on this same screen already records repairing. The rule about order
         * belongs beside the arrows it is about.
         */
        description={t("imagesNote")}
        footnote={canPickMedia ? undefined : t("mediaForbidden")}
      >
        <div className="flex flex-col gap-4">
          {/* ------------------------------------------- the main image --- */}
          <Section title={t("image")}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Thumbnail url={currentImageUrl} />

                <span className="min-w-0 flex-1 text-ui-label text-ui-muted">
                  {currentImageId === "" ? (
                    t("imageNone")
                  ) : currentImageUrl !== null ? (
                    t("imageAttached")
                  ) : (
                    /* The id, because it is the only thing known about it. A
                       typed id nothing has resolved is the fallback's ordinary
                       state, and drawing a broken square instead would say the
                       picture is missing rather than unresolved. */
                    <Ltr>{currentImageId}</Ltr>
                  )}
                </span>

                {currentImageId === "" ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    /*
                     * `""` and not `"0"`, and the difference is only in what a
                     * reader sees: `ProductDetail` sends the empty string and
                     * `ProductInput` normalises `''`, `null` and `0` to the
                     * same *clear the featured image*. An empty box is what
                     * "there is no image" looks like; a box reading `0` is a
                     * number somebody has to be told is not an id.
                     */
                    onClick={() => onImageIdChange("")}
                  >
                    {t("imageRemove")}
                  </Button>
                )}

                {canPickMedia ? (
                  <Button
                    id={fieldId("image_id")}
                    variant="secondary"
                    size="sm"
                    disabled={disabled}
                    onClick={() => openPicker("image")}
                  >
                    {currentImageId === "" ? t("imageChoose") : t("imageChange")}
                  </Button>
                ) : null}
              </div>

              {canPickMedia ? null : (
                /*
                 * The `ac_manage_content` fallback. `NewProductDrawer` draws the
                 * identical control with the identical hint, deliberately: the
                 * two screens are the same person's two ways of attaching a
                 * picture and they must not explain the same refusal twice in
                 * two voices.
                 *
                 * **No local rule on what is typed**, and that is where this
                 * one differs from the create drawer, which gates the request on
                 * `draftProblems`. There it had to: `buildPayload` omits an
                 * unparseable id, so a typed word became a 201 with no image and
                 * no complaint. Here the key rides on every save whatever it
                 * holds, so `"12a"` reaches the API and comes back as
                 * *"Must be an attachment id, or 0 to clear."* on this very
                 * control. The screen's own rule is that the API is the
                 * authority; a second copy could only be a second authority.
                 */
                <TextField
                  id={fieldId("image_id")}
                  label={t("manualImageId")}
                  hint={t("manualImageIdWhy")}
                  value={imageId}
                  onChange={onImageIdChange}
                  error={imageError}
                  isolate
                  inputMode="numeric"
                  disabled={disabled}
                />
              )}

              {canPickMedia && imageError ? (
                /* The picker path has no field to hang a refusal on — its
                   control is a button — so the message is rendered beside it
                   rather than dropped. `ErrorSummary` links to the button. */
                <p role="alert" className="text-ui-label text-ui-danger-fg" dir="ltr">
                  {imageError}
                </p>
              ) : null}
            </div>
          </Section>

          {/* ---------------------------------------------- the gallery --- */}
          <Section
            title={t("gallery")}
            /* The two facts a person needs before pressing an arrow, and the
               only place either is said: this order is the shop's, and the
               featured image is not one of these. */
            footnote={t("galleryNote")}
          >
            <div
              id={fieldId("gallery_image_ids")}
              role="group"
              aria-label={t("gallery")}
              /* Focusable only as a target: `ErrorSummary` links a failure to a
                 DOM id and calls `.focus()`, and a bare `<div>` would swallow
                 that silently. `-1` keeps it out of the tab order. */
              tabIndex={-1}
              className="ui-ring flex flex-col gap-3 rounded-ui-md outline-none"
            >
              {galleryIds.length === 0 ? (
                <p className="text-ui-body text-ui-muted">{t("galleryEmpty")}</p>
              ) : (
                <ul className="flex flex-col">
                  {galleryIds.map((id, index) => {
                    const label = t("galleryItem", { id });
                    return (
                      <li key={id} className="ui-row flex min-w-0 items-center gap-3 py-2">
                        <Thumbnail url={urls.get(id) ?? null} />
                        <span className="min-w-0 flex-1">
                          <Ltr className="text-ui-compact text-ui-fg">{id}</Ltr>
                        </span>
                        <Reorder
                          index={index}
                          count={galleryIds.length}
                          onMove={(from, to) =>
                            onGalleryChange(moveItem(galleryIds, from, to))
                          }
                          label={label}
                          disabled={disabled}
                        />
                        <IconButton
                          label={t("galleryRemove", { id })}
                          icon="trash"
                          size="lg"
                          disabled={disabled}
                          className="shrink-0"
                          onClick={() => {
                            setDuplicate(null);
                            onGalleryChange(galleryIds.filter((entry) => entry !== id));
                          }}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}

              {canPickMedia ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="plus"
                  disabled={disabled}
                  /* The group is a column, so a bare button stretches to the
                     card's width — which at 1440 is a 700px "Add an image".
                     Sized to its label instead; the rows above it are the full
                     width because a row of content should be. */
                  className="self-start"
                  onClick={() => openPicker("gallery")}
                >
                  {t("galleryAdd")}
                </Button>
              ) : (
                /*
                 * The same fallback one control over, and it needs a rule the
                 * main image's does not: this box is not a draft field, it is an
                 * *add* button's argument, so an unparseable id has nowhere to
                 * go and no 400 to earn. `parseAttachmentId` is
                 * `new-product.ts`'s and is imported rather than copied — and it
                 * is exactly right here, because it answers `null` for `0`,
                 * which the API refuses in this field by name
                 * (*"Ids must be positive integers."*) even though it accepts it
                 * in `image_id` as *clear*.
                 */
                /*
                  Stacked rather than a field and a button on one row, which an
                  earlier draft had at `items-end`: `FieldFrame` puts the hint
                  and the error *below* the input, so aligning on the bottom
                  edge floated the button under the help text instead of beside
                  the box — and further down again the moment a refusal
                  appeared. A column is right at the 340px floor anyway.
                */
                <div className="flex flex-col items-start gap-2">
                  <TextField
                    label={t("manualGalleryId")}
                    hint={t("manualGalleryIdWhy")}
                    value={manualGalleryId}
                    onChange={(next) => {
                      setManualGalleryId(next);
                      setBadId(null);
                      setDuplicate(null);
                    }}
                    error={badId ?? undefined}
                    isolate
                    inputMode="numeric"
                    disabled={disabled}
                    className="self-stretch"
                  />
                  {/* No `onSubmit`, deliberately. `TextField`'s commit prop
                      fires on Enter **and on blur**, so tabbing from the box to
                      this button would add the id and then the press would add
                      it again — earning the duplicate refusal for a person who
                      did exactly one thing. The button is the only trigger. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="plus"
                    disabled={disabled}
                    onClick={() => {
                      const parsed = parseAttachmentId(manualGalleryId);
                      if (parsed === null) {
                        setBadId(t("galleryBadId"));
                        return;
                      }
                      if (addToGallery(parsed)) setManualGalleryId("");
                    }}
                  >
                    {t("galleryAddId")}
                  </Button>
                </div>
              )}

              {/* Local and reachable from both paths — the picker closes on a
                  pick, so this is the only thing that tells somebody who chose a
                  tile already in the list why nothing changed. `role="status"`
                  rather than `alert`: it is a refusal to *repeat* an act, not a
                  failure, and it is in the reader's own language. */}
              {duplicate ? (
                <p role="status" className="text-ui-label text-ui-danger-fg">
                  {duplicate}
                </p>
              ) : null}

              {/* The API's, and English — so it is marked as its own language
                  rather than laid out backwards inside an Arabic paragraph,
                  which is `MediaUploadFields`' rule for the same kind of line. */}
              {galleryError ? (
                <p role="alert" className="text-ui-label text-ui-danger-fg" dir="ltr">
                  {galleryError}
                </p>
              ) : null}
            </div>
          </Section>
        </div>
      </Card>

      {/*
        One overlay, two steps. The title says which; the footer carries that
        step's controls and goes back exactly one.
      */}
      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setStep("picker");
        }}
        size="md"
        title={step === "upload" ? tMedia("uploadTitle") : tMedia("pickTitle")}
        description={
          step === "upload"
            ? tMedia("uploadDescription", { max: formatBytes(MAX_BYTES, locale) })
            : undefined
        }
        footer={
          step === "upload" ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setStep("picker")}
                disabled={upload.busy}
              >
                {t("backToPicker")}
              </Button>
              <Button
                onClick={() => void upload.send()}
                loading={upload.busy}
                /* `UploadModal`'s rule, inherited rather than re-decided: only
                   the two things that genuinely stop a send. A local verdict is
                   advisory — `lib/media.ts` argues that the browser is not the
                   authority on the cap — and never reaches here. */
                disabled={!upload.ready}
              >
                {tMedia("upload")}
              </Button>
            </>
          ) : (
            <>
              {/* Close first in DOM order, like every cancel in this panel: it
                  is the first tab stop, and `flex-col-reverse` puts the forward
                  control away from the thumb on a phone. */}
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {tUi("close")}
              </Button>
              {/* `plus`, which is the icon the media library's own upload button
                  wears — there is no `upload` in the sprite. */}
              <Button variant="secondary" icon="plus" onClick={() => setStep("upload")}>
                {tMedia("upload")}
              </Button>
              {target === "gallery" ? (
                /*
                 * **The count is on this button and not only in the picker's
                 * bar, and that is a 340px decision.** The overlay's body
                 * scrolls and its footer does not, so the bar is the first thing
                 * off screen the moment somebody scrolls to the fourth row of
                 * tiles — leaving a confirm control and no number anywhere. The
                 * SEO card on this screen records refusing to say the same thing
                 * twice; this is not that. The bar is where the *clear* is and
                 * says what it would clear; this is the commit, and it is the
                 * copy that is always visible.
                 *
                 * Disabled at zero rather than absent, which is the exception
                 * §3.3 already makes for a step's forward control: the upload
                 * step's send button beside it is disabled the same way, and a
                 * footer whose buttons come and go moves the two that stay.
                 */
                <Button disabled={chosen.length === 0} onClick={confirmGallery}>
                  {t("galleryAddSelected", { count: chosen.length })}
                </Button>
              ) : null}
            </>
          )
        }
      >
        {step === "upload" ? (
          <MediaUploadFields upload={upload} idPrefix="product-media-upload" />
        ) : (
          /*
           * Two contracts, one overlay. `active` is `MediaPicker`'s own gate on
           * the request rather than on the render — without it every product
           * detail in the panel would fetch a media library nobody has opened.
           * It is `open` and not `step === "picker"` only because the picker is
           * unmounted on the upload step anyway; the two are the same condition
           * here.
           */
          target === "image" ? (
            <MediaPicker
              active={open}
              /*
               * **Picking is still the commit for the featured image**, and the
               * overlay still closes — the paragraph this replaces argued that
               * for both fields and it survives for this one, because
               * `image_id` is one attachment and there is nothing a second tick
               * could mean. What it also said — that staying open would need a
               * grid able to say which tiles are already in — is what the
               * gallery branch below now has.
               */
              onPick={(item) => {
                remember(item.id, item.url);
                onImageIdChange(String(item.id));
                setOpen(false);
              }}
            />
          ) : (
            <MediaPicker
              active={open}
              selection={{
                selected: chosen,
                /* The draft's gallery, not the stored product's: a person who
                   removed a row and has not saved is looking at a gallery that
                   does not have it, and the grid must agree with the form in
                   front of them. */
                held: galleryIds,
                onToggle: (item, next) => {
                  /* Remembered on the way *in* and never on the way out. The
                     URL cache only grows — the field's own docblock — so
                     unticking and re-ticking redraws a thumbnail instead of a
                     placeholder, and so does confirming a picture whose row is
                     later removed and put back. */
                  if (next) remember(item.id, item.url);
                  setChosen((current) =>
                    next
                      ? [...current, item.id]
                      : current.filter((id) => id !== item.id),
                  );
                },
                onClear: () => setChosen([]),
              }}
            />
          )
        )}
      </Modal>
    </>
  );
}

/** Picker, then upload — one frame, and the footer goes back exactly one. */
type Step = "picker" | "upload";

/** Which control the picker was opened for. */
type Target = "image" | "gallery";

/**
 * The 48px square, or the placeholder for an id nothing has resolved.
 *
 * `alt=""` on purpose: the picture is decorative *here* — the row already names
 * the attachment, and its real alt text belongs to the storefront and is edited
 * in the library. Announcing it twice would read the id and then the caption of
 * a thumbnail nobody is looking at.
 */
function Thumbnail({ url }: { url: string | null }) {
  if (url === null) {
    return (
      <span className="flex size-12 shrink-0 items-center justify-center rounded-ui-md border border-ui-line bg-ui-surface-2">
        <Icon name="image" className="size-4 text-ui-subtle" />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="size-12 shrink-0 rounded-ui-md border border-ui-line bg-ui-surface-2 object-cover"
    />
  );
}
