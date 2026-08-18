import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TypeScript strict is the point of the project; a build that ignores it is a
  // build that ships the thing the config forbids.
  //
  // There is deliberately no `eslint` key: Next 16 removed it, and `next build` no
  // longer runs ESLint at all. Linting is its own stage in scripts/test.sh, which
  // is where it can fail the build on purpose rather than by inheritance.
  typescript: { ignoreBuildErrors: false },

  // The dev overlay's floating badge sits exactly where the bottom tab bar does,
  // so it covers the first tab in every mobile screenshot. Off in development;
  // it never existed in a production build.
  devIndicators: false,
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
