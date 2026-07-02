import type { FieldValidation } from "../fields/base";
import type {
  AccessInput,
  CapabilitiesInput,
  FieldCapabilitiesInput,
  FieldDefinitionInput,
  MetaobjectDefinitionInput,
} from "../definition-input";
import { CREATE_DEFINITION_MUTATION, execute, UPDATE_DEFINITION_MUTATION, type AdminGraphQLClient } from "./client";
import type { DefinitionChange, DiffOp } from "./diff";
import type { PulledRemote } from "./pull";
import { refValidationsToIds } from "./ref-validations";

export interface PushOptions {
  /** Apply destructive ops (`removeField`, `changeFieldType`). Default false. */
  allowDestructive?: boolean;
}

export type PushOpResult =
  | { op: DiffOp; status: "applied"; id?: string }
  | { op: DiffOp; status: "skipped"; reason: "destructive" }
  | { op: DiffOp; status: "blocked"; reason: string }
  | { op: DiffOp; status: "failed"; userErrors: UserError[] };

export interface PushResult {
  results: PushOpResult[];
  counts: { applied: number; skipped: number; blocked: number; failed: number };
  ok: boolean;
}

type UserError = { field?: string[]; message: string; code?: string };
type MutationPayload = { metaobjectDefinition?: { id?: string } | null; userErrors: UserError[] };
type FieldUpdateInput = {
  key: string;
  name: string;
  description?: string;
  required: boolean;
  validations: FieldValidation[];
  capabilities?: FieldCapabilitiesInput;
};
type FieldOpInput = { create: FieldDefinitionInput } | { update: FieldUpdateInput } | { delete: { key: string } };

/** The `MetaobjectDefinitionUpdateInput` metadata carried by an `updateDefinition` op. */
interface DefinitionUpdateInput {
  name?: string;
  description?: string;
  displayNameKey?: string;
  access?: AccessInput;
  capabilities?: CapabilitiesInput;
}

/**
 * Build the definition-level update payload for the changed fields. `capabilities`
 * always sends an explicit `onlineStore` (absence means disabled — decision 4) so a
 * removed `onlineStore` config reconciles the live capability off. [design §8]
 */
function definitionUpdateFor(def: MetaobjectDefinitionInput, changes: DefinitionChange[]): DefinitionUpdateInput {
  const out: DefinitionUpdateInput = {};
  for (const c of changes) {
    if (c === "name") out.name = def.name;
    else if (c === "description") out.description = def.description;
    else if (c === "displayNameKey") out.displayNameKey = def.displayNameKey;
    else if (c === "access") out.access = def.access;
    else if (c === "capabilities") {
      const caps = def.capabilities;
      const payload: CapabilitiesInput = {};
      if (caps?.publishable) payload.publishable = caps.publishable;
      if (caps?.translatable) payload.translatable = caps.translatable;
      if (caps?.renderable) payload.renderable = caps.renderable;
      payload.onlineStore = caps?.onlineStore ?? { enabled: false };
      out.capabilities = payload;
    }
  }
  return out;
}

/** The full local field input for a field, used to build create/update payloads. [design §7] */
function fieldInputFor(
  defByType: Map<string, MetaobjectDefinitionInput>,
  type: string,
  key: string,
): FieldDefinitionInput | undefined {
  return defByType.get(type)?.fieldDefinitions.find((f) => f.key === key);
}

/**
 * The `$app:` types a single field references, from its `metaobject_definition_type`
 * (single) and `metaobject_definition_types` (JSON array) validations.
 */
function fieldRefTargets(field: FieldDefinitionInput): string[] {
  const out: string[] = [];
  for (const v of field.validations) {
    if (v.name === "metaobject_definition_type") {
      out.push(v.value);
    } else if (v.name === "metaobject_definition_types") {
      try {
        const parsed: unknown = JSON.parse(v.value);
        if (Array.isArray(parsed)) for (const t of parsed) if (typeof t === "string") out.push(t);
      } catch {
        // Ignore a malformed validation value rather than failing the push.
      }
    }
  }
  return out;
}

/**
 * The `$app:` types a definition references across all its fields. These are the
 * dependency edges for create ordering. [design §7]
 */
