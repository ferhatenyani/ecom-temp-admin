import { describe, expect, it } from "vitest";
import {
  PREVIEW_SANDBOX,
  previewDocument,
  previewFailure,
} from "@/app/[locale]/(panel)/marketing/campaigns/[id]/MailPreview";
import { buildEmail, emptyValues } from "@/app/[locale]/(panel)/marketing/campaigns/[id]/email-body";
import { BrowserApiError } from "@/lib/api/browser";
import { EMAIL_PALETTE } from "@/lib/email-palette";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * The rendered preview's two testable halves — item 8.
 *
 * The component is not tested here and could not usefully be: what a
 * `srcdoc` frame draws is a browser's business, and the assertions that matter
 * about it (that the panel's direction does not leak in, that a link click does
 * not navigate the frame, that the box holds at 340px) are browser facts a jsdom
 * `render()` would answer wrongly and confidently. Those were driven in a real
 * Chromium at both locales and both widths; this file asserts the two things a
 * browser cannot show and a reviewer cannot eyeball.
 *
 * **The wrapper carries the fragment and never rewrites it**, and **the sandbox
 * grants nothing**. Both are properties somebody can break with a one-token edit
 * that reads as an improvement.
 */

const FRAGMENT = '<p style="direction:ltr">Bonjour Amina,</p>';

