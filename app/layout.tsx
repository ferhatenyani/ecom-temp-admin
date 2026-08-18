import type { ReactNode } from "react";

/**
 * The root layout exists only to satisfy Next's requirement for one above the
 * `[locale]` segment. `<html>` and `<body>` are emitted by
 * `app/[locale]/layout.tsx`, because `lang` and `dir` come from the locale and
 * this level does not know it.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
