import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    css: false,
    clearMocks: true,
    // Boundary tests type 128-129 character passwords key by key with userEvent (~30 ms per key in
    // jsdom). They pass in about 4 s alone but exceed the 5 s default when the files run in parallel.
    testTimeout: 30_000,
  },
});
