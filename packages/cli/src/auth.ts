import type { Config } from "@fmaplabs/meta-manifest";
import type { AdminGraphQLClient } from "@fmaplabs/meta-manifest";
import type { MetaobjectSchema } from "@fmaplabs/meta-manifest";
import { createAdminClient } from "@fmaplabs/meta-manifest/node";
import { createCliAdminClient, type RunCommand } from "@fmaplabs/meta-manifest/node";
import { effectiveNamespace, effectiveScope } from "@fmaplabs/meta-manifest";
import { isAppReservedNamespace, type AnyMetafieldSet } from "@fmaplabs/meta-manifest";

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
 * material — for `pull` whenever its scope includes app-owned material (pullAll
 * would enumerate the CLI app's types, and `--force` could overwrite the schema
 * with an empty one; `--scope merchant` touches no `$app` material and is
 * exempt), and for `diff`/`push` only when a schema or metafield set actually
 * resolves to app scope. [plan §3]
 */
export function cliAuthAppScopeNotice(opts: {
  config: Config;
  command: "pull" | "diff" | "push";
  /** The pull's --scope; only "merchant" skips the guard. */
  pullScope?: "app" | "merchant" | "all";
  schemas?: AnySchema[];
  metafieldSets?: AnyMetafieldSet[];
}): string | null {
  const { config, command } = opts;
  if (config.auth !== "cli") return null;

  let trigger: string | null = null;
  if (command === "pull") {
    if (opts.pullScope === "merchant") return null;
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
