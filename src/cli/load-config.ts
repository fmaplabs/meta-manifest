import { resolve } from "node:path";
import { createJiti } from "jiti";
import { validateConfig } from "../config";
import type { Config } from "../config";
import { isMetaobjectSchema } from "../define";
import type { AnyEntries, AnySchema } from "../index";

const jiti = createJiti(import.meta.url);

/** Load and validate meta-manifest.config.ts (default: ./meta-manifest.config.ts). */
export async function loadConfig(configPath = "meta-manifest.config.ts"): Promise<Config> {
  const abs = resolve(process.cwd(), configPath);
  const mod = await jiti.import<{ default?: unknown }>(abs);
  return validateConfig(mod.default);
}

/** `undefined` is what a missing `export default` in an imported module loads as. */
function describeValue(value: unknown): string {
  return value === undefined ? "undefined" : Array.isArray(value) ? "an array" : `type ${typeof value}`;
}

/**
 * Load the `schemas` export from the main schema module. Schemas may be declared across
 * multiple files — each as its module's `export default defineMetaobject(...)` — as long as
 * the main module imports them and lists every one in `schemas`. Each element is validated
 * here because the CLI runs untypechecked (via jiti): a missing `export default` imports as
 * `undefined` and would otherwise only blow up mid-diff with an opaque error.
 */
export async function loadSchemas(schemaPath: string): Promise<AnySchema[]> {
  const abs = resolve(process.cwd(), schemaPath);
  const mod = await jiti.import<{ schemas?: unknown }>(abs);
  if (!Array.isArray(mod.schemas)) {
    throw new Error(`Schema module "${schemaPath}" must export a \`schemas\` array.`);
  }
  const seenTypes = new Map<string, number>();
  mod.schemas.forEach((schema, i) => {
    if (!isMetaobjectSchema(schema)) {
      throw new Error(
        `schemas[${i}] in "${schemaPath}" is not a metaobject schema (got ${describeValue(schema)}). ` +
          `Each schema module must \`export default defineMetaobject(...)\`; import it into the main ` +
          `schema module and list it in \`schemas\`.`,
      );
    }
    const first = seenTypes.get(schema.type);
    if (first !== undefined) {
      throw new Error(
        `Duplicate metaobject type "${schema.type}" in "${schemaPath}" — ` +
          `schemas[${first}] and schemas[${i}] both declare it.`,
      );
    }
    seenTypes.set(schema.type, i);
  });
  return mod.schemas as AnySchema[];
}

function isEntriesDef(value: unknown): value is AnyEntries {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Partial<AnyEntries>;
  return isMetaobjectSchema(e.schema) && typeof e.entries === "object" && e.entries !== null;
}

/**
 * Load the `entries` export (an array of `defineEntries(...)` sets) from the main entries
 * module. Like schemas, sets may live in their own files as `export default defineEntries(...)`
 * and be imported into the main module's `entries` array.
 */
export async function loadEntries(entriesPath: string): Promise<AnyEntries[]> {
  const abs = resolve(process.cwd(), entriesPath);
  const mod = await jiti.import<{ entries?: unknown }>(abs);
  if (!Array.isArray(mod.entries)) {
    throw new Error(`Entries module "${entriesPath}" must export an \`entries\` array.`);
  }
  mod.entries.forEach((set, i) => {
    if (!isEntriesDef(set)) {
      throw new Error(
        `entries[${i}] in "${entriesPath}" is not a set of declared entries (got ${describeValue(set)}). ` +
          `Each entries module must \`export default defineEntries(...)\`; import it into the main ` +
          `entries module and list it in \`entries\`.`,
      );
    }
  });
  return mod.entries as AnyEntries[];
}
