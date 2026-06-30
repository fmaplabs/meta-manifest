import { describe, expect, it } from "vitest";
import {
  CREATE_DEFINITION_MUTATION,
  execute,
  PULL_DEFINITION_QUERY,
  SyncTransportError,
  UPDATE_DEFINITION_MUTATION,
  type AdminGraphQLClient,
} from "./client";

describe("execute", () => {
  it("returns data on success", async () => {
    const client: AdminGraphQLClient = async () => ({ data: { shop: { name: "Acme" } } });
    const data = await execute<{ shop: { name: string } }>(client, "query { shop { name } }");
    expect(data).toEqual({ shop: { name: "Acme" } });
  });

  it("throws SyncTransportError when top-level errors are present", async () => {
    const errors = [{ message: "Access denied" }];
    const client: AdminGraphQLClient = async () => ({ errors });
    await expect(execute(client, "query { shop { name } }")).rejects.toBeInstanceOf(SyncTransportError);
    await expect(execute(client, "query { shop { name } }")).rejects.toMatchObject({ errors });
  });

  it("ignores an empty top-level errors array", async () => {
    const client: AdminGraphQLClient = async () => ({ data: { ok: true }, errors: [] });
    await expect(execute(client, "query { ok }")).resolves.toEqual({ ok: true });
  });

  it("passes variables through to the client", async () => {
    let seen: Record<string, unknown> | undefined;
    const client: AdminGraphQLClient = async (_query, options) => {
      seen = options?.variables;
      return { data: { echoed: true } };
    };
    await execute(client, "query ($type: String!) { x }", { type: "$app:author" });
    expect(seen).toEqual({ type: "$app:author" });
  });

  it("propagates a transport rejection unchanged", async () => {
    const boom = new Error("network down");
    const client: AdminGraphQLClient = async () => {
      throw boom;
    };
    await expect(execute(client, "query { shop { name } }")).rejects.toBe(boom);
  });
});

describe("operation strings", () => {
  it("are the schema-validated documents from the design spec", () => {
    expect(PULL_DEFINITION_QUERY).toContain("metaobjectDefinitionByType(type: $type)");
    expect(CREATE_DEFINITION_MUTATION).toContain("metaobjectDefinitionCreate(definition: $definition)");
    expect(UPDATE_DEFINITION_MUTATION).toContain("metaobjectDefinitionUpdate(id: $id, definition: $definition)");
  });
});
