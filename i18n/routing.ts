import { defineRouting } from "next-intl/routing";

/**
 * `fr` and `ar`, and the locale segment is present always — no implicit default —
 * because a shared link must render in the language it was shared in.
 */
export const routing = defineRouting({
  locales: ["fr", "ar"],
  defaultLocale: "fr",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

export function isLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}

/** `dir` comes from the locale, not from a user setting. */
export function dirFor(locale: string): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}
