import { describe, expect, it } from "vitest";
import { integer } from "./number";
import { product } from "./reference";
import { text } from "./text";
import { list } from "./list";

describe("list", () => {
  it("prefixes the inner shopifyType", () => {
    expect(list(text()).shopifyType).toBe("list.single_line_text_field");
    expect(list(product()).shopifyType).toBe("list.product_reference");
  });

  it("encodes a JSON array of element JSON values", () => {
    expect(list(integer()).encode([1, 2, 3])).toBe("[1,2,3]");
    expect(list(text()).encode(["a", "b"])).toBe('["a","b"]');
  });

  it("decodes from a JSON-array wire value", () => {
    expect(list(integer()).decode([1, 2])).toEqual({ value: [1, 2] });
    expect(list(integer()).decode("[1,2]")).toEqual({ value: [1, 2] });
  });

  it("merges inner validations with list.min/list.max", () => {
    expect(list(text({ max: 5 }), { min: 1, max: 10 }).validations()).toEqual([
      { name: "max", value: "5" },
      { name: "list.min", value: "1" },
      { name: "list.max", value: "10" },
    ]);
  });

  it("reports the index path of a failing element", () => {
    const result = list(integer()).decode([1, "x"]);
    expect(result.issues?.[0]?.path).toEqual([1]);
  });
});
