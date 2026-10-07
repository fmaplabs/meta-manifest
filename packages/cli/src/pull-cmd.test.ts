import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AdminGraphQLClient } from "@fmaplabs/meta-manifest";
import { defineMetafields, m } from "@fmaplabs/meta-manifest";
import { CURRENT_APP_QUERY, LIST_DEFINITIONS_QUERY, PULL_METAFIELD_DEFINITIONS_QUERY } from "@fmaplabs/meta-manifest";
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

/** A store with one app-owned and one merchant metaobject, and app + merchant metafield definitions. */
function mixedStore(): AdminGraphQLClient {
  const metafieldNode = (overrides: Record<string, unknown>) => ({
    name: null,
    description: null,
    type: { name: "metaobject_reference" },
    validations: [],
    access: { admin: null, storefront: null, customerAccount: null },
    capabilities: {
      adminFilterable: { enabled: false },
      smartCollectionCondition: { enabled: false },
      uniqueValues: { enabled: false },
    },
    pinnedPosition: null,
    ...overrides,
  });
  return async (query, options) => {
    if (query === CURRENT_APP_QUERY) {
      return { data: { currentAppInstallation: { app: { id: "gid://shopify/App/111" } } } };
    }
    if (query.includes("accessScopes")) {
      return { data: { currentAppInstallation: { accessScopes: [{ handle: "read_products" }] } } };
    }
    if (query === PULL_METAFIELD_DEFINITIONS_QUERY) {
      const nodes =
        options?.variables?.ownerType === "PRODUCT"
          ? [
              metafieldNode({
                id: "gid://shopify/MetafieldDefinition/9",
                namespace: "app--111",
                key: "author",
                validations: [{ name: "metaobject_definition_id", value: "gid://shopify/MetaobjectDefinition/1" }],
              }),
              metafieldNode({
                id: "gid://shopify/MetafieldDefinition/10",
                namespace: "custom",
                key: "designer",
                validations: [{ name: "metaobject_definition_id", value: "gid://shopify/MetaobjectDefinition/2" }],
              }),
            ]
          : [];
      return { data: { metafieldDefinitions: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } };
    }
    expect(query).toBe(LIST_DEFINITIONS_QUERY);
    return { data: { metaobjectDefinitions: {
      nodes: [
        { id: "gid://shopify/MetaobjectDefinition/1", name: "Author", type: "app--111--author",
          fieldDefinitions: [{ key: "name", type: { name: "single_line_text_field" }, required: true, validations: [] }] },
        { id: "gid://shopify/MetaobjectDefinition/2", name: "Designer", type: "designer",
          fieldDefinitions: [{ key: "name", type: { name: "single_line_text_field" }, required: false, validations: [] }] },
      ],
      pageInfo: { hasNextPage: false, endCursor: null } } } };
  };
}

describe("runPull with --scope", () => {
  it('scope "merchant" writes merchant metaobjects and discovers merchant metafields without declared sets', async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-pull-"));
    const res = await runPull({
      client: mixedStore(),
      schemaPath: join(dir, "schema.ts"),
      scope: "merchant",
      metafields: { path: join(dir, "metafields.ts") },
    });
    expect(res.count).toBe(1);
    const schema = readFileSync(join(dir, "schema.ts"), "utf8");
    expect(schema).toContain('defineMetaobject("designer"');
    expect(schema).toContain('scope: "merchant"');
    expect(schema).not.toContain('defineMetaobject("author"');
    expect(res.metafieldCount).toBe(1);
    const mf = readFileSync(join(dir, "metafields.ts"), "utf8");
    expect(mf).toContain('namespace: "custom"');
    // GID ref target re-labeled to the merchant metaobject's bare type.
    expect(mf).toContain('({ type: "designer" })');
    expect(mf).not.toContain("app--111");
  });

  it('scope "all" merges declared pairs with discovery, deduping shared pairs', async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-pull-"));
    const sets = [
      defineMetafields("product", { fields: { author: m.text() } }),
      defineMetafields("product", { namespace: "custom", fields: { designer: m.text() } }),
    ];
    const res = await runPull({
      client: mixedStore(),
      schemaPath: join(dir, "schema.ts"),
      scope: "all",
      metafields: { path: join(dir, "metafields.ts"), sets },
    });
    expect(res.count).toBe(2);
    const schema = readFileSync(join(dir, "schema.ts"), "utf8");
    expect(schema).toContain('defineMetaobject("author"');
    expect(schema).toContain('defineMetaobject("designer"');
    // "custom.designer" is both declared and discovered — it must appear once.
    expect(res.metafieldCount).toBe(2);
    const mf = readFileSync(join(dir, "metafields.ts"), "utf8");
    expect(mf).toContain('({ type: "$app:author" })');
    expect(mf).toContain('({ type: "designer" })');
  });
});
