import type { AccessConfig, CapabilitiesConfig, MetaobjectSchema } from "./define";
import type { FieldMap } from "./infer";
import type { FieldValidation } from "./fields/base";

export interface FieldDefinitionInput {
  key: string;
  name: string;
  description?: string;
  required: boolean;
  type: string;
  validations: FieldValidation[];
}
export interface MetaobjectDefinitionInput {
  type: string;
  name: string;
  description?: string;
  displayNameKey?: string;
  access?: { admin?: string; storefront?: string };
  capabilities?: Record<string, { enabled: boolean }>;
  fieldDefinitions: FieldDefinitionInput[];
}

function mapAccess(access?: AccessConfig): MetaobjectDefinitionInput["access"] {
  if (!access) return undefined;
  const out: { admin?: string; storefront?: string } = {};
  if (access.admin) out.admin = access.admin.toUpperCase();
  if (access.storefront) out.storefront = access.storefront.toUpperCase();
  return out;
}

function mapCapabilities(caps?: CapabilitiesConfig): MetaobjectDefinitionInput["capabilities"] {
  if (!caps) return undefined;
  const out: Record<string, { enabled: boolean }> = {};
  for (const [k, v] of Object.entries(caps)) if (v != null) out[k] = { enabled: v };
  return Object.keys(out).length ? out : undefined;
}

export function toDefinitionInput<F extends FieldMap>(schema: MetaobjectSchema<F>): MetaobjectDefinitionInput {
  const { config } = schema;
  const fieldDefinitions: FieldDefinitionInput[] = Object.entries(schema.fields).map(([key, field]) => {
    const def: FieldDefinitionInput = {
      key,
      name: field.name ?? key,
      required: field.required,
      type: field.shopifyType,
      validations: field.validations(),
    };
    if (field.description != null) def.description = field.description;
    return def;
  });

  const out: MetaobjectDefinitionInput = {
    type: schema.type,
    name: config.name,
    fieldDefinitions,
  };
  if (config.description != null) out.description = config.description;
  if (config.displayName != null) out.displayNameKey = config.displayName;
  const access = mapAccess(config.access);
  if (access) out.access = access;
  const capabilities = mapCapabilities(config.capabilities);
  if (capabilities) out.capabilities = capabilities;
  return out;
}
