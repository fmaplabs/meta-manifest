import { describe, expect, it } from "vitest";
import type { AdminGraphQLClient } from "./client";
import {
  CREATE_METAFIELD_DEFINITION_MUTATION,
  DELETE_METAFIELD_DEFINITION_MUTATION,
  UPDATE_METAFIELD_DEFINITION_MUTATION,
} from "./client";
import type { LocalMetafieldDefinition } from "./resolve";
import type { PulledMetafieldDefinition } from "./metafield-pull";
import type { MetafieldOp } from "./metafield-diff";
import { pushMetafields } from "./metafield-push";

function local(overrides: Partial<LocalMetafieldDefinition> = {}): LocalMetafieldDefinition {
  return {
    ownerType: "PRODUCT",
    namespace: "$app",
    key: "a",
    type: "single_line_text_field",
    name: "A",
    validations: [],
    capabilities: {
      adminFilterable: { enabled: false },
      smartCollectionCondition: { enabled: false },
      uniqueValues: { enabled: false },
    },
    pin: false,
    ...overrides,
  };
}

function remote(overrides: Partial<PulledMetafieldDefinition> = {}): PulledMetafieldDefinition {
  return { id: "gid://shopify/MetafieldDefinition/1", ...local(), ...overrides } as PulledMetafieldDefinition;
}

function fakeStore(opts: { failCreate?: boolean } = {}) {
  const calls: Array<{ kind: string; variables: Record<string, unknown> }> = [];
  const client: AdminGraphQLClient = async (query, options) => {
    const variables = options?.variables ?? {};
    if (query === CREATE_METAFIELD_DEFINITION_MUTATION) {
      calls.push({ kind: "create", variables });
      if (opts.failCreate) {
        return { data: { metafieldDefinitionCreate: { createdDefinition: null, userErrors: [{ message: "nope" }] } } };
      }
      return {
        data: {
          metafieldDefinitionCreate: {
            createdDefinition: { id: "gid://shopify/MetafieldDefinition/9", namespace: "app--1", key: "a" },
            userErrors: [],
          },
        },
      };
    }
    if (query === UPDATE_METAFIELD_DEFINITION_MUTATION) {
      calls.push({ kind: "update", variables });
      return { data: { metafieldDefinitionUpdate: { updatedDefinition: { id: "gid://shopify/MetafieldDefinition/1" }, userErrors: [] } } };
    }
    if (query === DELETE_METAFIELD_DEFINITION_MUTATION) {
      calls.push({ kind: "delete", variables });
      return { data: { metafieldDefinitionDelete: { deletedDefinitionId: variables.id, userErrors: [] } } };
    }
    return { data: {} };
  };
  return { client, calls };
}

const createOp: MetafieldOp = { kind: "createMetafield", ownerType: "PRODUCT", namespace: "$app", key: "a" };

describe("pushMetafields — create", () => {
  it("maps the create payload, omitting namespace for $app and disabled capabilities", async () => {
    const { client, calls } = fakeStore();
    const def = local({
      name: "A",
      description: "note",
      pin: true,
      access: { admin: "MERCHANT_READ" },
      validations: [{ name: "max", value: "9" }],
      capabilities: {
        adminFilterable: { enabled: true },
        smartCollectionCondition: { enabled: false },
        uniqueValues: { enabled: false },
      },
    });
    const result = await pushMetafields(client, [createOp], { definitions: [def], remote: [] });
    expect(result.ok).toBe(true);
    expect(result.results[0]).toMatchObject({ status: "applied", id: "gid://shopify/MetafieldDefinition/9" });
    expect(calls[0].variables.definition).toEqual({
      ownerType: "PRODUCT",
      key: "a",
      name: "A",
      type: "single_line_text_field",
      description: "note",
      validations: [{ name: "max", value: "9" }],
      access: { admin: "MERCHANT_READ" },
      capabilities: { adminFilterable: { enabled: true } },
      pin: true,
    });
  });

  it("sends an explicit namespace verbatim", async () => {
    const { client, calls } = fakeStore();
    const op: MetafieldOp = { kind: "createMetafield", ownerType: "PRODUCT", namespace: "product", key: "a" };
    await pushMetafields(client, [op], { definitions: [local({ namespace: "product" })], remote: [] });
    expect((calls[0].variables.definition as Record<string, unknown>).namespace).toBe("product");
  });

  it("turns userErrors into a failed result without throwing", async () => {
    const { client } = fakeStore({ failCreate: true });
    const result = await pushMetafields(client, [createOp], { definitions: [local()], remote: [] });
    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({ status: "failed", userErrors: [{ message: "nope" }] });
  });
});

