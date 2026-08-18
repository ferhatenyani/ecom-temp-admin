/**
 * The one file outside `styles/tokens.css` permitted a colour literal, and the
 * reason is recorded here because `scripts/check-design.sh` refuses it anywhere
 * else **by name with the reason** — the backend's own convention for a rule with
 * a bounded exception.
 *
 * `theme-color` paints the browser and iOS status-bar chrome, and Next's metadata
 * API is TypeScript, not CSS: it cannot read a custom property. Setting it from
 * the client after mount does work, but only after first paint, so the status bar
 * flashes the wrong colour every cold start of an installed PWA — which is
 * exactly the safe-area polish the brief exists to protect.
 *
 * These two values MUST mirror `--color-bg-grouped` in `styles/tokens.css`. There
 * is no mechanism that enforces it; the pairing is asserted by a unit test
 * instead, which reads both files and compares them.
 */

export const THEME_COLOR_LIGHT = "#f2f2f7";
export const THEME_COLOR_DARK = "#000000";
