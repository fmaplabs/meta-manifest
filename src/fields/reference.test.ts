import { describe, expect, it } from "vitest";
import { list } from "./list";
import { collection, file, mixedRef, product, ref } from "./reference";

describe("reference codecs", () => {
  it("product reference round-trips a GID", () => {
    const f = product();
    expect(f.shopifyType).toBe("product_reference");
    expect(f.decode("gid://shopify/Product/1")).toEqual({ value: "gid://shopify/Product/1" });
    expect(f.encode("gid://shopify/Product/1")).toBe("gid://shopify/Product/1");
  });

  it("collection uses its own type", () => {
    expect(collection().shopifyType).toBe("collection_reference");
  });

  it("file emits file_type_options from accept", () => {
    expect(file({ accept: ["Image"] }).validations()).toEqual([
      { name: "file_type_options", value: '["Image"]' },
    ]);
  });

  it("ref pins the target by metaobject_definition_type", () => {
    const f = ref({ type: "$app:author" });
    expect(f.shopifyType).toBe("metaobject_reference");
    expect(f.validations()).toEqual([{ name: "metaobject_definition_type", value: "$app:author" }]);
  });

  it("ref accepts a thunk for circular references", () => {
    const f = ref(() => ({ type: "$app:book" }));
    expect(f.validations()).toEqual([{ name: "metaobject_definition_type", value: "$app:book" }]);
  });

  it("mixedRef pins several targets via metaobject_definition_types", () => {
    const f = mixedRef([{ type: "$app:author" }, { type: "$app:publisher" }]);
    expect(f.shopifyType).toBe("mixed_reference");
    expect(f.validations()).toEqual([
      { name: "metaobject_definition_types", value: JSON.stringify(["$app:author", "$app:publisher"]) },
    ]);
  });

  it("mixedRef accepts thunks per target for circular references", () => {
    const f = mixedRef([() => ({ type: "$app:a" }), () => ({ type: "$app:b" })]);
    expect(f.validations()).toEqual([
      { name: "metaobject_definition_types", value: JSON.stringify(["$app:a", "$app:b"]) },
    ]);
  });

  it("mixedRef round-trips a metaobject GID", () => {
    const f = mixedRef([{ type: "$app:author" }]);
    expect(f.decode("gid://shopify/Metaobject/1")).toEqual({ value: "gid://shopify/Metaobject/1" });
    expect(f.encode("gid://shopify/Metaobject/1")).toBe("gid://shopify/Metaobject/1");
  });

  it("list(mixedRef) becomes list.mixed_reference and preserves the types validation", () => {
    const f = list(mixedRef([{ type: "$app:a" }, { type: "$app:b" }]));
    expect(f.shopifyType).toBe("list.mixed_reference");
    expect(f.validations()).toEqual([
      { name: "metaobject_definition_types", value: JSON.stringify(["$app:a", "$app:b"]) },
    ]);
  });
});
