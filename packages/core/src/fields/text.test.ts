import { describe, expect, it } from "vitest";
import { multilineText, text } from "./text";

describe("text", () => {
  it("emits length and choices validations", () => {
    const f = text({ max: 120, choices: ["a", "b"] });
    expect(f.shopifyType).toBe("single_line_text_field");
    expect(f.validations()).toEqual([
      { name: "max", value: "120" },
      { name: "choices", value: '["a","b"]' },
    ]);
  });

  it("round-trips a string value", () => {
    const f = text();
    expect(f.encode("hi")).toBe("hi");
    expect(f.decode("hi")).toEqual({ value: "hi" });
  });

  it("rejects values failing max length", () => {
    expect(text({ max: 2 }).decode("hello").issues?.[0]?.message).toMatch(/at most 2/);
  });

  it("rejects values outside choices", () => {
    expect(text({ choices: ["a"] }).decode("b").issues?.[0]?.message).toMatch(/one of/);
  });

  it("multilineText uses the multi-line type", () => {
    expect(multilineText().shopifyType).toBe("multi_line_text_field");
  });
});
