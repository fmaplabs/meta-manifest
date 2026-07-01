import type { MetaobjectSchema } from "../define";
import type { FieldMap } from "../infer";
import type { FieldValidation } from "../fields/base";
import type { CapabilitiesInput, MetaobjectDefinitionInput } from "../definition-input";

export interface RemoteAccess {
  admin?: string;
  storefront?: string;
  customerAccount?: string;
}
/** Normalized capability comparison shape. `enabled` is compared for every capability
 * present locally; `data` keys are compared only when locally declared. [design §8] */
export interface RemoteRenderable {
  enabled: boolean;
  data?: { metaTitleKey?: string; metaDescriptionKey?: string };
}
export interface RemoteOnlineStore {
  enabled: boolean;
  data?: { urlHandle?: string };
}
export interface RemoteCapabilities {
  publishable?: { enabled: boolean };
  translatable?: { enabled: boolean };
  renderable?: RemoteRenderable;
  onlineStore?: RemoteOnlineStore;
}
export interface RemoteField {
  key: string;
  type: string;
  required: boolean;
  filterable: boolean;
  validations: FieldValidation[];
}
export interface RemoteDefinition {
  type: string;
  name?: string;
  description?: string;
  displayNameKey?: string;
  access?: RemoteAccess;
  capabilities?: RemoteCapabilities;
  fields: RemoteField[];
}

/** Local capabilities: declared ones plus `onlineStore` (absence disables — decision 4). */
function localCapabilities(caps: CapabilitiesInput | undefined): RemoteCapabilities {
  const out: RemoteCapabilities = {};
  if (caps?.publishable) out.publishable = { enabled: caps.publishable.enabled };
  if (caps?.translatable) out.translatable = { enabled: caps.translatable.enabled };
  if (caps?.renderable) {
    out.renderable = { enabled: caps.renderable.enabled };
    if (caps.renderable.data) out.renderable.data = { ...caps.renderable.data };
  }
  out.onlineStore = caps?.onlineStore
    ? { enabled: caps.onlineStore.enabled, data: { urlHandle: caps.onlineStore.data?.urlHandle } }
    : { enabled: false };
  return out;
}

/** Normalize a (already scope-resolved) definition input to the diff shape. */
export function normalizeDefinition(def: MetaobjectDefinitionInput): RemoteDefinition {
  const out: RemoteDefinition = {
    type: def.type,
    name: def.name,
    capabilities: localCapabilities(def.capabilities),
    fields: def.fieldDefinitions.map((f) => ({
      key: f.key,
      type: f.type,
      required: f.required,
      filterable: f.capabilities?.adminFilterable?.enabled ?? false,
      validations: f.validations,
    })),
  };
  if (def.description != null) out.description = def.description;
  if (def.displayNameKey != null) out.displayNameKey = def.displayNameKey;
  if (def.access) out.access = { ...def.access };
  return out;
}

export function normalizeLocal<F extends FieldMap>(schema: MetaobjectSchema<F>): RemoteDefinition {
  return normalizeDefinition(schema.toDefinitionInput());
}

export interface PulledFieldDefinition {
  key: string;
  type: { name: string } | string;
  required: boolean;
  validations?: FieldValidation[];
  capabilities?: { adminFilterable?: { enabled: boolean } | null } | null;
}
export interface PulledAccess {
  admin?: string | null;
  storefront?: string | null;
  customerAccount?: string | null;
}
export interface PulledCapabilities {
  publishable?: { enabled: boolean } | null;
  translatable?: { enabled: boolean } | null;
  renderable?: { enabled: boolean; data?: { metaTitleKey?: string | null; metaDescriptionKey?: string | null } | null } | null;
  onlineStore?: { enabled: boolean; data?: { urlHandle?: string | null } | null } | null;
}
export interface PulledDefinition {
  type: string;
  name?: string;
  description?: string | null;
  displayNameKey?: string | null;
  access?: PulledAccess | null;
  capabilities?: PulledCapabilities | null;
  fieldDefinitions: PulledFieldDefinition[];
}

function remoteAccess(access: PulledAccess | null | undefined): RemoteAccess | undefined {
  if (!access) return undefined;
  const out: RemoteAccess = {};
  if (access.admin != null) out.admin = access.admin;
  if (access.storefront != null) out.storefront = access.storefront;
  if (access.customerAccount != null) out.customerAccount = access.customerAccount;
  return out;
}

function remoteCapabilities(caps: PulledCapabilities | null | undefined): RemoteCapabilities {
  const out: RemoteCapabilities = {};
  if (!caps) return out;
  if (caps.publishable) out.publishable = { enabled: !!caps.publishable.enabled };
  if (caps.translatable) out.translatable = { enabled: !!caps.translatable.enabled };
  if (caps.renderable) {
    out.renderable = { enabled: !!caps.renderable.enabled };
    const d = caps.renderable.data;
    if (d) {
      const data: { metaTitleKey?: string; metaDescriptionKey?: string } = {};
      if (d.metaTitleKey != null) data.metaTitleKey = d.metaTitleKey;
      if (d.metaDescriptionKey != null) data.metaDescriptionKey = d.metaDescriptionKey;
      if (Object.keys(data).length) out.renderable.data = data;
    }
  }
  if (caps.onlineStore) {
    out.onlineStore = { enabled: !!caps.onlineStore.enabled };
    if (caps.onlineStore.data?.urlHandle != null) out.onlineStore.data = { urlHandle: caps.onlineStore.data.urlHandle };
  }
  return out;
}

export function normalizeRemote(def: PulledDefinition): RemoteDefinition {
  const out: RemoteDefinition = {
    type: def.type,
    name: def.name,
    capabilities: remoteCapabilities(def.capabilities),
    fields: def.fieldDefinitions.map((f) => ({
      key: f.key,
      type: typeof f.type === "string" ? f.type : f.type.name,
      required: f.required,
      filterable: f.capabilities?.adminFilterable?.enabled ?? false,
      validations: f.validations ?? [],
    })),
  };
  if (def.description != null) out.description = def.description;
  if (def.displayNameKey != null) out.displayNameKey = def.displayNameKey;
  const access = remoteAccess(def.access);
  if (access) out.access = access;
  return out;
}
