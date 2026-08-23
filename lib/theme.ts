/**
 * The theme preference, and where it is kept.
 *
 * **A cookie, not `localStorage`.** The first draft used storage plus a blocking
 * inline `<script>` in `<head>` to stamp `data-theme` before paint. That is the
 * long-standing Next.js recipe for avoiding a flash of the wrong theme, and
 * under React 19 it is an error: *"Encountered a script tag while rendering
 * React component. Scripts inside React components are never executed when
 * rendering on the client."* It showed up as a red overlay on every page.
 *
 * A cookie is sent with the document request, so the server already knows the
 * answer and can stamp `data-theme` on `<html>` in the markup it emits. No
 * script, no flash, nothing to hydrate, and the choice survives on a device
 * where storage is blocked but cookies are not.
 *
 * `system` is the *absence* of the cookie rather than a third value: the token
 * file has three states — explicit light, explicit dark, and nothing stamped,
 * where `prefers-color-scheme` decides. Writing `data-theme="system"` would
 * match neither branch and strand the reader in light.
 */

export const THEME_COOKIE = "ac-theme";

/** A year. A theme preference is not something to re-ask about. */
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

export type ThemeChoice = "light" | "dark" | "system";

export function isTheme(value: string | undefined): value is "light" | "dark" {
  return value === "light" || value === "dark";
}

/** What the server stamps on `<html>`, or `undefined` for `system`. */
export function themeAttribute(cookieValue: string | undefined): "light" | "dark" | undefined {
  return isTheme(cookieValue) ? cookieValue : undefined;
}
