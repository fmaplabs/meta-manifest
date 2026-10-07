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

  it("validateConfig accepts auth: \"cli\" without an accessToken", () => {
    const c = validateConfig({ shop: "s.myshopify.com", schema: "./s.ts", auth: "cli" });
    expect(c.auth).toBe("cli");
  });

  it("validateConfig still requires shop and schema under auth: \"cli\"", () => {
    expect(() => validateConfig({ schema: "./s.ts", auth: "cli" })).toThrow(/shop/);
    expect(() => validateConfig({ shop: "s", auth: "cli" })).toThrow(/schema/);
  });

  it("validateConfig requires accessToken when auth is \"token\" or absent", () => {
    expect(() => validateConfig({ shop: "s", schema: "./s.ts" })).toThrow(/accessToken/);
    expect(() => validateConfig({ shop: "s", schema: "./s.ts", auth: "token" })).toThrow(
      /accessToken/,
    );
  });

  it("validateConfig rejects an unknown auth value naming \"auth\"", () => {
    expect(() => validateConfig({ shop: "s", accessToken: "t", schema: "./s.ts", auth: "bogus" })).toThrow(
      /auth/,
    );
  });

  it("validateConfig accepts auth: \"client-credentials\" with clientId + clientSecret and no accessToken", () => {
    const c = validateConfig({
      shop: "s.myshopify.com",
      schema: "./s.ts",
      auth: "client-credentials",
      clientId: "id",
      clientSecret: "secret",
    });
    expect(c.auth).toBe("client-credentials");
  });

  it("validateConfig requires clientId and clientSecret under auth: \"client-credentials\"", () => {
    const base = { shop: "s", schema: "./s.ts", auth: "client-credentials" };
    expect(() => validateConfig({ ...base, clientSecret: "x" })).toThrow(/clientId/);
    expect(() => validateConfig({ ...base, clientId: "x" })).toThrow(/clientSecret/);
    expect(() => validateConfig({ ...base, clientId: "", clientSecret: "x" })).toThrow(/clientId/);
  });

  it("validateConfig still requires shop and schema under auth: \"client-credentials\"", () => {
    const creds = { auth: "client-credentials", clientId: "id", clientSecret: "secret" };
    expect(() => validateConfig({ ...creds, schema: "./s.ts" })).toThrow(/shop/);
    expect(() => validateConfig({ ...creds, shop: "s" })).toThrow(/schema/);
  });

  it("validateConfig's auth error names all three modes", () => {
    expect(() => validateConfig({ shop: "s", accessToken: "t", schema: "./s.ts", auth: "bogus" })).toThrow(
      /client-credentials/,
    );
  });

  it("validateConfig accepts a valid metafields path and rejects a non-string one", () => {
    const base = { shop: "s", accessToken: "t", schema: "./s.ts" };
    expect(validateConfig({ ...base, metafields: "./m.ts" }).metafields).toBe("./m.ts");
    expect(validateConfig(base).metafields).toBeUndefined();
    expect(() => validateConfig({ ...base, metafields: 42 })).toThrow(/metafields/);
    expect(() => validateConfig({ ...base, metafields: "" })).toThrow(/metafields/);
  });
});
