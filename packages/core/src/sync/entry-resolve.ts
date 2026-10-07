import type { MetaobjectSchema } from "../define";
import type { AnyEntries } from "../entries";
import { HANDLE_RE, parseEntryRef } from "../entries";
import type { Field, Issue } from "../fields/base";
import { resolveDefinitions, type ScopeConfig } from "./resolve";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = MetaobjectSchema<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyField = Field<any, any, any>;

/** Field types whose values may hold `$entry:` placeholders. */
const REF_TYPES = new Set([
  "metaobject_reference",
  "mixed_reference",
  "list.metaobject_reference",
  "list.mixed_reference",
]);

/** A placeholder reference from one declared entry to another (effective types). */
export interface EntryRefEdge {
  fieldKey: string;
  type: string;
  handle: string;
}

/** A declared entry, scope-resolved and validated, ready to diff/push. */
export interface ResolvedEntry {
  /** Effective (scope-resolved) metaobject type. */
  type: string;
  handle: string;
  schema: AnySchema;
  /**
   * Declared field values. `$entry:` placeholders are rewritten to effective
   * target types but left unresolved — diff/push substitute GIDs per field.
   */
  value: Record<string, unknown>;
  status?: "active" | "draft";
  refs: EntryRefEdge[];
}

/** The `$entry:` placeholders in one field's declared value (string or string array). */
export function placeholderRefs(v: unknown): Array<{ type: string; handle: string }> {
  const out: Array<{ type: string; handle: string }> = [];
  for (const el of Array.isArray(v) ? v : [v]) {
    const r = parseEntryRef(el);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Replace `$entry:` placeholders inside one field's declared value with GIDs
 * from `gid`. Placeholders `gid` can't resolve are left in place and reported —
 * at diff time that means "trivially changed"; at push time, a blocked dependency.
 */
export function substituteFieldValue(
  v: unknown,
  gid: (type: string, handle: string) => string | undefined,
): { value: unknown; unresolved: Array<{ type: string; handle: string }> } {
  const unresolved: Array<{ type: string; handle: string }> = [];
  const sub = (el: unknown): unknown => {
    const r = parseEntryRef(el);
    if (!r) return el;
    const id = gid(r.type, r.handle);
    if (id == null) {
      unresolved.push(r);
      return el;
    }
    return id;
  };
  return { value: Array.isArray(v) ? v.map(sub) : sub(v), unresolved };
}

/** The canonical `$app:` types a ref field accepts, from its declared validations. */
function refTargetTypes(field: AnyField): string[] {
  const out: string[] = [];
  for (const v of field.validations()) {
    if (v.name === "metaobject_definition_type") {
      out.push(v.value);
    } else if (v.name === "metaobject_definition_types") {
      try {
        const parsed: unknown = JSON.parse(v.value);
        if (Array.isArray(parsed)) for (const t of parsed) if (typeof t === "string") out.push(t);
      } catch {
        // A malformed validation value is a definition-side problem, not an entry one.
      }
    }
  }
  return out;
}

/** Rewrite a field value's placeholders from canonical to effective target types, collecting refs. */
function rewriteRefs(
  fieldKey: string,
  v: unknown,
  effByCanonical: Map<string, string>,
  refs: EntryRefEdge[],
): unknown {
  const rewrite = (el: unknown): unknown => {
    const r = parseEntryRef(el);
    if (!r) return el;
    const type = effByCanonical.get(r.type) ?? r.type;
    refs.push({ fieldKey, type, handle: r.handle });
    return `$entry:${type}/${r.handle}`;
  };
  return Array.isArray(v) ? v.map(rewrite) : rewrite(v);
}

/**
 * Validate the declared entry sets against the schemas and resolve them into
 * the effective-scope space the sync pipeline works in. All checks run before
 * any network call; a non-empty `issues` means the plan must not proceed.
 */
export function resolveEntries(
  entrySets: AnyEntries[],
  schemas: AnySchema[],
  config: ScopeConfig = {},
): { entries: ResolvedEntry[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const definitions = resolveDefinitions(schemas, config);
  const effByCanonical = new Map(schemas.map((s, i) => [s.type, definitions[i].type]));
  const schemaByType = new Map(schemas.map((s) => [s.type, s]));

  const entries: ResolvedEntry[] = [];
  const declared = new Set<string>();

  for (const set of entrySets) {
    const canonical = set.schema?.type;
    const schema = canonical != null ? schemaByType.get(canonical) : undefined;
    if (!schema) {
      issues.push({ message: `Entries declared for "${canonical}" but the schema module does not export that schema.` });
      continue;
    }
    if (set.status !== undefined && set.status !== "active" && set.status !== "draft") {
      issues.push({ message: `Entry set for "${canonical}": status must be "active" or "draft".` });
      continue;
    }
    const effType = effByCanonical.get(schema.type) as string;
    const fields = schema.fields as Record<string, AnyField>;

    for (const [handle, declaredValue] of Object.entries(set.entries as Record<string, Record<string, unknown>>)) {
      const key = `${effType}/${handle}`;
      if (!HANDLE_RE.test(handle)) {
        issues.push({ message: `Invalid entry handle "${handle}" for "${effType}" — use lowercase kebab-case.`, path: [key] });
        continue;
      }
      if (declared.has(key)) {
        issues.push({ message: `Entry "${key}" is declared more than once across entry sets.`, path: [key] });
        continue;
      }
      declared.add(key);

      for (const k of Object.keys(declaredValue)) {
        if (!(k in fields)) issues.push({ message: `Entry "${key}" sets unknown field "${k}".`, path: [key, k] });
      }

      const refs: EntryRefEdge[] = [];
      const value: Record<string, unknown> = {};
      for (const [k, field] of Object.entries(fields)) {
        const v = declaredValue[k];
        if (v == null) {
          if (field.required) issues.push({ message: `Entry "${key}" is missing required field "${k}".`, path: [key, k] });
          continue;
        }

        const placeholders = placeholderRefs(v);
        if (placeholders.length > 0 && !REF_TYPES.has(field.shopifyType)) {
          issues.push({
            message: `Entry "${key}" field "${k}" holds an $entry: placeholder but is not a metaobject reference field.`,
            path: [key, k],
          });
          continue;
        }
        if (placeholders.length > 0) {
          const targets = refTargetTypes(field);
          for (const r of placeholders) {
            if (!targets.includes(r.type)) {
              issues.push({
                message: `Entry "${key}" field "${k}" references "${r.type}/${r.handle}" but the field only accepts: ${targets.join(", ")}.`,
                path: [key, k],
              });
            }
          }
        }

        // Round-trip the declared value through encode→decode: exercises the same
        // toJson/fromJson/check machinery push will use, before any network call.
        try {
          const decoded = field.decode(field.encode(v));
          if (decoded.issues) {
            issues.push(...decoded.issues.map((i) => ({ ...i, path: [key, k, ...(i.path ?? [])] })));
            continue;
          }
        } catch (err) {
          issues.push({
            message: `Entry "${key}" field "${k}" cannot be encoded: ${err instanceof Error ? err.message : String(err)}`,
            path: [key, k],
          });
          continue;
        }

        value[k] = rewriteRefs(k, v, effByCanonical, refs);
      }

      entries.push({ type: effType, handle, schema, value, status: set.status, refs });
    }
  }

  // Placeholder targets must be declared entries — a raw GID is the escape hatch
  // for referencing anything meta-manifest doesn't manage.
  for (const e of entries) {
    for (const r of e.refs) {
      if (!declared.has(`${r.type}/${r.handle}`)) {
        issues.push({
          message: `Entry "${e.type}/${e.handle}" field "${r.fieldKey}" references undeclared entry "${r.type}/${r.handle}". Declare it, or use a raw GID.`,
          path: [`${e.type}/${e.handle}`, r.fieldKey],
        });
      }
    }
  }

  return { entries, issues };
}
