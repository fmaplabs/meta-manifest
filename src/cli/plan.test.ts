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
    const { plan, remote } = await planFor(client, [A]);
    expect(remote).toEqual([]);
    expect(plan.map((op) => op.kind)).toEqual(["createDefinition"]);
  });
});
