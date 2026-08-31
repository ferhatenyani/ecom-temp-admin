"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { EmailImage, EmailValues } from "./email-body";
import { BLOCKS, brandColour, onBrand } from "./email-body";
import { brandLegible, brandRatio } from "./body-fields";
import { EMAIL_PALETTE } from "@/lib/email-palette";
import { Card } from "@/components/ui/Card";
import { ChoiceGroup, Section, TextArea, TextField } from "@/components/ui/Form";
import { Button, IconButton } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Overlay";
import { MediaPicker } from "@/components/ui/MediaPicker";
import { Notice } from "@/components/ui/States";
import { Icon } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";

/**
 * The composer's body form: the answers `email-body.ts` turns into a message.
 *
 * ## The blocks are drawn in `BLOCKS` order, and emptiness is the toggle
 *
 * Sub-task 2 asks for "optional blocks that can be toggled on and off in a fixed
 * order — not a drag-and-drop builder". The generator already settles both halves
 * and this form does not re-decide either: `BLOCKS` is the order, in the file that
 * also walks it to build the HTML and the text, so the three cannot disagree; and
 * **a block is present exactly when its own values are non-empty**, which means the
 * "on" switch is filling it in and the "off" switch is clearing it.
 *
 * That is deliberately *not* a `Switch` per block beside the fields. A toggle would
 * be a second piece of state that can disagree with the values — a block switched
 * on with nothing in it, or switched off with a paragraph still stored in it — and
 * the generator is total precisely because that state does not exist. What the form
 * owes the reader instead is for the consequence to be legible, so every block says
 * whether it is **in the message** or **not shown**, and a filled one carries the
 * control that empties it.
 *
 * ## Two fields that are not blocks, in front of the six that are
 *
 * `direction` and `brandColour` are properties of the whole message rather than
 * blocks in it, so they sit in their own card above. Direction is *offered* rather
 * than derived — `directionFor()` seeds it from the campaign's locale and then it
 * is a stored decision, because an Algerian shop with an Arabic panel writes French
 * campaigns and the panel's own language switch must never reflow a body somebody
 * already laid out.
 *
 * ## The colour control is a hex field and a live swatch, and that is forced
 *
 * `<input type="color">` is the obvious control and it is unavailable twice over.
 * It is browser-drawn chrome, which is the class of control this panel spent the
 * date-picker and `Listbox` branches removing; and a palette of preset swatches —
 * the usual replacement — cannot be built here at all, because **every preset would
 * be a colour literal in source** and `scripts/check-design.sh` refuses those
 * outside `styles/tokens.css` and the two files exempt by name. `lib/email-palette.ts`
 * is the second of those and widening it again for a row of swatches is exactly the
 * "second exemption" the branch was told to argue very loudly before taking.
 *
 * So the control is the value itself — `#rrggbb`, the string the message will carry
 * — with a **drawn preview of the actual button** beside it, filled from
 * `brandColour()` and labelled in `onBrand()`'s choice. Nothing there is a literal:
 * both colours are computed at run time from what the shopkeeper typed. And the
 * preview is worth more than a swatch would be, because the thing that can go wrong
 * with a brand colour here is not the fill, it is the **label on it** — which is
 * what the warning under it names.
 */
