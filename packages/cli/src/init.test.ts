import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "./init";

describe("runInit", () => {
  it("scaffolds config + schema, and does not overwrite on re-run", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mm-init-"));
    const first = await runInit({ cwd });
    expect(first.created).toContain("meta-manifest.config.ts");
    expect(existsSync(join(cwd, "meta-manifest.config.ts"))).toBe(true);

    // Optional modules are discoverable as commented config lines.
    const config = readFileSync(join(cwd, "meta-manifest.config.ts"), "utf8");
    expect(config).toContain(`// entries: "./src/entries.ts",`);
    expect(config).toContain(`// metafields: "./src/metafields.ts",`);
    expect(config).toContain(`// auth: "cli",`);
    expect(config).toContain(`// auth: "client-credentials",`);
    expect(config).toContain(`// clientId: process.env.SHOPIFY_CLIENT_ID!,`);
    expect(config).toContain(`// clientSecret: process.env.SHOPIFY_CLIENT_SECRET!,`);

    // One metaobject per file (default export), aggregated by the main schema module.
    expect(readFileSync(join(cwd, "src/metaobjects/author.ts"), "utf8")).toContain("export default defineMetaobject");
    const schema = readFileSync(join(cwd, "src/schema.ts"), "utf8");
    expect(schema).toContain(`import author from "./metaobjects/author"`);
    expect(schema).toContain("export const schemas = [author]");

    const second = await runInit({ cwd });
    expect(second.created).toEqual([]); // nothing overwritten
  });

  it("writes a placeholder .env when SHOPIFY_ADMIN_TOKEN is not set", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mm-init-"));
    const result = await runInit({ cwd, env: {} });
    expect(result.created).toContain(".env");
    const env = readFileSync(join(cwd, ".env"), "utf8");
    expect(env).toContain("SHOPIFY_ADMIN_TOKEN=\n");
    expect(env).toContain("# SHOPIFY_CLIENT_ID=");
    expect(env).toContain("# SHOPIFY_CLIENT_SECRET=");
  });

  it("persists an already-exported SHOPIFY_ADMIN_TOKEN into .env", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mm-init-"));
    await runInit({ cwd, env: { SHOPIFY_ADMIN_TOKEN: "shpat_test123" } });
    const env = readFileSync(join(cwd, ".env"), "utf8");
    expect(env).toContain("SHOPIFY_ADMIN_TOKEN=shpat_test123\n");
  });

  it("never overwrites an existing .env", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mm-init-"));
    writeFileSync(join(cwd, ".env"), "SHOPIFY_ADMIN_TOKEN=keepme\n");
    const result = await runInit({ cwd, env: { SHOPIFY_ADMIN_TOKEN: "shpat_other" } });
    expect(result.created).not.toContain(".env");
    expect(readFileSync(join(cwd, ".env"), "utf8")).toBe("SHOPIFY_ADMIN_TOKEN=keepme\n");
  });

  it("creates .gitignore covering .env when missing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mm-init-"));
    await runInit({ cwd, env: {} });
    const lines = readFileSync(join(cwd, ".gitignore"), "utf8").split("\n");
    expect(lines).toContain(".env");
  });

  it("appends .env to an existing .gitignore that does not cover it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mm-init-"));
    writeFileSync(join(cwd, ".gitignore"), "node_modules\ndist\n");
    await runInit({ cwd, env: {} });
    const contents = readFileSync(join(cwd, ".gitignore"), "utf8");
    expect(contents.startsWith("node_modules\ndist\n")).toBe(true);
    expect(contents.split("\n")).toContain(".env");
  });

  it("leaves .gitignore alone when .env is already covered", async () => {
    for (const covered of [".env\n", "/.env\n"]) {
      const cwd = mkdtempSync(join(tmpdir(), "mm-init-"));
      writeFileSync(join(cwd, ".gitignore"), `node_modules\n${covered}`);
      await runInit({ cwd, env: {} });
      expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe(`node_modules\n${covered}`);
    }
  });
});
