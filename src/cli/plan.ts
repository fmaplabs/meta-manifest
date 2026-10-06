import type {
  AdminGraphQLClient,
  AnyEntries,
  AnyMetafieldSet,
  DiffOp,
  EntryOp,
  Issue,
  LocalMetafieldDefinition,
  MetafieldOp,
  MetaobjectDefinitionInput,
  PulledEntry,
  PulledMetafieldDefinition,
  PulledRemote,
  ResolvedEntry,
  ScopeConfig,
} from "../index";
import {
  diff,
  diffEntries,
  diffMetafields,
  metafieldPairs,
  normalizeDefinition,
  normalizeRemote,
  pull,
  pullEntries,
  pullMetafields,
  refValidationsToTypes,
  resolveDefinitions,
  resolveEntries,
  resolveMetafieldSets,
} from "../index";
import { APP_NAMESPACE, SyncTransportError } from "../index";
import { metafieldOwnerKey } from "../metafields";
import type { AnySchema } from "../index";

const APP_PREFIX = "$app:";
/** Where the bare `$app` metafield namespace lands under a merchant scope. */
const MERCHANT_NAMESPACE = "custom";

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

export interface EntryPlan {
  plan: EntryOp[];
  entries: ResolvedEntry[];
  remote: PulledEntry[];
  issues: Issue[];
}

/**
 * Resolve + validate declared entries, pull the declared keys, and diff.
 * Validation issues short-circuit before any network call. Pulls are skipped
 * for types whose definition doesn't exist yet (`pendingCreateTypes`) — their
 * entries are creates by construction.
 */
export async function planEntriesFor(
  client: AdminGraphQLClient,
  entrySets: AnyEntries[],
  schemas: AnySchema[],
  config: ScopeConfig = {},
  opts: { pendingCreateTypes?: ReadonlySet<string> } = {},
): Promise<EntryPlan> {
  const { entries, issues } = resolveEntries(entrySets, schemas, config);
  if (issues.length > 0) return { plan: [], entries: [], remote: [], issues };
  const keys = entries
    .filter((e) => !opts.pendingCreateTypes?.has(e.type))
    .map((e) => ({ type: e.type, handle: e.handle }));
  const remote = await pullEntries(client, keys);
  return { plan: diffEntries(entries, remote), entries, remote, issues: [] };
}

export interface MetafieldPlan {
  plan: MetafieldOp[];
  /** Resolved local definitions — reused by `pushMetafields` to build payloads. */
  definitions: LocalMetafieldDefinition[];
  remote: PulledMetafieldDefinition[];
  warnings: string[];
}

/**
 * The metafield counterpart of `detectScopeFlips`: a definition flipped from app
 * to merchant scope moves from the `$app` namespace to `"custom"`, so the diff
 * plans a fresh create and the app-owned definition is silently orphaned (the
 * old pair is no longer declared, hence no longer managed). Detect the orphan —
 * it is app-owned, so unambiguously ours — only where a create is actually
 * planned; migration is manual. [design §13]
 */
async function detectMetafieldScopeFlips(
  client: AdminGraphQLClient,
  definitions: LocalMetafieldDefinition[],
  plan: MetafieldOp[],
): Promise<string[]> {
  const keyOf = (d: { ownerType: string; namespace: string; key: string }) => `${d.ownerType}/${d.namespace}/${d.key}`;
  const created = new Set(plan.filter((op) => op.kind === "createMetafield").map(keyOf));
  const candidates = definitions.filter((d) => d.namespace === MERCHANT_NAMESPACE && created.has(keyOf(d)));
  if (candidates.length === 0) return [];
  const owners = [...new Set(candidates.map((d) => d.ownerType))];
  let shadows: PulledMetafieldDefinition[];
  try {
    shadows = await pullMetafields(client, owners.map((ownerType) => ({ ownerType, namespace: APP_NAMESPACE })));
  } catch (err) {
    // Best-effort check: without a resolvable app id, "ours" cannot be told apart
    // from another app's reserved namespace — skip rather than fail the plan.
    if (err instanceof SyncTransportError) throw err;
    return [];
  }
  const shadowKeys = new Set(shadows.map((s) => `${s.ownerType}/${s.key}`));
  const warnings: string[] = [];
  for (const d of candidates) {
    if (!shadowKeys.has(`${d.ownerType}/${d.key}`)) continue;
    const owner = metafieldOwnerKey(d.ownerType) ?? d.ownerType;
    warnings.push(
      `"${owner}.${MERCHANT_NAMESPACE}.${d.key}" is merchant-scoped but an app-owned "${owner}.${APP_NAMESPACE}.${d.key}" ` +
        `already exists remotely. Scope changes are not migrated (the namespace is part of the identity): a new ` +
        `"${MERCHANT_NAMESPACE}" definition will be created and the app-owned one left orphaned. ` +
        `Migrate manually — see docs/SYNC.md.`,
    );
  }
  return warnings;
}

/**
 * Resolve declared metafield sets, pull the declared `(ownerType, namespace)`
 * pairs, and diff. Pulled GID-form reference validations are rewritten back to
 * type-form via `metaobjectTypeById` (definition GID → effective type, from the
 * metaobject plan) so they compare against the local canon. [design §7]
 */
export async function planMetafieldsFor(
  client: AdminGraphQLClient,
  sets: AnyMetafieldSet[],
  schemas: AnySchema[],
  config: ScopeConfig = {},
  opts: { metaobjectTypeById?: ReadonlyMap<string, string> } = {},
): Promise<MetafieldPlan> {
  const definitions = resolveMetafieldSets(sets, schemas, config);
  const pairs = metafieldPairs(sets, config);
  const pulled = await pullMetafields(client, pairs);
  const typeById = opts.metaobjectTypeById;
  const remote = typeById
    ? pulled.map((d) => ({ ...d, validations: refValidationsToTypes(d.validations, typeById) }))
    : pulled;
  const plan = diffMetafields(definitions, remote, pairs);
  const warnings = await detectMetafieldScopeFlips(client, definitions, plan);
  return { plan, definitions, remote, warnings };
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
  // GID-form ref validations on pulled defs are re-labeled to the managed types' canon.
  const typeById = new Map(remote.map((r) => [r.id, r.type]));
  const plan = diff(localDefs, remote.map((r) => normalizeRemote(r.definition, typeById)));
  const warnings = await detectScopeFlips(client, definitions, plan);
  return { plan, remote, definitions, warnings };
}
