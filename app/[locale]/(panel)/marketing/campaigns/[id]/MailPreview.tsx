"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CampaignPreview } from "@/lib/api/schemas/campaign";
import { unsubscribeNote } from "@/lib/campaigns";
import { EMAIL_PALETTE } from "@/lib/email-palette";
import { Card, DataList, DataRow } from "@/components/ui/Card";
import { FilterTabs } from "@/components/ui/FilterBar";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/States";
import { Skeleton } from "@/components/ui/Skeleton";
import { Icon } from "@/components/primitives/Icon";
import { Ltr } from "@/components/primitives/Ltr";
import { tokenLiteral } from "./email-body";

/**
 * The rendered mail, folded into the compose step — item 8.
 *
 * ## `StepPreview`'s argument is kept, and only its conclusion is overruled
 *
 * The step this replaces showed the HTML as **source**, deliberately, and its
 * reasoning was written down rather than assumed: *a preview that renders is a
 * preview of how this browser draws it, which is not how a mail client will, and
 * it invites treating the panel as a WYSIWYG it is not.* Both halves of that are
 * true and neither is repealed here. What changed is the weight on the other side
 * of the scale — `todo.yml` puts it plainly: *"whats the point of having apperçu
 * if it doesnt render the html"* — because the reader of this screen is a
 * shopkeeper, and raw `<table cellpadding="0">` is not a preview to them at any
 * fidelity. A render that is approximately right is worth more than markup that is
 * exactly right and unreadable.
 *
 * So the argument survives in the two places it can still do work, which is the
 * shape `components/ui/Listbox.tsx` and `DatePicker` used when they reversed a
 * case: **in this docblock**, whole, so the next person reads the reasoning before
 * they touch the decision; and **on screen in one line** — `previewStep.render`,
 * the card's own description — saying that this is the browser's drawing and that
 * the test send is the real thing. The test send is one step away and is still the
 * final gate before an audience, exactly as it was.
 *
 * The source did not disappear either, which is the third reason the reversal is
 * cheap: `GeneratedBodies` sits directly above this card with both bodies in
 * editable text areas. Anybody who wants the markup is looking at it already.
 *
 * ## Why this is a file and not a block inside `Steps.tsx`
 *
 * The test the last dozen entries in `scripts/check-design.sh` apply — *a block
 * that is only markup stays in its screen; a block that owns decisions gets a file
 * so the decisions have somewhere to be argued.* Four decisions live below and
 * none of them is markup: the exact `sandbox` value and every token refused, the
 * document wrapper the fragment is served inside, the height of a frame whose
 * content cannot be measured, and what "stale" means on a step that now holds a
 * live form. `Steps.tsx` is already the wizard's four steps and this is one card
 * inside one of them — `BodyForm.tsx`'s argument at the branch before this one.
 *
 * ## Under the form, and that is the column's decision rather than a preference
 *
 * The step text offers "beside or under". `PageBody width="detail"` is
 * `max-w-192` — **768px** — and the message is a 600px card. Beside would leave
 * the form about 140px wide at the composer's widest, and there is no width at all
 * at the 340px floor. So: under, and the frame is the last thing on the step before
 * the token list.
 */

/* ------------------------------------------------------------- the sandbox --- */

