import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AdminGraphQLClient, AnyMetafieldSet, PulledMetafieldDefinition, PullScope, ScopeConfig } from "../index";
import {
  discoverMerchantMetafields,
  generateMetafieldsSource,
  generateSchemaSource,
  metafieldPairs,
  normalizeRemote,
  pullAll,
  pullMetafields,
  refValidationsToTypes,
} from "../index";

/** Format source with the user's local prettier if available; otherwise return as-is. */
async function maybeFormat(source: string): Promise<string> {
  try {
    const spec = "prettier";
    const prettier = await import(spec);
    return await prettier.format(source, { parser: "typescript" });
  } catch {
    return source;
  }
}

/** Write generated source, warning (like schema) before overwriting an existing file. */
function writeGenerated(path: string, source: string, force: boolean | undefined, label: string): string {
  const abs = resolve(process.cwd(), path);
  if (existsSync(abs) && !force) {
    console.warn(`Overwriting existing ${path}.`);
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, source);
  console.log(label);
  return abs;
}

export async function runPull(args: {
  client: AdminGraphQLClient;
  schemaPath: string;
  force?: boolean;
  /** Which ownership class(es) to enumerate; defaults to app-owned only. */
  scope?: PullScope;
  /** When set, re-pull the declared `(ownerType, namespace)` pairs (app scope) and/or discover merchant pairs, and codegen this module. [design §8] */
  metafields?: { path: string; sets?: AnyMetafieldSet[]; config?: ScopeConfig };
}): Promise<{ written: string; count: number; metafieldCount?: number }> {
  const scope = args.scope ?? "app";
  const remote = await pullAll(args.client, { scope });
  const typeById = new Map(remote.map((r) => [r.id, r.type]));
  const defs = remote.map((r) => normalizeRemote(r.definition, typeById));
  const source = await maybeFormat(generateSchemaSource(defs));
  const written = writeGenerated(
    args.schemaPath,
    source,
    args.force,
    `Wrote ${defs.length} definition${defs.length === 1 ? "" : "s"} to ${args.schemaPath}.`,
  );

  let metafieldCount: number | undefined;
  if (args.metafields) {
    // App scope re-pulls only the declared pairs; merchant scope discovers the
    // store's merchant-owned pairs; "all" merges the two (discovery wins dupes).
    const pulled: PulledMetafieldDefinition[] = [];
    const seen = new Set<string>();
    const add = (defsIn: PulledMetafieldDefinition[]) => {
      for (const d of defsIn) {
        const id = `${d.ownerType}/${d.namespace}/${d.key}`;
        if (seen.has(id)) continue;
        seen.add(id);
        pulled.push(d);
      }
    };
    if (scope !== "app") {
      const { definitions, warnings } = await discoverMerchantMetafields(args.client);
      for (const w of warnings) console.warn(w);
      add(definitions);
    }
    if (scope !== "merchant" && args.metafields.sets?.length) {
      const pairs = metafieldPairs(args.metafields.sets, args.metafields.config);
      add(await pullMetafields(args.client, pairs));
    }
    const normalized = pulled.map((d) => ({ ...d, validations: refValidationsToTypes(d.validations, typeById) }));
    const metafieldsSource = await maybeFormat(generateMetafieldsSource(normalized));
    writeGenerated(
      args.metafields.path,
      metafieldsSource,
      args.force,
      `Wrote ${normalized.length} metafield definition${normalized.length === 1 ? "" : "s"} to ${args.metafields.path}.`,
    );
    metafieldCount = normalized.length;
  }

  return { written, count: defs.length, metafieldCount };
}
