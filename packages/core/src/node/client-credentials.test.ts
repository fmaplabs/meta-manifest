import { describe, it, expect, vi, afterEach } from "vitest";
import { createClientCredentialsAdminClient } from "./client-credentials";
import { SyncTransportError } from "../sync/client";

afterEach(() => vi.unstubAllGlobals());

const tokenResponse = () =>
  new Response(JSON.stringify({ access_token: "minted-tok", scope: "read_products", expires_in: 86399 }), {
    status: 200,
  });

describe("createClientCredentialsAdminClient", () => {
  it("mints a token via the client-credentials grant, then POSTs GraphQL with it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClientCredentialsAdminClient({
      shop: "s.myshopify.com",
      clientId: "id",
      clientSecret: "secret",
      apiVersion: "2026-07",
    });
    const res = await client("query { ok }", { variables: { a: 1 } });
    expect(res).toEqual({ data: { ok: true } });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe("https://s.myshopify.com/admin/oauth/access_token");
    expect(tokenInit.method).toBe("POST");
    expect((tokenInit.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(tokenInit.body as string);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe("id");
    expect(form.get("client_secret")).toBe("secret");

    const [gqlUrl, gqlInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(gqlUrl).toBe("https://s.myshopify.com/admin/api/2026-07/graphql.json");
    expect((gqlInit.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("minted-tok");
    expect(JSON.parse(gqlInit.body as string)).toEqual({ query: "query { ok }", variables: { a: 1 } });
  });

  it("mints once and reuses the token across calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockImplementation(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClientCredentialsAdminClient({ shop: "s.myshopify.com", clientId: "id", clientSecret: "secret" });
    await client("query { a }");
    await client("query { b }");
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => (url as string).includes("/admin/oauth/access_token"));
    expect(tokenCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("wraps a token-mint rejection in SyncTransportError carrying the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "shop_not_permitted" }), { status: 400 })),
    );
    const client = createClientCredentialsAdminClient({ shop: "s.myshopify.com", clientId: "id", clientSecret: "secret" });
    const err = await client("query { ok }").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SyncTransportError);
    expect(String((err as SyncTransportError).errors)).toContain("shop_not_permitted");
  });

  it("throws SyncTransportError on a non-OK GraphQL response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClientCredentialsAdminClient({ shop: "s.myshopify.com", clientId: "id", clientSecret: "secret" });
    await expect(client("query { ok }")).rejects.toBeInstanceOf(SyncTransportError);
  });
});
