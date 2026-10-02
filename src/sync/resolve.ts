import type { Config } from "../config";
import type { MetaobjectSchema } from "../define";
import type { Field, FieldValidation } from "../fields/base";
import type { FieldDefinitionInput, MetaobjectDefinitionInput } from "../definition-input";
import { APP_NAMESPACE, type AnyMetafieldSet, type MetafieldOwnerType } from "../metafields";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = MetaobjectSchema<any>;

/** The subset of config that scope resolution reads. */
export type ScopeConfig = Pick<Config, "scope" | "merchantEditable">;

export type Scope = "app" | "merchant";

const APP_PREFIX = "$app:";

/** Per-metaobject `scope` → global `config.scope` → `"app"`. [design §6] */
function effectiveScope(schema: AnySchema, config: ScopeConfig): Scope {
  return schema.config.scope ?? config.scope ?? "app";
}

/** `$app:<handle>` for app scope, bare `<handle>` for merchant scope. [design §6] */
function effectiveType(handle: string, scope: Scope): string {
  return scope === "merchant" ? handle : `${APP_PREFIX}${handle}`;
}

/**
 * Rewrite a reference-target validation from the canonical `$app:<handle>` form
 * to the referenced metaobject's effective type. Handles both the single
 * `metaobject_definition_type` value and each element of the
 * `metaobject_definition_types` JSON array. [design §6]
 */
function rewriteReference(v: FieldValidation, effByCanonical: Map<string, string>): FieldValidation {
  if (v.name === "metaobject_definition_type") {
    const mapped = effByCanonical.get(v.value);
    return mapped ? { ...v, value: mapped } : v;
  }
  if (v.name === "metaobject_definition_types") {
    try {
      const parsed: unknown = JSON.parse(v.value);
      if (Array.isArray(parsed)) {
        const rewritten = parsed.map((t) => (typeof t === "string" ? (effByCanonical.get(t) ?? t) : t));
        return { ...v, value: JSON.stringify(rewritten) };
      }
    } catch {
      // Leave a malformed validation value untouched.
    }
  }
  return v;
}

/**
 * Resolve `access.admin` in place for a definition. App scope defaults from
 * `merchantEditable` when not set explicitly; merchant scope omits admin and
 * rejects an explicit admin (invalid on merchant-owned types). [design §6, §10]
 */
function resolveAdmin(out: MetaobjectDefinitionInput, handle: string, scope: Scope, config: ScopeConfig): void {
  const explicitAdmin = out.access?.admin;
  if (scope === "merchant") {
    if (explicitAdmin != null) {
      throw new Error(
        `"${handle}" is merchant-scoped but sets access.admin; admin access is only valid on app-scoped metaobjects.`,
      );
    }
    return;
  }
  if (explicitAdmin == null) {
    const admin = config.merchantEditable ? "MERCHANT_READ_WRITE" : "MERCHANT_READ";
    out.access = { ...out.access, admin };
  }
}

/** Canonical `$app:<handle>` → effective type for every schema, for reference rewriting. */
function effectiveTypes(schemas: AnySchema[], config: ScopeConfig): Map<string, string> {
  const effByCanonical = new Map<string, string>();
  for (const s of schemas) {
    effByCanonical.set(`${APP_PREFIX}${s.handle}`, effectiveType(s.handle, effectiveScope(s, config)));
  }
  return effByCanonical;
}

/**
 * Resolve each schema's canonical (`$app:`) definition input into the effective
 * input the sync pipeline pushes: definition `type` and reference targets are
 * rewritten to each metaobject's effective scope, and `access.admin` is resolved.
 * `schema.type` / `m.ref` public values are unchanged. [design §6]
 */
export function resolveDefinitions(schemas: AnySchema[], config: ScopeConfig = {}): MetaobjectDefinitionInput[] {
  // Pass 1: canonical `$app:<handle>` → effective type, for reference rewriting.
  const effByCanonical = effectiveTypes(schemas, config);

  return schemas.map((s) => {
    const scope = effectiveScope(s, config);
    const base = s.toDefinitionInput();
    const fieldDefinitions: FieldDefinitionInput[] = base.fieldDefinitions.map((f) => ({
      ...f,
      validations: f.validations.map((v) => rewriteReference(v, effByCanonical)),
    }));
    const out: MetaobjectDefinitionInput = { ...base, type: effectiveType(s.handle, scope), fieldDefinitions };
    resolveAdmin(out, s.handle, scope, config);
    return out;
  });
}

