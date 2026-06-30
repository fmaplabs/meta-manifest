import { describe, expect, it } from "vitest";
import { color, date, dateTime, json, url } from "./scalar";

describe("scalar codecs", () => {
  it("date round-trips ISO strings and emits min/max", () => {
    expect(date().decode("2026-06-30")).toEqual({ value: "2026-06-30" });
    expect(date({ min: "2020-01-01" }).validations()).toEqual([{ name: "min", value: "2020-01-01" }]);
  });

  it("dateTime uses the date_time type", () => {
    expect(dateTime().shopifyType).toBe("date_time");
  });

  it("url emits allowed_domains validation", () => {
    expect(url({ allowedDomains: ["shopify.com"] }).validations()).toEqual([
      { name: "allowed_domains", value: '["shopify.com"]' },
    ]);
  });

  it("color validates hex format", () => {
    expect(color().decode("#ff0000")).toEqual({ value: "#ff0000" });
    expect(color().decode("red").issues?.[0]?.message).toMatch(/hex/);
  });

  it("json parses a JSON string and re-serializes on encode", () => {
    expect(json().decode('{"a":1}')).toEqual({ value: { a: 1 } });
    expect(json().encode({ a: 1 })).toBe('{"a":1}');
  });
});
