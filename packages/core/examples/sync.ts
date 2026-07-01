/**
 * Runnable walkthrough of the sync pipeline: define → pull → diff → push.
 *
 *   pnpm --filter @meta-manifest/core example
 *   # or: pnpm --filter @meta-manifest/core exec tsx examples/sync.ts
 *
 * The `AdminGraphQLClient` here is an in-file FAKE so this script runs offline
 * with no Shopify store. In a real app you inject a client backed by
 * `admin.graphql` — see ../docs/SYNC.md ("Wiring the client").
 *
 * Two scenarios are shown:
 *   A. empty store   → both definitions are created (Material before Product)
 *   B. drifted store → a field is added, one updated, one removed (destructive)
 */
import {
  diff,
  normalizeLocal,
  normalizeRemote,
  pull,
  push,
  type AdminGraphQLClient,
  type DiffOp,
  type PulledRemote,
  type PushResult,
} from "../src/index";
import { Material, Product, schemas } from "./schema";

// --- pretty printer -------------------------------------------------------

function fieldLabel(op: DiffOp): string {
  if (op.kind === "addField") return `.${op.field.key}`;
  if ("key" in op) return `.${op.key}`;
  return "";
}

function printRun(label: string, plan: DiffOp[], result: PushResult): void {
  console.log(`\n${label}`);
  console.log(`  plan: ${plan.map((op) => op.kind).join(", ") || "(no changes — already in sync)"}`);
  for (const r of result.results) {
    const detail =
      r.status === "skipped" || r.status === "blocked"
        ? `  ← ${r.reason}`
        : r.status === "failed"
          ? `  ← ${r.userErrors.map((e) => e.message).join("; ")}`
          : "";
    console.log(`    ${r.op.kind} ${r.op.type}${fieldLabel(r.op)}: ${r.status}${detail}`);
  }
  console.log(`  counts: ${JSON.stringify(result.counts)}  ok: ${result.ok}`);
}

// `normalizeLocal` is normalized one-by-one on purpose: `schemas.map(normalizeLocal)`
// does NOT typecheck — the heterogeneous schema array can't unify normalizeLocal's
// generic. Call it per schema instead. (See ../docs/SYNC.md §4.)
const local = [normalizeLocal(Material), normalizeLocal(Product)];
// Plain method access needs no generic inference, so these DO map fine:
const definitions = schemas.map((s) => s.toDefinitionInput());
const types = schemas.map((s) => s.type);

// --- Scenario A: empty store ---------------------------------------------

async function scenarioEmptyStore(): Promise<void> {
  const createdOrder: string[] = [];
  let idCounter = 0;
  const client: AdminGraphQLClient = async (query, options) => {
    if (query.includes("metaobjectDefinitionByType")) {
      return { data: { metaobjectDefinitionByType: null } }; // every type missing
    }
    if (query.includes("metaobjectDefinitionCreate")) {
      const def = options?.variables?.definition as { type: string };
      createdOrder.push(def.type);
      idCounter += 1;
      return {
        data: {
          metaobjectDefinitionCreate: {
            metaobjectDefinition: { id: `gid://shopify/MetaobjectDefinition/${idCounter}`, type: def.type },
            userErrors: [],
          },
        },
      };
    }
    return { data: {} };
  };

  const remote = await pull(client, types);
  const plan = diff(local, remote.map((r) => normalizeRemote(r.definition)));
  const result = await push(client, plan, { definitions, remote });

  printRun("Scenario A — empty store", plan, result);
  console.log(`  create order: ${createdOrder.join(" → ")}  (referenced type first)`);
}

// --- Scenario B: drifted store -------------------------------------------

/** A store that already has both definitions, but Product has drifted from the
 *  local schema: `title` isn't required, `rating` is missing, and a legacy
 *  `sku` field lingers. */
function driftedStoreClient(): AdminGraphQLClient {
  const nodesByType: Record<string, unknown> = {
    [Material.type]: {
      id: "gid://shopify/MetaobjectDefinition/10",
      name: "Material",
      type: Material.type,
      fieldDefinitions: [
        { key: "name", name: "name", required: true, type: { name: "single_line_text_field" }, validations: [{ name: "max", value: "80" }] },
        { key: "density", name: "density", required: false, type: { name: "weight" }, validations: [] },
      ],
    },
    [Product.type]: {
      id: "gid://shopify/MetaobjectDefinition/11",
      name: "Product Spec",
      type: Product.type,
      fieldDefinitions: [
        { key: "title", name: "title", required: false, type: { name: "single_line_text_field" }, validations: [{ name: "max", value: "120" }] }, // required drift
        { key: "price", name: "price", required: false, type: { name: "money" }, validations: [] },
        { key: "specs", name: "specs", required: false, type: { name: "list.metaobject_reference" }, validations: [{ name: "metaobject_definition_type", value: Material.type }] },
        { key: "gallery", name: "gallery", required: false, type: { name: "list.file_reference" }, validations: [{ name: "file_type_options", value: '["Image"]' }] },
        { key: "dimensions", name: "dimensions", required: false, type: { name: "dimension" }, validations: [] },
        // `rating` missing here → addField
        { key: "sku", name: "sku", required: false, type: { name: "single_line_text_field" }, validations: [] }, // legacy → removeField (destructive)
      ],
    },
  };

  return async (query, options) => {
    if (query.includes("metaobjectDefinitionByType")) {
      const type = options?.variables?.type as string;
      return { data: { metaobjectDefinitionByType: nodesByType[type] ?? null } };
    }
    if (query.includes("metaobjectDefinitionUpdate")) {
      const id = options?.variables?.id as string;
      return { data: { metaobjectDefinitionUpdate: { metaobjectDefinition: { id }, userErrors: [] } } };
    }
    return { data: {} };
  };
}

async function scenarioDriftedStore(): Promise<void> {
  const client = driftedStoreClient();
  const remote: PulledRemote[] = await pull(client, types);
  const plan = diff(local, remote.map((r) => normalizeRemote(r.definition)));

  // Default: destructive ops (removeField / changeFieldType) are skipped.
  const safe = await push(client, plan, { definitions, remote });
  printRun("Scenario B — drifted store (allowDestructive: false, the default)", plan, safe);

  // Opt in to destructive ops to actually remove the legacy `sku` field.
  const destructive = await push(client, plan, { definitions, remote }, { allowDestructive: true });
  printRun("Scenario B — same plan, allowDestructive: true", plan, destructive);
}

await scenarioEmptyStore();
await scenarioDriftedStore();
console.log("");