/** Normalized `{enabled}` state for every metafield capability (absent = disabled). [design §7] */
export interface MetafieldCapabilities {
  adminFilterable: { enabled: boolean };
  smartCollectionCondition: { enabled: boolean };
  uniqueValues: { enabled: boolean };
}

export interface MetafieldAccess {
  admin?: string;
  storefront?: string;
  customerAccount?: string;
}

/**
 * The comparable local shape for one metafield definition: namespace is the
 * effective one (`$app` canonical for app-reserved), access enums are uppercased,
 * and capabilities are materialized `{enabled}` both ways so "was on, now off"
 * diffs correctly. [design §6, §7]
 */
export interface LocalMetafieldDefinition {
  ownerType: MetafieldOwnerType;
  namespace: string;
  key: string;
  type: string;
  name: string;
  description?: string;
  validations: FieldValidation[];
  access?: MetafieldAccess;
  capabilities: MetafieldCapabilities;
  pin: boolean;
}

/** Declared `namespace` verbatim; the bare `$app` sentinel resolves by scope. [design §6] */
function effectiveNamespace(namespace: string, scope: Scope): string {
  if (namespace !== APP_NAMESPACE) return namespace;
  return scope === "merchant" ? "custom" : APP_NAMESPACE;
}

/**
 * The effective `(ownerType, namespace)` pairs the given sets declare — the unit
 * pull fetches and diff bounds removes to. Derived from the sets (not resolved
 * definitions) so a declared-but-empty set still counts as managed. [design §8]
 */
export function metafieldPairs(
  sets: AnyMetafieldSet[],
  config: ScopeConfig = {},
): Array<{ ownerType: MetafieldOwnerType; namespace: string }> {
  const seen = new Set<string>();
  const out: Array<{ ownerType: MetafieldOwnerType; namespace: string }> = [];
  for (const set of sets) {
    const namespace = effectiveNamespace(set.namespace, set.scope ?? config.scope ?? "app");
    const key = `${set.owner}/${namespace}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ownerType: set.owner, namespace });
  }
  return out;
}

/**
 * Resolve declared metafield sets into the flat per-definition shape diff/push
 * consume. Reference validations are rewritten against the metaobject schemas'
 * effective types — the same rewrite `resolveDefinitions` applies. [design §6]
 */
export function resolveMetafieldSets(
  sets: AnyMetafieldSet[],
  schemas: AnySchema[],
  config: ScopeConfig = {},
): LocalMetafieldDefinition[] {
  const effByCanonical = effectiveTypes(schemas, config);
  const out: LocalMetafieldDefinition[] = [];

  for (const set of sets) {
    const scope: Scope = set.scope ?? config.scope ?? "app";
    const namespace = effectiveNamespace(set.namespace, scope);

    for (const [key, field] of Object.entries(set.fields as Record<string, Field<unknown, unknown, boolean>>)) {
      const opts = set.options[key] ?? {};
      // Re-check under the *effective* namespace: define-time validation can't
      // see a merchant `config.scope` driving the default to "custom". [design §9]
      if (opts.access?.admin != null && !namespace.startsWith(APP_NAMESPACE)) {
        throw new Error(
          `Metafield "${key}": access.admin is only valid for app-reserved-namespace definitions (namespace "${namespace}").`,
        );
      }

      const access: MetafieldAccess = {};
      if (opts.access?.admin) access.admin = opts.access.admin.toUpperCase();
      if (opts.access?.storefront) access.storefront = opts.access.storefront.toUpperCase();
      if (opts.access?.customerAccount) access.customerAccount = opts.access.customerAccount.toUpperCase();

      const def: LocalMetafieldDefinition = {
        ownerType: set.owner,
        namespace,
        key,
        type: field.shopifyType,
        name: field.name ?? key,
        validations: field.validations().map((v) => rewriteReference(v, effByCanonical)),
        capabilities: {
          adminFilterable: { enabled: opts.capabilities?.adminFilterable ?? field.filterable },
          smartCollectionCondition: { enabled: opts.capabilities?.smartCollectionCondition ?? false },
          uniqueValues: { enabled: opts.capabilities?.uniqueValues ?? false },
        },
        pin: opts.pin ?? false,
      };
      const description = opts.description ?? field.description;
      if (description != null) def.description = description;
      if (Object.keys(access).length) def.access = access;
      out.push(def);
    }
  }
  return out;
}
