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
 * Applies a `diff()` plan to a store. Safe ops run; destructive ops are skipped
 * unless `allowDestructive`. Per-op `userErrors` become `failed` entries (never
 * thrown); only transport / top-level GraphQL errors propagate. [design §7, §8]
 *
 * This phase assumes `plan` is already in a runnable order — dependency ordering
 * and cycle handling are layered on separately.
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

  async function applyOp(op: DiffOp): Promise<PushOpResult> {
    if (op.kind === "createDefinition") {
      const def = defByType.get(op.type);
      if (!def) return { op, status: "blocked", reason: `no definition input for "${op.type}"` };
      const data = await execute<{ metaobjectDefinitionCreate: MutationPayload }>(client, CREATE_DEFINITION_MUTATION, { definition: def });
      const payload = data.metaobjectDefinitionCreate;
      if (payload.userErrors.length) return { op, status: "failed", userErrors: payload.userErrors };
      const id = payload.metaobjectDefinition?.id;
      if (id) idByType.set(op.type, id);
      return { op, status: "applied", id };
    }

    const destructive = op.kind === "removeField" || op.kind === "changeFieldType";
    if (destructive && !allowDestructive) return { op, status: "skipped", reason: "destructive" };

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

  const results: PushOpResult[] = [];
  for (const op of plan) results.push(await applyOp(op));

  const counts = { applied: 0, skipped: 0, blocked: 0, failed: 0 };
  for (const r of results) counts[r.status]++;
  return { results, counts, ok: counts.failed === 0 && counts.blocked === 0 };
}
