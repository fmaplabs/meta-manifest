# Changelog

## Unreleased

- **Multi-file schema declaration.** Declare each metaobject in its own module as
  `export default defineMetaobject(...)` and import them into the main schema module's
  `schemas` array; entry sets can be split the same way (`export default defineEntries(...)`
  per file, aggregated in the main entries module). `loadSchemas`/`loadEntries` now validate
  every element — a missing `export default` (which imports as `undefined`) fails fast naming
  the offending index, and two files declaring the same metaobject type are rejected as a
  duplicate. New `isMetaobjectSchema` type guard exported from the library root. `mm init`
  scaffolds the multi-file layout (`src/metaobjects/author.ts` + an aggregating
  `src/schema.ts`).
- **`m.mixedRef([...])`** — a mixed-reference field that can point at several metaobject
  types (Shopify's `mixed_reference`), plus `m.list(m.mixedRef([...]))` for the list form
  (`list.mixed_reference`). Round-trips through `pull` codegen (emitted as lazy thunks) and
  contributes create-ordering dependency edges like `m.ref`.
- **Reference cycles are now created two-pass instead of `blocked`.** `push` creates each
  definition in a reference cycle with its cycle-breaking ref fields stripped, then issues a
  follow-up `metaobjectDefinitionUpdate` to add them once every member exists. Non-create
  ops run last so they can target types created this run. A cycle member whose create fails
  still leaves the ref fields pointing at it `blocked`.

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
