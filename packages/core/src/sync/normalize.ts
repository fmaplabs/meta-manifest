import type { MetaobjectSchema } from "../define";
import type { FieldMap } from "../infer";
import type { FieldValidation } from "../fields/base";

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

export function normalizeLocal<F extends FieldMap>(schema: MetaobjectSchema<F>): RemoteDefinition {
  const def = schema.toDefinitionInput();
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

interface PulledFieldDefinition {
  key: string;
  type: { name: string } | string;
  required: boolean;
  validations?: FieldValidation[];
}
interface PulledDefinition {
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
