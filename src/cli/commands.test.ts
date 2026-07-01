import { describe, it, expect } from "vitest";
import type { AdminGraphQLClient } from "../index";
import { CREATE_DEFINITION_MUTATION, PULL_DEFINITION_QUERY } from "../sync/client";
import { defineMetaobject, m } from "../index";
import { runDiff } from "./diff";
import { runPush } from "./push";

const A = defineMetaobject("a", { name: "A", fields: { n: m.text({ required: true }) } });

function fakeStore(): AdminGraphQLClient {
  let counter = 0;
  return async (query, options) => {
    if (query === PULL_DEFINITION_QUERY) return { data: { metaobjectDefinitionByType: null } };
    if (query === CREATE_DEFINITION_MUTATION) {
      const def = options?.variables?.definition as { type: string };
      counter += 1;
      return { data: { metaobjectDefinitionCreate: {
        metaobjectDefinition: { id: `gid://shopify/MetaobjectDefinition/${counter}`, type: def.type },
        userErrors: [] } } };
    }
    return { data: {} };
  };
}

describe("runDiff / runPush", () => {
  it("runDiff returns the create plan", async () => {
    const plan = await runDiff({ client: fakeStore(), schemas: [A] });
    expect(plan.map((op) => op.kind)).toEqual(["createDefinition"]);
  });
  it("runPush applies the plan and reports ok", async () => {
    const result = await runPush({ client: fakeStore(), schemas: [A] });
    expect(result.ok).toBe(true);
    expect(result.counts.applied).toBe(1);
  });
});
