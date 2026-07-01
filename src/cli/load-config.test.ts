import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, loadSchemas } from "./load-config";

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
});
