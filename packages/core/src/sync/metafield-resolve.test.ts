import { describe, expect, it } from "vitest";
import { defineMetaobject } from "../define";
import { defineMetafields } from "../metafields";
import { m } from "../fields/index";
import { resolveMetafieldSets } from "./resolve";

const Author = defineMetaobject("author", { name: "Author", fields: { name: m.text({ required: true }) } });
const MerchantAuthor = defineMetaobject("author", {
  name: "Author",
  scope: "merchant",
  fields: { name: m.text({ required: true }) },
});

describe("resolveMetafieldSets — namespace & scope", () => {
  it("defaults the namespace to $app under app scope", () => {
    const set = defineMetafields("product", { fields: { a: m.text() } });
    const [def] = resolveMetafieldSets([set], [], {});
    expect(def).toMatchObject({ ownerType: "PRODUCT", namespace: "$app", key: "a" });
  });

  it("defaults the namespace to custom under merchant scope (global config)", () => {
    const set = defineMetafields("product", { fields: { a: m.text() } });
    const [def] = resolveMetafieldSets([set], [], { scope: "merchant" });
    expect(def.namespace).toBe("custom");
  });

  it("per-set scope overrides the global scope", () => {
    const set = defineMetafields("product", { scope: "merchant", fields: { a: m.text() } });
    const [def] = resolveMetafieldSets([set], [], { scope: "app" });
    expect(def.namespace).toBe("custom");
  });

  it("keeps an explicit namespace verbatim regardless of scope", () => {
    const set = defineMetafields("product", { namespace: "product", fields: { a: m.text() } });
    const [def] = resolveMetafieldSets([set], [], { scope: "merchant" });
    expect(def.namespace).toBe("product");
  });

  it("treats an explicit $app namespace as the sentinel", () => {
    const set = defineMetafields("product", { namespace: "$app", fields: { a: m.text() } });
    expect(resolveMetafieldSets([set], [], {})[0].namespace).toBe("$app");
    expect(resolveMetafieldSets([set], [], { scope: "merchant" })[0].namespace).toBe("custom");
  });

  it("rejects access.admin when the effective namespace is not app-reserved", () => {
    // Passes define-time validation (no explicit namespace/scope) but resolves to "custom".
    const set = defineMetafields("product", {
      fields: { a: { field: m.text(), access: { admin: "merchant_read" } } },
    });
    expect(() => resolveMetafieldSets([set], [], { scope: "merchant" })).toThrow(/access\.admin/);
  });
});

describe("resolveMetafieldSets — definition normalization", () => {
  it("builds the comparable definition with name fallback, validations, and pin", () => {
    const set = defineMetafields("product", {
      fields: {
        careGuide: { field: m.text({ name: "Care Guide", max: 100 }), pin: true, description: "How to care" },
      },
    });
    const [def] = resolveMetafieldSets([set], [], {});
    expect(def).toMatchObject({
      key: "careGuide",
      type: "single_line_text_field",
      name: "Care Guide",
      description: "How to care",
      pin: true,
      validations: [{ name: "max", value: "100" }],
    });
  });

  it("uppercases declared access values", () => {
    const set = defineMetafields("product", {
      fields: {
        a: { field: m.text(), access: { admin: "merchant_read_write", storefront: "public_read" } },
      },
    });
    const [def] = resolveMetafieldSets([set], [], {});
    expect(def.access).toEqual({ admin: "MERCHANT_READ_WRITE", storefront: "PUBLIC_READ" });
  });

  it("materializes all capabilities as {enabled} (absent = disabled), merging filterable", () => {
    const set = defineMetafields("product", {
      fields: {
        a: m.text({ filterable: true }),
        b: { field: m.text(), capabilities: { uniqueValues: true } },
      },
    });
    const defs = resolveMetafieldSets([set], [], {});
    expect(defs[0].capabilities).toEqual({
      adminFilterable: { enabled: true },
      smartCollectionCondition: { enabled: false },
      uniqueValues: { enabled: false },
    });
    expect(defs[1].capabilities).toEqual({
      adminFilterable: { enabled: false },
      smartCollectionCondition: { enabled: false },
      uniqueValues: { enabled: true },
    });
  });

  it("rewrites metaobject reference validations to the target's effective type", () => {
    const set = defineMetafields("product", {
      fields: { author: m.ref(Author), authors: m.list(m.mixedRef([Author])) },
    });
    const defs = resolveMetafieldSets([set], [MerchantAuthor], {});
    // MerchantAuthor is merchant-scoped, so "$app:author" rewrites to bare "author".
    expect(defs[0].validations).toEqual([{ name: "metaobject_definition_type", value: "author" }]);
    expect(defs[1].validations).toContainEqual({ name: "metaobject_definition_types", value: JSON.stringify(["author"]) });
  });
});
