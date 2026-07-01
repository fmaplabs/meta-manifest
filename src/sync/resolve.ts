import type { Config } from "../config";
import type { MetaobjectSchema } from "../define";
import type { FieldValidation } from "../fields/base";
import type { FieldDefinitionInput, MetaobjectDefinitionInput } from "../definition-input";

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

/**
 * Resolve each schema's canonical (`$app:`) definition input into the effective
 * input the sync pipeline pushes: definition `type` and reference targets are
 * rewritten to each metaobject's effective scope, and `access.admin` is resolved.
 * `schema.type` / `m.ref` public values are unchanged. [design §6]
 */
export function resolveDefinitions(schemas: AnySchema[], config: ScopeConfig = {}): MetaobjectDefinitionInput[] {
  // Pass 1: canonical `$app:<handle>` → effective type, for reference rewriting.
  const effByCanonical = new Map<string, string>();
  for (const s of schemas) {
    effByCanonical.set(`${APP_PREFIX}${s.handle}`, effectiveType(s.handle, effectiveScope(s, config)));
  }

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
