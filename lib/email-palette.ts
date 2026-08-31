/**
 * The email body's six fixed colours, and the **second** file outside
 * `styles/tokens.css` permitted a colour literal.
 *
 * This is a deliberate widening of `scripts/check-design.sh`'s colour rule and it
 * is announced here rather than discovered later, because a rule with a bounded
 * exception is only honest while the boundary is written down. `lib/theme-color.ts`
 * is the precedent and the shape is copied exactly: **exempt by name, with the
 * reason, paired to the token it mirrors by a unit test that reads both files.**
 *
 * ## Why the exemption could not be avoided
 *
 * The rule exists because a component that wants a colour should name a token, and
 * the token resolves through CSS. An email resolves through nothing. Read the
 * backend's `Campaigns\EmailHtml::ALLOWED` and the reason is structural rather
 * than stylistic:
 *
 *  - **There is no `<style>` block.** `style` is in `EmailHtml::FORBIDDEN_TAGS`, so
 *    a stylesheet cannot reach the message — and measured through the real
 *    sanitiser, the tag is stripped while **its text is kept**, so an emitted
 *    `<style>p{color:red}</style>` does not merely fail, it prints `p{color:red}`
 *    into the body of somebody's mail.
 *  - **There is no `class` attribute.** Not on any tag in `ALLOWED`. Measured:
 *    `<div class="wrap">` comes back `<div>`.
 *  - **A custom property has nothing to resolve against.** `var(--color-ui-fg)`
 *    survives `safecss_filter_attr` — `var` is on WordPress's allowed-function
 *    list — and then resolves to nothing in an inbox, because the document that
 *    defined it is a different document on a different machine.
 *
 * So every colour in the message has to be a literal in the message, and the only
 * question left is *where the literal is written*. Written in the generator it
 * would be six numbers scattered through four hundred lines of markup; written
 * here it is six named values with the token each mirrors beside it, and
 * `tests/email-body.test.ts` fails the day one of them drifts.
 *
 * ## The light values only, on purpose
 *
 * Every token below is the **light** value from tokens.css's `ui-` layer. There is
 * no dark variant and there could not be a useful one: dark mode in an email is
 * `@media (prefers-color-scheme: dark)`, a media query needs a `<style>` block,
 * and the block is stripped. What clients do instead is invert the message
 * themselves, with their own heuristics, from whatever the message states — so the
 * one thing the generator can do to help is state a light palette plainly and
 * completely, never leaving a colour unset for a client to guess at.
 *
 * ## The `ui-` layer, not the iOS one above it
 *
 * DESIGN.md's live system. It is also the layer whose neutrals are *hex*: the iOS
 * layer writes `--color-label: rgb(0 0 0 / 1)`, and `rgb()` is **dropped** by
 * `safecss_filter_attr` — measured, `background-color:rgb(255,255,255)` came back
 * with the whole declaration gone. Hex is the only colour syntax that survives the
 * save, which settles the format as well as the values.
 *
 * The contrast ratios in the comments are the ones tokens.css measured, against
 * `--color-ui-surface` — which is `card` below, and is what the text actually sits
 * on in this layout.
 */

export type EmailPalette = {
  /** The band behind the card — `--color-ui-canvas`. */
  ground: string;
  /** The card itself, and the colour of text placed on a dark brand — `--color-ui-surface`. */
  card: string;
  /** Body text and headings — `--color-ui-fg`. */
  ink: string;
  /** The footer, and anything deliberately quieter — `--color-ui-muted`. */
  muted: string;
  /** The card's edge and the rule above the footer — `--color-ui-line`. */
  line: string;
  /**
   * The call-to-action's fill **when the shopkeeper has not chosen one**, and
   * therefore the only one of the six that a form can override.
   *
   * `--color-ui-accent`. tokens.css is explicit that accent means "this is
   * interactive" rather than "this is the primary button", and a call-to-action is
   * the one thing in an email that is unambiguously interactive.
   */
  brand: string;
};

export const EMAIL_PALETTE: EmailPalette = {
  ground: "#f6f7f9", // --color-ui-canvas
  card: "#ffffff", // --color-ui-surface
  ink: "#191d23", // --color-ui-fg      16.92:1 on card
  muted: "#59616e", // --color-ui-muted   6.25:1 on card
  line: "#e2e5ea", // --color-ui-line
  brand: "#0b62d6", // --color-ui-accent  5.63:1 on card
};

/**
 * The token each value mirrors, as data, so the pairing test is a loop rather than
 * six copied assertions — and so adding a seventh colour without pairing it fails
 * to compile.
 */
export const EMAIL_PALETTE_TOKENS: Record<keyof EmailPalette, string> = {
  ground: "--color-ui-canvas",
  card: "--color-ui-surface",
  ink: "--color-ui-fg",
  muted: "--color-ui-muted",
  line: "--color-ui-line",
  brand: "--color-ui-accent",
};
