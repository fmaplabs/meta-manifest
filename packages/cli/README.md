# @fmaplabs/meta-manifest-cli

The `mm` / `meta-manifest` CLI for
[`@fmaplabs/meta-manifest`](https://www.npmjs.com/package/@fmaplabs/meta-manifest):
keeps a Shopify store's metaobject & metafield definitions (and optional seed
entries) in sync with schema declared in code, via `pull` → `diff` → `push`.

## Install

```bash
npm i -D @fmaplabs/meta-manifest @fmaplabs/meta-manifest-cli
# or: pnpm add -D @fmaplabs/meta-manifest @fmaplabs/meta-manifest-cli
```

The library package provides the builders your schema imports; this package provides
the `mm` and `meta-manifest` bins.

## Quick start

```bash
npx mm init   # scaffold meta-manifest.config.ts + a starter src/schema.ts
npx mm pull   # bootstrap schema.ts from a store's existing definitions (skip if starting fresh)
npx mm diff   # preview what push would change
npx mm push   # apply it
```

Authenticate one of two ways:

- **Admin API token** (default) — create a custom app in the store admin
  (**Settings → Apps and sales channels → Develop apps**), grant it
  `read_metaobject_definitions`/`write_metaobject_definitions`, and expose the token
  as `SHOPIFY_ADMIN_TOKEN` (exported, or in a `.env` the CLI loads automatically).
- **Shopify CLI session** — no custom app needed: set `auth: "cli"` in the config and
  run `shopify store auth --store my-store.myshopify.com --scopes read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects`
  once. Calls then go through `shopify store execute` (a few seconds of overhead per
  call; meant for `scope: "merchant"` workflows — under CLI auth, `$app`-scoped
  material resolves to the Shopify CLI's own app identity, so the CLI refuses
  app-scoped operations unless you pass `--allow-cli-app-scope`).

## Config

`meta-manifest.config.ts` (safe to commit — the token comes from the environment):

```ts
import { defineConfig } from "@fmaplabs/meta-manifest";

export default defineConfig({
  shop: "my-store.myshopify.com",
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  // auth: "cli",                    // optional; use a `shopify store auth` session instead
  apiVersion: "2026-07",             // optional
  schema: "./src/schema.ts",         // where `pull` writes, `diff`/`push` read
  entries: "./src/entries.ts",       // optional; seed entries to upsert on push
  metafields: "./src/metafields.ts", // optional; metafield-definition sets to reconcile
  scope: "app",                      // optional; "app" (default) | "merchant"
  merchantEditable: false,           // optional; default admin access for app-scoped metaobjects
});
```

The config and schema/entries/metafields modules are TypeScript, loaded directly via
[jiti](https://github.com/unjs/jiti) — no build step.

## Commands

| Command  | Behavior | Exit |
|----------|----------|------|
| `mm init` | Scaffold `meta-manifest.config.ts` + a starter schema. No network. | 0 / 1 |
| `mm pull` | Enumerate the store's definitions and **codegen** the schema module (overwrites it). With `metafields` configured, also re-pulls the declared `(owner, namespace)` pairs. | 0 / 1 |
| `mm diff` | Compare local schema against the store and print the plan. Read-only; exits 0 even when there is drift. | 0 / 1 |
| `mm push` | Diff, then apply: topologically ordered (referenced types created first) and **destructive-gated** — field removals / type changes are skipped unless `--allow-destructive`. Metafield definitions push after metaobject definitions; declared entries last. | 0 / 1 / 2 |

`mm push` exits `2` if any operation failed or was blocked (so CI can detect a partial
failure), `1` on a config/transport error, and `0` otherwise — including when
destructive ops were skipped.

## Flags

- `--config <path>` — use a non-default config file.
- `--allow-destructive` — apply destructive changes (`removeField`/`changeFieldType`,
  metafield remove/type-change) on push.
- `--scope <app|merchant|all>` — on `pull`, which ownership scope to enumerate.
- `--allow-cli-app-scope` — under `auth: "cli"`, downgrade the app-scope hard error to
  a warning (dev-store experimentation only).
- `--force` — overwrite the schema file on `pull` without the warning.

Value-taking flags accept both `--flag value` and `--flag=value`; unknown flags are an
error.

## Docs

- [Repository README](https://github.com/fmaplabs/meta-manifest#readme) — schema builders, config options, metafields, seed entries.
- [`docs/CLI.md`](https://github.com/fmaplabs/meta-manifest/blob/HEAD/docs/CLI.md) — step-by-step walkthrough with example output, token scopes, CI usage.
- [`docs/SYNC.md`](https://github.com/fmaplabs/meta-manifest/blob/HEAD/docs/SYNC.md) — sync engine internals.
- [`CHANGELOG.md`](https://github.com/fmaplabs/meta-manifest/blob/HEAD/CHANGELOG.md)

## License

MIT
