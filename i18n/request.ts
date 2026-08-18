import { getRequestConfig } from "next-intl/server";
import { routing, isLocale } from "./routing";
import { SHOP_TIMEZONE } from "@/lib/format/date";

/**
 * next-intl's `requestLocale` is deprecated in 4.13 in favour of
 * `next/root-params`. That module is Server-Component-only in Next 16.3.1 and
 * `getRequestConfig` also runs for Route Handlers, so `requestLocale` stays here
 * and `next/root-params` is used in the layouts, which is where it works.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  // The `[locale]` segment acts as a catch-all for unknown routes, so an invalid
  // value has to be replaced rather than trusted.
  const locale = requested && isLocale(requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Pinned to the shop's zone, not the server's or the reader's.
    timeZone: SHOP_TIMEZONE,
  };
});
