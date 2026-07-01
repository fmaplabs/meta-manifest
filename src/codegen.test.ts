import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { defineMetaobject, m } from "./index";
import { normalizeLocal } from "./sync/normalize";
import { diff } from "./sync/diff";
import { generateSchemaSource } from "./codegen";
import type { RemoteDefinition } from "./sync/normalize";
import type { AnySchema } from "./index";

const Material = defineMetaobject("material", {
  name: "Material",
  fields: { name: m.text({ required: true, max: 80 }), density: m.weight() },
});
const Product = defineMetaobject("product_spec", {
  name: "Product Spec",
  fields: {
    title: m.text({ required: true, max: 120 }),
    price: m.money(),
    specs: m.list(m.ref(Material)),
    rating: m.rating({ min: 1, max: 5 }),
  },
});

describe("generateSchemaSource", () => {
  it("round-trips: generated source re-normalizes to an empty diff", async () => {
    const local: RemoteDefinition[] = [normalizeLocal(Material), normalizeLocal(Product)];
    const source = generateSchemaSource(local);

    const dir = mkdtempSync(join(tmpdir(), "mm-codegen-"));
    const file = join(dir, "schema.ts");
    // Rewrite the package import to the built source under test.
    writeFileSync(file, source.replace('from "meta-manifest"', `from ${JSON.stringify(join(process.cwd(), "src/index.ts"))}`));

    const jiti = createJiti(import.meta.url);
    const mod = await jiti.import<{ schemas: AnySchema[] }>(file);
    const regenerated = mod.schemas.map(normalizeLocal);

    // Compare each generated definition against its origin — no create/add/remove/change ops.
    const plan = diff(regenerated, local);
    expect(plan).toEqual([]);
  });

  it("emits references in dependency order (Material before Product)", () => {
    const source = generateSchemaSource([normalizeLocal(Material), normalizeLocal(Product)]);
    expect(source.indexOf("const Material")).toBeLessThan(source.indexOf("const ProductSpec"));
    expect(source).toContain("m.list(m.ref(Material))");
    expect(source).toContain('export const schemas = [Material, ProductSpec]');
  });

  it("round-trips a date field with min/max (emitted as string literals, not Number(...))", async () => {
    const Event = defineMetaobject("event", {
      name: "Event",
      fields: {
        happensOn: m.date({ min: "2020-01-01", max: "2030-12-31" }),
      },
    });
    const local: RemoteDefinition[] = [normalizeLocal(Event)];
    const source = generateSchemaSource(local);

    const dir = mkdtempSync(join(tmpdir(), "mm-codegen-date-"));
    const file = join(dir, "schema.ts");
    // Rewrite the package import to the built source under test.
    writeFileSync(file, source.replace('from "meta-manifest"', `from ${JSON.stringify(join(process.cwd(), "src/index.ts"))}`));

    const jiti = createJiti(import.meta.url);
    const mod = await jiti.import<{ schemas: AnySchema[] }>(file);
    const regenerated = mod.schemas.map(normalizeLocal);

    const plan = diff(regenerated, local);
    expect(plan).toEqual([]);
  });
});
