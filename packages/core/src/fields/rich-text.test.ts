import { describe, expect, it } from "vitest";
import { list } from "./list";
import { richText } from "./rich-text";

const doc = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "hi" }] }] };

describe("richText codec", () => {
  it("uses the rich_text_field type with no validations", () => {
    const f = richText();
    expect(f.shopifyType).toBe("rich_text_field");
    expect(f.validations()).toEqual([]);
  });

  it("round-trips the rich-text AST through the JSON wire format", () => {
    const f = richText();
    expect(f.encode(doc)).toBe(JSON.stringify(doc));
    expect(f.decode(JSON.stringify(doc))).toEqual({ value: doc });
  });

  it("reports invalid JSON on the wire", () => {
    expect(richText().decode("{nope")).toMatchObject({ issues: [{ message: expect.stringContaining("JSON") }] });
  });

  it("wraps in a list", () => {
    const f = list(richText());
    expect(f.shopifyType).toBe("list.rich_text_field");
    expect(f.decode(JSON.stringify([doc]))).toEqual({ value: [doc] });
  });
});