export function referenceEdges(def: MetaobjectDefinitionInput): string[] {
  return def.fieldDefinitions.flatMap(fieldRefTargets);
}

/**
 * Split a cyclic definition's fields for two-pass creation: `deferred` fields
 * reference another type *in the cycle* (whose target doesn't exist yet at create
 * time) and are added by a follow-up update; `pass1` fields — scalars, refs to
 * already-created types, and self-references — create with the definition. [design §7]
 */
function splitCyclicFields(
  def: MetaobjectDefinitionInput,
  cyclicTypes: Set<string>,
): { pass1: FieldDefinitionInput[]; deferred: FieldDefinitionInput[] } {
  const pass1: FieldDefinitionInput[] = [];
  const deferred: FieldDefinitionInput[] = [];
  for (const f of def.fieldDefinitions) {
    const breaksCycle = fieldRefTargets(f).some((t) => cyclicTypes.has(t) && t !== def.type);
    (breaksCycle ? deferred : pass1).push(f);
  }
  return { pass1, deferred };
}

/**
 * Kahn's topological sort: returns create keys in dependency-first order.
 * Keys left unordered are entangled in a reference cycle. Shared by definition
 * creates (keys = types) and entry creates (keys = "type/handle"). [design §7]
 */
export function topoSort(types: Set<string>, deps: Map<string, Set<string>>): { ordered: string[]; unordered: string[] } {
  const remaining = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const t of types) {
    const d = deps.get(t) ?? new Set<string>();
    remaining.set(t, d.size);
    for (const dep of d) {
      const list = dependents.get(dep) ?? [];
      list.push(t);
      dependents.set(dep, list);
    }
  }

  const queue: string[] = [];
  for (const t of types) if ((remaining.get(t) ?? 0) === 0) queue.push(t);

  const ordered: string[] = [];
  while (queue.length) {
    const t = queue.shift() as string;
    ordered.push(t);
    for (const dependent of dependents.get(t) ?? []) {
      const r = (remaining.get(dependent) ?? 0) - 1;
      remaining.set(dependent, r);
      if (r === 0) queue.push(dependent);
    }
  }

  const orderedSet = new Set(ordered);
  return { ordered, unordered: [...types].filter((t) => !orderedSet.has(t)) };
}

/**
 * Applies a `diff()` plan to a store. Safe ops run; destructive ops are skipped
 * unless `allowDestructive`. Per-op `userErrors` become `failed` entries (never
 * thrown); only transport / top-level GraphQL errors propagate. [design §7, §8]
 *
 * Create ops run in dependency order (a referenced type before its referencer);
 * types entangled in a reference cycle are created two-pass — created with the
 * cycle-breaking ref fields stripped, then updated to add them once every member
 * exists. Results are returned in plan order; client calls happen in execution
 * order. [design §7]
 */
