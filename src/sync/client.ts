/**
 * The minimal Admin GraphQL transport the sync adapter depends on. The app
 * supplies a concrete implementation at its edge (wrapping `admin.graphql`),
 * keeping `@fmaplabs/meta-manifest` free of any runtime dependency on a GraphQL
 * client. [design §5]
 */
export interface AdminGraphQLClient {
  (query: string, options?: { variables?: Record<string, unknown> }): Promise<{ data?: unknown; errors?: unknown }>;
}

// GraphQL operation strings, copied verbatim from the schema-validated documents
// in the design spec §3. Re-validated against Admin API 2026-07 during planning.
// Do not edit by hand — keep equal to the validated documents (drift guard, §12).

export const PULL_DEFINITION_QUERY = `query PullMetaobjectDefinition($type: String!) {
  metaobjectDefinitionByType(type: $type) {
    id
    name
    type
    description
    displayNameKey
    fieldDefinitions {
      key
      name
      description
      required
      type { name }
      validations { name value }
      capabilities { adminFilterable { enabled } }
    }
    access { admin storefront customerAccount }
    capabilities {
      publishable { enabled }
      translatable { enabled }
      renderable { enabled data { metaTitleKey metaDescriptionKey } }
      onlineStore { enabled data { urlHandle } }
    }
  }
}`;

export const LIST_DEFINITIONS_QUERY = `query ListMetaobjectDefinitions($after: String) {
  metaobjectDefinitions(first: 50, after: $after) {
    nodes {
      id
      name
      type
      description
      displayNameKey
      fieldDefinitions {
        key
        name
        description
        required
        type { name }
        validations { name value }
        capabilities { adminFilterable { enabled } }
      }
      access { admin storefront customerAccount }
      capabilities {
        publishable { enabled }
        translatable { enabled }
        renderable { enabled data { metaTitleKey metaDescriptionKey } }
        onlineStore { enabled data { urlHandle } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const CREATE_DEFINITION_MUTATION = `mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
  metaobjectDefinitionCreate(definition: $definition) {
    metaobjectDefinition { id type }
    userErrors { field message code }
  }
}`;

export const UPDATE_DEFINITION_MUTATION = `mutation UpdateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
  metaobjectDefinitionUpdate(id: $id, definition: $definition) {
    metaobjectDefinition { id type }
    userErrors { field message code }
  }
}`;

/**
 * Thrown when a request fails at the transport or top-level GraphQL layer —
 * distinct from per-op `userErrors`, which `push` reports as `failed` rather
 * than throwing. Carries the offending top-level `errors` payload. [design §5]
 */
export class SyncTransportError extends Error {
  constructor(message: string, readonly errors: unknown) {
    super(message);
    this.name = "SyncTransportError";
  }
}

/**
 * Runs an operation through the injected client and returns its `data`.
 * A non-empty top-level `errors` payload becomes a `SyncTransportError`;
 * a rejected transport promise propagates unchanged. [design §5]
 */
export async function execute<T>(
  client: AdminGraphQLClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const result = await client(query, variables ? { variables } : undefined);
  if (Array.isArray(result.errors) ? result.errors.length > 0 : result.errors != null) {
    throw new SyncTransportError("GraphQL request failed", result.errors);
  }
  return result.data as T;
}
