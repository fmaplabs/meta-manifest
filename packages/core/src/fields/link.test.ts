import { describe, expect, it } from "vitest";
import { list } from "./list";
import { link } from "./link";

describe("link codec", () => {
  it("uses the link type with no validations", () => {
    const f = link();
    expect(f.shopifyType).toBe("link");
    expect(f.validations()).toEqual([]);
  });

  it("round-trips { text?, url } through the JSON wire format", () => {
    const f = link();
    const value = { text: "Docs", url: "https://example.com" };
    expect(f.encode(value)).toBe(JSON.stringify(value));
    expect(f.decode(JSON.stringify(value))).toEqual({ value });
    expect(f.decode(JSON.stringify({ url: "https://example.com" }))).toEqual({ value: { url: "https://example.com" } });
  });

  it("rejects a value without a string url", () => {
    expect(link().decode(JSON.stringify({ text: "no url" }))).toMatchObject({
      issues: [{ message: expect.stringContaining("url") }],
    });
  });

  it("wraps in a list", () => {
    const f = list(link());
    expect(f.shopifyType).toBe("list.link");
    expect(f.decode(JSON.stringify([{ url: "https://a.example" }]))).toEqual({ value: [{ url: "https://a.example" }] });
  });
});
