import { describe, expect, it } from "vitest";
import { defineMetaobject } from "../define";
import { m } from "../fields/index";
import type { AdminGraphQLClient } from "./client";
import { diff } from "./diff";
import { normalizeLocal, normalizeRemote } from "./normalize";
import { pull } from "./pull";

interface StoredNode {
  id: string;
  name: string;
  type: string;
  fieldDefinitions: Array<{
    key: string;
    name: string;
    description: string | null;
    required: boolean;
    type: { name: string };
    validations: Array<{ name: string; value: string }>;
  }>;
}

// metaobjectDefinitionByType resolves "$app:author" and returns a node whose
// `type` is the RESOLVED form (app--<id>--author). The fake keys its store by
// the requested $app: type but returns nodes carrying that resolved form, so the
// tests exercise pull's relabeling. [design §6, ground-truth #1/#2]
function fakeClient(store: Record<string, StoredNode>): AdminGraphQLClient {
  return async (_query, options) => {
    const type = options?.variables?.type as string;
    return { data: { metaobjectDefinitionByType: store[type] ?? null } };
  };
}

const authorNode: StoredNode = {
  id: "gid://shopify/MetaobjectDefinition/123",
  name: "Author",
  type: "app--999--author",
  fieldDefinitions: [
    { key: "name", name: "Name", description: null, required: true, type: { name: "single_line_text_field" }, validations: [{ name: "max", value: "120" }] },
    { key: "bio", name: "Bio", description: null, required: false, type: { name: "multi_line_text_field" }, validations: [] },
  ],
};

describe("pull", () => {
  it("relabels the resolved type to the requested $app: type and captures the id", async () => {
    const result = await pull(fakeClient({ "$app:author": authorNode }), ["$app:author"]);
    expect(result).toEqual([
      {
        id: "gid://shopify/MetaobjectDefinition/123",
        type: "$app:author",
        definition: { type: "$app:author", name: "Author", fieldDefinitions: authorNode.fieldDefinitions },
      },
    ]);
  });

  it("omits a type that is not present on the store", async () => {
    const result = await pull(fakeClient({ "$app:author": authorNode }), ["$app:author", "$app:book"]);
    expect(result.map((r) => r.type)).toEqual(["$app:author"]);
  });

  it("returns an empty array when nothing matches", async () => {
    const result = await pull(fakeClient({}), ["$app:author"]);
    expect(result).toEqual([]);
  });

  it("produces a definition that normalizeRemote turns into the expected RemoteDefinition", async () => {
    const result = await pull(fakeClient({ "$app:author": authorNode }), ["$app:author"]);
    const r = result[0];
    if (!r) throw new Error("expected a pulled remote");
    expect(normalizeRemote(r.definition)).toEqual({
      type: "$app:author",
      name: "Author",
      fields: [
        { key: "name", type: "single_line_text_field", required: true, validations: [{ name: "max", value: "120" }] },
        { key: "bio", type: "multi_line_text_field", required: false, validations: [] },
      ],
    });
  });

  it("relabels so diff matches an identical local schema (no ops)", async () => {
    const Author = defineMetaobject("author", {
      name: "Author",
      fields: { name: m.text({ required: true, max: 120 }), bio: m.multilineText() },
    });
    const remote = await pull(fakeClient({ "$app:author": authorNode }), ["$app:author"]);
    const ops = diff([normalizeLocal(Author)], remote.map((r) => normalizeRemote(r.definition)));
    expect(ops).toEqual([]);
  });
});
