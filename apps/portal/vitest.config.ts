import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` throws on import outside Next.js. Tests run in pure
      // node, so alias it to a noop module — same effect as the worker's
      // require-cache shim, but works for ESM module resolution.
      "server-only": path.resolve(__dirname, "./test/server-only-shim.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./test/setup-env.ts"],
  },
});
