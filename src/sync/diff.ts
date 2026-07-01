import type { FieldValidation } from "../fields/base";
import type { RemoteDefinition, RemoteField } from "./normalize";

export type DiffOp =
  | { kind: "createDefinition"; type: string; definition: RemoteDefinition }
  | { kind: "addField"; type: string; field: RemoteField }
  | { kind: "updateField"; type: string; key: string; changes: Partial<RemoteField> }
  | { kind: "changeFieldType"; type: string; key: string; from: string; to: string; destructive: true }
  | { kind: "removeField"; type: string; key: string; destructive: true };

function sameValidations(a: FieldValidation[], b: FieldValidation[]): boolean {
  const norm = (v: FieldValidation[]) => JSON.stringify([...v].sort((x, y) => x.name.localeCompare(y.name)));
  return norm(a) === norm(b);
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
  }

  return ops;
}
