import type { AccessConfig, CapabilitiesConfig, MetaobjectSchema } from "./define";
import type { FieldMap } from "./infer";
import type { FieldValidation } from "./fields/base";

export interface FieldCapabilitiesInput {
  adminFilterable?: { enabled: boolean };
}
export interface FieldDefinitionInput {
  key: string;
  name: string;
  description?: string;
  required: boolean;
  type: string;
  validations: FieldValidation[];
  capabilities?: FieldCapabilitiesInput;
}

export interface AccessInput {
  admin?: string;
  storefront?: string;
  customerAccount?: string;
}
export interface RenderableData {
  metaTitleKey?: string;
  metaDescriptionKey?: string;
}
export interface OnlineStoreData {
  urlHandle: string;
  createRedirects?: boolean;
}
export interface CapabilitiesInput {
  publishable?: { enabled: boolean };
  translatable?: { enabled: boolean };
  renderable?: { enabled: boolean; data?: RenderableData };
  onlineStore?: { enabled: boolean; data?: OnlineStoreData };
}
export interface MetaobjectDefinitionInput {
  type: string;
  name: string;
  description?: string;
  displayNameKey?: string;
  access?: AccessInput;
  capabilities?: CapabilitiesInput;
  fieldDefinitions: FieldDefinitionInput[];
}

function mapAccess(access?: AccessConfig): AccessInput | undefined {
  if (!access) return undefined;
  const out: AccessInput = {};
  if (access.admin) out.admin = access.admin.toUpperCase();
  if (access.storefront) out.storefront = access.storefront.toUpperCase();
  if (access.customerAccount) out.customerAccount = access.customerAccount.toUpperCase();
  return out;
}

function mapCapabilities(caps?: CapabilitiesConfig): CapabilitiesInput | undefined {
  if (!caps) return undefined;
  const out: CapabilitiesInput = {};
  if (caps.publishable != null) out.publishable = { enabled: caps.publishable };
  if (caps.translatable != null) out.translatable = { enabled: caps.translatable };
  if (caps.renderable != null) {
    if (typeof caps.renderable === "boolean") {
      out.renderable = { enabled: caps.renderable };
    } else {
      const data: RenderableData = {};
      if (caps.renderable.metaTitleKey != null) data.metaTitleKey = caps.renderable.metaTitleKey;
      if (caps.renderable.metaDescriptionKey != null) data.metaDescriptionKey = caps.renderable.metaDescriptionKey;
      out.renderable = Object.keys(data).length ? { enabled: true, data } : { enabled: true };
    }
  }
  if (caps.onlineStore != null) {
    const data: OnlineStoreData = { urlHandle: caps.onlineStore.urlHandle };
    if (caps.onlineStore.createRedirects != null) data.createRedirects = caps.onlineStore.createRedirects;
    out.onlineStore = { enabled: true, data };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Throws if a `renderable` SEO key doesn't name a declared field. [design §10] */
function validateSeoKeys(caps: CapabilitiesConfig | undefined, fieldKeys: Set<string>, name: string): void {
  const r = caps?.renderable;
  if (!r || typeof r === "boolean") return;
  for (const prop of ["metaTitleKey", "metaDescriptionKey"] as const) {
    const key = r[prop];
    if (key != null && !fieldKeys.has(key)) {
      throw new Error(`renderable.${prop} "${key}" is not a declared field key on "${name}".`);
    }
  }
}

export function toDefinitionInput<F extends FieldMap>(schema: MetaobjectSchema<F>): MetaobjectDefinitionInput {
  const { config } = schema;
  validateSeoKeys(config.capabilities, new Set(Object.keys(schema.fields)), config.name);

  const fieldDefinitions: FieldDefinitionInput[] = Object.entries(schema.fields).map(([key, field]) => {
    const def: FieldDefinitionInput = {
      key,
      name: field.name ?? key,
      required: field.required,
      type: field.shopifyType,
      validations: field.validations(),
    };
    if (field.description != null) def.description = field.description;
    if (field.filterable) def.capabilities = { adminFilterable: { enabled: true } };
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
