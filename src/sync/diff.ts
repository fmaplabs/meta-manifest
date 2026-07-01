import type { FieldValidation } from "../fields/base";
import type { RemoteAccess, RemoteCapabilities, RemoteDefinition, RemoteField } from "./normalize";

/** Definition-level metadata that `updateDefinition` reconciles. */
export type DefinitionChange = "name" | "description" | "displayNameKey" | "access" | "capabilities";

export type DiffOp =
  | { kind: "createDefinition"; type: string; definition: RemoteDefinition }
  | { kind: "updateDefinition"; type: string; changes: DefinitionChange[]; destructive?: true }
  | { kind: "addField"; type: string; field: RemoteField }
  | { kind: "updateField"; type: string; key: string; changes: Partial<RemoteField> }
  | { kind: "changeFieldType"; type: string; key: string; from: string; to: string; destructive: true }
  | { kind: "removeField"; type: string; key: string; destructive: true };

function sameValidations(a: FieldValidation[], b: FieldValidation[]): boolean {
  const norm = (v: FieldValidation[]) => JSON.stringify([...v].sort((x, y) => x.name.localeCompare(y.name)));
  return norm(a) === norm(b);
}

const CAP_KEYS = ["publishable", "translatable", "renderable", "onlineStore"] as const;

/** Access changed only where the local side declares a value (undeclared = unmanaged). [design §8] */
function accessChanged(local: RemoteAccess, remote: RemoteAccess | undefined): boolean {
  for (const key of ["admin", "storefront", "customerAccount"] as const) {
    const lv = local[key];
    if (lv != null && remote?.[key] !== lv) return true;
  }
  return false;
}

/**
 * A capability differs when its `enabled` flag differs (compared for every
 * capability present locally) or a locally-declared `data` key differs. Capabilities
 * absent locally are unmanaged and skipped; `onlineStore` is always present locally
 * (absence = disabled), so it is always compared. [design §8]
 */
function capabilitiesChanged(local: RemoteCapabilities, remote: RemoteCapabilities | undefined): boolean {
  for (const key of CAP_KEYS) {
    const lc = local[key];
    if (!lc) continue;
    const rc = remote?.[key];
    if ((rc?.enabled ?? false) !== lc.enabled) return true;
    const ldata = (lc as { data?: Record<string, string> }).data;
    if (ldata) {
      const rdata = (rc as { data?: Record<string, unknown> } | undefined)?.data;
      for (const [k, v] of Object.entries(ldata)) {
        if (v != null && rdata?.[k] !== v) return true;
      }
    }
  }
  return false;
}

/** Disabling online-store rendering removes live pages, so it is gated destructive. [design §8] */
function disablesOnlineStore(local: RemoteCapabilities, remote: RemoteCapabilities | undefined): boolean {
  return local.onlineStore?.enabled === false && remote?.onlineStore?.enabled === true;
}

/** The changed definition-level metadata fields (empty when nothing drifted). */
function definitionChanges(local: RemoteDefinition, remote: RemoteDefinition): DefinitionChange[] {
  const changes: DefinitionChange[] = [];
  if (local.name != null && local.name !== remote.name) changes.push("name");
  if (local.description != null && local.description !== remote.description) changes.push("description");
  if (local.displayNameKey != null && local.displayNameKey !== remote.displayNameKey) changes.push("displayNameKey");
  if (local.access && accessChanged(local.access, remote.access)) changes.push("access");
  if (local.capabilities && capabilitiesChanged(local.capabilities, remote.capabilities)) changes.push("capabilities");
  return changes;
}

export function diff(local: RemoteDefinition[], remote: RemoteDefinition[]): DiffOp[] {
  const ops: DiffOp[] = [];
  const remoteByType = new Map(remote.map((d) => [d.type, d]));

  for (const localDef of local) {
    const remoteDef = remoteByType.get(localDef.type);
    if (!remoteDef) {
      ops.push({ kind: "createDefinition", type: localDef.type, definition: localDef });
      continue;
    }
    const remoteFields = new Map(remoteDef.fields.map((f) => [f.key, f]));
    const localKeys = new Set(localDef.fields.map((f) => f.key));

    for (const lf of localDef.fields) {
      const rf = remoteFields.get(lf.key);
      if (!rf) {
        ops.push({ kind: "addField", type: localDef.type, field: lf });
        continue;
      }
      if (rf.type !== lf.type) {
        ops.push({ kind: "changeFieldType", type: localDef.type, key: lf.key, from: rf.type, to: lf.type, destructive: true });
        continue;
      }
      const changes: Partial<RemoteField> = {};
      if (rf.required !== lf.required) changes.required = lf.required;
      if (rf.filterable !== lf.filterable) changes.filterable = lf.filterable;
      if (!sameValidations(rf.validations, lf.validations)) changes.validations = lf.validations;
      if (Object.keys(changes).length) {
        ops.push({ kind: "updateField", type: localDef.type, key: lf.key, changes });
      }
    }

    for (const rf of remoteDef.fields) {
      if (!localKeys.has(rf.key)) {
        ops.push({ kind: "removeField", type: localDef.type, key: rf.key, destructive: true });
      }
    }

    const metaChanges = definitionChanges(localDef, remoteDef);
    if (metaChanges.length) {
      const destructive = localDef.capabilities
        ? disablesOnlineStore(localDef.capabilities, remoteDef.capabilities)
        : false;
      ops.push({
        kind: "updateDefinition",
        type: localDef.type,
        changes: metaChanges,
        ...(destructive ? { destructive: true as const } : {}),
      });
    }
  }

  return ops;
}
