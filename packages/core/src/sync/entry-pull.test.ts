import { describe, expect, it } from "vitest";
import { PULL_ENTRY_QUERY, SyncTransportError } from "./client";
import { pullEntries } from "./entry-pull";

const remoteEntries: Record<string, { id: string; fields: Array<{ key: string; value: string }>; status?: string }> = {
  "$app:book/persuasion": { id: "gid://shopify/Metaobject/1", fields: [{ key: "title", value: "Persuasion" }], status: "ACTIVE" },
};

const fakeClient = (query: string, options?: { variables?: Record<string, unknown> }) => {
  if (query !== PULL_ENTRY_QUERY) throw new Error(`unexpected query`);
  const h = options?.variables?.handle as { type: string; handle: string };
  const hit = remoteEntries[`${h.type}/${h.handle}`];
  return Promise.resolve({
    data: {
      metaobjectByHandle: hit
        ? {
            id: hit.id,
            handle: h.handle,
            type: h.type,
            fields: hit.fields,
            capabilities: hit.status ? { publishable: { status: hit.status } } : null,
          }
        : null,
    },
  });
};

describe("pullEntries", () => {
  it("returns present entries re-labeled with the requested key and omits absent ones", async () => {
    const out = await pullEntries(fakeClient, [
      { type: "$app:book", handle: "persuasion" },
      { type: "$app:book", handle: "missing" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "gid://shopify/Metaobject/1",
      type: "$app:book",
      handle: "persuasion",
      status: "ACTIVE",
    });
  });

  it("propagates top-level GraphQL errors as SyncTransportError", async () => {
    const failing = () => Promise.resolve({ errors: [{ message: "boom" }] });
    await expect(pullEntries(failing, [{ type: "$app:book", handle: "x" }])).rejects.toBeInstanceOf(SyncTransportError);
  });
});
