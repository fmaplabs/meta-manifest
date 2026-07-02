import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AdminGraphQLClient } from "../index";
import { generateSchemaSource, normalizeRemote, pullAll } from "../index";

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

export async function runPull(args: {
  client: AdminGraphQLClient;
  schemaPath: string;
  force?: boolean;
}): Promise<{ written: string; count: number }> {
  const remote = await pullAll(args.client); // app-owned only
  const typeById = new Map(remote.map((r) => [r.id, r.type]));
  const defs = remote.map((r) => normalizeRemote(r.definition, typeById));
  const source = await maybeFormat(generateSchemaSource(defs));

  const abs = resolve(process.cwd(), args.schemaPath);
  if (existsSync(abs) && !args.force) {
    console.warn(`Overwriting existing ${args.schemaPath}.`);
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, source);
  console.log(`Wrote ${defs.length} definition${defs.length === 1 ? "" : "s"} to ${args.schemaPath}.`);
  return { written: abs, count: defs.length };
}