/**
 * **The empty string, which is every restriction turned on.**
 *
 * `sandbox` is a list of permissions *granted back*, so the argument has to be
 * made token by token for the ones that are absent — an empty attribute is not
 * laziness, it is the only value that grants nothing. The HTML in it is sanitised
 * on save with an email-safe allowlist (`Campaigns\EmailHtml::sanitize()`, called
 * from `CampaignService::create()`/`::update()`, and from
 * `EmailTemplates::sanitizeOnSave()` for a body that came from a template), so
 * rendering it is already safe. This is the belt under those braces: it holds even
 * on the day the allowlist is widened by somebody who did not know this screen
 * renders its output.
 *
 * Each token, and why it is not here:
 *
 *   `allow-scripts`       There is no script to run — `script` is in
 *                         `EmailHtml::FORBIDDEN_TAGS` and every `on*` attribute is
 *                         refused by `FORBIDDEN_ATTRIBUTE_PREFIXES`. Granting it
 *                         would buy exactly one thing, the height measurement
 *                         below, and would spend the whole point of the sandbox to
 *                         buy it: a body that reached this screen carrying script
 *                         would then execute it. Refused, and the height is solved
 *                         another way.
 *   `allow-same-origin`   The one that matters most. Without it the frame's
 *                         document has an **opaque origin**: it cannot read the
 *                         panel's cookies, `localStorage` or DOM, and the panel
 *                         cannot read its document either. Both halves of that are
 *                         deliberate — see the height note. With `allow-scripts`
 *                         beside it the pair would be worth nothing at all, since
 *                         a script in a same-origin frame can simply remove the
 *                         sandbox attribute from its own iframe element.
 *   `allow-forms`         `form`, `input`, `button`, `select` and `textarea` are
 *                         all in `FORBIDDEN_TAGS`, and the plugin says why: *"a
 *                         form in an email is a phishing pattern"*. Nothing to
 *                         submit.
 *   `allow-popups`        See the link note below — its absence is what makes a
 *                         link click inert rather than a navigation.
 *   `allow-top-navigation`, `allow-modals`, `allow-downloads`, `allow-pointer-lock`
 *                         A preview of a marketing email has no business doing any
 *                         of these, and each is a real thing a hostile body would
 *                         otherwise try.
 *
 * ## What a link click does
 *
 * This needed deciding rather than discovering, because the default is bad. A
 * sandboxed frame is always allowed to navigate **itself** — no token gates that —
 * so an `<a href>` with no `target` would replace the preview with the live page,
 * fetched from the panel, and the preview would be gone until the tab was
 * re-rendered. The unsubscribe link the API appends to every body is the worst
 * case: it is the one link on the screen somebody clicks by reflex.
 *
 * So the wrapper document carries `<base target="_blank">`, which routes every
 * link to an auxiliary browsing context — and `allow-popups` is not granted, so
 * the browser blocks it. The click does **nothing**, the preview survives, and the
 * screen says so in `previewStep.render` rather than leaving somebody to wonder.
 * That is the right outcome twice over: a mail client is where a link gets
 * clicked, and the appended unsubscribe URL carries the sample token
 * (`CampaignService::sampleContext()`, `?token=sample`) so following it would
 * teach nobody anything.
 */
export const PREVIEW_SANDBOX = "";

/* ------------------------------------------------------------ the document --- */