export function BodyForm({
  values,
  onChange,
  disabled,
}: {
  values: EmailValues;
  onChange: (next: EmailValues) => void;
  disabled: boolean;
}) {
  const t = useTranslations("campaigns");
  const [picking, setPicking] = useState<"logo" | "image" | null>(null);

  const patch = (next: Partial<EmailValues>) => onChange({ ...values, ...next });

  return (
    <>
      <Card title={t("bodyForm.brand")}>
        <div className="flex flex-col gap-4">
          <Section title={t("bodyForm.direction")} footnote={t("bodyForm.directionNote")}>
            <ChoiceGroup
              label={t("bodyForm.direction")}
              value={values.direction}
              onChange={(direction) =>
                patch({ direction: direction === "rtl" ? "rtl" : "ltr" })
              }
              options={[
                { value: "ltr", label: t("bodyForm.ltr") },
                { value: "rtl", label: t("bodyForm.rtl") },
              ]}
              disabled={disabled}
            />
          </Section>

          <BrandColour
            value={values.brandColour}
            onChange={(brandColour) => patch({ brandColour })}
            disabled={disabled}
          />
        </div>
      </Card>

      <Card title={t("bodyForm.blocks")} footnote={t("bodyForm.blocksNote")}>
        <div className="flex flex-col gap-4">
          {/*
            Walked rather than written out, so this list and the two the generator
            walks are one list. A seventh block added there appears here as a
            compile error rather than as a block nobody can fill in.
          */}
          {BLOCKS.map((block) => {
            switch (block) {
              case "logo":
                return (
                  <ImageBlock
                    key={block}
                    idPrefix={BODY_IDS.logo}
                    title={t("bodyForm.logo")}
                    hint={t("bodyForm.logoHint")}
                    image={values.logo}
                    onChange={(logo) => patch({ logo })}
                    onPick={() => setPicking("logo")}
                    disabled={disabled}
                  />
                );

              case "title":
                return (
                  <Section key={block} title={t("bodyForm.title")}>
                    <BlockState on={values.title.trim() !== ""} />
                    <TextField
                      id={BODY_IDS.title}
                      label={t("bodyForm.titleLabel")}
                      value={values.title}
                      onChange={(title) => patch({ title })}
                      disabled={disabled}
                    />
                  </Section>
                );

              case "paragraphs":
                return (
                  <Paragraphs
                    key={block}
                    paragraphs={values.paragraphs}
                    onChange={(paragraphs) => patch({ paragraphs })}
                    disabled={disabled}
                  />
                );

              case "image":
                return (
                  <ImageBlock
                    key={block}
                    idPrefix={BODY_IDS.image}
                    title={t("bodyForm.image")}
                    hint={t("bodyForm.imageHint")}
                    image={values.image}
                    onChange={(image) => patch({ image })}
                    onPick={() => setPicking("image")}
                    disabled={disabled}
                  />
                );

              case "cta":
                return (
                  <Cta
                    key={block}
                    cta={values.cta}
                    fill={brandColour(values.brandColour)}
                    direction={values.direction}
                    onChange={(cta) => patch({ cta })}
                    disabled={disabled}
                  />
                );

              case "footer":
                return (
                  <Section key={block} title={t("bodyForm.footer")} footnote={t("bodyForm.footerNote")}>
                    <BlockState on={values.footer.trim() !== ""} />
                    <TextArea
                      id={BODY_IDS.footer}
                      label={t("bodyForm.footerLabel")}
                      value={values.footer}
                      onChange={(footer) => patch({ footer })}
                      rows={3}
                      disabled={disabled}
                    />
                  </Section>
                );
            }
          })}
        </div>
      </Card>

      {/*
        **A `Modal`, not a step — and `ProductMedia` is the precedent it copies.**

        `MediaPicker` is a chromeless panel by design and its host decides where it
        lives; the two shapes already in this panel are a *step* inside a drawer
        (`BannerDrawer`, `NewProductDrawer`) and a *modal* on a route
        (`products/[id]/ProductMedia.tsx`). The step shape exists because DESIGN.md
        §3.1 forbids nested overlays — "a modal that needs a second modal is a modal
        that needs steps" — and at the 340px floor the second overlay erases the
        first.

        **This is a route, so that antecedent is absent** and the modal is one
        overlay over a page, which is the shape §3.1 endorses. `ProductMedia`'s two
        route-specific reasons transfer intact: a page's frame does not survive a
        step the way a drawer's does, so swapping this body would take `PageHeader`
        and the wizard's own step indicator off screen and the way back would have
        to be redrawn by hand; and on a route the browser's Back button means *leave
        the campaign*, so a step that looked like navigation would send somebody out
        of an unsaved draft.

        The composer's wizard steps are not a counter-argument. They are steps of
        the *task*, drawn in the header and addressable backwards; picking a picture
        is not a step of composing a campaign, it is a task to finish or abandon.

        No upload step. `ProductMedia` carries one and this deliberately does not:
        an email's logo is an asset the shop already has, the library screen exists
        for putting one there, and the second step would be the only part of this
        form that can 413.
      */}
      <Modal
        open={picking !== null}
        onOpenChange={(next) => {
          if (!next) setPicking(null);
        }}
        size="md"
        title={picking === "image" ? t("bodyForm.pickImage") : t("bodyForm.pickLogo")}
        /*
          The trigger is a real `Button` that holds focus when clicked, so
          `useOpenerFocus`'s recorded opener is enough and `returnFocusTo` is not
          passed — `ProductMedia` makes the same call for the same reason. The two
          triggers are named all the same, because `ErrorSummary` needs somewhere
          to send a refusal on either image.
        */
        footer={
          <Button variant="secondary" onClick={() => setPicking(null)}>
            {t("bodyForm.closePicker")}
          </Button>
        }
      >
        <MediaPicker
          /* Gates the request rather than the render, so opening a campaign does
             not fetch a media library nobody asked for. */
          active={picking !== null}
          onPick={(item) => {
            /*
             * **A direct field rename, with no normalisation and no defaulting.**
             * `MediaItem.url` is `wp_get_attachment_url()` and is already an
             * absolute `http(s)` URL, which is what `EmailImage.src` requires and
             * what `imageTag()` refuses anything else for. `alt` is a required
             * non-nullable string that is legitimately `""`, which the generator
             * emits as `alt=""` on purpose. `width` is `number | null` on both
             * sides, null for a file WordPress could not measure.
             *
             * Never `sizes[…]`: it is `{}` on every fixture in this shop, so a
             * client that reached for a thumbnail would work in production and
             * break on every test image.
             */
            const image: EmailImage = { src: item.url, alt: item.alt, width: item.width };
            if (picking === "image") patch({ image });
            else patch({ logo: image });
            setPicking(null);
          }}
        />
      </Modal>
    </>
  );
}

