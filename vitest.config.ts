import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Phase 1 has no component-render layer, so the node environment is enough.
    // Later phases that test rendered UI should switch this to jsdom per-file
    // via a `// @vitest-environment jsdom` docblock, not globally.
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
