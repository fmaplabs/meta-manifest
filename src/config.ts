export const DEFAULT_API_VERSION = "2026-07";

export interface Config {
  /** e.g. "my-store.myshopify.com" */
  shop: string;
  /** Admin API access token; reference via process.env in your config file. */
  accessToken: string;
  /** Admin API version. Defaults to DEFAULT_API_VERSION. */
  apiVersion?: string;
  /** Path to the schema module whose `schemas` export drives diff/push, and pull writes. */
  schema: string;
  /** Optional path to a module whose `entries` export declares seed entries to upsert on push. */
  entries?: string;
  /** Optional path to a module whose `metafields` export declares metafield-definition sets. */
  metafields?: string;
  /** Scope for all metaobjects, unless overridden per-metaobject. Defaults to "app". */
  scope?: "app" | "merchant";
  /** Default admin access for app-scoped metaobjects: false → merchant_read, true → merchant_read_write. Defaults to false. */
  merchantEditable?: boolean;
}

/** Identity helper for type inference in `meta-manifest.config.ts`. */
export function defineConfig(config: Config): Config {
  return config;
}

/** Validate a loaded config object, throwing a one-line Error naming the first missing field. */
export function validateConfig(raw: unknown): Config {
  const c = raw as Partial<Config> | null | undefined;
  for (const key of ["shop", "accessToken", "schema"] as const) {
    if (!c || typeof c[key] !== "string" || c[key] === "") {
      throw new Error(`Invalid config: missing or empty "${key}".`);
    }
  }
  for (const key of ["entries", "metafields"] as const) {
    if (c?.[key] !== undefined && (typeof c[key] !== "string" || c[key] === "")) {
      throw new Error(`Invalid config: "${key}" must be a non-empty path string when set.`);
    }
  }
  return c as Config;
}
