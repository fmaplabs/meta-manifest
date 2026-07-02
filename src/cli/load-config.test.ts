import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, loadEntries, loadSchemas } from "./load-config";

function tmp(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mm-load-"));
  const file = join(dir, name);
  writeFileSync(file, contents);
  return file;
}

describe("loadConfig / loadSchemas", () => {
  it("loads and validates a config default export", async () => {
    const file = tmp("meta-manifest.config.ts",
      `export default { shop: "s.myshopify.com", accessToken: "t", schema: "./schema.ts" };`);
    const config = await loadConfig(file);
    expect(config.shop).toBe("s.myshopify.com");
  });

  it("throws when a required field is missing", async () => {
    const file = tmp("bad.config.ts", `export default { accessToken: "t", schema: "./s.ts" };`);
    await expect(loadConfig(file)).rejects.toThrow(/shop/);
  });

  it("loads the schemas array from a schema module", async () => {
    const idx = JSON.stringify(join(process.cwd(), "src/index.ts"));
    const file = tmp("schema.ts",
      `import { defineMetaobject, m } from ${idx};
       export const A = defineMetaobject("a", { name: "A", fields: { n: m.text() } });
       export const schemas = [A];`);
    const schemas = await loadSchemas(file);
    expect(schemas.map((s) => s.type)).toEqual(["$app:a"]);
  });

  it("loads the entries array from an entries module", async () => {
    const idx = JSON.stringify(join(process.cwd(), "src/index.ts"));
    const file = tmp("entries.ts",
      `import { defineMetaobject, defineEntries, m } from ${idx};
       const A = defineMetaobject("a", { name: "A", fields: { n: m.text() } });
       export const entries = [defineEntries(A, { one: { n: "1" } })];`);
    const entries = await loadEntries(file);
    expect(entries).toHaveLength(1);
    expect(entries[0].schema.type).toBe("$app:a");
  });

  it("throws when an entries module lacks the entries export", async () => {
    const file = tmp("entries.ts", `export const nope = [];`);
    await expect(loadEntries(file)).rejects.toThrow(/entries.*array/);
  });
});
