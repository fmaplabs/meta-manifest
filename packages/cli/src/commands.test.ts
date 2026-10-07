import { describe, it, expect, vi } from "vitest";
import type { AdminGraphQLClient } from "@fmaplabs/meta-manifest";
import {
  CREATE_DEFINITION_MUTATION,
  CREATE_METAFIELD_DEFINITION_MUTATION,
  CURRENT_APP_QUERY,
  DELETE_METAFIELD_DEFINITION_MUTATION,
  PULL_DEFINITION_QUERY,
  PULL_ENTRY_QUERY,
  PULL_METAFIELD_DEFINITIONS_QUERY,
  UPSERT_ENTRY_MUTATION,
} from "@fmaplabs/meta-manifest";
import { defineEntries, defineMetafields, defineMetaobject, m } from "@fmaplabs/meta-manifest";
import { runDiff } from "./diff";
import { runPush } from "./push";

const A = defineMetaobject("a", { name: "A", fields: { n: m.text({ required: true }) } });
const E = defineEntries(A, { one: { n: "1" } });
const MF = defineMetafields("product", { fields: { careGuide: m.text() } });

function fakeStore(
  opts: { failCreateDefinition?: boolean; remoteMetafieldNodes?: Array<Record<string, unknown>> } = {},
): { client: AdminGraphQLClient; calls: string[]; payloads: Record<string, unknown[]> } {
  let counter = 0;
  const calls: string[] = [];
  const payloads: Record<string, unknown[]> = { createMetafieldDefinition: [], deleteMetafieldDefinition: [] };
  const client: AdminGraphQLClient = async (query, options) => {
    if (query === PULL_DEFINITION_QUERY) {
      calls.push("pullDefinition");
      return { data: { metaobjectDefinitionByType: null } };
    }
    if (query === CREATE_DEFINITION_MUTATION) {
      calls.push("createDefinition");
      const def = options?.variables?.definition as { type: string };
      if (opts.failCreateDefinition) {
        return { data: { metaobjectDefinitionCreate: { metaobjectDefinition: null, userErrors: [{ message: "no" }] } } };
      }
      counter += 1;
      return { data: { metaobjectDefinitionCreate: {
        metaobjectDefinition: { id: `gid://shopify/MetaobjectDefinition/${counter}`, type: def.type },
        userErrors: [] } } };
    }
    if (query === PULL_ENTRY_QUERY) {
      calls.push("pullEntry");
      return { data: { metaobjectByHandle: null } };
    }
    if (query === UPSERT_ENTRY_MUTATION) {
      calls.push("upsertEntry");
      const h = options?.variables?.handle as { handle: string };
      counter += 1;
      return { data: { metaobjectUpsert: { metaobject: { id: `gid://shopify/Metaobject/${counter}`, handle: h.handle }, userErrors: [] } } };
    }
    if (query === CURRENT_APP_QUERY) {
      calls.push("currentApp");
      return { data: { currentAppInstallation: { app: { id: "gid://shopify/App/1" } } } };
    }
    if (query === PULL_METAFIELD_DEFINITIONS_QUERY) {
      calls.push("pullMetafieldDefinitions");
      return { data: { metafieldDefinitions: {
        nodes: opts.remoteMetafieldNodes ?? [],
        pageInfo: { hasNextPage: false, endCursor: null } } } };
    }
    if (query === CREATE_METAFIELD_DEFINITION_MUTATION) {
      calls.push("createMetafieldDefinition");
      payloads.createMetafieldDefinition.push(options?.variables?.definition);
      counter += 1;
      return { data: { metafieldDefinitionCreate: {
        createdDefinition: { id: `gid://shopify/MetafieldDefinition/${counter}` },
        userErrors: [] } } };
    }
    if (query === DELETE_METAFIELD_DEFINITION_MUTATION) {
      calls.push("deleteMetafieldDefinition");
      payloads.deleteMetafieldDefinition.push(options?.variables);
      return { data: { metafieldDefinitionDelete: { deletedDefinitionId: options?.variables?.id, userErrors: [] } } };
    }
    return { data: {} };
  };
  return { client, calls, payloads };
}

function remoteMetafieldNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "gid://shopify/MetafieldDefinition/50",
    name: "legacy",
    namespace: "app--1",
    key: "legacy",
    description: null,
    type: { name: "single_line_text_field" },
    validations: [],
    access: { admin: "MERCHANT_READ", storefront: null, customerAccount: null },
    capabilities: {
      adminFilterable: { enabled: false },
      smartCollectionCondition: { enabled: false },
      uniqueValues: { enabled: false },
    },
    pinnedPosition: null,
    ...overrides,
  };
}

