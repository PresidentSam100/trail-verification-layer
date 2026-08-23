import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/api/src/**/*.test.ts", "packages/contracts/src/**/*.test.ts"],
    environment: "node",
    coverage: { reporter: ["text", "json-summary"] },
  },
});
