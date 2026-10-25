import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: r("./") },
      // Next.js provides "server-only" inside its bundler; in plain Node tests it is a no-op.
      { find: /^server-only$/, replacement: r("./test/server-only-stub.ts") },
    ],
  },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
