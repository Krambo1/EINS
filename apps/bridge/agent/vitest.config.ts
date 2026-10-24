import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Keeps the suite away from the real machine-wide data dir
    // (%ProgramData%\EINS-Agent). See vitest.setup.ts.
    setupFiles: ["./vitest.setup.ts"],
  },
});
