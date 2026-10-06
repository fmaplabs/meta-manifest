import { describe, it, expect, vi, afterEach } from "vitest";
import { selectAdminClient, cliAuthAppScopeNotice } from "./auth";
import { defineMetaobject } from "../define";
import { defineMetafields } from "../metafields";
import { m } from "../fields/index";
import type { Config } from "../config";
import type { RunCommand } from "../node/cli-client";

afterEach(() => vi.unstubAllGlobals());

const tokenConfig: Config = { shop: "s.myshopify.com", accessToken: "tok", schema: "./s.ts" };
const cliConfig: Config = { shop: "s.myshopify.com", schema: "./s.ts", auth: "cli" };

describe("selectAdminClient", () => {
  it("returns the fetch-based client for token configs", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = selectAdminClient(tokenConfig);
    await client("query { x }");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = (fetchMock.mock.calls[0] as unknown) as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("tok");
  });

  it("returns the shopify-CLI client for cli configs", async () => {
    const calls: string[][] = [];
    const run: RunCommand = async (bin, args) => {
      calls.push([bin, ...args]);
      return { code: 0, stdout: "{}", stderr: "" };
    };
    const client = selectAdminClient(cliConfig, { run });
    await client("query { x }");
    expect(calls[0][0]).toBe("shopify");
    expect(calls[0]).toContain("--store");
    expect(calls[0]).toContain("s.myshopify.com");
  });
});

describe("cliAuthAppScopeNotice", () => {
  const AppSchema = defineMetaobject("thing", { name: "Thing", fields: { t: m.text() } });
  const MerchantSchema = defineMetaobject("other", { name: "Other", scope: "merchant", fields: { t: m.text() } });
  const AppSet = defineMetafields("product", { fields: { x: m.text() } });
  const CustomSet = defineMetafields("product", { namespace: "acme", fields: { x: m.text() } });

  it("is null for token configs regardless of command or material", () => {
    expect(cliAuthAppScopeNotice({ config: tokenConfig, command: "pull" })).toBeNull();
    expect(cliAuthAppScopeNotice({ config: tokenConfig, command: "push", schemas: [AppSchema], metafieldSets: [AppSet] })).toBeNull();
  });

  it("always triggers for pull under cli auth, naming the override flag", () => {
    const notice = cliAuthAppScopeNotice({ config: { ...cliConfig, scope: "merchant" }, command: "pull" });
    expect(notice).toContain("--allow-cli-app-scope");
  });

  it("triggers for diff/push when a schema resolves to app scope by default", () => {
    expect(cliAuthAppScopeNotice({ config: cliConfig, command: "diff", schemas: [AppSchema] })).not.toBeNull();
  });

  it("triggers for diff/push when a per-schema scope overrides a merchant default", () => {
    expect(
      cliAuthAppScopeNotice({
        config: { ...cliConfig, scope: "merchant" },
        command: "push",
        schemas: [defineMetaobject("forced", { name: "Forced", scope: "app", fields: { t: m.text() } })],
      }),
    ).not.toBeNull();
  });

  it("triggers for diff/push when a metafield set's effective namespace is $app-rooted", () => {
    // Schemas are all merchant-scoped; only the set's default "$app" namespace
    // (config scope defaults to "app") should trip the guard.
    expect(
      cliAuthAppScopeNotice({
        config: cliConfig,
        command: "diff",
        schemas: [MerchantSchema],
        metafieldSets: [AppSet],
      }),
    ).not.toBeNull();
  });

  it("is null for diff/push when all material is merchant-scoped", () => {
    expect(
      cliAuthAppScopeNotice({
        config: { ...cliConfig, scope: "merchant" },
        command: "push",
        schemas: [MerchantSchema, AppSchema], // AppSchema defaults → merchant via config.scope
        metafieldSets: [CustomSet, AppSet], // AppSet's $app sentinel resolves to "custom" under merchant scope
      }),
    ).toBeNull();
  });
});
