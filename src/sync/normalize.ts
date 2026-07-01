import type { MetaobjectSchema } from "../define";
import type { FieldMap } from "../infer";
import type { FieldValidation } from "../fields/base";
import type { MetaobjectDefinitionInput } from "../definition-input";

export interface RemoteField {
  key: string;
  type: string;
  required: boolean;
  validations: FieldValidation[];
}
export interface RemoteDefinition {
  type: string;
  name?: string;
  fields: RemoteField[];
}

/** Normalize a (already scope-resolved) definition input to the diff shape. */
export function normalizeDefinition(def: MetaobjectDefinitionInput): RemoteDefinition {
  return {
    type: def.type,
    name: def.name,
    fields: def.fieldDefinitions.map((f) => ({
      key: f.key,
      type: f.type,
      required: f.required,
      validations: f.validations,
    })),
  };
}

export function normalizeLocal<F extends FieldMap>(schema: MetaobjectSchema<F>): RemoteDefinition {
  return normalizeDefinition(schema.toDefinitionInput());
}

export interface PulledFieldDefinition {
  key: string;
  type: { name: string } | string;
  required: boolean;
  validations?: FieldValidation[];
}
export interface PulledDefinition {
  type: string;
  name?: string;
  fieldDefinitions: PulledFieldDefinition[];
}

export function normalizeRemote(def: PulledDefinition): RemoteDefinition {
  return {
    type: def.type,
    name: def.name,
    fields: def.fieldDefinitions.map((f) => ({
      key: f.key,
      type: typeof f.type === "string" ? f.type : f.type.name,
      required: f.required,
      validations: f.validations ?? [],
    })),
  };
}
