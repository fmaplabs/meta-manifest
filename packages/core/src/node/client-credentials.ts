import type { AdminGraphQLClient } from "../sync/client";
import { SyncTransportError } from "../sync/client";
import { DEFAULT_API_VERSION } from "../config";

/**
 * Build an AdminGraphQLClient for a Dev Dashboard app's client-credentials
 * grant: the first GraphQL call mints a 24h Admin token from
 * /admin/oauth/access_token, cached for the process lifetime (a CLI run lasts
 * seconds — no refresh or 401-retry logic), then every call behaves exactly
 * like `createAdminClient`.
 */
export function createClientCredentialsAdminClient(opts: {
  shop: string;
  clientId: string;
  clientSecret: string;
  apiVersion?: string;
}): AdminGraphQLClient {
  const version = opts.apiVersion ?? DEFAULT_API_VERSION;
  const endpoint = `https://${opts.shop}/admin/api/${version}/graphql.json`;
  const tokenEndpoint = `https://${opts.shop}/admin/oauth/access_token`;

  const mint = async (): Promise<string> => {
    let res: Response;
    try {
      res = await fetch(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
        }).toString(),
      });
    } catch (cause) {
      throw new SyncTransportError(`Token request to ${opts.shop} failed`, cause);
    }
    if (!res.ok) {
      // e.g. {"error":"shop_not_permitted"} — surface the body as the cause.
      throw new SyncTransportError(
        `Client-credentials token request returned HTTP ${res.status}`,
        await res.text().catch(() => null),
      );
    }
    const body = (await res.json().catch(() => null)) as { access_token?: string } | null;
    if (!body?.access_token) {
      throw new SyncTransportError(`Client-credentials token response had no access_token`, body);
    }
    return body.access_token;
  };

  let token: Promise<string> | undefined;
  return async (query, options) => {
    token ??= mint().catch((err) => {
      token = undefined; // a failed mint is not cached
      throw err;
    });
    const accessToken = await token;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
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
