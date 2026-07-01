#!/usr/bin/env node
import { SyncTransportError } from "../sync/client";
import { createAdminClient } from "../node/client";
import { loadConfig, loadSchemas } from "./load-config";
import { runInit } from "./init";
import { runDiff } from "./diff";
import { runPush } from "./push";
import { runPull } from "./pull";

export interface Args {
  command?: string;
  config?: string;
  allowDestructive: boolean;
  force: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { allowDestructive: false, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--allow-destructive") args.allowDestructive = true;
    else if (a === "--force") args.force = true;
    else if (a === "--config") args.config = argv[++i];
    else if (!a.startsWith("-") && !args.command) args.command = a;
  }
  return args;
}

const HELP = `meta-manifest — sync Shopify metaobject definitions

Usage: mm <command> [options]

Commands:
  init                 Scaffold meta-manifest.config.ts + src/schema.ts
  pull                 Enumerate remote definitions and write schema source
  diff                 Show the changes a push would apply
  push                 Apply local schema to the store

Options:
  --config <path>      Config file (default: meta-manifest.config.ts)
  --allow-destructive  Apply destructive changes on push
  --force              Overwrite schema on pull without warning
  -h, --help           Show this help`;

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help || !args.command) {
    console.log(HELP);
    return args.command ? 0 : args.help ? 0 : 1;
  }
  try {
    if (args.command === "init") {
      await runInit();
      return 0;
    }
    const config = await loadConfig(args.config);
    const client = createAdminClient(config);
    if (args.command === "pull") {
      await runPull({ client, schemaPath: config.schema, force: args.force });
      return 0;
    }
    const schemas = await loadSchemas(config.schema);
    if (args.command === "diff") {
      await runDiff({ client, schemas });
      return 0;
    }
    if (args.command === "push") {
      const result = await runPush({ client, schemas, allowDestructive: args.allowDestructive });
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
