# Changelog

## 0.1.0

Pivot to a standalone npm package + `mm` CLI.

- The repo is no longer a Shopify embedded app. It is now a single published package,
  `@fmaplabs/meta-manifest`, exposing a library entry (`import { defineMetaobject, m, defineConfig, ... }
  from "@fmaplabs/meta-manifest"`), a Node-only client entry (`import { createAdminClient } from
  "@fmaplabs/meta-manifest/node"`), and a CLI bin (`mm` / `meta-manifest`).
- New CLI commands: `init` (scaffold config + schema), `pull` (codegen `schema.ts` from a live
  store), `diff` (preview a sync plan), `push` (apply it, topologically ordered and
  destructive-gated behind `--allow-destructive`).
- The library API (`defineMetaobject`, `m.*` field builders, `parse`/`encode`,
  `toDefinitionInput`, `diff`/`pull`/`push`) is unchanged from the previous
  `@fmaplabs/meta-manifest` workspace package — this pivot only changes packaging and
  distribution, plus adds the CLI and standalone Admin API client on top.

Everything before this point in the repo's history was the Shopify app template this package
used to live inside; see git history for that changelog.