/**
 * The DOM ids the body's controls carry.
 *
 * Literals rather than `useId()`, for `Steps.tsx`'s stated reason — `ErrorSummary`
 * links a 400's field to `document.getElementById` — and for a second one this
 * branch adds: the merge-token list finds the field it is inserting into by id, so
 * a generated id would make the caret unreachable from outside the control.
 */
export const BODY_IDS = {
  title: "campaign-body-title",
  paragraph: (index: number) => `campaign-body-paragraph-${index}`,
  ctaLabel: "campaign-body-cta-label",
  ctaHref: "campaign-body-cta-href",
  footer: "campaign-body-footer",
  logo: "campaign-body-logo",
  image: "campaign-body-image",
} as const;

/**
 * Whether this block reaches the message, said in words.
 *
 * The whole of the "toggle" — there is no switch, so this line is the only place a
 * reader learns that an empty block is simply absent rather than rendered blank.
 */
function BlockState({ on }: { on: boolean }) {
  const t = useTranslations("campaigns");

  return (
    <p className="flex items-center gap-1.5 text-ui-label text-ui-muted">
      <Icon
        name={on ? "check" : "close"}
        className={`size-3.5 shrink-0 ${on ? "text-ui-success-fg" : "text-ui-subtle"}`}
      />
      {on ? t("bodyForm.shown") : t("bodyForm.hidden")}
    </p>
  );
}

