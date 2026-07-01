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

  // Exercises the real CLI pipeline (resolveDefinitions → normalizeDefinition → diff),
  // which — unlike normalizeLocal — injects admin access. This is where a first-push
  // "updateDefinition (access)" would come from, so pin the behavior explicitly.
  function remoteNode(admin: string) {
    return {
      id: "gid://shopify/MetaobjectDefinition/1",
      name: "A",
      type: "app--1--a",
      description: null,
      displayNameKey: null,
      access: { admin, storefront: null, customerAccount: null },
      capabilities: {
        publishable: { enabled: false },
        translatable: { enabled: false },
        renderable: { enabled: false, data: null },
        onlineStore: { enabled: false, data: null },
      },
      fieldDefinitions: [
        { key: "n", name: "n", description: null, required: true, type: { name: "single_line_text_field" }, validations: [], capabilities: { adminFilterable: { enabled: false } } },
      ],
    };
  }
  const clientReturning = (admin: string): AdminGraphQLClient => async () => ({
    data: { metaobjectDefinitionByType: remoteNode(admin) },
  });

  it("does not churn when the remote app-owned admin already matches the resolved default", async () => {
    const { plan } = await planFor(clientReturning("MERCHANT_READ"), [A], {});
    expect(plan).toEqual([]);
  });

  it("reconciles admin access when the resolved value differs from remote", async () => {
    const readOnly = await planFor(clientReturning("MERCHANT_READ_WRITE"), [A], {});
    const upd = readOnly.plan.find((op) => op.kind === "updateDefinition");
    expect(upd?.kind === "updateDefinition" && upd.changes).toEqual(["access"]);

    // merchantEditable:true resolves admin to MERCHANT_READ_WRITE, matching remote → no churn.
    const writable = await planFor(clientReturning("MERCHANT_READ_WRITE"), [A], { merchantEditable: true });
    expect(writable.plan).toEqual([]);
  });
});
