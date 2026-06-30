import { describe, expect, expectTypeOf, it } from "vitest";
import { m } from "./fields/index";
import { defineMetaobject, type Infer } from "./define";

const Author = defineMetaobject("author", {
  name: "Author",
  displayName: "name",
  fields: {
    name: m.text({ required: true, max: 120 }),
    bio: m.multilineText(),
    rating: m.rating({ min: 1, max: 5 }),
  },
});

describe("defineMetaobject", () => {
  it("resolves an app-owned type", () => {
    expect(Author.type).toBe("$app:author");
  });

  it("parses a Shopify field array into a typed object", () => {
    const result = Author.parse([
      { key: "name", jsonValue: "Ursula" },
      { key: "rating", jsonValue: { value: "5", scale_min: "1", scale_max: "5" } },
    ]);
    expect(result).toEqual({ value: { name: "Ursula", rating: { value: 5, scaleMin: 1, scaleMax: 5 } } });
  });

  it("reports an error for a missing required field", () => {
    const result = Author.parse([]);
    expect(result.issues?.[0]?.path).toEqual(["name"]);
  });

  it("encodes a typed object into Shopify {key,value} entries", () => {
    expect(Author.encode({ name: "Ursula" })).toEqual([{ key: "name", value: "Ursula" }]);
  });

  it("infers required vs optional keys", () => {
    expectTypeOf<Infer<typeof Author.fields>>().toMatchTypeOf<{ name: string }>();
    expectTypeOf<Infer<typeof Author.fields>>().toEqualTypeOf<{
      name: string;
      bio?: string;
      rating?: { value: number; scaleMin: number; scaleMax: number };
    }>();
  });
});
