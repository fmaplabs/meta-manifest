import type { MetaobjectSchema } from "./define";
import type { TypeRef } from "./fields/reference";
import type { FieldMap, InferInput } from "./infer";

/** Prefix of an entry-reference placeholder value: `"$entry:<canonical-type>/<handle>"`. */
export const ENTRY_REF_PREFIX = "$entry:";

/** Conservative Shopify handle shape: lowercase alphanumerics separated by single hyphens. */
export const HANDLE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

declare const entryRefBrand: unique symbol;
/**
 * A placeholder reference to another declared entry. Branded so it reads as
 * intentional, but structurally a string — it slots into every `m.ref` /
 * `m.mixedRef` / `m.list(m.ref)` input position. Push resolves it to the
 * target entry's GID; raw `gid://shopify/...` strings pass through untouched.
 */
export type EntryRef = string & { readonly [entryRefBrand]: true };

function resolveType(target: TypeRef): string {
  return typeof target === "function" ? target().type : target.type;
}

/** Reference another declared entry by its schema (or type thunk) and handle. */
export function entryRef(target: TypeRef, handle: string): EntryRef {
  return `${ENTRY_REF_PREFIX}${resolveType(target)}/${handle}` as EntryRef;
}

/** Parse an `$entry:` placeholder into its target; null when `value` isn't one. */
export function parseEntryRef(value: unknown): { type: string; handle: string } | null {
  if (typeof value !== "string" || !value.startsWith(ENTRY_REF_PREFIX)) return null;
  const rest = value.slice(ENTRY_REF_PREFIX.length);
  const slash = rest.lastIndexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { type: rest.slice(0, slash), handle: rest.slice(slash + 1) };
}

export interface EntriesOptions {
  /** Publishable status applied to every entry in the set (needs the `publishable` capability). */
  status?: "active" | "draft";
}

/** A set of seed entries for one schema, keyed by handle. */
export interface EntriesDef<F extends FieldMap> {
  readonly schema: MetaobjectSchema<F>;
  readonly entries: Record<string, InferInput<F>>;
  readonly status?: "active" | "draft";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEntries = EntriesDef<any>;

/**
 * Declare seed entries for `schema`, keyed by handle. `mm push` upserts them
 * (create or partial update); entries and fields not declared here are never
 * touched or deleted.
 */
export function defineEntries<F extends FieldMap>(
  schema: MetaobjectSchema<F>,
  entries: Record<string, InferInput<F>>,
  opts: EntriesOptions = {},
): EntriesDef<F> {
  return { schema, entries, status: opts.status };
}
