import type { AdminGraphQLClient } from "./client";
import { execute, PULL_ENTRY_QUERY } from "./client";

export interface PulledEntryField {
  key: string;
  value: string | null;
  jsonValue?: unknown;
}

/** An entry read back from the store, re-labeled with the requested (effective) type. */
export interface PulledEntry {
  id: string;
  type: string;
  handle: string;
  fields: PulledEntryField[];
  /** Publishable status ("ACTIVE"/"DRAFT"); undefined when the capability is off. */
  status?: string;
}

interface PullEntryResponse {
  metaobjectByHandle: {
    id: string;
    handle: string;
    type: string;
    fields: PulledEntryField[];
    capabilities?: { publishable?: { status?: string | null } | null } | null;
  } | null;
}

/**
 * Reads the declared `(type, handle)` entries back from the store, one query
 * per key (seed entries are few — this scales with declared data, not store
 * data). Absent entries are omitted so `diffEntries` emits a create. [design §6]
 */
export async function pullEntries(
  client: AdminGraphQLClient,
  keys: ReadonlyArray<{ type: string; handle: string }>,
): Promise<PulledEntry[]> {
  const out: PulledEntry[] = [];
  for (const { type, handle } of keys) {
    const data = await execute<PullEntryResponse>(client, PULL_ENTRY_QUERY, { handle: { type, handle } });
    const node = data.metaobjectByHandle;
    if (!node) continue;
    out.push({
      id: node.id,
      type,
      handle,
      fields: node.fields,
      status: node.capabilities?.publishable?.status ?? undefined,
    });
  }
  return out;
}