export async function push(
  client: AdminGraphQLClient,
  plan: DiffOp[],
  sources: { definitions: MetaobjectDefinitionInput[]; remote: PulledRemote[] },
  options?: PushOptions,
): Promise<PushResult> {
  const allowDestructive = options?.allowDestructive ?? false;
  const defByType = new Map(sources.definitions.map((d) => [d.type, d]));
  const idByType = new Map(sources.remote.map((r) => [r.type, r.id]));

  const indexed = plan.map((op, index) => ({ op, index }));
  const createOps = indexed.filter((x) => x.op.kind === "createDefinition");
  const otherOps = indexed.filter((x) => x.op.kind !== "createDefinition");
  const createTypes = new Set(createOps.map((x) => x.op.type));

  // Dependency edges among the types being created this run. Self-edges are
  // excluded: a self-referential definition creates normally rather than being
  // flagged a length-1 cycle (deliberate; the spec does not address it).
  const deps = new Map<string, Set<string>>();
  for (const { op } of createOps) {
    const def = defByType.get(op.type);
    const targets = def ? referenceEdges(def) : [];
    deps.set(op.type, new Set(targets.filter((t) => createTypes.has(t) && t !== op.type)));
  }

  const { ordered, unordered } = topoSort(createTypes, deps);
  const cyclicTypes = new Set(unordered);
  const createByType = new Map(createOps.map((x) => [x.op.type, x]));

  // Types whose create this run failed or was blocked — their dependents block too.
  const failedTypes = new Set<string>();

  /**
   * Field input with merchant-scope ref targets resolved to definition GIDs at send
   * time — `idByType` holds pulled ids plus ids captured from creates earlier this
   * run (creates are dependency-first, so a same-run target's id exists by then).
   */
  function resolveFieldRefs(f: FieldDefinitionInput): FieldDefinitionInput {
    return { ...f, validations: refValidationsToIds(f.validations, idByType) };
  }

  /** Run a `metaobjectDefinitionCreate` for `definition`, recording the new id or failure. */
  async function createDefinition(op: DiffOp, definition: MetaobjectDefinitionInput): Promise<PushOpResult> {
    const data = await execute<{ metaobjectDefinitionCreate: MutationPayload }>(client, CREATE_DEFINITION_MUTATION, {
      definition: { ...definition, fieldDefinitions: definition.fieldDefinitions.map(resolveFieldRefs) },
    });
    const payload = data.metaobjectDefinitionCreate;
    if (payload.userErrors.length) {
      failedTypes.add(op.type);
      return { op, status: "failed", userErrors: payload.userErrors };
    }
    const id = payload.metaobjectDefinition?.id;
    if (id) idByType.set(op.type, id);
    return { op, status: "applied", id };
  }

  /** Create an acyclic definition (full field set), blocking on a failed dependency. */
  async function applyAcyclicCreate(op: DiffOp): Promise<PushOpResult> {
    for (const dep of deps.get(op.type) ?? []) {
      if (failedTypes.has(dep)) {
        failedTypes.add(op.type);
        return { op, status: "blocked", reason: `blocked: dependency "${dep}" was not created` };
      }
    }
    const def = defByType.get(op.type);
    if (!def) {
      failedTypes.add(op.type);
      return { op, status: "blocked", reason: `no definition input for "${op.type}"` };
    }
    return createDefinition(op, def);
  }

  /** Apply a non-create op (field add/update/remove, definition update). [design §7, §8] */
  async function applyFieldOp(op: DiffOp): Promise<PushOpResult> {
    const destructive = "destructive" in op && op.destructive === true;
    if (destructive && !allowDestructive) return { op, status: "skipped", reason: "destructive" };

    if (failedTypes.has(op.type)) return { op, status: "blocked", reason: `blocked: definition "${op.type}" was not created` };

    const id = idByType.get(op.type);
    if (id == null) return { op, status: "blocked", reason: `no definition id for "${op.type}"` };

    let definition: { fieldDefinitions: FieldOpInput[] } | DefinitionUpdateInput;
    if (op.kind === "updateDefinition") {
      const def = defByType.get(op.type);
      if (!def) return { op, status: "blocked", reason: `no definition input for "${op.type}"` };
      definition = definitionUpdateFor(def, op.changes);
    } else {
      const fieldDefinitions = fieldOpsFor(op);
      if (!fieldDefinitions) return { op, status: "blocked", reason: `no field input for "${op.type}"` };
      definition = { fieldDefinitions };
    }

    const data = await execute<{ metaobjectDefinitionUpdate: MutationPayload }>(client, UPDATE_DEFINITION_MUTATION, { id, definition });
    const payload = data.metaobjectDefinitionUpdate;
    if (payload.userErrors.length) return { op, status: "failed", userErrors: payload.userErrors };
    return { op, status: "applied", id: payload.metaobjectDefinition?.id ?? id };
  }

  /** Builds the `fieldDefinitions` tagged-union ops for a field-level diff op. [design §7] */
  function fieldOpsFor(op: DiffOp): FieldOpInput[] | undefined {
    switch (op.kind) {
      case "addField": {
        const field = fieldInputFor(defByType, op.type, op.field.key);
        return field ? [{ create: resolveFieldRefs(field) }] : undefined;
      }
      case "updateField": {
        const field = fieldInputFor(defByType, op.type, op.key);
        if (!field) return undefined;
        // `type` is immutable, so the update payload omits it. [design §7]
        const update: FieldUpdateInput = {
          key: field.key,
          name: field.name,
          required: field.required,
          validations: refValidationsToIds(field.validations, idByType),
        };
        if (field.description != null) update.description = field.description;
        // Reconcile `adminFilterable` only when the field's filter state drifted. [design §8]
        if ("filterable" in op.changes) {
          update.capabilities = { adminFilterable: { enabled: op.changes.filterable ?? false } };
        }
        return [{ update }];
      }
      case "removeField":
        return [{ delete: { key: op.key } }];
      case "changeFieldType": {
        const field = fieldInputFor(defByType, op.type, op.key);
        return field ? [{ delete: { key: op.key } }, { create: resolveFieldRefs(field) }] : undefined;
      }
      default:
        return undefined;
    }
  }

  // Record each result at its original plan index so `results` aligns with the caller's plan.
  const results: PushOpResult[] = new Array(plan.length);

  // Phase A: acyclic creates, dependency-first (a referenced type before its referencer).
  for (const type of ordered) {
    const entry = createByType.get(type) as { op: DiffOp; index: number };
    results[entry.index] = await applyAcyclicCreate(entry.op);
  }

  // Cyclic definitions can't be ordered: create each with the cycle-breaking ref fields
  // stripped (pass 1), then add those fields once every member exists (pass 2). [design §7]
  const cyclicCreates = createOps.filter((x) => cyclicTypes.has(x.op.type));
  const deferredByType = new Map<string, FieldDefinitionInput[]>();

  // Phase B: pass-1 reduced creates.
  for (const { op, index } of cyclicCreates) {
    const def = defByType.get(op.type);
    if (!def) {
      failedTypes.add(op.type);
      results[index] = { op, status: "blocked", reason: `no definition input for "${op.type}"` };
      continue;
    }
    // A non-cyclic dependency lives in the pass-1 field set, so its failure blocks the create.
    const failedDep = [...(deps.get(op.type) ?? [])].find((d) => !cyclicTypes.has(d) && failedTypes.has(d));
    if (failedDep) {
      failedTypes.add(op.type);
      results[index] = { op, status: "blocked", reason: `blocked: dependency "${failedDep}" was not created` };
      continue;
    }
    const { pass1, deferred } = splitCyclicFields(def, cyclicTypes);
    deferredByType.set(op.type, deferred);
    results[index] = await createDefinition(op, { ...def, fieldDefinitions: pass1 });
  }

  // Phase C: pass-2 — add the deferred ref fields now that every cyclic member exists.
  for (const { op, index } of cyclicCreates) {
    if (results[index]?.status !== "applied") continue;
    const deferred = deferredByType.get(op.type) ?? [];
    if (!deferred.length) continue;
    const failedTarget = deferred.flatMap(fieldRefTargets).find((t) => failedTypes.has(t));
    if (failedTarget) {
      failedTypes.add(op.type);
      results[index] = { op, status: "blocked", reason: `blocked: dependency "${failedTarget}" was not created` };
      continue;
    }
    const id = idByType.get(op.type);
    if (id == null) {
      results[index] = { op, status: "blocked", reason: `no definition id for "${op.type}"` };
      continue;
    }
    const definition: { fieldDefinitions: FieldOpInput[] } = { fieldDefinitions: deferred.map((f) => ({ create: resolveFieldRefs(f) })) };
    const data = await execute<{ metaobjectDefinitionUpdate: MutationPayload }>(client, UPDATE_DEFINITION_MUTATION, { id, definition });
    const payload = data.metaobjectDefinitionUpdate;
    if (payload.userErrors.length) {
      failedTypes.add(op.type);
      results[index] = { op, status: "failed", userErrors: payload.userErrors };
    }
  }

  // Phase D: all other ops last — they may add fields/refs targeting a type created above.
  for (const { op, index } of otherOps) results[index] = await applyFieldOp(op);

  const counts = { applied: 0, skipped: 0, blocked: 0, failed: 0 };
  for (const r of results) counts[r.status]++;
  return { results, counts, ok: counts.failed === 0 && counts.blocked === 0 };
}
