import { describe, it, expect, vi, afterEach } from "vitest";
import { createAdminClient } from "./client";
import { SyncTransportError } from "../sync/client";

afterEach(() => vi.unstubAllGlobals());

describe("createAdminClient", () => {
  it("POSTs to the shop graphql endpoint with the token header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createAdminClient({ shop: "s.myshopify.com", accessToken: "tok", apiVersion: "2026-07" });
    const res = await client("query { ok }", { variables: { a: 1 } });
    expect(res).toEqual({ data: { ok: true } });
    const [url, init] = (fetchMock.mock.calls[0] as unknown) as [string, RequestInit];
    expect(url).toBe("https://s.myshopify.com/admin/api/2026-07/graphql.json");
    expect(init.method).toBe("POST");
    expect((init.headers as any)["X-Shopify-Access-Token"]).toBe("tok");
    expect(JSON.parse(init.body as string)).toEqual({ query: "query { ok }", variables: { a: 1 } });
  });

  it("throws SyncTransportError on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const client = createAdminClient({ shop: "s.myshopify.com", accessToken: "tok" });
    await expect(client("query { ok }")).rejects.toBeInstanceOf(SyncTransportError);
  });
});
