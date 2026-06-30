import type { AdminGraphQLClient } from "./client";
import { execute, PULL_DEFINITION_QUERY } from "./client";
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
