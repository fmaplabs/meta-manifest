#!/usr/bin/env node
import { SyncTransportError } from "@fmaplabs/meta-manifest";
import { selectAdminClient, cliAuthAppScopeNotice } from "./auth";
import { loadConfig, loadEntries, loadMetafields, loadSchemas } from "./load-config";
import { loadDotEnv } from "./load-env";
import { runInit } from "./init";
import { runDiff } from "./diff";
import { runPush } from "./push";
import { runPull } from "./pull";

export interface Args {
  command?: string;
  config?: string;
  allowDestructive: boolean;
  allowCliAppScope: boolean;
  force: boolean;
  check: boolean;
  help: boolean;
  scope: "app" | "merchant" | "all";
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { allowDestructive: false, allowCliAppScope: false, force: false, check: false, help: false, scope: "app" };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    // Split "--flag=value" so both spellings parse identically.
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const a = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? undefined : raw.slice(eq + 1);
    const booleanFlag = (): true => {
      if (inline !== undefined) throw new Error(`Flag ${a} does not take a value (got "${raw}").`);
      return true;
    };
    if (a === "--help" || a === "-h") args.help = booleanFlag();
    else if (a === "--allow-destructive") args.allowDestructive = booleanFlag();
    else if (a === "--allow-cli-app-scope") args.allowCliAppScope = booleanFlag();
    else if (a === "--force") args.force = booleanFlag();
    else if (a === "--check") args.check = booleanFlag();
    else if (a === "--config") args.config = inline ?? argv[++i];
    else if (a === "--scope") {
      const value = inline ?? argv[++i];
      if (value !== "app" && value !== "merchant" && value !== "all") {
        throw new Error(`Invalid --scope "${value ?? ""}" — expected app, merchant, or all.`);
      }
      args.scope = value;
    } else if (a.startsWith("-")) throw new Error(`Unknown flag "${raw}". Run mm --help for usage.`);
    else if (!args.command) args.command = a;
  }
  return args;
}

const HELP = `meta-manifest — sync Shopify metaobject & metafield definitions

Usage: mm <command> [options]

Commands:
  init                 Scaffold meta-manifest.config.ts + src/schema.ts
  pull                 Enumerate remote definitions and write schema source
  diff                 Show the changes a push would apply
  push                 Apply local schema to the store

When \`metafields\` is set in the config, diff and push also reconcile the
declared metafield definitions (after metaobject definitions, before entries),
and pull re-pulls the declared pairs and regenerates the metafields module.
When \`entries\` is set, diff and push also plan and upsert the declared seed
entries (after definitions). Entries are never deleted.

Options:
  --config <path>        Config file (default: meta-manifest.config.ts)
  --allow-destructive    Apply destructive changes on push
  --allow-cli-app-scope  Under auth: "cli", downgrade the app-scope error to a warning
  --check                On diff, exit 2 when the store differs from the local
                         schema (for CI drift gates); exit 0 when in sync
  --force                Overwrite schema on pull without warning
  --scope <value>        What pull enumerates: app (default), merchant, or all.
                         merchant/all also discover merchant-owned metafield
                         definitions store-wide (owners the token can't read are
                         skipped with a warning); merchant skips the cli-auth
                         app-scope guard since no $app material is touched
  -h, --help             Show this help`;

/** Under diff --check: exit 2 when the store differs from the desired state, 0 when in sync. */
export function checkExitCode(result: { definitions: unknown[]; metafields: unknown[]; entries: unknown[] }): 0 | 2 {
  return result.definitions.length || result.metafields.length || result.entries.length ? 2 : 0;
}

/** Enforce the CLI-auth app-scope guard: hard error, or a warning under --allow-cli-app-scope. */
function enforceCliAppScope(notice: string | null, allow: boolean): void {
  if (notice === null) return;
  if (!allow) throw new Error(notice);
  console.warn(notice);
}

export async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (args.help || !args.command) {
    console.log(HELP);
    return args.command ? 0 : args.help ? 0 : 1;
  }
  try {
    if (args.command === "init") {
      await runInit();
      return 0;
    }
    loadDotEnv();
    const config = await loadConfig(args.config);
    const client = selectAdminClient(config);
    if (args.command === "pull") {
      enforceCliAppScope(cliAuthAppScopeNotice({ config, command: "pull", pullScope: args.scope }), args.allowCliAppScope);
      // The app-scope metafield re-pull needs the locally declared pairs; a
      // missing/invalid metafields module just means nothing is declared yet.
      // Merchant discovery needs no declared sets, so under --scope merchant/all
      // the module is still (re)generated from discovery alone.
      let metafields: { path: string; sets?: Awaited<ReturnType<typeof loadMetafields>>; config: typeof config } | undefined;
      if (config.metafields) {
        try {
          metafields = { path: config.metafields, sets: await loadMetafields(config.metafields, config), config };
        } catch (e) {
          const reason = `could not load "${config.metafields}": ${e instanceof Error ? e.message : String(e)}`;
          if (args.scope === "app") {
            console.warn(`Skipping metafields pull — ${reason}`);
          } else {
            if (args.scope === "all") console.warn(`Pulling discovered merchant metafield definitions only — ${reason}`);
            metafields = { path: config.metafields, config };
          }
        }
      }
      await runPull({ client, schemaPath: config.schema, force: args.force, scope: args.scope, metafields });
      return 0;
    }
    const schemas = await loadSchemas(config.schema);
    const entries = config.entries ? await loadEntries(config.entries) : undefined;
    const metafields = config.metafields ? await loadMetafields(config.metafields, config) : undefined;
    if (args.command === "diff" || args.command === "push") {
      enforceCliAppScope(
        cliAuthAppScopeNotice({ config, command: args.command, schemas, metafieldSets: metafields }),
        args.allowCliAppScope,
      );
    }
    if (args.command === "diff") {
      const result = await runDiff({ client, schemas, entries, metafields, config });
      return args.check ? checkExitCode(result) : 0;
    }
    if (args.command === "push") {
      const result = await runPush({ client, schemas, entries, metafields, config, allowDestructive: args.allowDestructive });
      return result.ok ? 0 : 2;
    }
    console.error(`Unknown command: ${args.command}`);
    console.log(HELP);
    return 1;
  } catch (err) {
    if (err instanceof SyncTransportError) console.error(`Sync failed: Shopify rejected a request.`);
    else console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

// Invoked as the bin. Guarded so importing this module in tests (which read
// `parseArgs`) does not trigger process.exit — vitest sets process.env.VITEST.
if (process.env.VITEST === undefined) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
