import { describe, expect, it } from "vitest";
import { defineMetafields, m, type AdminGraphQLClient, type AnyMetafieldSet } from "@fmaplabs/meta-manifest";
import { runDiff } from "./diff";
import { runPush } from "./push";
import {
  CREATE_METAFIELD_DEFINITION_MUTATION,
  CURRENT_APP_QUERY,
  DELETE_METAFIELD_DEFINITION_MUTATION,
  PULL_DEFINITION_QUERY,
  PULL_METAFIELD_DEFINITIONS_QUERY,
  UPDATE_METAFIELD_DEFINITION_MUTATION,
} from "@fmaplabs/meta-manifest";

interface StoredDefinition {
  id: string;
  namespace: string;
  key: string;
  name: string;
  description: string | null;
  type: string;
  validations: Array<{ name: string; value: string }>;
  pin: boolean;
}

/**
 * A stateful fake store for the metafield lifecycle: creates land in an
 * app--<id> namespace (as Shopify resolves `$app`), pulls serve them back,
 * updates merge, deletes remove. Exercises create → clean re-diff → drift →
 * update → destructive gating end to end, as the live-store e2e would.
 */
function fakeStore() {
  const stored = new Map<string, StoredDefinition>();
  let counter = 0;
  const resolveNamespace = (ns: string | undefined) => (ns === undefined ? "app--777" : ns);

  const client: AdminGraphQLClient = async (query, options) => {
    const variables = options?.variables ?? {};
    if (query === PULL_DEFINITION_QUERY) return { data: { metaobjectDefinitionByType: null } };
    if (query === CURRENT_APP_QUERY) {
      return { data: { currentAppInstallation: { app: { id: "gid://shopify/App/777" } } } };
    }
    if (query === PULL_METAFIELD_DEFINITIONS_QUERY) {
      const nodes = [...stored.values()].map((d) => ({
        id: d.id,
        name: d.name,
        namespace: d.namespace,
        key: d.key,
        description: d.description,
        type: { name: d.type },
        validations: d.validations,
        access: { admin: "MERCHANT_READ", storefront: null, customerAccount: null },
        capabilities: {
          adminFilterable: { enabled: false },
          smartCollectionCondition: { enabled: false },
          uniqueValues: { enabled: false },
        },
        pinnedPosition: d.pin ? 1 : null,
      }));
      return { data: { metafieldDefinitions: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } };
    }
    if (query === CREATE_METAFIELD_DEFINITION_MUTATION) {
      const def = variables.definition as {
        namespace?: string; key: string; name: string; description?: string;
        type: string; validations?: Array<{ name: string; value: string }>; pin?: boolean;
      };
      counter += 1;
      const namespace = resolveNamespace(def.namespace);
      const id = `gid://shopify/MetafieldDefinition/${counter}`;
      stored.set(`${namespace}/${def.key}`, {
        id,
        namespace,
        key: def.key,
        name: def.name,
        description: def.description ?? null,
        type: def.type,
        validations: def.validations ?? [],
        pin: def.pin ?? false,
      });
      return { data: { metafieldDefinitionCreate: { createdDefinition: { id }, userErrors: [] } } };
    }
    if (query === UPDATE_METAFIELD_DEFINITION_MUTATION) {
      const def = variables.definition as {
        namespace?: string; key: string; name?: string; description?: string;
        validations?: Array<{ name: string; value: string }>; pin?: boolean;
      };
      const existing = stored.get(`${resolveNamespace(def.namespace)}/${def.key}`);
      if (!existing) {
        return { data: { metafieldDefinitionUpdate: { updatedDefinition: null, userErrors: [{ message: "not found" }] } } };
      }
      if (def.name !== undefined) existing.name = def.name;
      if (def.description !== undefined) existing.description = def.description;
      if (def.validations !== undefined) existing.validations = def.validations;
      if (def.pin !== undefined) existing.pin = def.pin;
      return { data: { metafieldDefinitionUpdate: { updatedDefinition: { id: existing.id }, userErrors: [] } } };
    }
    if (query === DELETE_METAFIELD_DEFINITION_MUTATION) {
      const id = variables.id as string;
      for (const [key, d] of stored) {
        if (d.id === id) {
          stored.delete(key);
          return { data: { metafieldDefinitionDelete: { deletedDefinitionId: id, userErrors: [] } } };
        }
      }
      return { data: { metafieldDefinitionDelete: { deletedDefinitionId: null, userErrors: [{ message: "not found" }] } } };
    }
    return { data: {} };
  };
  return { client, stored };
}

