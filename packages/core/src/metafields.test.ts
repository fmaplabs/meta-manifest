import { describe, expect, expectTypeOf, it } from "vitest";
import { m } from "./fields/index";
import { defineMetaobject } from "./define";
import { defineMetafields, isMetafieldSet, APP_NAMESPACE, type Infer } from "./metafields";

const Author = defineMetaobject("author", {
  name: "Author",
  fields: { name: m.text({ required: true }) },
});

const ProductApp = defineMetafields("product", {
  fields: {
    careGuide: m.text({ name: "Care Guide", max: 100 }),
    author: { field: m.ref(Author), pin: true },
    rating: { field: m.decimal({ min: 0, max: 5 }), capabilities: { adminFilterable: true } },
  },
});

const ProductTheme = defineMetafields("product", {
  namespace: "product",
  fields: {
    color: m.color({ name: "Color" }),
    "care-instructions": m.multilineText(),
  },
});

describe("defineMetafields", () => {
  it("maps the camelCase owner to the canonical MetafieldOwnerType enum value", () => {
    expect(ProductApp.owner).toBe("PRODUCT");
    expect(defineMetafields("companyLocation", { fields: { a: m.text() } }).owner).toBe("COMPANY_LOCATION");
  });

  it("defaults the namespace to the $app sentinel and keeps explicit namespaces verbatim", () => {
    expect(ProductApp.namespace).toBe(APP_NAMESPACE);
    expect(ProductTheme.namespace).toBe("product");
  });

  it("unwraps wrapper entries into bare fields and captures their options", () => {
    expect(ProductApp.fields.author.shopifyType).toBe("metaobject_reference");
    expect(ProductApp.fields.careGuide.shopifyType).toBe("single_line_text_field");
    expect(ProductApp.options.author).toEqual({ pin: true });
    expect(ProductApp.options.rating).toEqual({ capabilities: { adminFilterable: true } });
    expect(ProductApp.options.careGuide).toEqual({});
  });

  it("rejects an unknown owner at runtime (the CLI loads untypechecked)", () => {
    expect(() => defineMetafields("gadget" as never, { fields: { a: m.text() } })).toThrow(/owner/i);
  });

  it("parses a Shopify metafield array into a typed object", () => {
    const result = ProductApp.parse([
      { key: "careGuide", jsonValue: "Wash cold" },
      { key: "rating", jsonValue: "4.5" },
    ]);
    expect(result).toEqual({ value: { careGuide: "Wash cold", rating: 4.5 } });
  });

  it("reports an error for a missing required field", () => {
    const Req = defineMetafields("product", { fields: { sku: { field: m.text({ required: true }) } } });
    expect(Req.parse([]).issues?.[0]?.path).toEqual(["sku"]);
  });

  it("encodes values as metafieldsSet inputs with type, omitting namespace for $app", () => {
    expect(ProductApp.encode({ careGuide: "Wash cold" })).toEqual([
      { key: "careGuide", value: "Wash cold", type: "single_line_text_field" },
    ]);
  });

  it("encodes an explicit namespace verbatim", () => {
    expect(ProductTheme.encode({ color: "#ff0000" })).toEqual([
      { key: "color", value: "#ff0000", type: "color", namespace: "product" },
    ]);
  });

  it("exposes a set-level Standard Schema interface", () => {
    const std = ProductApp["~standard"];
    expect(std.version).toBe(1);
    expect(std.vendor).toBe("@fmaplabs/meta-manifest");
    expect(std.validate([{ key: "careGuide", jsonValue: "x" }])).toEqual({ value: { careGuide: "x" } });
  });

  it("infers required vs optional keys through wrapper entries", () => {
    const Set = defineMetafields("product", {
      fields: {
        sku: { field: m.text({ required: true }), pin: true },
        note: m.multilineText(),
      },
    });
    expectTypeOf<Infer<typeof Set.fields>>().toEqualTypeOf<{ sku: string; note?: string }>();
  });
});

describe("defineMetafields author-time validation", () => {
  it("rejects smartCollectionCondition on a non-product owner", () => {
    expect(() =>
      defineMetafields("customer", {
        fields: { a: { field: m.text(), capabilities: { smartCollectionCondition: true } } },
      }),
    ).toThrow(/smartCollectionCondition/);
  });

  it("allows smartCollectionCondition on the product owner", () => {
    expect(() =>
      defineMetafields("product", {
        fields: { a: { field: m.text(), capabilities: { smartCollectionCondition: true } } },
      }),
    ).not.toThrow();
  });

  it("rejects a filterable builder contradicted by capabilities.adminFilterable: false", () => {
    expect(() =>
      defineMetafields("product", {
        fields: { a: { field: m.text({ filterable: true }), capabilities: { adminFilterable: false } } },
      }),
    ).toThrow(/filterable/);
  });

  it("rejects access.admin on a set with an explicit non-reserved namespace", () => {
    expect(() =>
      defineMetafields("product", {
        namespace: "product",
        fields: { a: { field: m.text(), access: { admin: "merchant_read" } } },
      }),
    ).toThrow(/access\.admin/);
  });

  it("rejects access.admin on a merchant-scoped set", () => {
    expect(() =>
      defineMetafields("product", {
        scope: "merchant",
        fields: { a: { field: m.text(), access: { admin: "merchant_read" } } },
      }),
    ).toThrow(/access\.admin/);
  });

  it("allows access.admin on an app-reserved-namespace set", () => {
    expect(() =>
      defineMetafields("product", {
        fields: { a: { field: m.text(), access: { admin: "merchant_read_write" } } },
      }),
    ).not.toThrow();
  });

  it("allows access.admin on a $app:<suffix> sub-namespace (as mm pull can generate)", () => {
    expect(() =>
      defineMetafields("product", {
        namespace: "$app:reviews",
        fields: { a: { field: m.text(), access: { admin: "merchant_read_write" } } },
      }),
    ).not.toThrow();
  });

  it("does not mistake a $app-prefixed non-reserved namespace for app-reserved", () => {
    expect(() =>
      defineMetafields("product", {
        namespace: "$apple",
        fields: { a: { field: m.text(), access: { admin: "merchant_read" } } },
      }),
    ).toThrow(/access\.admin/);
  });
});

describe("defineMetafields with per-set merchant scope", () => {
  it("resolves the namespace sentinel to custom at define time", () => {
    const set = defineMetafields("product", { scope: "merchant", fields: { a: m.text() } });
    expect(set.namespace).toBe("custom");
  });

  it("encodes merchant-set values with the custom namespace", () => {
    const set = defineMetafields("product", { scope: "merchant", fields: { a: m.text() } });
    expect(set.encode({ a: "x" })).toEqual([
      { key: "a", value: "x", type: "single_line_text_field", namespace: "custom" },
    ]);
  });

  it("treats an explicit $app namespace as the sentinel under per-set merchant scope", () => {
    const set = defineMetafields("product", { namespace: "$app", scope: "merchant", fields: { a: m.text() } });
    expect(set.namespace).toBe("custom");
  });
});

describe("isMetafieldSet", () => {
  it("accepts a defineMetafields result", () => {
    expect(isMetafieldSet(ProductApp)).toBe(true);
  });

  it("rejects a metaobject schema, plain objects, and primitives", () => {
    expect(isMetafieldSet(Author)).toBe(false);
    expect(isMetafieldSet({})).toBe(false);
    expect(isMetafieldSet(undefined)).toBe(false);
  });
});
