# Changelog

## Unreleased

- **Merchant-owned pull (`--scope`).** `mm pull --scope merchant|all` enumerates
  merchant-owned metaobject definitions (codegen'd with `scope: "merchant"`) alongside or
  instead of app-owned ones, and — when a `metafields` module is configured — discovers
  merchant-owned metafield definitions store-wide across every known owner type. Any app's
  `app--…` reserved namespaces and Shopify's standard `shopify`/`shopify--…` namespaces are
  excluded; owner types the token can't read are skipped with a warning instead of failing.
  `--scope merchant` touches no `$app` material, so it skips the `auth: "cli"` app-scope
  guard — making pull usable under CLI auth for the first time. Library: `pullAll` takes
  `{ scope }` (replacing `appOwnedOnly`), and `discoverMerchantMetafields` is exported.
  See `docs/CLI.md` §4 Path B.
- **Opt-in Shopify-CLI auth mode.** Set `auth: "cli"` in the config and the CLI runs every
  Admin GraphQL call through the Shopify CLI's stored `shopify store auth` session via
  `shopify store execute` — no custom-app token required (`accessToken` becomes optional and
  is ignored). `createCliAdminClient` is exported from the `/node` subpath beside
  `createAdminClient`. Because a store session's "current app" is the Shopify CLI itself,
  `$app` material changes identity under CLI auth; `pull`, and `diff`/`push` involving
  app-scoped material, fail with an explanation unless `--allow-cli-app-scope` downgrades
  the error to a warning. Intended for `scope: "merchant"` workflows and dev stores — each
  call carries a few seconds of CLI process overhead. See `docs/CLI.md` §2.
- **Metafield-definition sync.** Declare typed metafield definitions on Shopify owner
  resources (product, customer, order, company, …) with `defineMetafields`, reusing the same
  `m.*` field builders as metaobjects. Point the config's `metafields` at the module and
  `diff`/`push` reconcile the declared definitions — after metaobject definitions (so
  `m.ref` targets exist), before entries — keyed by `(ownerType, namespace, key)`; `pull`
  re-pulls the declared pairs and regenerates the metafields module. App scope resolves to
  the `$app` reserved namespace and merchant scope to `custom`; only the *current* app's
  `app--<id>` spelling canonicalizes to `$app`, so other apps' definitions are never
  mistaken for managed ones. Type changes and undeclared-definition removes are destructive
  and gated behind `--allow-destructive` (deletes inside an app-reserved namespace always
  send `deleteAllAssociatedMetafields: true` — Shopify requires it, and the plan says so).
  See `docs/CLI.md` and `docs/SYNC.md`.
- **Token-scope empty-pull guard.** Shopify answers a metafield-definition read the token
  isn't scoped for with an *empty* list, not an error — which a diff would read as "nothing
  exists remotely" and plan to re-create everything. When an owner type's pull comes back
  empty, the CLI now checks the token's granted scopes (`currentAppInstallation {
  accessScopes }`) and fails naming the missing `read_*` scope instead of trusting the
  result. Covers the owners with documented scope mappings (products/customers/orders/
  companies groups); write counts as read, and an unreadable scope list degrades to no
  guard rather than a false block.
- **Metafield/metaobject parity fixes.** Flipping a metafield set from app to merchant
  scope now warns about the app-owned definitions it would orphan, like metaobject scope
  flips; two sets resolving to the same effective namespace (e.g. a default-namespace set
  and an explicit `custom` set under merchant config scope) are rejected at load time as
  duplicates, naming the rewrite; and metafields whose reference validations target a
  metaobject type whose create failed this run report `blocked` instead of bouncing off
  Shopify as userErrors (for type changes, before the delete — a doomed recreate can no
  longer wipe the existing definition).
- **New field builders:** `m.richText()`, `m.link()`, and `m.customer()` / `m.order()` /
  `m.company()` / `m.companyLocation()` reference builders — all round-trip through `pull`
  codegen.

## 0.9.0

- **Merchant-scope reference targets now push as definition GIDs.** Shopify's
  `metaobject_definition_type` validation only resolves app-reserved types, so
  `metaobjectDefinitionCreate`/`Update` rejected any `m.ref`/`m.mixedRef` pointing at a
  merchant-scoped (bare) type ("Validations require that you select a metaobject"). `push`
  now rewrites those validations to `metaobject_definition_id`/`_ids` at send time (ids come
  from `pull`, or from a create earlier in the same run), and pulled definitions are
  normalized back to the type-form canon before `diff`/codegen (`normalizeRemote` takes an
  optional `typeById` map), so round-trips stay clean. New `refValidationsToIds`/
  `refValidationsToTypes` helpers exported from the library root. App-reserved (`$app:`) ref
  targets keep the documented type-form behavior.

## 0.8.0

- **Multi-file schema declaration.** Declare each metaobject in its own module as
  `export default defineMetaobject(...)` and import them into the main schema module's
  `schemas` array; entry sets can be split the same way (`export default defineEntries(...)`
  per file, aggregated in the main entries module). `loadSchemas`/`loadEntries` now validate
  every element — a missing `export default` (which imports as `undefined`) fails fast naming
  the offending index, and two files declaring the same metaobject type are rejected as a
  duplicate. New `isMetaobjectSchema` type guard exported from the library root. `mm init`
  scaffolds the multi-file layout (`src/metaobjects/author.ts` + an aggregating
  `src/schema.ts`).

## 0.7.0

Version bump only (republish of 0.6.0).

## 0.6.0

- **Code-first metaobject entry management (upsert-only seed sync).** Declare seed entries
  with `defineEntries`, wire the module up via `entries` in the config, and `diff`/`push`
  plan and upsert them after definitions. Entries are never deleted.

## 0.5.0

Version bump only (republish of 0.4.0).

## 0.4.0

- **`m.mixedRef([...])`** — a mixed-reference field that can point at several metaobject
  types (Shopify's `mixed_reference`), plus `m.list(m.mixedRef([...]))` for the list form
  (`list.mixed_reference`). Round-trips through `pull` codegen (emitted as lazy thunks) and
  contributes create-ordering dependency edges like `m.ref`.
- **Reference cycles are now created two-pass instead of `blocked`.** `push` creates each
  definition in a reference cycle with its cycle-breaking ref fields stripped, then issues a
  follow-up `metaobjectDefinitionUpdate` to add them once every member exists. Non-create
  ops run last so they can target types created this run. A cycle member whose create fails
  still leaves the ref fields pointing at it `blocked`.

## 0.3.0

- **Metaobject configuration options.** Beyond fields, `defineMetaobject` accepts and
  reconciles definition metadata — `displayName`, `description`, `access`, `capabilities`,
  and app/merchant `scope` (with a store-wide default via `defineConfig`) — mapped into
  create payloads, drift-reconciled by `diff`/`push`, and round-tripped by `pull` codegen.

## 0.2.0

- `.env` loading for the Admin token; package renamed to `@fmaplabs/meta-manifest` with npm
  release setup; codegen emits lazy `m.ref` thunks; `push` exits `2` on `blocked` ops.

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
