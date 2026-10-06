import type { FieldValidation } from "../fields/base";
import { APP_NAMESPACE, isAppReservedNamespace, metafieldOwnerKey, type MetafieldOwnerType } from "../metafields";
import { ACCESS_SCOPES_QUERY, CURRENT_APP_QUERY, execute, PULL_METAFIELD_DEFINITIONS_QUERY, type AdminGraphQLClient } from "./client";
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

// The owner resource's read scope gates metafield-definition reads (there is no
// metafield-specific scope). Only the groupings documented in docs/CLI.md §2 are
// mapped — a wrong guess here would block a legitimate first push with a phantom
// "missing scope" error, so undocumented owners skip the guard instead.
const READ_SCOPE_BY_OWNER: Partial<Record<MetafieldOwnerType, string>> = {
  PRODUCT: "read_products",
  PRODUCTVARIANT: "read_products",
  COLLECTION: "read_products",
  CUSTOMER: "read_customers",
  ORDER: "read_orders",
  DRAFTORDER: "read_orders",
  COMPANY: "read_companies",
  COMPANY_LOCATION: "read_companies",
};

/** The token's granted scope handles, or undefined when they cannot be read (guard degrades). */
async function fetchScopeHandles(client: AdminGraphQLClient): Promise<Set<string> | undefined> {
  try {
    const data = await execute<{ currentAppInstallation: { accessScopes?: Array<{ handle: string }> | null } | null }>(
      client,
      ACCESS_SCOPES_QUERY,
    );
    const scopes = data.currentAppInstallation?.accessScopes;
    return scopes ? new Set(scopes.map((s) => s.handle)) : undefined;
  } catch {
    // Best-effort: an empty pull is only AMBIGUOUS. If the scopes can't be read,
    // fall back to trusting it rather than failing diff/pull/push outright.
    return undefined;
  }
}

/**
 * Shopify answers an owner read the token isn't scoped for with an EMPTY
 * `metafieldDefinitions` connection, not an error — which a diff would read as
 * "nothing exists remotely" and plan to re-create everything. For owner types
 * whose page-walk returned zero raw nodes, confirm the token actually holds the
 * documented read scope (write implies read); throw naming every confirmed-
 * unreadable owner. A non-empty connection already proves the scope. [design §8]
 */
async function guardEmptyOwnerPulls(client: AdminGraphQLClient, emptyOwners: MetafieldOwnerType[]): Promise<void> {
  const guarded = emptyOwners.filter((o) => READ_SCOPE_BY_OWNER[o] !== undefined);
  if (guarded.length === 0) return;
  const handles = await fetchScopeHandles(client);
  if (!handles) return;
  const missing = guarded.filter((o) => {
    const read = READ_SCOPE_BY_OWNER[o] as string;
    return !handles.has(read) && !handles.has(read.replace(/^read_/, "write_"));
  });
  if (missing.length === 0) return;
  const lines = missing.map((o) => {
    const owner = metafieldOwnerKey(o) ?? o;
    return `  - ${owner}: token lacks ${READ_SCOPE_BY_OWNER[o]}`;
  });
  throw new Error(
    `Shopify returned no metafield definitions for ${missing.length === 1 ? "an owner type" : "owner types"} the token cannot read:\n` +
      `${lines.join("\n")}\n` +
      `A missing owner read scope makes Shopify return an empty list instead of an error, so this result cannot ` +
      `be trusted — a diff would plan to re-create every declared definition. Grant the scope${missing.length === 1 ? "" : "s"} ` +
      `above (the write scope for push), or remove the owner's declarations. See docs/CLI.md §2.`,
  );
}

/**
 * Reads the current metafield definitions for the declared `(ownerType, namespace)`
 * pairs: one page-walk per unique owner type, nodes filtered client-side to the
 * declared pairs after namespace canonicalization. Definitions in unmanaged
 * pairs are never returned, so they are never compared or touched. An owner type
 * whose connection comes back empty is checked against the token's access scopes
 * before the emptiness is believed (`guardEmptyOwnerPulls`). [design §8]
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
  const emptyOwners: MetafieldOwnerType[] = [];
  for (const ownerType of ownerTypes) {
    let after: string | null = null;
    let rawNodes = 0;
    do {
      const data: PullResponse = await execute<PullResponse>(client, PULL_METAFIELD_DEFINITIONS_QUERY, { ownerType, after });
      rawNodes += data.metafieldDefinitions.nodes.length;
      for (const node of data.metafieldDefinitions.nodes) {
        const def = normalizeNode(ownerType, node, appNamespace);
        if (declared.has(`${def.ownerType}/${def.namespace}`)) out.push(def);
      }
      after = data.metafieldDefinitions.pageInfo.hasNextPage ? data.metafieldDefinitions.pageInfo.endCursor : null;
    } while (after !== null);
    if (rawNodes === 0) emptyOwners.push(ownerType);
  }
  await guardEmptyOwnerPulls(client, emptyOwners);
  return out;
}
