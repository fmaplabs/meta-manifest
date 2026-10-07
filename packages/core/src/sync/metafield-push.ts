import { APP_NAMESPACE, isAppReservedNamespace } from "../metafields";
import {
  CREATE_METAFIELD_DEFINITION_MUTATION,
  DELETE_METAFIELD_DEFINITION_MUTATION,
  UPDATE_METAFIELD_DEFINITION_MUTATION,
  execute,
  type AdminGraphQLClient,
} from "./client";
import type { MetafieldChange, MetafieldOp } from "./metafield-diff";
import type { PulledMetafieldDefinition } from "./metafield-pull";
import { referencedMetaobjectTypes, refValidationsToIds } from "./ref-validations";
import type { LocalMetafieldDefinition, MetafieldCapabilities } from "./resolve";

export interface MetafieldPushOptions {
  /** Apply destructive ops (`removeMetafield`, `changeMetafieldType`). Default false. */
  allowDestructive?: boolean;
}

type UserError = { field?: string[]; message: string; code?: string };

export type MetafieldPushOpResult =
  | { op: MetafieldOp; status: "applied"; id?: string }
  | { op: MetafieldOp; status: "skipped"; reason: "destructive" }
  | { op: MetafieldOp; status: "blocked"; reason: string }
  | { op: MetafieldOp; status: "failed"; userErrors: UserError[] };

export interface MetafieldPushResult {
  results: MetafieldPushOpResult[];
  counts: { applied: number; skipped: number; blocked: number; failed: number };
  ok: boolean;
}

type CapabilitiesPayload = Partial<Record<keyof MetafieldCapabilities, { enabled: boolean }>>;

/** Only capability keys supported by the owner are safe to send; enabled ones always are. */
function enabledCapabilities(caps: MetafieldCapabilities): CapabilitiesPayload | undefined {
  const out: CapabilitiesPayload = {};
  for (const key of ["adminFilterable", "smartCollectionCondition", "uniqueValues"] as const) {
    if (caps[key].enabled) out[key] = { enabled: true };
  }
  return Object.keys(out).length ? out : undefined;
}

/** The capabilities whose `enabled` drifted — the update payload sends exactly these. [design §7] */
function driftedCapabilities(local: MetafieldCapabilities, remote: MetafieldCapabilities | undefined): CapabilitiesPayload {
  const out: CapabilitiesPayload = {};
  for (const key of ["adminFilterable", "smartCollectionCondition", "uniqueValues"] as const) {
    if (local[key].enabled !== (remote?.[key].enabled ?? false)) out[key] = { enabled: local[key].enabled };
  }
  return out;
}

/** `MetafieldDefinitionInput` for a create: bare `$app` is omitted (→ app-reserved). [design §3] */
function createInput(def: LocalMetafieldDefinition): Record<string, unknown> {
  const input: Record<string, unknown> = {
    ownerType: def.ownerType,
    key: def.key,
    name: def.name,
    type: def.type,
  };
  if (def.namespace !== APP_NAMESPACE) input.namespace = def.namespace;
  if (def.description != null) input.description = def.description;
  if (def.validations.length) input.validations = def.validations;
  if (def.access) input.access = def.access;
  const capabilities = enabledCapabilities(def.capabilities);
  if (capabilities) input.capabilities = capabilities;
  if (def.pin) input.pin = true;
  return input;
}

/**
 * `MetafieldDefinitionUpdateInput` for the changed properties. Identity is the
 * `(ownerType, key, namespace?)` triple — namespace omitted means app-reserved;
 * there is no id-based update. [design §3]
 */
function updateInput(
  def: LocalMetafieldDefinition,
  changes: MetafieldChange[],
  remote: PulledMetafieldDefinition | undefined,
): Record<string, unknown> {
  const input: Record<string, unknown> = { ownerType: def.ownerType, key: def.key };
  if (def.namespace !== APP_NAMESPACE) input.namespace = def.namespace;
  for (const c of changes) {
    if (c === "name") input.name = def.name;
    else if (c === "description") input.description = def.description;
    else if (c === "validations") input.validations = def.validations;
    else if (c === "access") input.access = def.access;
    else if (c === "capabilities") input.capabilities = driftedCapabilities(def.capabilities, remote?.capabilities);
    else if (c === "pin") input.pin = def.pin;
  }
  return input;
}

/**
 * Applies a metafield-definition plan. Safe ops run; destructive ops are skipped
 * unless `allowDestructive`. Deleting inside an app-reserved namespace always
 * sets `deleteAllAssociatedMetafields: true` (required by Shopify; wipes values
 * store-wide, async). Per-op `userErrors` become `failed` results; only
 * transport errors propagate. No ordering is needed within metafields. [design §6, §7]
 */
