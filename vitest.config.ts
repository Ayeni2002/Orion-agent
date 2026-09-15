import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Phase 1 has no component-render layer, so the node environment is enough.
    // Later phases that test rendered UI should switch this to jsdom per-file
    // via a `// @vitest-environment jsdom` docblock, not globally.
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Clears the provider environment before every test file, so the suite
    // cannot inherit a configured endpoint from the shell it was run in. See
    // the file — it is what makes "no test needs a credential" a property of
    // the setup rather than of the machine.
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
