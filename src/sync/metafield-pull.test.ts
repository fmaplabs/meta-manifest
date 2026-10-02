import { describe, expect, it } from "vitest";
import type { AdminGraphQLClient } from "./client";
import { PULL_METAFIELD_DEFINITIONS_QUERY } from "./client";
import { pullMetafields } from "./metafield-pull";

type Node = Record<string, unknown>;

function node(overrides: Node): Node {
  return {
    id: "gid://shopify/MetafieldDefinition/1",
    name: "A",
    namespace: "custom",
    key: "a",
    description: null,
    type: { name: "single_line_text_field" },
    validations: [],
    access: { admin: "PUBLIC_READ_WRITE", storefront: null, customerAccount: null },
    capabilities: {
      adminFilterable: { enabled: false },
      smartCollectionCondition: { enabled: false },
      uniqueValues: { enabled: false },
    },
    pinnedPosition: null,
    ...overrides,
  };
}

/** Pages of nodes per ownerType; records the variables of every request. */
function fakeStore(pagesByOwner: Record<string, Node[][]>) {
  const requests: Array<Record<string, unknown> | undefined> = [];
  const client: AdminGraphQLClient = async (query, options) => {
    expect(query).toBe(PULL_METAFIELD_DEFINITIONS_QUERY);
    requests.push(options?.variables);
    const ownerType = options?.variables?.ownerType as string;
    const after = options?.variables?.after as string | null;
    const pages = pagesByOwner[ownerType] ?? [[]];
    const index = after === null ? 0 : Number(after);
    const nodes = pages[index] ?? [];
    const hasNextPage = index + 1 < pages.length;
    return {
      data: {
        metafieldDefinitions: {
          nodes,
          pageInfo: { hasNextPage, endCursor: hasNextPage ? String(index + 1) : null },
        },
      },
    };
  };
  return { client, requests };
}

describe("pullMetafields", () => {
  it("fetches once per unique ownerType and keeps only declared (ownerType, namespace) pairs", async () => {
    const { client, requests } = fakeStore({
      PRODUCT: [[
        node({ namespace: "custom", key: "a" }),
        node({ namespace: "unmanaged", key: "b", id: "gid://shopify/MetafieldDefinition/2" }),
      ]],
    });
    const out = await pullMetafields(client, [
      { ownerType: "PRODUCT", namespace: "custom" },
      { ownerType: "PRODUCT", namespace: "theme" },
    ]);
    expect(requests).toHaveLength(1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ownerType: "PRODUCT", namespace: "custom", key: "a", type: "single_line_text_field" });
  });

  it("canonicalizes app--<id> namespaces to $app (and app--<id>--<suffix> to $app:<suffix>)", async () => {
    const { client } = fakeStore({
      PRODUCT: [[
        node({ namespace: "app--123", key: "careGuide" }),
        node({ namespace: "app--123--swatch", key: "color", id: "gid://shopify/MetafieldDefinition/2" }),
      ]],
    });
    const out = await pullMetafields(client, [
      { ownerType: "PRODUCT", namespace: "$app" },
      { ownerType: "PRODUCT", namespace: "$app:swatch" },
    ]);
    expect(out.map((d) => d.namespace)).toEqual(["$app", "$app:swatch"]);
  });

  it("walks pages until hasNextPage is false", async () => {
    const { client, requests } = fakeStore({
      PRODUCT: [
        [node({ namespace: "custom", key: "a" })],
        [node({ namespace: "custom", key: "b", id: "gid://shopify/MetafieldDefinition/2" })],
      ],
    });
    const out = await pullMetafields(client, [{ ownerType: "PRODUCT", namespace: "custom" }]);
    expect(requests).toHaveLength(2);
    expect(out.map((d) => d.key)).toEqual(["a", "b"]);
  });

  it("normalizes pin from pinnedPosition and strips null access keys", async () => {
    const { client } = fakeStore({
      PRODUCT: [[
        node({ namespace: "custom", key: "a", pinnedPosition: 3 }),
      ]],
    });
    const [def] = await pullMetafields(client, [{ ownerType: "PRODUCT", namespace: "custom" }]);
    expect(def.pin).toBe(true);
    expect(def.access).toEqual({ admin: "PUBLIC_READ_WRITE" });
    expect(def.capabilities).toEqual({
      adminFilterable: { enabled: false },
      smartCollectionCondition: { enabled: false },
      uniqueValues: { enabled: false },
    });
  });
});
