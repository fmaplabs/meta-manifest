import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AdminGraphQLClient } from "../index";
import { defineMetafields, m } from "../index";
import { CURRENT_APP_QUERY, LIST_DEFINITIONS_QUERY, PULL_METAFIELD_DEFINITIONS_QUERY } from "../sync/client";
import { runPull } from "./pull";

function fakeStore(): AdminGraphQLClient {
  return async (query) => {
    if (query === CURRENT_APP_QUERY) {
      return { data: { currentAppInstallation: { app: { id: "gid://shopify/App/111" } } } };
    }
    if (query === PULL_METAFIELD_DEFINITIONS_QUERY) {
      return { data: { metafieldDefinitions: {
        nodes: [{
          id: "gid://shopify/MetafieldDefinition/9",
          name: "Book Author",
          namespace: "app--111",
          key: "author",
          description: null,
          type: { name: "metaobject_reference" },
          validations: [{ name: "metaobject_definition_id", value: "gid://shopify/MetaobjectDefinition/1" }],
          access: { admin: "MERCHANT_READ", storefront: null, customerAccount: null },
          capabilities: {
            adminFilterable: { enabled: false },
            smartCollectionCondition: { enabled: false },
            uniqueValues: { enabled: false },
          },
          pinnedPosition: 1,
        }],
        pageInfo: { hasNextPage: false, endCursor: null } } } };
    }
    expect(query).toBe(LIST_DEFINITIONS_QUERY);
    return { data: { metaobjectDefinitions: {
      nodes: [{ id: "gid://shopify/MetaobjectDefinition/1", name: "Author", type: "app--111--author",
        fieldDefinitions: [{ key: "name", type: { name: "single_line_text_field" }, required: true, validations: [] }] }],
      pageInfo: { hasNextPage: false, endCursor: null } } } };
  };
}

describe("runPull", () => {
  it("writes generated schema source containing the pulled definition", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-pull-"));
    const out = join(dir, "schema.ts");
    const res = await runPull({ client: fakeStore(), schemaPath: out });
    expect(res.count).toBe(1);
    const src = readFileSync(out, "utf8");
    expect(src).toContain('defineMetaobject("author"');
    expect(src).toContain("m.text(");
    expect(src).toContain("export const schemas = [Author]");
  });

  it("re-pulls declared metafield pairs and codegens the metafields module", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-pull-"));
    const sets = [defineMetafields("product", { fields: { author: m.text() } })];
    const res = await runPull({
      client: fakeStore(),
      schemaPath: join(dir, "schema.ts"),
      metafields: { path: join(dir, "metafields.ts"), sets },
    });
    expect(res.metafieldCount).toBe(1);
    const src = readFileSync(join(dir, "metafields.ts"), "utf8");
    expect(src).toContain(`defineMetafields("product", {`);
    // GID-form ref target re-labeled to the canonical type via the metaobject pull.
    expect(src).toContain(`m.ref(() => ({ type: "$app:author" }), { name: "Book Author" })`);
    expect(src).toContain("pin: true");
    expect(src).toContain("export const metafields = [ProductApp];");
  });

  it("skips the metafields module when none is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-pull-"));
    const res = await runPull({ client: fakeStore(), schemaPath: join(dir, "schema.ts") });
    expect(res.metafieldCount).toBeUndefined();
  });
});
