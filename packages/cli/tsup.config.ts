import { defineConfig } from "tsup";

export default defineConfig({
  // The CLI uses import.meta.url (ESM-only), so it must not get a CJS build;
  // both bin entries point at the ESM output.
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  clean: true,
  sourcemap: true,
  banner: { js: "" },
});