export async function pushMetafields(
  client: AdminGraphQLClient,
  plan: MetafieldOp[],
  sources: {
    definitions: LocalMetafieldDefinition[];
    remote: PulledMetafieldDefinition[];
    /** Metaobject type → definition GID (pulled + created this run), for merchant-scope ref targets. */
    metaobjectIdsByType?: ReadonlyMap<string, string>;
    /** Metaobject types whose definition create did not apply this run — ops whose validations reference one are blocked. */
    failedMetaobjectTypes?: ReadonlySet<string>;
  },
  options?: MetafieldPushOptions,
): Promise<MetafieldPushResult> {
  const allowDestructive = options?.allowDestructive ?? false;
  const keyOf = (d: { ownerType: string; namespace: string; key: string }) => `${d.ownerType}/${d.namespace}/${d.key}`;
  const idsByType = sources.metaobjectIdsByType ?? new Map<string, string>();
  const failedTypes = sources.failedMetaobjectTypes ?? new Set<string>();
  // Merchant-scope reference targets must be GID-form at the store boundary (see
  // ref-validations.ts). Applied at the payload sites so the blocked-dependency
  // check below still sees the canonical type-form validations.
  const withRefIds = (def: LocalMetafieldDefinition): LocalMetafieldDefinition => ({
    ...def,
    validations: refValidationsToIds(def.validations, idsByType),
  });
  const defByKey = new Map(sources.definitions.map((d) => [keyOf(d), d]));
  const remoteByKey = new Map(sources.remote.map((d) => [keyOf(d), d]));

  /** A reference target whose metaobject create did not apply — sending it would only surface a userError. */
  function failedRefTarget(def: LocalMetafieldDefinition): string | undefined {
    if (failedTypes.size === 0) return undefined;
    return referencedMetaobjectTypes(def.validations).find((t) => failedTypes.has(t));
  }

  async function create(op: MetafieldOp, def: LocalMetafieldDefinition): Promise<MetafieldPushOpResult> {
    const data = await execute<{
      metafieldDefinitionCreate: { createdDefinition?: { id?: string } | null; userErrors: UserError[] };
    }>(client, CREATE_METAFIELD_DEFINITION_MUTATION, { definition: createInput(withRefIds(def)) });
    const payload = data.metafieldDefinitionCreate;
    if (payload.userErrors.length) return { op, status: "failed", userErrors: payload.userErrors };
    return { op, status: "applied", id: payload.createdDefinition?.id };
  }

  async function remove(op: MetafieldOp): Promise<MetafieldPushOpResult> {
    const id = remoteByKey.get(keyOf(op))?.id;
    if (id == null) return { op, status: "blocked", reason: `no remote definition id for "${keyOf(op)}"` };
    const data = await execute<{
      metafieldDefinitionDelete: { deletedDefinitionId?: string | null; userErrors: UserError[] };
    }>(client, DELETE_METAFIELD_DEFINITION_MUTATION, {
      id,
      deleteAllAssociatedMetafields: isAppReservedNamespace(op.namespace),
    });
    const payload = data.metafieldDefinitionDelete;
    if (payload.userErrors.length) return { op, status: "failed", userErrors: payload.userErrors };
    return { op, status: "applied", id };
  }

  async function apply(op: MetafieldOp): Promise<MetafieldPushOpResult> {
    const destructive = "destructive" in op && op.destructive === true;
    if (destructive && !allowDestructive) return { op, status: "skipped", reason: "destructive" };

    switch (op.kind) {
      case "createMetafield": {
        const def = defByKey.get(keyOf(op));
        if (!def) return { op, status: "blocked", reason: `no local definition for "${keyOf(op)}"` };
        const failedRef = failedRefTarget(def);
        if (failedRef) return { op, status: "blocked", reason: `referenced metaobject definition "${failedRef}" was not created` };
        return create(op, def);
      }
      case "updateMetafield": {
        const def = defByKey.get(keyOf(op));
        if (!def) return { op, status: "blocked", reason: `no local definition for "${keyOf(op)}"` };
        const failedRef = op.changes.includes("validations") ? failedRefTarget(def) : undefined;
        if (failedRef) return { op, status: "blocked", reason: `referenced metaobject definition "${failedRef}" was not created` };
        const data = await execute<{
          metafieldDefinitionUpdate: { updatedDefinition?: { id?: string } | null; userErrors: UserError[] };
        }>(client, UPDATE_METAFIELD_DEFINITION_MUTATION, {
          definition: updateInput(withRefIds(def), op.changes, remoteByKey.get(keyOf(op))),
        });
        const payload = data.metafieldDefinitionUpdate;
        if (payload.userErrors.length) return { op, status: "failed", userErrors: payload.userErrors };
        return { op, status: "applied", id: payload.updatedDefinition?.id };
      }
      case "removeMetafield":
        return remove(op);
      case "changeMetafieldType": {
        // `type` is immutable: delete (wiping app-reserved values), then recreate. [design §6]
        const def = defByKey.get(keyOf(op));
        if (!def) return { op, status: "blocked", reason: `no local definition for "${keyOf(op)}"` };
        // Checked before the delete: a doomed recreate must not wipe the old definition.
        const failedRef = failedRefTarget(def);
        if (failedRef) return { op, status: "blocked", reason: `referenced metaobject definition "${failedRef}" was not created` };
        const deleted = await remove(op);
        if (deleted.status !== "applied") return deleted;
        return create(op, def);
      }
    }
  }

  const results: MetafieldPushOpResult[] = [];
  for (const op of plan) results.push(await apply(op));

  const counts = { applied: 0, skipped: 0, blocked: 0, failed: 0 };
  for (const r of results) counts[r.status]++;
  return { results, counts, ok: counts.failed === 0 && counts.blocked === 0 };
}
