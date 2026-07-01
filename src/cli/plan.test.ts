import { describe, it, expect } from "vitest";
import type { AdminGraphQLClient } from "../index";
import { PULL_DEFINITION_QUERY } from "../sync/client";
import { defineMetaobject, m } from "../index";
import { planFor } from "./plan";

const A = defineMetaobject("a", { name: "A", fields: { n: m.text({ required: true }) } });

describe("planFor", () => {
  it("plans a create when the type is absent remotely", async () => {
    const client: AdminGraphQLClient = async (query) => {
      expect(query).toBe(PULL_DEFINITION_QUERY);
      return { data: { metaobjectDefinitionByType: null } };
    };
    const { plan, remote, warnings } = await planFor(client, [A]);
    expect(remote).toEqual([]);
    expect(plan.map((op) => op.kind)).toEqual(["createDefinition"]);
    expect(warnings).toEqual([]);
  });

  it("warns when a merchant-scoped def would orphan an existing app-owned definition", async () => {
    const Author = defineMetaobject("author", {
      name: "Author",
      scope: "merchant",
      fields: { n: m.text({ required: true }) },
    });
    const client: AdminGraphQLClient = async (_query, options) => {
      // The merchant type "author" is absent (→ create); its "$app:author" shadow exists.
      if (options?.variables?.type === "$app:author") {
        return {
          data: {
            metaobjectDefinitionByType: {
              id: "gid://shopify/MetaobjectDefinition/1",
              name: "Author",
              type: "app--1--author",
              fieldDefinitions: [],
            },
          },
        };
      }
      return { data: { metaobjectDefinitionByType: null } };
    };
    const { plan, warnings } = await planFor(client, [Author], { scope: "app" });
    expect(plan.map((op) => op.kind)).toEqual(["createDefinition"]);
    expect(warnings.some((w) => w.includes("orphaned"))).toBe(true);
  });
});