const V1: AnyMetafieldSet[] = [
  defineMetafields("product", {
    fields: { careGuide: m.text({ name: "Care Guide", max: 100 }) },
  }),
  defineMetafields("product", {
    namespace: "product",
    fields: { color: m.color({ name: "Color" }) },
  }),
];

// Drift: careGuide renamed + pinned + tightened validation; color unchanged.
const V2: AnyMetafieldSet[] = [
  defineMetafields("product", {
    fields: { careGuide: { field: m.text({ name: "Care Instructions", max: 50 }), pin: true } },
  }),
  defineMetafields("product", {
    namespace: "product",
    fields: { color: m.color({ name: "Color" }) },
  }),
];

// careGuide removed entirely — a destructive remove within the declared $app pair.
const V3: AnyMetafieldSet[] = [
  defineMetafields("product", { fields: {} }),
  defineMetafields("product", {
    namespace: "product",
    fields: { color: m.color({ name: "Color" }) },
  }),
];

describe("metafield definitions e2e lifecycle", () => {
  it("creates, re-diffs clean, updates drift, and gates the destructive delete", async () => {
    const { client, stored } = fakeStore();

    // 1. First push creates both definitions ($app and explicit namespace).
    const first = await runPush({ client, schemas: [], metafields: V1 });
    expect(first.ok).toBe(true);
    expect(first.metafields?.counts).toEqual({ applied: 2, skipped: 0, blocked: 0, failed: 0 });
    expect(stored.get("app--777/careGuide")?.name).toBe("Care Guide");
    expect(stored.get("product/color")?.type).toBe("color");

    // 2. Re-diff is clean: app--777 canonicalizes back to $app, everything matches.
    const clean = await runDiff({ client, schemas: [], metafields: V1 });
    expect(clean.metafields).toEqual([]);

    // 3. Rename + pin + tightened validation reconcile through one update op.
    const drift = await runDiff({ client, schemas: [], metafields: V2 });
    expect(drift.metafields).toEqual([
      { kind: "updateMetafield", ownerType: "PRODUCT", namespace: "$app", key: "careGuide", changes: ["name", "validations", "pin"] },
    ]);
    const second = await runPush({ client, schemas: [], metafields: V2 });
    expect(second.ok).toBe(true);
    expect(stored.get("app--777/careGuide")).toMatchObject({
      name: "Care Instructions",
      pin: true,
      validations: [{ name: "max", value: "50" }],
    });

    // 4. Removing the declared field plans a destructive remove, gated by default.
    const gated = await runPush({ client, schemas: [], metafields: V3 });
    expect(gated.ok).toBe(true);
    expect(gated.metafields?.results[0]).toMatchObject({ status: "skipped", reason: "destructive" });
    expect(stored.has("app--777/careGuide")).toBe(true);

    // 5. --allow-destructive applies it; the unmanaged-pair color definition survives.
    const destroyed = await runPush({ client, schemas: [], metafields: V3, allowDestructive: true });
    expect(destroyed.ok).toBe(true);
    expect(stored.has("app--777/careGuide")).toBe(false);
    expect(stored.has("product/color")).toBe(true);

    // 6. Final state is clean.
    const final = await runDiff({ client, schemas: [], metafields: V3 });
    expect(final.metafields).toEqual([]);
  });
});
