import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "node/client": "src/node/client.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    banner: { js: "" },
  },
  {
    // The CLI uses import.meta.url (ESM-only), so it must not get a CJS build;
    // both bin entries point at the ESM output.
    entry: {
      "cli/index": "src/cli/index.ts",
    },
    format: ["esm"],
    clean: false,
    sourcemap: true,
    banner: { js: "" },
  },
]);
