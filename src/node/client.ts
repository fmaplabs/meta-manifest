import type { AdminGraphQLClient } from "../sync/client";
import { SyncTransportError } from "../sync/client";
import { DEFAULT_API_VERSION } from "../config";

/**
 * Build an AdminGraphQLClient that talks directly to a store using an Admin API
 * access token — the CLI's standalone equivalent of the app's session-based
 * `admin.graphql` wrapper. [design §2]
 */
export function createAdminClient(opts: {
  shop: string;
  accessToken: string;
  apiVersion?: string;
}): AdminGraphQLClient {
  const version = opts.apiVersion ?? DEFAULT_API_VERSION;
  const endpoint = `https://${opts.shop}/admin/api/${version}/graphql.json`;
  return async (query, options) => {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": opts.accessToken },
        body: JSON.stringify({ query, variables: options?.variables }),
      });
    } catch (cause) {
      throw new SyncTransportError(`Request to ${opts.shop} failed`, cause);
    }
    if (!res.ok) {
      throw new SyncTransportError(`Admin API returned HTTP ${res.status}`, await res.text().catch(() => null));
    }
    return res.json() as Promise<{ data?: unknown; errors?: unknown }>;
  };
}
