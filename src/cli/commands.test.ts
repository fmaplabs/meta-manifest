import { describe, it, expect } from "vitest";
import type { AdminGraphQLClient } from "../index";
import { CREATE_DEFINITION_MUTATION, PULL_DEFINITION_QUERY, PULL_ENTRY_QUERY, UPSERT_ENTRY_MUTATION } from "../sync/client";
import { defineEntries, defineMetaobject, m } from "../index";
import { runDiff } from "./diff";
import { runPush } from "./push";

const A = defineMetaobject("a", { name: "A", fields: { n: m.text({ required: true }) } });
const E = defineEntries(A, { one: { n: "1" } });

function fakeStore(opts: { failCreateDefinition?: boolean } = {}): { client: AdminGraphQLClient; calls: string[] } {
  let counter = 0;
  const calls: string[] = [];
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
    return { data: {} };
  };
  return { client, calls };
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
