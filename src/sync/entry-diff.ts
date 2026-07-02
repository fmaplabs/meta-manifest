import type { Field } from "../fields/base";
import type { PulledEntry } from "./entry-pull";
import { substituteFieldValue, type ResolvedEntry } from "./entry-resolve";

export type EntryOp =
  | { kind: "createEntry"; type: string; handle: string }
  | { kind: "updateEntry"; type: string; handle: string; changes: string[]; statusChange?: boolean };

/**
 * Compare declared entries against the pulled remote state. Only declared
 * fields are compared — anything else on a remote entry is unmanaged and never
 * diffed (upsert-only seed model). Placeholder refs resolve through the pulled
 * GIDs; a placeholder to a not-yet-existing entry can't match any remote value,
 * so it is a change by construction. [design §8]
 */
export function diffEntries(entries: ResolvedEntry[], remote: PulledEntry[]): EntryOp[] {
  const remoteByKey = new Map(remote.map((r) => [`${r.type}/${r.handle}`, r]));
  const gid = (type: string, handle: string) => remoteByKey.get(`${type}/${handle}`)?.id;

  const ops: EntryOp[] = [];
  for (const entry of entries) {
    const pulled = remoteByKey.get(`${entry.type}/${entry.handle}`);
    if (!pulled) {
      ops.push({ kind: "createEntry", type: entry.type, handle: entry.handle });
      continue;
    }

    const remoteValueByKey = new Map(pulled.fields.map((f) => [f.key, f.value]));
    const changes: string[] = [];
    for (const [key, v] of Object.entries(entry.value)) {
      const field = (entry.schema.fields as Record<string, Field<unknown, unknown, boolean>>)[key];
      const { value, unresolved } = substituteFieldValue(v, gid);
      if (unresolved.length > 0) {
        changes.push(key);
        continue;
      }
      const remoteValue = remoteValueByKey.get(key);
      if (remoteValue == null || !field.wireEquals(field.encode(value), remoteValue)) changes.push(key);
    }

    const statusChange =
      entry.status !== undefined && entry.status.toUpperCase() !== (pulled.status ?? "").toUpperCase();

    if (changes.length > 0 || statusChange) {
      ops.push({ kind: "updateEntry", type: entry.type, handle: entry.handle, changes, ...(statusChange ? { statusChange } : {}) });
    }
  }
  return ops;
}