describe("the preview document", () => {
  it("carries the server's HTML byte for byte", () => {
    /*
     * The whole reason `previewDocument` is a concatenation rather than a
     * transformation. `preview.html` is the API's own render of the stored body —
     * tokens resolved, unsubscribe footer appended by `TemplateRenderer::render()`
     * — and a panel that patched it on the way into the frame would be previewing
     * a message nobody is going to send. Asserted as a *substring*, which is the
     * only form of this claim that cannot be satisfied by a lucky escape.
     */
    expect(previewDocument(FRAGMENT)).toContain(FRAGMENT);

    // And on a real generated body, which is the case that actually ships: a
    // table with quotes, percent signs and hex colours in its attributes.
    const { html } = buildEmail({
      ...emptyValues("rtl"),
      title: "الجمعة البيضاء",
      paragraphs: ["كل شيء بخصم 30٪."],
    });
    expect(html).not.toBe("");
    expect(previewDocument(html)).toContain(html);
  });

  it("is a whole document, because the generator deliberately is not", () => {
    /*
     * `buildEmail()` emits no wrapper at all and its docblock says why:
     * `EmailHtml::FORBIDDEN_TAGS` holds `style`, `head`, `meta` and `link`, and
     * the sanitiser strips the tag while **keeping its text** — so a generator
     * that emitted a `<style>` block would print its own stylesheet into
     * somebody's inbox. The wrapper therefore has to be added here, on the panel
     * side of the wire, where the sanitiser can never see it.
     */
    const document = previewDocument(FRAGMENT);

    expect(document.startsWith("<!doctype html>")).toBe(true);
    expect(document).toContain("<body>");
    expect(document.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("declares no direction of its own beyond `auto`", () => {
    /*
     * A frame is a separate document, so the panel's `dir="rtl"` does not reach
     * it and the root direction is a **choice**. `auto` is the choice the retired
     * `<pre dir="auto">` already made for the same bytes: the message states its
     * own direction inline on every text-bearing cell — `dir` is in no tag's
     * allowlist, so `direction:rtl` in a `style` is the only mechanism that
     * survives a save — and `auto` decides the rest from the first strong
     * character.
     */
    expect(previewDocument(FRAGMENT)).toContain('<html dir="auto">');
    expect(previewDocument(FRAGMENT)).not.toContain('dir="rtl"');
    expect(previewDocument(FRAGMENT)).not.toContain('<html dir="ltr">');
  });

  it("routes every link away from the frame", () => {
    /*
     * **The default here is bad and had to be overridden.** A sandboxed frame is
     * always permitted to navigate *itself* — no token gates that — so an `<a
     * href>` with no target would replace the preview with the live page. `<base
     * target="_blank">` sends the click to an auxiliary context instead, and
     * `allow-popups` is not granted, so the browser blocks it and the preview
     * survives.
     *
     * No `href` on the `<base>`, deliberately: a relative URL in a hand-written
     * body then fails to resolve, which is exactly what it would do in a mail
     * client. A base pointed at the shop would make the preview work where the
     * mail will not.
     */
    expect(previewDocument(FRAGMENT)).toContain('<base target="_blank">');
    expect(previewDocument(FRAGMENT)).not.toMatch(/<base[^>]*href/);
  });

  it("adds no script and no styling the message does not carry itself", () => {
    /*
     * Everything the message looks like is inline on the message, because that is
     * the only styling that survives `EmailHtml::sanitize()`. So the wrapper adds
     * a two-property reset and the mail's own ground colour and nothing else — no
     * font stack, no rules that could make the preview prettier than the mail.
     */
    const document = previewDocument(FRAGMENT);

    expect(document).not.toContain("<script");
    expect(document).not.toContain("font-family");
    expect(document).toContain(
      `<style>html,body{margin:0;padding:0;background-color:${EMAIL_PALETTE.ground}}</style>`,
    );

    // One `<style>` element, and it is the reset. A second would be a rule the
    // message cannot carry, shown to somebody deciding whether to send it.
    expect(document.match(/<style/g)).toHaveLength(1);
  });

  it("gives the frame a viewport, which is what makes 340px legible", () => {
    /*
     * Without it a mobile browser lays a frame out against a ~980px virtual
     * viewport and scales the result down — at the panel's 340px floor that turns
     * a 600px card into a stamp. With it the frame's own box is the viewport and
     * the message's `width:100%` fluidity does what it was written to do.
     */
    expect(previewDocument(FRAGMENT)).toContain(
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
    );
  });
});

describe("the sandbox", () => {
  it("grants nothing, and this assertion exists to make a grant explain itself", () => {
    /*
     * **A change-detector on purpose**, which is not the usual thing to want. The
     * only way this constant moves is somebody adding a token, and every token is
     * a permission handed to markup a shopkeeper authored:
     *
     *   `allow-scripts`      would buy the frame's height, which is the one thing
     *                        the fixed box below gives up — and would spend the
     *                        whole sandbox to buy it.
     *   `allow-same-origin`  would re-join the frame to the panel's origin, and
     *                        beside `allow-scripts` would be worth nothing at all:
     *                        a script in a same-origin frame can remove the
     *                        sandbox attribute from its own iframe element.
     *   `allow-popups`       is what currently makes a link click inert rather
     *                        than a navigation.
     *
     * The HTML is sanitised on save and that is the belt; this is the braces. A
     * test that fails on the diff is the cheapest way to make the second half of
     * that sentence stay true.
     */
    expect(PREVIEW_SANDBOX).toBe("");
  });
});

/**
 * Item D11 — the third state, and the classification that decides which of the
 * two failures is on screen.
 *
 * Pure, so it is testable where the component is not: what a `srcdoc` frame draws
 * is a browser's business, but *whether a 403 offers a retry* is a decision, and
 * it is one a plausible edit could collapse.
 */
describe("a preview that did not arrive", () => {
  const refusal = (status: number, message = "Sorry, you are not allowed to do that.") =>
    new BrowserApiError({ status, message });

  it("tells a lost permission apart from a lost request", () => {
    /*
     * `CampaignService::preview():275` asserts `MANAGE_MARKETING`, which is the
     * same capability the campaign read and the whole screen are gated on — read
     * from source. So a 403 here is not a Marketing Manager's ordinary state
     * (that state is a **200** with a null `audience_count`, measured, and
     * `hasAudienceCount` is what handles it) but a capability that went away
     * under an open tab. Asking again cannot grant a permission, so the forbidden
     * branch carries no detail to render and the component offers no retry.
     */
    expect(previewFailure(refusal(403))).toEqual({ kind: "forbidden", detail: null });

    // Everything else is a request that did not complete, and asking again is
    // exactly the remedy.
    expect(previewFailure(refusal(500, "Internal error")).kind).toBe("read");
    expect(previewFailure(refusal(503, "Service unavailable")).kind).toBe("read");
    expect(previewFailure(refusal(404, "No campaign with that id.")).kind).toBe("read");
  });

  it("keeps the API's own sentence, and only the API's", () => {
    /*
     * `ErrorState.detail` is where the provider's English belongs — beside the
     * panel's own message, never as it — which is the arrangement
     * `analytics/page.tsx` reached for the same pair. What must *not* reach it is
     * the panel talking to itself: a `campaignPreview.parse()` failure throws a
     * `ZodError` whose message names paths in a TypeScript schema, and putting
     * that under "the preview could not be loaded" would be the worst text on the
     * screen.
     */
    expect(previewFailure(refusal(500, "Internal error")).detail).toBe("Internal error");

    for (const thrown of [
      new Error("Expected object, received null at html"),
      new TypeError("fetch failed"),
      "a string nobody threw on purpose",
      undefined,
    ]) {
      const failure = previewFailure(thrown);
      expect(failure.kind, String(thrown)).toBe("read");
      expect(failure.detail, String(thrown)).toBeNull();
    }
  });

  it("says both halves in both locales", () => {
    /*
     * `failed` replaces the skeleton and `refreshFailed` is the marker under a
     * render that is present but behind — the state react-query produces by
     * keeping the last successful data through a failed refetch, and the one a
     * single nullable preview could not have expressed.
     */
    for (const messages of [fr, ar]) {
      for (const key of ["failed", "refreshFailed"] as const) {
        expect(messages.campaigns.previewStep[key], key).toBeTypeOf("string");
      }
    }
    expect(fr.campaigns.previewStep.failed).not.toBe(ar.campaigns.previewStep.failed);

    // The retry's own label is `states.retry`, reused rather than re-declared:
    // `ErrorState` draws it and this branch adds no button of its own.
    expect(fr.states.retry).toBeTypeOf("string");
    expect(ar.states.retry).toBeTypeOf("string");
    // And the 403 renders `ForbiddenState`, which names the capability itself.
    expect(fr.states.capability.ac_manage_marketing).toBeTypeOf("string");
    expect(ar.states.capability.ac_manage_marketing).toBeTypeOf("string");
  });
});
