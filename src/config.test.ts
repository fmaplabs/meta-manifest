import { describe, it, expect } from "vitest";
import { defineConfig, validateConfig, DEFAULT_API_VERSION } from "./config";

describe("config", () => {
  it("defineConfig returns its argument and DEFAULT_API_VERSION is 2026-07", () => {
    const c = { shop: "s.myshopify.com", accessToken: "t", schema: "./s.ts" };
    expect(defineConfig(c)).toBe(c);
    expect(DEFAULT_API_VERSION).toBe("2026-07");
  });

  it("validateConfig accepts a complete config", () => {
    const c = validateConfig({ shop: "s.myshopify.com", accessToken: "t", schema: "./s.ts" });
    expect(c.shop).toBe("s.myshopify.com");
  });

  it("validateConfig throws with the missing field named", () => {
    expect(() => validateConfig({ accessToken: "t", schema: "./s.ts" })).toThrow(/shop/);
    expect(() => validateConfig({ shop: "s", schema: "./s.ts" })).toThrow(/accessToken/);
    expect(() => validateConfig({ shop: "s", accessToken: "t" })).toThrow(/schema/);
  });

  it("validateConfig accepts a valid entries path and rejects a non-string one", () => {
    const base = { shop: "s", accessToken: "t", schema: "./s.ts" };
    expect(validateConfig({ ...base, entries: "./e.ts" }).entries).toBe("./e.ts");
    expect(validateConfig(base).entries).toBeUndefined();
    expect(() => validateConfig({ ...base, entries: 42 })).toThrow(/entries/);
    expect(() => validateConfig({ ...base, entries: "" })).toThrow(/entries/);
  });
});
