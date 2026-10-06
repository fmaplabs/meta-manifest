import { describe, it, expect } from "vitest";
import type { AdminGraphQLClient } from "./client";
import { LIST_DEFINITIONS_QUERY } from "./client";
import { pullAll } from "./pull";

/** Fake client returning two pages; one app-owned def, one merchant def, one foreign app's def. */
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
        { id: "gid://shopify/MetaobjectDefinition/3", name: "Widget", type: "app--222--widget",
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
    expect(remote.map((r) => r.type)).toEqual(["$app:author", "$app:widget"]);
    expect(remote[0].id).toBe("gid://shopify/MetaobjectDefinition/1");
    expect(remote[0].definition.type).toBe("$app:author");
  });

  it('scope "merchant" keeps only bare types, excluding every app-reserved one', async () => {
    const remote = await pullAll(fakeStore(), { scope: "merchant" });
    expect(remote.map((r) => r.type)).toEqual(["designer"]);
    expect(remote[0].definition.type).toBe("designer");
  });

  it('scope "all" returns app-owned (canonicalized) and merchant defs', async () => {
    const remote = await pullAll(fakeStore(), { scope: "all" });
    expect(remote.map((r) => r.type)).toEqual(["$app:author", "designer", "$app:widget"]);
  });
});