describe("runDiff / runPush", () => {
  it("runDiff returns the create plan", async () => {
    const { definitions, entries } = await runDiff({ client: fakeStore().client, schemas: [A] });
    expect(definitions.map((op) => op.kind)).toEqual(["createDefinition"]);
    expect(entries).toEqual([]);
  });
  it("runPush applies the plan and reports ok", async () => {
    const result = await runPush({ client: fakeStore().client, schemas: [A] });
    expect(result.ok).toBe(true);
    expect(result.definitions.counts.applied).toBe(1);
    expect(result.entries).toBeUndefined();
  });

  it("runDiff plans entries after definitions, skipping pulls for pending types", async () => {
    const { client, calls } = fakeStore();
    const { definitions, entries } = await runDiff({ client, schemas: [A], entries: [E] });
    expect(definitions.map((op) => op.kind)).toEqual(["createDefinition"]);
    expect(entries).toEqual([{ kind: "createEntry", type: "$app:a", handle: "one" }]);
    // "$app:a" is pending creation, so its entry was never pulled.
    expect(calls).not.toContain("pullEntry");
  });

  it("runPush upserts entries after definitions and reports combined ok", async () => {
    const { client, calls } = fakeStore();
    const result = await runPush({ client, schemas: [A], entries: [E] });
    expect(result.ok).toBe(true);
    expect(result.definitions.counts.applied).toBe(1);
    expect(result.entries?.counts).toEqual({ applied: 1, blocked: 0, failed: 0 });
    expect(calls.indexOf("upsertEntry")).toBeGreaterThan(calls.indexOf("createDefinition"));
  });

  it("a failed definition create blocks its entries and flips ok (exit-code-2 path)", async () => {
    const { client, calls } = fakeStore({ failCreateDefinition: true });
    const result = await runPush({ client, schemas: [A], entries: [E] });
    expect(result.ok).toBe(false);
    expect(result.definitions.counts.failed).toBe(1);
    expect(result.entries?.results[0]).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining('definition "$app:a"'),
    });
    expect(calls).not.toContain("upsertEntry");
  });

  it("runPush fails fast on entry validation issues, before any network call", async () => {
    const { client, calls } = fakeStore();
    const bad = defineEntries(A, { "Bad Handle": { n: "x" } });
    await expect(runPush({ client, schemas: [A], entries: [bad] })).rejects.toThrow(/Entry validation failed/);
    expect(calls).toEqual([]);
  });
});

describe("runDiff / runPush with metafields", () => {
  it("runDiff returns the metafield plan alongside definitions", async () => {
    const { client } = fakeStore();
    const { definitions, metafields } = await runDiff({ client, schemas: [A], metafields: [MF] });
    expect(definitions.map((op) => op.kind)).toEqual(["createDefinition"]);
    expect(metafields).toEqual([{ kind: "createMetafield", ownerType: "PRODUCT", namespace: "$app", key: "careGuide" }]);
  });

  it("runPush pushes metafields after metaobject definitions and before entries", async () => {
    const { client, calls } = fakeStore();
    const result = await runPush({ client, schemas: [A], entries: [E], metafields: [MF] });
    expect(result.ok).toBe(true);
    expect(result.metafields?.counts).toEqual({ applied: 1, skipped: 0, blocked: 0, failed: 0 });
    expect(calls.indexOf("createMetafieldDefinition")).toBeGreaterThan(calls.indexOf("createDefinition"));
    expect(calls.indexOf("upsertEntry")).toBeGreaterThan(calls.indexOf("createMetafieldDefinition"));
  });

  it("runPush threads ids of metaobject definitions created this run into metafield ref payloads", async () => {
    const { client, payloads } = fakeStore();
    const Merchant = defineMetaobject("author", { name: "Author", scope: "merchant", fields: { n: m.text() } });
    const RefSet = defineMetafields("product", { fields: { author: m.ref(Merchant) } });
    await runPush({ client, schemas: [Merchant], metafields: [RefSet] });
    expect((payloads.createMetafieldDefinition[0] as { validations: unknown }).validations).toEqual([
      { name: "metaobject_definition_id", value: "gid://shopify/MetaobjectDefinition/1" },
    ]);
  });

  it("a failed definition create blocks metafields that reference it (exit-code-2 path)", async () => {
    const { client, calls } = fakeStore({ failCreateDefinition: true });
    const RefSet = defineMetafields("product", { fields: { author: m.ref(A) } });
    const result = await runPush({ client, schemas: [A], metafields: [RefSet] });
    expect(result.ok).toBe(false);
    expect(result.metafields?.results[0]).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining('"$app:a"'),
    });
    expect(calls).not.toContain("createMetafieldDefinition");
  });

  it("runPush gates destructive metafield ops behind allowDestructive and stays ok", async () => {
    const { client, calls } = fakeStore({ remoteMetafieldNodes: [remoteMetafieldNode()] });
    const result = await runPush({ client, schemas: [A], metafields: [MF] });
    expect(result.ok).toBe(true);
    expect(result.metafields?.counts.skipped).toBe(1);
    expect(calls).not.toContain("deleteMetafieldDefinition");
  });

  it("runDiff and runPush surface metafield scope-flip warnings", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // The app's reserved namespace still holds "careGuide" while the set is now
      // merchant-scoped — its create must come with an orphaning warning.
      const MerchantMF = defineMetafields("product", { scope: "merchant", fields: { careGuide: m.text() } });
      const nodes = [remoteMetafieldNode({ key: "careGuide", name: "careGuide" })];
      await runDiff({ client: fakeStore({ remoteMetafieldNodes: nodes }).client, schemas: [A], metafields: [MerchantMF] });
      expect(warn.mock.calls.some((c) => String(c[0]).includes("orphaned"))).toBe(true);

      warn.mockClear();
      await runPush({ client: fakeStore({ remoteMetafieldNodes: nodes }).client, schemas: [A], metafields: [MerchantMF] });
      expect(warn.mock.calls.some((c) => String(c[0]).includes("orphaned"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("runPush applies destructive metafield removes with allowDestructive", async () => {
    const { client, payloads } = fakeStore({ remoteMetafieldNodes: [remoteMetafieldNode()] });
    const result = await runPush({ client, schemas: [A], metafields: [MF], allowDestructive: true });
    expect(result.ok).toBe(true);
    expect(payloads.deleteMetafieldDefinition[0]).toEqual({
      id: "gid://shopify/MetafieldDefinition/50",
      deleteAllAssociatedMetafields: true,
    });
  });
});
