import type { FieldValidation } from "../fields/base";
import { APP_NAMESPACE, isAppReservedNamespace, type MetafieldOwnerType } from "../metafields";
import { CURRENT_APP_QUERY, execute, PULL_METAFIELD_DEFINITIONS_QUERY, type AdminGraphQLClient } from "./client";
import type { MetafieldAccess, MetafieldCapabilities } from "./resolve";

/** One declared `(ownerType, namespace)` pair — the unit `mm` manages. [design §8] */
export interface MetafieldPair {
  ownerType: MetafieldOwnerType;
  namespace: string;
}

/**
 * A metafield definition read back from the store, normalized to the diff shape:
 * `namespace` is canonicalized (`app--<id>` → `$app`), `pin` derives from
 * `pinnedPosition`, and capabilities are materialized `{enabled}`. `id` is the
 * GID `push` threads into delete ops. [design §6, §7]
 */
export interface PulledMetafieldDefinition {
  id: string;
  ownerType: MetafieldOwnerType;
  namespace: string;
  key: string;
  type: string;
  name?: string;
  description?: string;
  validations: FieldValidation[];
  access?: MetafieldAccess;
  capabilities: MetafieldCapabilities;
  pin: boolean;
}

interface PullNode {
  id: string;
  name?: string | null;
  namespace: string;
  key: string;
  description?: string | null;
  type: { name: string } | string;
  validations?: FieldValidation[] | null;
  access?: { admin?: string | null; storefront?: string | null; customerAccount?: string | null } | null;
  capabilities?: {
    adminFilterable?: { enabled: boolean } | null;
    smartCollectionCondition?: { enabled: boolean } | null;
    uniqueValues?: { enabled: boolean } | null;
  } | null;
  pinnedPosition?: number | null;
}

interface PullResponse {
  metafieldDefinitions: {
    nodes: PullNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

/**
 * Convert the store's resolved app-reserved namespace back to the canonical
 * local spelling — but ONLY the current app's: `appNamespace` (`app--<own id>`)
 * → `$app`, `app--<own id>--<suffix>` → `$app:<suffix>`. Every other namespace,
 * including OTHER apps' `app--<id>` reserved namespaces, passes through
 * verbatim so foreign definitions are never mistaken for managed ones. [design §6]
 */
export function toCanonicalNamespace(namespace: string, appNamespace: string): string {
  if (namespace === appNamespace) return APP_NAMESPACE;
  if (namespace.startsWith(`${appNamespace}--`)) {
    return `${APP_NAMESPACE}:${namespace.slice(appNamespace.length + 2)}`;
  }
  return namespace;
}

/** The store's own `app--<id>` namespace, from the current app installation. */
async function resolveAppNamespace(client: AdminGraphQLClient): Promise<string> {
  const data = await execute<{ currentAppInstallation: { app?: { id?: string } | null } | null }>(client, CURRENT_APP_QUERY);
  const gid = data.currentAppInstallation?.app?.id;
  const id = gid ? /\/(\d+)$/.exec(gid)?.[1] : undefined;
  if (!id) {
    throw new Error(
      "Could not resolve the store's app-reserved namespace (currentAppInstallation returned no app id) — " +
        "refusing to manage $app metafield definitions, since another app's definitions could be mistaken for ours.",
    );
  }
  return `app--${id}`;
}

function normalizeNode(ownerType: MetafieldOwnerType, node: PullNode, appNamespace: string | undefined): PulledMetafieldDefinition {
  const out: PulledMetafieldDefinition = {
    id: node.id,
    ownerType,
    namespace: appNamespace === undefined ? node.namespace : toCanonicalNamespace(node.namespace, appNamespace),
    key: node.key,
    type: typeof node.type === "string" ? node.type : node.type.name,
    validations: node.validations ?? [],
    capabilities: {
      adminFilterable: { enabled: node.capabilities?.adminFilterable?.enabled ?? false },
      smartCollectionCondition: { enabled: node.capabilities?.smartCollectionCondition?.enabled ?? false },
      uniqueValues: { enabled: node.capabilities?.uniqueValues?.enabled ?? false },
    },
    pin: node.pinnedPosition != null,
  };
  if (node.name != null) out.name = node.name;
  if (node.description != null) out.description = node.description;
  const access: MetafieldAccess = {};
  if (node.access?.admin != null) access.admin = node.access.admin;
  if (node.access?.storefront != null) access.storefront = node.access.storefront;
  if (node.access?.customerAccount != null) access.customerAccount = node.access.customerAccount;
  if (Object.keys(access).length) out.access = access;
  return out;
}

/**
 * Reads the current metafield definitions for the declared `(ownerType, namespace)`
 * pairs: one page-walk per unique owner type, nodes filtered client-side to the
 * declared pairs after namespace canonicalization. Definitions in unmanaged
 * pairs are never returned, so they are never compared or touched. [design §8]
 */
export async function pullMetafields(
  client: AdminGraphQLClient,
  pairs: readonly MetafieldPair[],
): Promise<PulledMetafieldDefinition[]> {
  const declared = new Set(pairs.map((p) => `${p.ownerType}/${p.namespace}`));
  const ownerTypes = [...new Set(pairs.map((p) => p.ownerType))];
  // The own-app namespace is only needed (and only queried) when an
  // app-reserved pair is managed; explicit-namespace projects skip it.
  const appNamespace = pairs.some((p) => isAppReservedNamespace(p.namespace))
    ? await resolveAppNamespace(client)
    : undefined;

  const out: PulledMetafieldDefinition[] = [];
  for (const ownerType of ownerTypes) {
    let after: string | null = null;
    do {
      const data: PullResponse = await execute<PullResponse>(client, PULL_METAFIELD_DEFINITIONS_QUERY, { ownerType, after });
      for (const node of data.metafieldDefinitions.nodes) {
        const def = normalizeNode(ownerType, node, appNamespace);
        if (declared.has(`${def.ownerType}/${def.namespace}`)) out.push(def);
      }
      after = data.metafieldDefinitions.pageInfo.hasNextPage ? data.metafieldDefinitions.pageInfo.endCursor : null;
    } while (after !== null);
  }
  return out;
}
