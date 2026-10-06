import type { Config } from "../config";
import type { AdminGraphQLClient } from "../sync/client";
import type { MetaobjectSchema } from "../define";
import { createAdminClient } from "../node/client";
import { createCliAdminClient, type RunCommand } from "../node/cli-client";
import { effectiveNamespace, effectiveScope } from "../sync/resolve";
import { isAppReservedNamespace, type AnyMetafieldSet } from "../metafields";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = MetaobjectSchema<any>;

/** Pick the Admin client for the config's auth mode: `"cli"` → `shopify store execute`, otherwise the token-based fetch client. */
export function selectAdminClient(config: Config, deps?: { run?: RunCommand }): AdminGraphQLClient {
  if (config.auth === "cli") {
    return createCliAdminClient({ shop: config.shop, apiVersion: config.apiVersion, run: deps?.run });
  }
  return createAdminClient(config);
}

/**
 * Under `auth: "cli"`, `$app` material resolves to the *Shopify CLI's* app
 * identity, not yours. Returns the explanation to raise (hard error, or a
 * warning under --allow-cli-app-scope) when the command would touch app-scoped
 * material — always for `pull` (pullAll enumerates the CLI app's types, and
 * `--force` could overwrite the schema with an empty one), and for `diff`/`push`
 * only when a schema or metafield set actually resolves to app scope. [plan §3]
 */
export function cliAuthAppScopeNotice(opts: {
  config: Config;
  command: "pull" | "diff" | "push";
  schemas?: AnySchema[];
  metafieldSets?: AnyMetafieldSet[];
}): string | null {
  const { config, command } = opts;
  if (config.auth !== "cli") return null;

  let trigger: string | null = null;
  if (command === "pull") {
    trigger = "pull enumerates app-owned ($app) material";
  } else {
    const appSchema = (opts.schemas ?? []).find((s) => effectiveScope(s, config) === "app");
    if (appSchema) {
      trigger = `metaobject "${appSchema.handle}" resolves to app scope`;
    } else {
      const appSet = (opts.metafieldSets ?? []).find((set) =>
        isAppReservedNamespace(effectiveNamespace(set.namespace, set.scope ?? config.scope ?? "app")),
      );
      if (appSet) trigger = `a "${appSet.owner}" metafield set resolves to the $app namespace`;
    }
  }
  if (trigger === null) return null;

  return (
    `Cannot ${command} under auth: "cli" — ${trigger}, but a Shopify CLI session's "$app" is the Shopify CLI's own app, not yours. ` +
    `App-scoped definitions pushed this way get reserved under the CLI app's namespace (app--…) and are unusable by your app` +
    (command === "pull" ? `, and pull would list the CLI app's (likely empty) definitions instead of your app's` : ``) +
    `.\n` +
    `Use scope: "merchant" (and explicit metafield namespaces), or token auth for app-scoped material. ` +
    `Pass --allow-cli-app-scope to continue anyway (dev-store experimentation only).`
  );
}