/**
 * The email fragment, wrapped in the smallest document that renders it honestly.
 *
 * **A wrapper is required rather than tidy.** `buildEmail()` emits no document at
 * all — no `<html>`, no `<head>`, no `<body>` — and its docblock says why: `head`
 * and `style` are stripped by the sanitiser while *their text is kept*, so a
 * generator that emitted a wrapper would print its own stylesheet into somebody's
 * inbox. The markup therefore starts at the outermost `<table>`, and something has
 * to put a document around it before a browser will lay it out. That something is
 * here, in the panel, where it cannot reach the wire.
 *
 * Pure, exported, and asserted in `tests/mail-preview.test.ts` — the same split
 * `email-body.ts` makes, and for the same reason: what a screenshot cannot show is
 * that the fragment arrives **byte for byte** inside the wrapper. This function
 * concatenates and never rewrites. The preview is the server's own render of the
 * stored body; a panel that "helpfully" patched it would be previewing something
 * nobody is going to send.
 *
 * Four lines and each is load-bearing:
 *
 *   `dir="auto"`   The panel's direction does **not** cross into a frame — a
 *                  separate document computes its own direction from its own root
 *                  — so this is a choice rather than an inheritance, and `auto` is
 *                  the choice the retired `<pre dir="auto">` already made for the
 *                  same content. The mail states its own direction anyway:
 *                  `EmailHtml::ALLOWED` has no `dir` on any tag, so `buildEmail()`
 *                  writes `direction:rtl` into the `style` of every text-bearing
 *                  cell, which wins inside its own subtree whatever the root says.
 *                  `auto` decides the rest — a hand-written body that states
 *                  nothing — from the first strong character, which is what a
 *                  reader would have wanted anyway.
 *   the viewport   Without it a mobile browser lays a frame out against a ~980px
 *                  virtual viewport and then scales the result down, which at the
 *                  340px floor turns a 600px card into an unreadable stamp. With
 *                  it the frame's own box is the viewport and the message's
 *                  `width:100%` fluidity does what it was written to do.
 *   `<base>`       The link decision above. `target` only, and deliberately no
 *                  `href`: a relative URL in a hand-written body then resolves
 *                  against the panel and fails to load, which is exactly what it
 *                  would do in a mail client. A `<base href>` pointed at the shop
 *                  would make the preview work where the mail will not.
 *   the background `EMAIL_PALETTE.ground`, the same colour the message's own outer
 *                  table paints, so the frame's letterbox is part of the mail
 *                  rather than a white gap. It is the **light** palette in both
 *                  themes, and that is correct rather than an oversight: the
 *                  message has one set of colours and no media query can reach it
 *                  (`style` is a forbidden tag), so a dark-mode preview would be
 *                  the panel showing a mail that does not exist.
 *
 * There is no `<style>` beyond the two-property reset, no font stack, and no
 * script. Everything the message looks like is inline on the message, which is the
 * constraint it was generated under — so the preview inherits nothing from the
 * panel and the frame is as close to a bare client as a browser gets.
 */
export function previewDocument(html: string): string {
  return [
    "<!doctype html>",
    '<html dir="auto">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<base target="_blank">',
    `<style>html,body{margin:0;padding:0;background-color:${EMAIL_PALETTE.ground}}</style>`,
    "</head>",
    "<body>",
    html,
    "</body>",
    "</html>",
  ].join("\n");
}

/* ------------------------------------------------------------- the component --- */

export type MailPreviewState = {
  /** The server's render of the **saved** campaign, or null while it is unknown. */
  preview: CampaignPreview | null;
  loading: boolean;
  /**
   * The draft on screen differs from the campaign the render came from.
   *
   * Compared against the **server's copy** rather than against a snapshot of the
   * last save, and that is the honest comparison rather than the flattering one:
   * the question this marker answers is *does the frame show what the form says*,
   * and the frame shows what was stored. A snapshot would answer a different
   * question — *have you typed since you last pressed save* — which is the same
   * answer almost always and the wrong one exactly when it matters.
   *
   * The case where the two differ is worth having: `body_html` is sanitised on
   * save, so a hand-edited body carrying something the allowlist removes comes
   * back changed and stays marked. `changes.md` records that the composer does not
   * rebind its draft to the PATCH response, and that the difference was *"visible
   * only on the next load"*. It is visible here now. The sentence stays true —
   * the preview does show the last save, and the form does not match it.
   */
  stale: boolean;
  /** A save is in flight. The refresh control is the composer's own `save()`. */
  refreshing: boolean;
  /** §3.7's offline reason, or null. A refresh is a write and says why it cannot. */
  blocked: string | null;
  onRefresh: () => void;
};

/**
 * The warning, then the render.
 *
 * The order is sub-task 3's: `unknown_tokens` belongs *next to the body it is
 * about*, which is the text areas immediately above this component, not on a page
 * of its own two clicks away. It is the one thing the retired step existed for and
 * the one thing that could not survive being skipped.
 */
