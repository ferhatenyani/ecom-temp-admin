import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/**
 * Next 16 renamed the `middleware` file convention to `proxy`, and the export
 * must be named `proxy` or be the default. next-intl still ships its factory
 * under `next-intl/middleware` — the package name is not the file convention, so
 * the import stays as it is and only the file and export names change.
 */
export const proxy = createMiddleware(routing);

export const config = {
  /**
   * Everything except API routes, Next internals and files with an extension.
   * `/api/*` must not be locale-prefixed: the session and proxy handlers are
   * addressed by the browser directly and have no locale.
   */
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
