import { resolve } from "node:path";
import { createJiti } from "jiti";
import { validateConfig } from "../config";
import type { Config } from "../config";
import type { AnyEntries, AnySchema } from "../index";

const jiti = createJiti(import.meta.url);

/** Load and validate meta-manifest.config.ts (default: ./meta-manifest.config.ts). */
export async function loadConfig(configPath = "meta-manifest.config.ts"): Promise<Config> {
  const abs = resolve(process.cwd(), configPath);
  const mod = await jiti.import<{ default?: unknown }>(abs);
  return validateConfig(mod.default);
}

/** Load the `schemas` export from a schema module. */
export async function loadSchemas(schemaPath: string): Promise<AnySchema[]> {
  const abs = resolve(process.cwd(), schemaPath);
  const mod = await jiti.import<{ schemas?: unknown }>(abs);
  if (!Array.isArray(mod.schemas)) {
    throw new Error(`Schema module "${schemaPath}" must export a \`schemas\` array.`);
  }
  return mod.schemas as AnySchema[];
}

/** Load the `entries` export (an array of `defineEntries(...)` sets) from an entries module. */
export async function loadEntries(entriesPath: string): Promise<AnyEntries[]> {
  const abs = resolve(process.cwd(), entriesPath);
  const mod = await jiti.import<{ entries?: unknown }>(abs);
  if (!Array.isArray(mod.entries)) {
    throw new Error(`Entries module "${entriesPath}" must export an \`entries\` array.`);
  }
  return mod.entries as AnyEntries[];
}
