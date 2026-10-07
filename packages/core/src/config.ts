export const DEFAULT_API_VERSION = "2026-07";

/** How the CLI authenticates to the Admin API: a static token, a `shopify store auth` session, or a client-credentials grant. */
export type AuthMode = "token" | "cli" | "client-credentials";

interface BaseConfig {
  /** e.g. "my-store.myshopify.com" */
  shop: string;
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

export interface TokenConfig extends BaseConfig {
  auth?: "token";
  /** Admin API access token; reference via process.env in your config file. */
  accessToken: string;
}

export interface CliConfig extends BaseConfig {
  /** Authenticate via the Shopify CLI's stored `shopify store auth` session. */
  auth: "cli";
  /** Permitted but ignored under CLI auth, so switching modes is a one-line edit. */
  accessToken?: string;
}

export interface ClientCredentialsConfig extends BaseConfig {
  /** Mint a 24h Admin token per run via the Dev Dashboard app's client-credentials grant. */
  auth: "client-credentials";
  /** The app's client ID; reference via process.env in your config file. */
  clientId: string;
  /** The app's client secret; reference via process.env in your config file. */
  clientSecret: string;
  /** Permitted but ignored under client-credentials auth, so switching modes is a one-line edit. */
  accessToken?: string;
}

export type Config = TokenConfig | CliConfig | ClientCredentialsConfig;

/** Identity helper for type inference in `meta-manifest.config.ts`. */
export function defineConfig(config: Config): Config {
  return config;
}

/** Validate a loaded config object, throwing a one-line Error naming the first missing field. */
export function validateConfig(raw: unknown): Config {
  const c = raw as
    | (Partial<BaseConfig> & { auth?: unknown; accessToken?: unknown; clientId?: unknown; clientSecret?: unknown })
    | null
    | undefined;
  if (c?.auth !== undefined && c.auth !== "token" && c.auth !== "cli" && c.auth !== "client-credentials") {
    throw new Error(`Invalid config: "auth" must be "token", "cli", or "client-credentials" when set.`);
  }
  const required: ("shop" | "accessToken" | "schema" | "clientId" | "clientSecret")[] =
    c?.auth === "cli"
      ? ["shop", "schema"]
      : c?.auth === "client-credentials"
        ? ["shop", "schema", "clientId", "clientSecret"]
        : ["shop", "accessToken", "schema"];
  for (const key of required) {
    if (!c || typeof c[key] !== "string" || c[key] === "") {
      throw new Error(`Invalid config: missing or empty "${key}".`);
    }
  }
  for (const key of ["entries", "metafields"] as const) {
    if (c?.[key] !== undefined && (typeof c[key] !== "string" || c[key] === "")) {
      throw new Error(`Invalid config: "${key}" must be a non-empty path string when set.`);
    }
  }
  return c as unknown as Config;
}
