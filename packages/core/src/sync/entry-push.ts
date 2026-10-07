import type { Field } from "../fields/base";
import { execute, UPSERT_ENTRY_MUTATION, type AdminGraphQLClient } from "./client";
import type { EntryOp } from "./entry-diff";
import type { PulledEntry } from "./entry-pull";
import { substituteFieldValue, type ResolvedEntry } from "./entry-resolve";
import { topoSort } from "./push";

type UserError = { field?: string[]; message: string; code?: string };
type UpsertPayload = { metaobject?: { id?: string; handle?: string } | null; userErrors: UserError[] };

export type EntryPushOpResult =
  | { op: EntryOp; status: "applied"; id?: string }
  | { op: EntryOp; status: "blocked"; reason: string }
  | { op: EntryOp; status: "failed"; userErrors: UserError[] };

export interface EntryPushResult {
  results: EntryPushOpResult[];
  counts: { applied: number; blocked: number; failed: number };
  ok: boolean;
}

const keyOf = (x: { type: string; handle: string }) => `${x.type}/${x.handle}`;

/**
 * Applies an entry plan via `metaobjectUpsert`. Creates run first, dependency
 * ordered (a referenced entry before its referencer); any field whose `$entry:`
 * placeholder can't resolve to a GID yet — cycle members and self-references —
 * is deferred and added by a pass-2 upsert once every create ran (safe because
 * the `metaobject` arg is a partial update). Updates run last and write only the
 * drifted fields. Per-op `userErrors` become `failed` results; only transport
 * errors propagate. [design §7, §8]
 */
