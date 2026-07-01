import type { AdminGraphQLClient, DiffOp, MetaobjectDefinitionInput, PulledRemote, ScopeConfig } from "../index";
import { diff, normalizeDefinition, normalizeRemote, pull, resolveDefinitions } from "../index";
import type { AnySchema } from "../index";

const APP_PREFIX = "$app:";

export interface Plan {
  plan: DiffOp[];
  remote: PulledRemote[];
  /** Scope-resolved definition inputs — reused by `push` so payloads use effective types. */
  definitions: MetaobjectDefinitionInput[];
  warnings: string[];
}

/**
 * `type` is immutable, so flipping a definition's scope makes `pull` look under
 * a new type and orphan the old one. Detect the app→merchant case (the orphan is
 * app-owned, so unambiguously ours) and surface it; migration is manual. [design §13]
 */
async function detectScopeFlips(
  client: AdminGraphQLClient,
  definitions: MetaobjectDefinitionInput[],
  plan: DiffOp[],
): Promise<string[]> {
  const merchant = definitions.filter((d) => !d.type.startsWith(APP_PREFIX));
  if (merchant.length === 0) return [];
  const created = new Set(plan.filter((op) => op.kind === "createDefinition").map((op) => op.type));
  const shadows = await pull(client, merchant.map((d) => `${APP_PREFIX}${d.type}`));
  const shadowTypes = new Set(shadows.map((s) => s.type));
  const warnings: string[] = [];
  for (const d of merchant) {
    if (created.has(d.type) && shadowTypes.has(`${APP_PREFIX}${d.type}`)) {
      warnings.push(
        `"${d.type}" is merchant-scoped but an app-owned "${APP_PREFIX}${d.type}" already exists remotely. ` +
          `Scope changes are not migrated (type is immutable): a new merchant-owned definition will be created and ` +
          `the app-owned one left orphaned. Migrate manually — see docs/SYNC.md.`,
      );
    }
  }
  return warnings;
}

/** Resolve scope, pull the effective types, normalize, and diff local↔remote. */
export async function planFor(
  client: AdminGraphQLClient,
  schemas: AnySchema[],
  config: ScopeConfig = {},
): Promise<Plan> {
  const definitions = resolveDefinitions(schemas, config);
  const types = definitions.map((d) => d.type);
  const localDefs = definitions.map(normalizeDefinition);
  const remote = await pull(client, types);
  const plan = diff(localDefs, remote.map((r) => normalizeRemote(r.definition)));
  const warnings = await detectScopeFlips(client, definitions, plan);
  return { plan, remote, definitions, warnings };
}
