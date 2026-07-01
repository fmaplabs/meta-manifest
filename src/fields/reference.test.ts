import { describe, expect, it } from "vitest";
import { collection, file, product, ref } from "./reference";

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
});
