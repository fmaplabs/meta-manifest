import type { AdminGraphQLClient } from "./client";
import { execute, PULL_DEFINITION_QUERY, LIST_DEFINITIONS_QUERY } from "./client";
import type { PulledDefinition, PulledFieldDefinition } from "./normalize";

/**
 * A definition read back from the store. `type` is the canonical "$app:…" key
 * (the REQUESTED type, re-labeled from the resolved `app--…` form Shopify
 * returns) so `diff()` matches local↔remote; `id` is the GID `push` threads into
 * update ops. [design §6]
 */
export interface PulledRemote {
  id: string;
  type: string;
  definition: PulledDefinition;
}

interface PullNode {
  id: string;
  name?: string;
  type: string;
  fieldDefinitions: PulledFieldDefinition[];
}
interface PullResponse {
  metaobjectDefinitionByType: PullNode | null;
}

/**
 * Reads the current metaobject definitions for the given `$app:` types. A type
 * absent from the store is omitted (so `diff()` emits a create). Each present
 * node is re-labeled with the requested type and its `id` is captured. [design §6]
 */
export async function pull(client: AdminGraphQLClient, types: readonly string[]): Promise<PulledRemote[]> {
  const out: PulledRemote[] = [];
  for (const type of types) {
    const data = await execute<PullResponse>(client, PULL_DEFINITION_QUERY, { type });
    const node = data.metaobjectDefinitionByType;
    if (!node) continue;
    out.push({
      id: node.id,
      type,
      definition: { type, name: node.name, fieldDefinitions: node.fieldDefinitions },
    });
  }
  return out;
}

interface ListResponse {
  metaobjectDefinitions: {
    nodes: PullNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

/** Convert Shopify's resolved app type ("app--<id>--<handle>") to canonical "$app:<handle>". */
function toCanonicalType(resolved: string): string | null {
  const m = /^app--\d+--(.+)$/.exec(resolved);
  return m ? `$app:${m[1]}` : null;
}

/**
 * Enumerate every metaobject definition in the store. By default returns only
 * app-owned definitions, re-labeled to canonical "$app:<handle>" types so they
 * round-trip through `defineMetaobject`. [design §3]
 */
export async function pullAll(
  client: AdminGraphQLClient,
  opts: { appOwnedOnly?: boolean } = {},
): Promise<PulledRemote[]> {
  const appOwnedOnly = opts.appOwnedOnly ?? true;
  const out: PulledRemote[] = [];
  let after: string | null = null;
  do {
    const data: ListResponse = await execute<ListResponse>(client, LIST_DEFINITIONS_QUERY, { after });
    for (const node of data.metaobjectDefinitions.nodes) {
      const canonical = toCanonicalType(node.type);
      if (appOwnedOnly && !canonical) continue;
      const type = canonical ?? node.type;
      out.push({ id: node.id, type, definition: { type, name: node.name, fieldDefinitions: node.fieldDefinitions } });
    }
    after = data.metaobjectDefinitions.pageInfo.hasNextPage ? data.metaobjectDefinitions.pageInfo.endCursor : null;
  } while (after !== null);
  return out;
}