describe("pushMetafields — update", () => {
  it("sends only the changed properties, identified by the (ownerType, key) triple", async () => {
    const { client, calls } = fakeStore();
    const op: MetafieldOp = { kind: "updateMetafield", ownerType: "PRODUCT", namespace: "$app", key: "a", changes: ["name", "pin"] };
    await pushMetafields(client, [op], {
      definitions: [local({ name: "New", pin: true })],
      remote: [remote()],
    });
    expect(calls[0].variables.definition).toEqual({ ownerType: "PRODUCT", key: "a", name: "New", pin: true });
  });

  it("sends only the drifted capabilities on a capabilities change", async () => {
    const { client, calls } = fakeStore();
    const op: MetafieldOp = { kind: "updateMetafield", ownerType: "PRODUCT", namespace: "$app", key: "a", changes: ["capabilities"] };
    await pushMetafields(client, [op], {
      definitions: [local()],
      remote: [remote({ capabilities: { adminFilterable: { enabled: true }, smartCollectionCondition: { enabled: false }, uniqueValues: { enabled: false } } })],
    });
    expect(calls[0].variables.definition).toEqual({
      ownerType: "PRODUCT",
      key: "a",
      capabilities: { adminFilterable: { enabled: false } },
    });
  });

  it("includes the namespace verbatim for explicit-namespace updates", async () => {
    const { client, calls } = fakeStore();
    const op: MetafieldOp = { kind: "updateMetafield", ownerType: "PRODUCT", namespace: "product", key: "a", changes: ["name"] };
    await pushMetafields(client, [op], {
      definitions: [local({ namespace: "product", name: "New" })],
      remote: [remote({ namespace: "product" })],
    });
    expect((calls[0].variables.definition as Record<string, unknown>).namespace).toBe("product");
  });
});

describe("pushMetafields — destructive gating", () => {
  const removeOp: MetafieldOp = { kind: "removeMetafield", ownerType: "PRODUCT", namespace: "$app", key: "a", destructive: true };

  it("skips destructive ops by default", async () => {
    const { client, calls } = fakeStore();
    const result = await pushMetafields(client, [removeOp], { definitions: [], remote: [remote()] });
    expect(result.results[0]).toEqual({ op: removeOp, status: "skipped", reason: "destructive" });
    expect(calls).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("deletes with deleteAllAssociatedMetafields: true for app-reserved namespaces", async () => {
    const { client, calls } = fakeStore();
    const result = await pushMetafields(client, [removeOp], { definitions: [], remote: [remote()] }, { allowDestructive: true });
    expect(result.results[0]).toMatchObject({ status: "applied" });
    expect(calls[0].variables).toEqual({ id: "gid://shopify/MetafieldDefinition/1", deleteAllAssociatedMetafields: true });
  });

  it("deletes with deleteAllAssociatedMetafields: false outside app-reserved namespaces", async () => {
    const { client, calls } = fakeStore();
    const op: MetafieldOp = { kind: "removeMetafield", ownerType: "PRODUCT", namespace: "custom", key: "a", destructive: true };
    await pushMetafields(client, [op], { definitions: [], remote: [remote({ namespace: "custom" })] }, { allowDestructive: true });
    expect(calls[0].variables).toEqual({ id: "gid://shopify/MetafieldDefinition/1", deleteAllAssociatedMetafields: false });
  });

  it("blocks a delete whose definition id was never pulled", async () => {
    const { client } = fakeStore();
    const result = await pushMetafields(client, [removeOp], { definitions: [], remote: [] }, { allowDestructive: true });
    expect(result.results[0]).toMatchObject({ status: "blocked" });
    expect(result.ok).toBe(false);
  });

  it("changeMetafieldType deletes then recreates when allowed", async () => {
    const { client, calls } = fakeStore();
    const op: MetafieldOp = {
      kind: "changeMetafieldType",
      ownerType: "PRODUCT",
      namespace: "$app",
      key: "a",
      from: "single_line_text_field",
      to: "number_integer",
      destructive: true,
    };
    const result = await pushMetafields(
      client,
      [op],
      { definitions: [local({ type: "number_integer" })], remote: [remote()] },
      { allowDestructive: true },
    );
    expect(result.results[0]).toMatchObject({ status: "applied" });
    expect(calls.map((c) => c.kind)).toEqual(["delete", "create"]);
    expect((calls[1].variables.definition as Record<string, unknown>).type).toBe("number_integer");
  });

  it("counts statuses and reports ok=false on failures", async () => {
    const { client } = fakeStore({ failCreate: true });
    const result = await pushMetafields(client, [createOp], { definitions: [local()], remote: [] });
    expect(result.counts).toEqual({ applied: 0, skipped: 0, blocked: 0, failed: 1 });
    expect(result.ok).toBe(false);
  });
});
