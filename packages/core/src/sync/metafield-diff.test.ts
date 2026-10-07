import { describe, expect, it } from "vitest";
import { defineMetafields } from "../metafields";
import { m } from "../fields/index";
import { resolveMetafieldSets, type LocalMetafieldDefinition } from "./resolve";
import type { PulledMetafieldDefinition } from "./metafield-pull";
import { diffMetafields } from "./metafield-diff";

const PAIRS = [{ ownerType: "PRODUCT", namespace: "$app" }] as const;

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

describe("diffMetafields", () => {
  it("emits createMetafield for a local-only definition", () => {
    expect(diffMetafields([local()], [], PAIRS)).toEqual([
      { kind: "createMetafield", ownerType: "PRODUCT", namespace: "$app", key: "a" },
    ]);
  });

  it("emits nothing when local and remote match", () => {
    expect(diffMetafields([local()], [remote()], PAIRS)).toEqual([]);
  });

  it("emits updateMetafield listing each drifted property", () => {
    const ops = diffMetafields(
      [local({ name: "New name", pin: true })],
      [remote()],
      PAIRS,
    );
    expect(ops).toEqual([
      { kind: "updateMetafield", ownerType: "PRODUCT", namespace: "$app", key: "a", changes: ["name", "pin"] },
    ]);
  });

  it("compares validations order-insensitively", () => {
    const ops = diffMetafields(
      [local({ validations: [{ name: "min", value: "1" }, { name: "max", value: "9" }] })],
      [remote({ validations: [{ name: "max", value: "9" }, { name: "min", value: "1" }] })],
      PAIRS,
    );
    expect(ops).toEqual([]);
  });

  it("diffs a capability that was enabled remotely and is now disabled locally", () => {
    const ops = diffMetafields(
      [local()],
      [remote({ capabilities: { adminFilterable: { enabled: true }, smartCollectionCondition: { enabled: false }, uniqueValues: { enabled: false } } })],
      PAIRS,
    );
    expect(ops).toEqual([
      { kind: "updateMetafield", ownerType: "PRODUCT", namespace: "$app", key: "a", changes: ["capabilities"] },
    ]);
  });

  it("treats locally-undeclared access and description as unmanaged", () => {
    const ops = diffMetafields(
      [local()],
      [remote({ access: { admin: "PUBLIC_READ_WRITE" }, description: "remote-only note" })],
      PAIRS,
    );
    expect(ops).toEqual([]);
  });

  it("diffs locally-declared access against the remote value", () => {
    const ops = diffMetafields(
      [local({ access: { storefront: "PUBLIC_READ" } })],
      [remote({ access: { storefront: "NONE" } })],
      PAIRS,
    );
    expect(ops).toEqual([
      { kind: "updateMetafield", ownerType: "PRODUCT", namespace: "$app", key: "a", changes: ["access"] },
    ]);
  });

  it("emits destructive changeMetafieldType when the type differs", () => {
    const ops = diffMetafields([local({ type: "number_integer" })], [remote()], PAIRS);
    expect(ops).toEqual([
      {
        kind: "changeMetafieldType",
        ownerType: "PRODUCT",
        namespace: "$app",
        key: "a",
        from: "single_line_text_field",
        to: "number_integer",
        destructive: true,
      },
    ]);
  });

  it("emits destructive removeMetafield for a remote-only definition in a declared pair", () => {
    const ops = diffMetafields([], [remote()], PAIRS);
    expect(ops).toEqual([
      { kind: "removeMetafield", ownerType: "PRODUCT", namespace: "$app", key: "a", destructive: true },
    ]);
  });

  it("never removes definitions from undeclared (ownerType, namespace) pairs", () => {
    const ops = diffMetafields([], [remote({ namespace: "unmanaged" })], PAIRS);
    expect(ops).toEqual([]);
  });

  it("diffs definitions resolved from real sets end to end", () => {
    const set = defineMetafields("product", { fields: { careGuide: m.text({ name: "Care Guide" }) } });
    const locals = resolveMetafieldSets([set], [], {});
    const ops = diffMetafields(locals, [], [{ ownerType: "PRODUCT", namespace: "$app" }]);
    expect(ops).toEqual([{ kind: "createMetafield", ownerType: "PRODUCT", namespace: "$app", key: "careGuide" }]);
  });
});
