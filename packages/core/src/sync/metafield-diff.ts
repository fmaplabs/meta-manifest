import type { FieldValidation } from "../fields/base";
import type { MetafieldOwnerType } from "../metafields";
import type { MetafieldPair, PulledMetafieldDefinition } from "./metafield-pull";
import type { LocalMetafieldDefinition, MetafieldAccess, MetafieldCapabilities } from "./resolve";

/** Definition properties `updateMetafield` reconciles. */
export type MetafieldChange = "name" | "description" | "validations" | "access" | "capabilities" | "pin";

/** One metafield-definition op, identified by `(ownerType, namespace, key)`. [design §5] */
export type MetafieldOp =
  | { kind: "createMetafield"; ownerType: MetafieldOwnerType; namespace: string; key: string }
  | { kind: "updateMetafield"; ownerType: MetafieldOwnerType; namespace: string; key: string; changes: MetafieldChange[] }
  | { kind: "changeMetafieldType"; ownerType: MetafieldOwnerType; namespace: string; key: string; from: string; to: string; destructive: true }
  | { kind: "removeMetafield"; ownerType: MetafieldOwnerType; namespace: string; key: string; destructive: true };

const keyOf = (d: { ownerType: string; namespace: string; key: string }) => `${d.ownerType}/${d.namespace}/${d.key}`;

function sameValidations(a: FieldValidation[], b: FieldValidation[]): boolean {
  const norm = (v: FieldValidation[]) => JSON.stringify([...v].sort((x, y) => x.name.localeCompare(y.name)));
  return norm(a) === norm(b);
}

/** Access changed only where the local side declares a value (undeclared = unmanaged). [design §7] */
function accessChanged(local: MetafieldAccess, remote: MetafieldAccess | undefined): boolean {
  for (const key of ["admin", "storefront", "customerAccount"] as const) {
    const lv = local[key];
    if (lv != null && remote?.[key] !== lv) return true;
  }
  return false;
}

/** Both sides are materialized `{enabled}`, so "was on, now off" compares directly. [design §7] */
function capabilitiesChanged(local: MetafieldCapabilities, remote: MetafieldCapabilities): boolean {
  for (const key of ["adminFilterable", "smartCollectionCondition", "uniqueValues"] as const) {
    if (local[key].enabled !== remote[key].enabled) return true;
  }
  return false;
}

function changesFor(local: LocalMetafieldDefinition, remote: PulledMetafieldDefinition): MetafieldChange[] {
  const changes: MetafieldChange[] = [];
  if (local.name !== remote.name) changes.push("name");
  if (local.description != null && local.description !== remote.description) changes.push("description");
  if (!sameValidations(local.validations, remote.validations)) changes.push("validations");
  if (local.access && accessChanged(local.access, remote.access)) changes.push("access");
  if (capabilitiesChanged(local.capabilities, remote.capabilities)) changes.push("capabilities");
  if (local.pin !== remote.pin) changes.push("pin");
  return changes;
}

/**
 * Compare resolved local definitions against the pulled remote state, keyed by
 * `(ownerType, namespace, key)`. `pairs` — the declared `(ownerType, namespace)`
 * pairs — bound the remove scope: remote-only definitions outside them are
 * unmanaged and never touched, even if present in `remote`. [design §7, §8]
 */
export function diffMetafields(
  local: LocalMetafieldDefinition[],
  remote: PulledMetafieldDefinition[],
  pairs: readonly MetafieldPair[],
): MetafieldOp[] {
  const ops: MetafieldOp[] = [];
  const remoteByKey = new Map(remote.map((d) => [keyOf(d), d]));
  const localKeys = new Set(local.map(keyOf));
  const declaredPairs = new Set(pairs.map((p) => `${p.ownerType}/${p.namespace}`));

  for (const l of local) {
    const id = { ownerType: l.ownerType, namespace: l.namespace, key: l.key };
    const r = remoteByKey.get(keyOf(l));
    if (!r) {
      ops.push({ kind: "createMetafield", ...id });
      continue;
    }
    if (r.type !== l.type) {
      ops.push({ kind: "changeMetafieldType", ...id, from: r.type, to: l.type, destructive: true });
      continue;
    }
    const changes = changesFor(l, r);
    if (changes.length) ops.push({ kind: "updateMetafield", ...id, changes });
  }

  for (const r of remote) {
    if (localKeys.has(keyOf(r))) continue;
    if (!declaredPairs.has(`${r.ownerType}/${r.namespace}`)) continue;
    ops.push({ kind: "removeMetafield", ownerType: r.ownerType, namespace: r.namespace, key: r.key, destructive: true });
  }

  return ops;
}