/** The brand colour, its live button preview, and the legibility warning. */
function BrandColour({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations("campaigns");

  const fill = brandColour(value);
  const ink = onBrand(fill);
  const legible = brandLegible(value);

  /*
   * **An empty colour is the panel's accent, and the form says so in words rather
   * than by filling the field in.**
   *
   * Those are different claims. A field pre-filled with the accent's own hex says
   * *the shop chose this*, and no shop chose it: `/settings` publishes no brand
   * colour under any spelling
   * — `SettingsInput::SCHEMA` is nineteen keys and none of them is one, read from
   * source — so there was nothing to prefill. `brandColour("")` already answers the
   * accent, which is `--color-ui-accent` at 5.63:1 on the card, so the message is
   * legible and deliberate either way. What the sentence buys is that the blue is
   * never mistaken for a measurement of the shop.
   */
  const fromShop = value.trim() === "";

  return (
    <Section
      title={t("bodyForm.colour")}
      footnote={fromShop ? t("bodyForm.colourDefault") : undefined}
    >
      <TextField
        id="campaign-body-colour"
        label={t("bodyForm.colourLabel")}
        value={value}
        onChange={onChange}
        /* A hex triplet is an identifier, not prose: it reads left to right in an
           Arabic form like every other code in this panel. */
        isolate
        /*
          **The placeholder is the accent itself, read from the palette rather than
          typed here.** It is the value `brandColour("")` actually answers, so the
          greyed text is a true statement of what the message will carry — and it is
          a run-time import rather than a literal, which is what keeps this file
          inside the colour rule. `lib/email-palette.ts` is the one file allowed to
          write it down.
        */
        placeholder={EMAIL_PALETTE.brand}
        hint={t("bodyForm.colourHint")}
        disabled={disabled}
      />

      {/*
        **The button as it will be drawn, at the colours it will be drawn in.**
        Both come from run-time values — `brandColour()` normalises what was typed
        and `onBrand()` picks the label — so there is no colour literal here and
        `check-design.sh` still guards every line of this file.

        `aria-hidden`, and the warning below carries the same fact in words: this is
        a picture of a button, not a button, and a screen reader that announced it
        would announce a control nobody can press.
      */}
      <div className="flex flex-wrap items-center gap-2 pt-1" aria-hidden="true">
        <span
          className="inline-flex items-center rounded-ui-md px-4 py-2 text-ui-compact"
          style={{ backgroundColor: fill, color: ink }}
        >
          {t("bodyForm.colourPreview")}
        </span>
        <Ltr numeric={false} className="font-mono text-ui-caption text-ui-subtle">
          {fill}
        </Ltr>
      </div>

      {/*
        **Warn, never refuse — it is the shopkeeper's brand.**

        `onBrand()` already picks the better of the message's two text colours by
        WCAG luminance rather than hard-coding white, which is what most email
        builders do and what would hand a yellow-branded shop a button at 1.3:1.
        With two candidates the best available still falls below AA's 4.5 for a
        narrow band of mid-luminance fills, bottoming at 4.1130:1 — see
        `brandContrast()`, which derives the bound rather than observing it.

        A shop whose brand is in that band does not stop being that shop, so this
        states the consequence and the number and leaves the choice alone.
        `furthestStep()` is untouched: an unreadable brand colour never stops the
        wizard.
      */}
      {legible ? null : (
        <div className="pt-1" data-testid="brand-contrast">
          <Notice tone="warning" title={t("bodyForm.colourUnreadable")}>
            <p className="text-ui-label">
              {t("bodyForm.colourUnreadableWhy", {
                ratio: brandRatio(value).toFixed(2),
                target: "4.5",
              })}
            </p>
          </Notice>
        </div>
      )}
    </Section>
  );
}

/**
 * A logo or an in-body picture: pick it, describe it, or clear it.
 *
 * One component for both because they differ in nothing but their cap — the
 * generator holds `LOGO_WIDTH` against `CONTENT_WIDTH` — and a second copy would be
 * two places to fix the day the alt-text rule changes.
 */
function ImageBlock({
  idPrefix,
  title,
  hint,
  image,
  onChange,
  onPick,
  disabled,
}: {
  idPrefix: string;
  title: string;
  hint: string;
  image: EmailImage | null;
  onChange: (next: EmailImage | null) => void;
  onPick: () => void;
  disabled: boolean;
}) {
  const t = useTranslations("campaigns");

  return (
    <Section title={title} footnote={hint}>
      <BlockState on={image !== null} />

      {image === null ? null : (
        <div className="flex items-start gap-3 pt-1">
          {/*
            A plain `<img>` and not `next/image`: the source is an absolute URL on
            the WordPress host, which is not in `next.config`'s remote patterns and
            is a different origin in every deployment. `MediaGrid` draws the library
            the same way.

            **`alt=""` here is deliberate and is not the image's alt text.** This is
            a thumbnail of the picture whose description is being edited in the
            field immediately beside it; announcing the description twice — once as
            the image and once as the input's value — is how a screen reader reads a
            form field as its own content. The alt that reaches the *message* is the
            one in that field, and the generator always emits it, empty or not.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.src}
            alt=""
            className="size-16 shrink-0 rounded-ui-md border border-ui-line object-contain"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <TextField
              id={`${idPrefix}-alt`}
              label={t("bodyForm.alt")}
              value={image.alt}
              onChange={(alt) => onChange({ ...image, alt })}
              /*
                **Empty is a real answer and the hint says so.** An `<img>` with no
                `alt` attribute is read aloud as its filename; an explicitly empty
                one is skipped. The generator always emits the attribute, so the
                choice here is between a description and a deliberate silence.
              */
              hint={t("bodyForm.altHint")}
              disabled={disabled}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          id={idPrefix}
          variant="secondary"
          icon="image"
          disabled={disabled}
          onClick={onPick}
        >
          {image === null ? t("bodyForm.choose") : t("bodyForm.replace")}
        </Button>
        {image === null ? null : (
          <Button variant="ghost" icon="trash" disabled={disabled} onClick={() => onChange(null)}>
            {t("bodyForm.clear")}
          </Button>
        )}
      </div>
    </Section>
  );
}

/**
 * The paragraphs — a list, add and remove, and **no reordering**.
 *
 * `MoveControls` exists in this panel and is deliberately not used: the homepage
 * and the menu tree are ordered documents whose order is the content, while these
 * are the sentences of one message and moving the third above the second is what
 * cut and paste is for. Adding the two buttons per row would be six controls on a
 * block that has two, at the width where the block is tightest.
 */
function Paragraphs({
  paragraphs,
  onChange,
  disabled,
}: {
  paragraphs: readonly string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  const t = useTranslations("campaigns");

  /* The generator drops an empty paragraph, so the block is "in the message" only
     when at least one of them has something in it — not when the list is
     non-empty. Same rule as every other block, applied to the right question. */
  const on = paragraphs.some((one) => one.trim() !== "");

  return (
    <Section title={t("bodyForm.paragraphs")} footnote={t("bodyForm.paragraphsNote")}>
      <BlockState on={on} />

      <div className="flex flex-col gap-3 pt-1">
        {paragraphs.map((paragraph, index) => (
          <div key={index} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <TextArea
                id={BODY_IDS.paragraph(index)}
                label={t("bodyForm.paragraph", { index: index + 1 })}
                value={paragraph}
                onChange={(next) =>
                  onChange(paragraphs.map((one, at) => (at === index ? next : one)))
                }
                rows={3}
                disabled={disabled}
              />
            </div>
            <IconButton
              label={t("bodyForm.removeParagraph", { index: index + 1 })}
              icon="trash"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange(paragraphs.filter((_, at) => at !== index))}
            />
          </div>
        ))}

        <div>
          <Button
            variant="secondary"
            icon="plus"
            disabled={disabled}
            onClick={() => onChange([...paragraphs, ""])}
          >
            {t("bodyForm.addParagraph")}
          </Button>
        </div>
      </div>
    </Section>
  );
}

/**
 * The one call to action: a label and where it goes, **both or neither**.
 *
 * `EmailCta` requires both and `safeHref()` drops a target that is not `http(s)`,
 * `mailto:` or a merge token — and it drops it *silently at the generator*, so the
 * whole block disappears rather than becoming a button that goes nowhere. That is
 * the right behaviour in the message and the wrong thing to discover in a preview,
 * so the form says which half is missing while it is still fixable.
 *
 * A token href is a real case rather than a theoretical one: a button reading
 * "Se désabonner" pointing at `{{unsubscribe_url}}` survives the sanitiser
 * untouched, because `{{` is not a protocol.
 */
function Cta({
  cta,
  fill,
  direction,
  onChange,
  disabled,
}: {
  cta: { label: string; href: string } | null;
  fill: string;
  direction: "ltr" | "rtl";
  onChange: (next: { label: string; href: string } | null) => void;
  disabled: boolean;
}) {
  const t = useTranslations("campaigns");

  const label = cta?.label ?? "";
  const href = cta?.href ?? "";
  const set = (next: { label: string; href: string }) =>
    onChange(next.label === "" && next.href === "" ? null : next);

  const half = label.trim() === "" ? (href.trim() === "" ? null : "label") : href.trim() === "" ? "href" : null;

  return (
    <Section title={t("bodyForm.cta")} footnote={t("bodyForm.ctaNote")}>
      <BlockState on={half === null && label.trim() !== ""} />

      <div className="flex flex-col gap-3 pt-1">
        <TextField
          id={BODY_IDS.ctaLabel}
          label={t("bodyForm.ctaLabel")}
          value={label}
          onChange={(next) => set({ label: next, href })}
          error={half === "label" ? t("bodyForm.ctaNeedsLabel") : undefined}
          disabled={disabled}
        />
        <TextField
          id={BODY_IDS.ctaHref}
          label={t("bodyForm.ctaHref")}
          value={href}
          onChange={(next) => set({ label, href: next })}
          /* A URL is an identifier: left to right inside an Arabic form. */
          isolate
          hint={t("bodyForm.ctaHrefHint")}
          error={half === "href" ? t("bodyForm.ctaNeedsHref") : undefined}
          disabled={disabled}
        />

        {/* The same drawn preview the colour control carries, in the block that
            actually owns the button — and in the message's direction, not the
            panel's. */}
        {label.trim() === "" ? null : (
          <div dir={direction} aria-hidden="true">
            <span
              className="inline-flex items-center rounded-ui-md px-4 py-2 text-ui-compact"
              style={{ backgroundColor: fill, color: onBrand(fill) }}
            >
              {label}
            </span>
          </div>
        )}
      </div>
    </Section>
  );
}