export function MailPreview({
  preview,
  loading,
  stale,
  refreshing,
  blocked,
  onRefresh,
}: MailPreviewState) {
  const t = useTranslations("campaigns");
  const [part, setPart] = useState<"html" | "text">("html");

  if (preview === null) {
    return (
      <Card title={t("previewStep.title")}>
        {/* The real box: a part switcher over a body block, so the card does not
            change height when the render arrives. */}
        <div className="flex flex-col gap-3" aria-busy={loading || undefined}>
          <Skeleton className="h-9 w-40 rounded-ui-md" />
          <Skeleton className="h-80 w-full rounded-ui-md" />
        </div>
      </Card>
    );
  }

  return (
    <>
      {/*
        **The whole reason the retired step existed, kept and moved rather than
        deleted.** An unknown token renders *empty* — `TemplateRenderer::substitute()`
        returns `''` for a name outside its allowlist — so `{{firstname}}` is five
        thousand mails beginning "Bonjour ,", and nothing else on any screen would
        say so. `unknown_tokens` is computed over the subject **and both bodies**
        (`TemplateRenderer::unknownTokens($subject . "\n" . $html . "\n" . $text)`),
        which is why it belongs on this step: all three are edited here.
      */}
      {preview.unknown_tokens.length > 0 ? (
        <Notice
          tone="warning"
          title={t("previewStep.unknownTokens", { count: preview.unknown_tokens.length })}
        >
          <span className="flex flex-wrap gap-1.5" data-testid="unknown-tokens">
            {preview.unknown_tokens.map((token) => (
              <Ltr
                key={token}
                numeric={false}
                className="rounded-ui-sm bg-ui-surface px-1.5 py-0.5 font-mono text-ui-caption text-ui-fg"
              >
                {tokenLiteral(token)}
              </Ltr>
            ))}
          </span>
          <span className="text-ui-label">
            {/*
              **The tokens are passed as values, not written into the message.**
              `{{first_name}}` inside an ICU string parses as a `{first_name}`
              placeholder wrapped in literal braces, so the message throws
              `INVALID_MESSAGE` and next-intl renders the key path — which is what
              this line did until a screenshot showed it. A value is inserted
              verbatim and never re-parsed.
            */}
            {t("previewStep.unknownWhy", {
              correct: tokenLiteral("first_name"),
              wrong: "{{firstname}}",
            })}
          </span>
        </Notice>
      ) : null}

      <Card
        title={t("previewStep.title")}
        /*
          **Sub-task 4's one line, and it is a `description` rather than a
          footnote on purpose**: it is read *before* the render rather than after
          it, which is the same placement `StepSend` gives the sentence about what
          a send does not do. It says what the frame is, what it is not, where the
          real answer lives, and what a link does — the four facts somebody needs
          in order to read the picture correctly.
        */
        description={t("previewStep.render")}
        footnote={
          unsubscribeNote(preview) === "appended"
            ? t("previewStep.unsubscribeAppended")
            : t("previewStep.unsubscribeAuthored")
        }
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            size="sm"
            loading={refreshing}
            disabled={!stale || blocked !== null}
            /* §3.3: a disabled control says why, and the two reasons are
               different — one is fixed by typing, the other by a network. */
            title={blocked ?? (stale ? undefined : t("previewStep.fresh"))}
            onClick={onRefresh}
            data-testid="refresh-preview"
          >
            {t("previewStep.refresh")}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <DataList>
            <DataRow label={t("field.subject")} stacked>
              <span dir="auto">{preview.subject}</span>
            </DataRow>
          </DataList>

          {/* `chips`, not the tab strip: DECISIONS.md §12's panel-wide rule is
              that a full-bleed underlined strip under the header always means
              *which view*, and this is a labelled choice inside a card. The two
              values are the mail's two **parts**, which is what they always were —
              only the HTML one is now drawn instead of quoted. */}
          <FilterTabs<"html" | "text">
            tabs={[
              { value: "html", label: t("previewStep.html") },
              { value: "text", label: t("previewStep.text") },
            ]}
            value={part}
            onChange={setPart}
            label={t("previewStep.partLabel")}
            variant="chips"
          />

          {part === "html" ? (
            /*
              **The height is fixed, and that is the answer to a question with no
              good answer.** A `srcdoc` frame does not size to its content, and the
              content cannot be measured from here: `PREVIEW_SANDBOX` withholds
              `allow-same-origin`, so the frame's document has an opaque origin and
              `contentDocument` is null. The two ways to get the number back are
              the two permissions that are worth more than the number —
              `allow-same-origin` re-joins the frame to the panel, and
              `allow-scripts` lets a body that reached this screen execute. Neither
              is spent on a layout convenience.

              So the frame is a **window** onto the message rather than a copy of
              it: `h-80`, the same ceiling `max-h-80` gives the text part below and
              every other body block in this panel, and the frame scrolls itself
              past it. 20rem, so it is 320px in French and **340px in Arabic** —
              `globals.css` sets `[dir="rtl"] { font-size: 106.25% }` because Plex
              Sans Arabic's x-height sits lower, and the box follows the panel's
              type scale like every other block. What is inside the frame does not:
              a separate document has its own root size, measured at 16px in both
              locales, so the message renders at the px sizes it states inline and
              is identical in both. Correct twice over — the mail is one artefact,
              and the window onto it is part of the panel.

              That has one more property worth naming: a message wider or taller
              than the box cannot push the *panel's* document past its viewport,
              because an overflow inside a frame is the frame's. The capture
              harness's 340px overflow assertion is on the outer document, and this
              is the one block on the screen it can no longer be asked to police.

              `referrerPolicy="no-referrer"`: the body may carry `<img src>` on the
              shop's own CDN and those requests really are made, exactly as a mail
              client would make them. The panel's URL is not theirs to learn.

              No `key`, deliberately: changing `srcdoc` reloads the frame by
              itself, and the campaign's id cannot change under this route — a key
              here would be an attribute with nothing to do.
            */
            <iframe
              title={t("previewStep.frameTitle")}
              srcDoc={previewDocument(preview.html)}
              sandbox={PREVIEW_SANDBOX}
              referrerPolicy="no-referrer"
              className="h-80 w-full rounded-ui-md border border-ui-line bg-ui-surface"
              data-testid="preview-frame"
            />
          ) : (
            /*
              The text part, still as text, because it **is** text — §85's rule is
              that it is authored rather than stripped from the HTML, so it is the
              other half of the message rather than a fallback view of this one.
              `dir="auto"`: the body is whatever language the campaign was written
              in, which is not necessarily the panel's.
            */
            <pre
              dir="auto"
              className="ui-scroll max-h-80 rounded-ui-md bg-ui-surface-2 px-3 py-2 text-ui-caption whitespace-pre-wrap text-ui-fg"
              data-testid="preview-body"
            >
              {preview.text}
            </pre>
          )}

          <div className="flex flex-col gap-1">
            {/*
              **The preview is of the *saved* campaign and the form above it is
              live**, which is new: the retired step was two saves downstream of
              the fields, so it could not disagree with anything on screen. Now it
              can, the moment somebody types. Said rather than hidden — the same
              call `StepAudience` makes about a count that describes the saved
              audience — and with the control that fixes it in the card's own
              header rather than a step away.
            */}
            {stale ? (
              <p
                className="flex items-start gap-1.5 text-ui-label text-ui-muted"
                data-testid="preview-stale"
              >
                <Icon name="clock" className="mt-0.5 size-4 shrink-0 text-ui-subtle" />
                <span className="min-w-0">{t("previewStep.stale")}</span>
              </p>
            ) : null}
            {/* Who "Amina Belkacem" is. `sampleContext()` is deliberately not a
                real customer — a preview built from one would put their name and
                a working unsubscribe link into an admin screen. */}
            <p className="text-ui-label text-ui-subtle">{t("previewStep.sample")}</p>
          </div>
        </div>
      </Card>
    </>
  );
}
