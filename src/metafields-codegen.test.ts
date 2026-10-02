import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { generateMetafieldsSource } from "./codegen";
import { diffMetafields } from "./sync/metafield-diff";
import { resolveMetafieldSets } from "./sync/resolve";
import type { PulledMetafieldDefinition } from "./sync/metafield-pull";
import type { AnyMetafieldSet } from "./metafields";

const CAPS_OFF = {
  adminFilterable: { enabled: false },
  smartCollectionCondition: { enabled: false },
  uniqueValues: { enabled: false },
};

function pulled(overrides: Partial<PulledMetafieldDefinition>): PulledMetafieldDefinition {
  return {
    id: "gid://shopify/MetafieldDefinition/1",
    ownerType: "PRODUCT",
    namespace: "$app",
    key: "a",
    type: "single_line_text_field",
    name: "a",
    validations: [],
    capabilities: CAPS_OFF,
    pin: false,
    ...overrides,
  };
}

const defs: PulledMetafieldDefinition[] = [
  pulled({
    key: "careGuide",
    name: "Care Guide",
    description: "How to care",
    validations: [{ name: "max", value: "100" }],
    capabilities: { ...CAPS_OFF, adminFilterable: { enabled: true } },
    pin: true,
    access: { storefront: "PUBLIC_READ" },
  }),
  pulled({ key: "author", type: "metaobject_reference", name: "author", validations: [{ name: "metaobject_definition_type", value: "$app:author" }] }),
  pulled({ namespace: "product", key: "color", type: "color", name: "color", id: "gid://shopify/MetafieldDefinition/2" }),
  pulled({ namespace: "product", key: "care-instructions", type: "multi_line_text_field", name: "care-instructions", id: "gid://shopify/MetafieldDefinition/3" }),
];

describe("generateMetafieldsSource", () => {
  it("emits one defineMetafields set per (owner, namespace) with wrapper options", () => {
    const source = generateMetafieldsSource(defs);
    expect(source).toContain(`import { defineMetafields, m } from "@fmaplabs/meta-manifest";`);
    expect(source.match(/defineMetafields\("product", \{/g)).toHaveLength(2);
    expect(source).toContain(`namespace: "product"`);
    expect(source).toContain(`m.text({ name: "Care Guide", max: 100, filterable: true })`);
    expect(source).toContain(`pin: true`);
    expect(source).toContain(`description: "How to care"`);
    expect(source).toContain(`access: { storefront: "public_read" }`);
    expect(source).toContain(`"care-instructions": m.multilineText()`);
    expect(source).toMatch(/export const metafields = \[\w+, \w+\];/);
  });

  it("round-trips: generated source re-resolves to an empty diff", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-mf-codegen-"));
    const file = join(dir, "metafields.ts");
    const source = generateMetafieldsSource(defs).replace(
      `"@fmaplabs/meta-manifest"`,
      JSON.stringify(join(process.cwd(), "src/index.ts")),
    );
    writeFileSync(file, source);
    const jiti = createJiti(import.meta.url);
    const mod = await jiti.import<{ metafields: AnyMetafieldSet[] }>(file);
    const locals = resolveMetafieldSets(mod.metafields, [], {});
    const pairs = [
      { ownerType: "PRODUCT", namespace: "$app" } as const,
      { ownerType: "PRODUCT", namespace: "product" } as const,
    ];
    expect(diffMetafields(locals, defs, pairs)).toEqual([]);
  });
});