export async function pushEntries(
  client: AdminGraphQLClient,
  plan: EntryOp[],
  sources: { entries: ResolvedEntry[]; remote: PulledEntry[]; failedDefinitionTypes?: ReadonlySet<string> },
): Promise<EntryPushResult> {
  const failedDefs = sources.failedDefinitionTypes ?? new Set<string>();
  const entryByKey = new Map(sources.entries.map((e) => [keyOf(e), e]));
  const idByKey = new Map(sources.remote.map((r) => [keyOf(r), r.id]));
  const gid = (type: string, handle: string) => idByKey.get(`${type}/${handle}`);

  const indexed = plan.map((op, index) => ({ op, index }));
  const creates = indexed.filter((x) => x.op.kind === "createEntry");
  const updates = indexed.filter((x) => x.op.kind === "updateEntry");
  const createKeys = new Set(creates.map((x) => keyOf(x.op)));

  // Dependency edges among the entries being created this run. Self-edges are
  // excluded (a self-referential entry is not a length-1 cycle); its self-ref
  // field is handled by the pass-2 deferral instead.
  const deps = new Map<string, Set<string>>();
  for (const { op } of creates) {
    const targets = (entryByKey.get(keyOf(op))?.refs ?? []).map((r) => `${r.type}/${r.handle}`);
    deps.set(keyOf(op), new Set(targets.filter((t) => createKeys.has(t) && t !== keyOf(op))));
  }
  const { ordered, unordered } = topoSort(createKeys, deps);
  const createByKey = new Map(creates.map((x) => [keyOf(x.op), x]));

  // Entries whose create failed or was blocked this run — their dependents block too.
  const failedKeys = new Set<string>();
  const results: EntryPushOpResult[] = new Array(plan.length);

  /** Encode declared fields (optionally restricted to `keys`), deferring unresolvable refs. */
  function encodeFields(entry: ResolvedEntry, keys?: string[]): { fields: Array<{ key: string; value: string }>; deferred: string[] } {
    const fields: Array<{ key: string; value: string }> = [];
    const deferred: string[] = [];
    for (const [k, v] of Object.entries(entry.value)) {
      if (keys && !keys.includes(k)) continue;
      const field = (entry.schema.fields as Record<string, Field<unknown, unknown, boolean>>)[k];
      const { value, unresolved } = substituteFieldValue(v, gid);
      if (unresolved.length > 0) deferred.push(k);
      else fields.push({ key: k, value: field.encode(value) });
    }
    return { fields, deferred };
  }

  /** Run one `metaobjectUpsert`, recording the entry's id or its failure. */
  async function upsert(op: EntryOp, metaobject: Record<string, unknown>): Promise<EntryPushOpResult> {
    const data = await execute<{ metaobjectUpsert: UpsertPayload }>(client, UPSERT_ENTRY_MUTATION, {
      handle: { type: op.type, handle: op.handle },
      metaobject,
    });
    const payload = data.metaobjectUpsert;
    if (payload.userErrors.length) {
      failedKeys.add(keyOf(op));
      return { op, status: "failed", userErrors: payload.userErrors };
    }
    const id = payload.metaobject?.id;
    if (id) idByKey.set(keyOf(op), id);
    return { op, status: "applied", id };
  }

  const deferredByKey = new Map<string, string[]>();

  async function applyCreate(op: EntryOp): Promise<EntryPushOpResult> {
    const key = keyOf(op);
    if (failedDefs.has(op.type)) {
      failedKeys.add(key);
      return { op, status: "blocked", reason: `blocked: definition "${op.type}" was not created` };
    }
    for (const dep of deps.get(key) ?? []) {
      if (failedKeys.has(dep)) {
        failedKeys.add(key);
        return { op, status: "blocked", reason: `blocked: dependency "${dep}" was not created` };
      }
    }
    const entry = entryByKey.get(key);
    if (!entry) {
      failedKeys.add(key);
      return { op, status: "blocked", reason: `no declared entry for "${key}"` };
    }
    const { fields, deferred } = encodeFields(entry);
    if (deferred.length > 0) deferredByKey.set(key, deferred);
    const metaobject: Record<string, unknown> = { fields };
    if (entry.status) metaobject.capabilities = { publishable: { status: entry.status.toUpperCase() } };
    return upsert(op, metaobject);
  }

  // Pass 1: creates — acyclic entries in dependency order, then cycle members
  // with their unresolvable ref fields deferred.
  for (const key of [...ordered, ...unordered]) {
    const x = createByKey.get(key) as { op: EntryOp; index: number };
    results[x.index] = await applyCreate(x.op);
  }

  // Pass 2: add the deferred ref fields now that every created entry has a GID.
  for (const { op, index } of creates) {
    if (results[index]?.status !== "applied") continue;
    const key = keyOf(op);
    const deferred = deferredByKey.get(key);
    if (!deferred?.length) continue;
    const entry = entryByKey.get(key) as ResolvedEntry;
    const { fields, deferred: still } = encodeFields(entry, deferred);
    if (still.length > 0) {
      failedKeys.add(key);
      results[index] = { op, status: "blocked", reason: `blocked: reference target for "${still.join('", "')}" was not created` };
      continue;
    }
    const r = await upsert(op, { fields });
    if (r.status !== "applied") results[index] = r;
  }

  // Updates last: write only the drifted fields (+ status when it drifted).
  for (const { op, index } of updates) {
    if (op.kind !== "updateEntry") continue;
    if (failedDefs.has(op.type)) {
      results[index] = { op, status: "blocked", reason: `blocked: definition "${op.type}" was not created` };
      continue;
    }
    const entry = entryByKey.get(keyOf(op));
    if (!entry) {
      results[index] = { op, status: "blocked", reason: `no declared entry for "${keyOf(op)}"` };
      continue;
    }
    const { fields, deferred } = encodeFields(entry, op.changes);
    if (deferred.length > 0) {
      results[index] = { op, status: "blocked", reason: `blocked: reference target for "${deferred.join('", "')}" was not created` };
      continue;
    }
    const metaobject: Record<string, unknown> = {};
    if (fields.length > 0) metaobject.fields = fields;
    if (op.statusChange && entry.status) metaobject.capabilities = { publishable: { status: entry.status.toUpperCase() } };
    results[index] = await upsert(op, metaobject);
  }

  const counts = { applied: 0, blocked: 0, failed: 0 };
  for (const r of results) counts[r.status]++;
  return { results, counts, ok: counts.failed === 0 && counts.blocked === 0 };
}
