import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "."),
      /**
       * `server-only` is provided by Next, not by npm, so Vite cannot resolve it.
       * It is stubbed here rather than removed from the source: in the real build
       * it is what turns "someone imported the credential sealer into a client
       * component" from a leak into a compile error, and that guarantee is worth
       * more than a tidy test config.
       */
      "server-only": resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
