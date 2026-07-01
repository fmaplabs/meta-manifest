import type { FieldValidation } from "../fields/base";
import type { FieldDefinitionInput, MetaobjectDefinitionInput } from "../definition-input";
import { CREATE_DEFINITION_MUTATION, execute, UPDATE_DEFINITION_MUTATION, type AdminGraphQLClient } from "./client";
import type { DiffOp } from "./diff";
import type { PulledRemote } from "./pull";

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
type FieldOpInput =
  | { create: FieldDefinitionInput }
  | { update: { key: string; name: string; description?: string; required: boolean; validations: FieldValidation[] } }
  | { delete: { key: string } };

/** The full local field input for a field, used to build create/update payloads. [design §7] */
function fieldInputFor(
  defByType: Map<string, MetaobjectDefinitionInput>,
  type: string,
  key: string,
): FieldDefinitionInput | undefined {
  return defByType.get(type)?.fieldDefinitions.find((f) => f.key === key);
}

/**
 * The `$app:` types a definition references, read from each field's
 * `metaobject_definition_type` (single) and `metaobject_definition_types` (JSON
 * array) validations. These are the dependency edges for create ordering. [design §7]
 */
export function referenceEdges(def: MetaobjectDefinitionInput): string[] {
  const out: string[] = [];
  for (const field of def.fieldDefinitions) {
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
  }
  return out;
}

/**
 * Kahn's topological sort: returns create `types` in dependency-first order.
 * Types left unordered are entangled in a reference cycle. [design §7]
 */
function topoSortCreates(types: Set<string>, deps: Map<string, Set<string>>): { ordered: string[]; unordered: string[] } {
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
 * types in a reference cycle are `blocked`. Results are returned in plan order;
 * client calls happen in execution order. [design §7]
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

  const { ordered, unordered } = topoSortCreates(createTypes, deps);
  const orderedSet = new Set(ordered);
  const cyclicTypes = new Set(unordered);
  const createByType = new Map(createOps.map((x) => [x.op.type, x]));
  const execOrder = [
    ...ordered.map((t) => createByType.get(t) as { op: DiffOp; index: number }),
    ...createOps.filter((x) => !orderedSet.has(x.op.type)),
    ...otherOps,
  ];

  // Types whose create this run failed or was blocked — their dependents block too.
  const failedTypes = new Set<string>();

  async function applyOp(op: DiffOp): Promise<PushOpResult> {
    if (op.kind === "createDefinition") {
      if (cyclicTypes.has(op.type)) {
        failedTypes.add(op.type);
        return { op, status: "blocked", reason: "reference cycle — two-pass create deferred" };
      }
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
      const data = await execute<{ metaobjectDefinitionCreate: MutationPayload }>(client, CREATE_DEFINITION_MUTATION, { definition: def });
      const payload = data.metaobjectDefinitionCreate;
      if (payload.userErrors.length) {
        failedTypes.add(op.type);
        return { op, status: "failed", userErrors: payload.userErrors };
      }
      const id = payload.metaobjectDefinition?.id;
      if (id) idByType.set(op.type, id);
      return { op, status: "applied", id };
    }

    const destructive = op.kind === "removeField" || op.kind === "changeFieldType";
    if (destructive && !allowDestructive) return { op, status: "skipped", reason: "destructive" };

    if (failedTypes.has(op.type)) return { op, status: "blocked", reason: `blocked: definition "${op.type}" was not created` };

    const id = idByType.get(op.type);
    if (id == null) return { op, status: "blocked", reason: `no definition id for "${op.type}"` };

    const fieldDefinitions = fieldOpsFor(op);
    if (!fieldDefinitions) return { op, status: "blocked", reason: `no field input for "${op.type}"` };

    const data = await execute<{ metaobjectDefinitionUpdate: MutationPayload }>(client, UPDATE_DEFINITION_MUTATION, { id, definition: { fieldDefinitions } });
    const payload = data.metaobjectDefinitionUpdate;
    if (payload.userErrors.length) return { op, status: "failed", userErrors: payload.userErrors };
    return { op, status: "applied", id: payload.metaobjectDefinition?.id ?? id };
  }

  /** Builds the `fieldDefinitions` tagged-union ops for a field-level diff op. [design §7] */
  function fieldOpsFor(op: DiffOp): FieldOpInput[] | undefined {
    switch (op.kind) {
      case "addField": {
        const field = fieldInputFor(defByType, op.type, op.field.key);
        return field ? [{ create: field }] : undefined;
      }
      case "updateField": {
        const field = fieldInputFor(defByType, op.type, op.key);
        if (!field) return undefined;
        // `type` is immutable, so the update payload omits it. [design §7]
        const update: { key: string; name: string; description?: string; required: boolean; validations: FieldValidation[] } = {
          key: field.key,
          name: field.name,
          required: field.required,
          validations: field.validations,
        };
        if (field.description != null) update.description = field.description;
        return [{ update }];
      }
      case "removeField":
        return [{ delete: { key: op.key } }];
      case "changeFieldType": {
        const field = fieldInputFor(defByType, op.type, op.key);
        return field ? [{ delete: { key: op.key } }, { create: field }] : undefined;
      }
      default:
        return undefined;
    }
  }

  // Execute in dependency order; record each result at its original plan index so
  // the returned `results` align with the caller's plan. [design §7]
  const results: PushOpResult[] = new Array(plan.length);
  for (const { op, index } of execOrder) results[index] = await applyOp(op);

  const counts = { applied: 0, skipped: 0, blocked: 0, failed: 0 };
  for (const r of results) counts[r.status]++;
  return { results, counts, ok: counts.failed === 0 && counts.blocked === 0 };
}
