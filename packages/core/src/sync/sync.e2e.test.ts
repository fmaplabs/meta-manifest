import { describe, expect, it } from "vitest";
import {
  defineMetaobject,
  diff,
  m,
  normalizeLocal,
  normalizeRemote,
  pull,
  push,
  type AdminGraphQLClient,
} from "../index";
import { CREATE_DEFINITION_MUTATION, PULL_DEFINITION_QUERY } from "./client";

// A single fake backing both pull and push: an empty store (every pull misses)
// that accepts creates and records the order in which types were created.
function fakeStore() {
  const createdTypes: string[] = [];
  let counter = 0;
  const client: AdminGraphQLClient = async (query, options) => {
    if (query === PULL_DEFINITION_QUERY) {
      return { data: { metaobjectDefinitionByType: null } };
    }
    if (query === CREATE_DEFINITION_MUTATION) {
      const def = options?.variables?.definition as { type: string };
      createdTypes.push(def.type);
      counter += 1;
      return {
        data: {
          metaobjectDefinitionCreate: {
            metaobjectDefinition: { id: `gid://shopify/MetaobjectDefinition/${counter}`, type: def.type },
            userErrors: [],
          },
        },
      };
    }
    return { data: {} };
  };
  return { client, createdTypes };
}

describe("sync end-to-end: define → pull → diff → push", () => {
  it("creates both definitions, referenced type first, against an empty store", async () => {
    const Author = defineMetaobject("author", {
      name: "Author",
      fields: { name: m.text({ required: true, max: 120 }) },
    });
    const Book = defineMetaobject("book", {
      name: "Book",
      fields: { title: m.text({ required: true }), author: m.ref(Author) },
    });

    const { client, createdTypes } = fakeStore();

    const remote = await pull(client, [Author.type, Book.type]);
    expect(remote).toEqual([]);

    // Each schema normalized directly: `[Author, Book].map(normalizeLocal)` can't
    // unify normalizeLocal's generic across a heterogeneous schema array.
    const local = [normalizeLocal(Author), normalizeLocal(Book)];
    const plan = diff(local, remote.map((r) => normalizeRemote(r.definition)));
    expect(plan.map((op) => op.kind)).toEqual(["createDefinition", "createDefinition"]);

    const result = await push(client, plan, {
      definitions: [Author.toDefinitionInput(), Book.toDefinitionInput()],
      remote,
    });

    const created = result.results.filter((r) => r.op.kind === "createDefinition");
    expect(created.every((r) => r.status === "applied")).toBe(true);
    expect(created).toHaveLength(2);
    expect(createdTypes).toEqual(["$app:author", "$app:book"]);
    expect(result.ok).toBe(true);
  });
});
