/**
 * The API's human-readable summaries carry HTML entities.
 *
 * Measured 2026-08-18 on `GET /orders/3078/timeline`:
 *
 *   "Stock levels reduced: Shipping test AC-SHIP-BOX (99&rarr;98)"
 *
 * React renders `{summary}` as text, so that string prints the six literal
 * characters `&rarr;` on screen. The entity has to be decoded before display —
 * and decoded *to text*, never handed to `dangerouslySetInnerHTML`, because the
 * same field also carries note bodies a customer could have influenced.
 *
 * A named-entity table rather than a DOM round-trip: this runs during server
 * rendering where there is no `document`, and the set of entities WooCommerce
 * actually emits in these strings is small and closed.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rarr: "→",
  larr: "←",
  rdquo: "”",
  ldquo: "“",
  rsquo: "’",
  lsquo: "‘",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  times: "×",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  deg: "°",
};

/**
 * `&amp;` is decoded in the same single pass as everything else, so an
 * `&amp;rarr;` in the source stays the literal text `&rarr;` instead of being
 * double-decoded into an arrow. That is why this is one regex and not a
 * sequence of `.replace` calls with `&amp;` handled first or last.
 */
export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const codePoint = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return whole;
      // Lone surrogates would throw and are never what the API meant.
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return whole;
      return String.fromCodePoint(codePoint);
    }
    const named = NAMED[body.toLowerCase()];
    return named ?? whole;
  });
}
