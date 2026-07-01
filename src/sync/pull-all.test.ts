import { describe, it, expect } from "vitest";
import type { AdminGraphQLClient } from "./client";
import { LIST_DEFINITIONS_QUERY } from "./client";
import { pullAll } from "./pull";

/** Fake client returning two pages; one app-owned def and one store-native def. */
function fakeStore(): AdminGraphQLClient {
  const pages = [
    {
      nodes: [
        { id: "gid://shopify/MetaobjectDefinition/1", name: "Author", type: "app--111--author",
          fieldDefinitions: [{ key: "name", type: { name: "single_line_text_field" }, required: true, validations: [] }] },
      ],
      pageInfo: { hasNextPage: true, endCursor: "c1" },
    },
    {
      nodes: [
        { id: "gid://shopify/MetaobjectDefinition/2", name: "Designer", type: "designer",
          fieldDefinitions: [{ key: "n", type: { name: "single_line_text_field" }, required: false, validations: [] }] },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  ];
  return async (query, options) => {
    expect(query).toBe(LIST_DEFINITIONS_QUERY);
    const after = (options?.variables?.after as string | undefined) ?? null;
    const page = after === null ? pages[0] : pages[1];
    return { data: { metaobjectDefinitions: { nodes: page.nodes, pageInfo: page.pageInfo } } };
  };
}

describe("pullAll", () => {
  it("paginates and keeps app-owned defs, re-labeled to $app: types", async () => {
    const remote = await pullAll(fakeStore());
    expect(remote.map((r) => r.type)).toEqual(["$app:author"]);
    expect(remote[0].id).toBe("gid://shopify/MetaobjectDefinition/1");
    expect(remote[0].definition.type).toBe("$app:author");
  });

  it("appOwnedOnly:false returns store-native defs too", async () => {
    const remote = await pullAll(fakeStore(), { appOwnedOnly: false });
    expect(remote.map((r) => r.type)).toEqual(["$app:author", "designer"]);
  });
});
