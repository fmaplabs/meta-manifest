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

/** Write several modules into one temp dir; returns the dir. */
function tmpDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "mm-load-"));
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
  return dir;
}

const idx = JSON.stringify(join(process.cwd(), "src/index.ts"));

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
    const file = tmp("schema.ts",
      `import { defineMetaobject, m } from ${idx};
       export const A = defineMetaobject("a", { name: "A", fields: { n: m.text() } });
       export const schemas = [A];`);
    const schemas = await loadSchemas(file);
    expect(schemas.map((s) => s.type)).toEqual(["$app:a"]);
  });

  it("loads schemas declared across multiple files as default exports", async () => {
    const dir = tmpDir({
      "author.ts": `import { defineMetaobject, m } from ${idx};
        export default defineMetaobject("author", { name: "Author", fields: { name: m.text() } });`,
      "book.ts": `import { defineMetaobject, m } from ${idx};
        export default defineMetaobject("book", { name: "Book", fields: { title: m.text() } });`,
      "schema.ts": `import author from "./author";
        import book from "./book";
        export const schemas = [author, book];`,
    });
    const schemas = await loadSchemas(join(dir, "schema.ts"));
    expect(schemas.map((s) => s.type)).toEqual(["$app:author", "$app:book"]);
  });

  it("names the element and hints at the default-export convention when a schema import is undefined", async () => {
    const dir = tmpDir({
      "author.ts": `import { defineMetaobject, m } from ${idx};
        export const author = defineMetaobject("author", { name: "Author", fields: { name: m.text() } });`,
      // author.ts has no default export, so \`author\` below is undefined at runtime.
      "schema.ts": `import author from "./author";
        export const schemas = [author];`,
    });
    await expect(loadSchemas(join(dir, "schema.ts"))).rejects.toThrow(/schemas\[0\].*export default/s);
  });

  it("rejects a schemas element that is not a metaobject schema", async () => {
    const file = tmp("schema.ts", `export const schemas = [{ handle: "a" }];`);
    await expect(loadSchemas(file)).rejects.toThrow(/schemas\[0\]/);
  });

  it("rejects duplicate metaobject types across schema files", async () => {
    const dir = tmpDir({
      "author.ts": `import { defineMetaobject, m } from ${idx};
        export default defineMetaobject("author", { name: "Author", fields: { name: m.text() } });`,
      "author-again.ts": `import { defineMetaobject, m } from ${idx};
        export default defineMetaobject("author", { name: "Author again", fields: { name: m.text() } });`,
      "schema.ts": `import author from "./author";
        import authorAgain from "./author-again";
        export const schemas = [author, authorAgain];`,
    });
    await expect(loadSchemas(join(dir, "schema.ts"))).rejects.toThrow(/duplicate.*\$app:author/is);
  });

  it("loads the entries array from an entries module", async () => {
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

  it("loads entry sets declared across multiple files as default exports", async () => {
    const dir = tmpDir({
      "author.ts": `import { defineMetaobject, m } from ${idx};
        export default defineMetaobject("author", { name: "Author", fields: { name: m.text() } });`,
      "author-entries.ts": `import { defineEntries } from ${idx};
        import author from "./author";
        export default defineEntries(author, { "jane-austen": { name: "Jane Austen" } });`,
      "entries.ts": `import authorEntries from "./author-entries";
        export const entries = [authorEntries];`,
    });
    const entries = await loadEntries(join(dir, "entries.ts"));
    expect(entries).toHaveLength(1);
    expect(entries[0].schema.type).toBe("$app:author");
  });

  it("names the element and hints at the default-export convention when an entries import is undefined", async () => {
    const dir = tmpDir({
      "entries.ts": `const missing = undefined;
        export const entries = [missing];`,
    });
    await expect(loadEntries(join(dir, "entries.ts"))).rejects.toThrow(/entries\[0\].*export default/s);
  });
});
