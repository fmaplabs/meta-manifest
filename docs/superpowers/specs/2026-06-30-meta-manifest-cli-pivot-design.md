# meta-manifest CLI/library pivot — design

**Date:** 2026-06-30
**Status:** Approved (brainstorming)
**Related:** [core SDK design](./2026-06-30-meta-manifest-schema-driven-metaobjects-design.md),
[sync adapter design](./2026-06-30-meta-manifest-sync-adapter-design.md)

## Context

`meta-manifest` is currently a **Shopify embedded app** (React Router 7, Polaris, Prisma
sessions) that contains a zero-dependency workspace library, `@meta-manifest/core`, for
declaring Shopify **metaobject definitions** and syncing them (pull → diff → push). The app is
the library's only consumer: it declares schema in `app/metaobjects/schema.ts` and drives sync
from a Polaris page (`app/routes/app.metaobjects.tsx`).

We are pivoting the repo into a **standalone published npm package + CLI**, in the mold of
[tento](https://github.com/drizzle-team/tento) but scoped to schema sync/migrations rather than
tento's runtime query client. The app is discarded.

The pivot is mostly **additive** because core is already transport-agnostic: every sync
operation talks to an injected `AdminGraphQLClient` interface. The app supplies a
*session-based* client (`admin.graphql`); the CLI will supply a *token-based standalone* client.
The `sync/` layer is untouched except for one new enumeration query.

## Goals

- Ship `meta-manifest` as a single, installable npm package exposing both a library (`import`)
  and a CLI (`mm` / `meta-manifest`).
- Provide `init`, `pull` (codegen), `diff`, and `push` commands driven by a `meta-manifest.config.ts`.
- Preserve the existing zero-dependency library surface and all current behavior/tests.

## Non-goals (v1)

- No runtime query client for metaobject *entries* (tento's headline feature) — roadmapped.
- No metafields (metaobjects only, as today).
- No support for store-native (non-app) metaobject definitions in `pull` codegen.

## Decisions (locked during brainstorming)

- **App fate:** strip the app; repo becomes a single, pure package (not a monorepo).
- **Scope (v1):** sync/migrations only — `defineMetaobject`, `m.*`, codecs, `diff`/`pull`/`push`.
- **`pull` behavior:** codegen — `pull` writes/overwrites `schema.ts` source (tento-style).
- **Packaging (Approach A):** one package; `bin` + subpath exports keep the `"."` library entry
  dependency-free in practice (CLI-only deps live behind the bin / `./node`).
- **Identity:** package `meta-manifest`, bin `meta-manifest` (+ `mm` alias), start `0.1.0`.

## Design

### 1. Target repo layout (single package)

```
meta-manifest/
├─ package.json          # public, versioned, bin + subpath exports
├─ tsup.config.ts        # build → dist/ (ESM+CJS+.d.ts); entries: index, node, cli
├─ tsconfig.json         # updated for new src layout
├─ vitest.config.ts      # moved up from packages/core/
├─ src/
│  ├─ index.ts           # "." export — the library, ZERO runtime deps (unchanged)
│  ├─ define.ts, infer.ts, definition-input.ts, standard-schema.ts   # unchanged
│  ├─ fields/            # unchanged
│  ├─ sync/              # unchanged + 1 new enumeration query & pullAll()
│  ├─ node/client.ts     # NEW · "./node" export · standalone token-based AdminGraphQLClient
│  ├─ config.ts          # NEW · defineConfig() + Config type + DEFAULT_API_VERSION
│  ├─ codegen.ts         # NEW · RemoteDefinition[] → schema.ts source
│  └─ cli/               # NEW · the bin
│     ├─ index.ts        # shebang, argv routing, config/client wiring, exit codes
│     ├─ init.ts  pull.ts  diff.ts  push.ts   # pure run* fns (client injected)
│     ├─ format.ts       # lifted verbatim from the deleted app route
│     └─ load-config.ts  # loads config + schema.ts via jiti
└─ dist/                 # built, published
```

**Deleted:** `app/`, `prisma/`, `extensions/`, `public/`, `.shopify/`, `.react-router/`,
`build/`, `shopify.app.toml`, `shopify.web.toml`, `vite.config.ts`, `.graphqlrc.ts`,
`Dockerfile`, `env.d.ts`, `.dockerignore`, `pnpm-workspace.yaml`, and all React Router /
Polaris / Prisma / Shopify-app dependencies. `packages/core/src` is promoted to `src/`.
Exploration confirmed **only `app/` imports `@meta-manifest/core`** (the one other mention, in
`vite.config.ts`, is a comment), so deleting the app breaks nothing else.

**package.json highlights:** `name: "meta-manifest"`, not `private`, `version: 0.1.0`,
`type: "module"`; `bin: { "meta-manifest": "./dist/cli/index.js", "mm": "./dist/cli/index.js" }`;
`exports`: `"."` → library (dep-free), `"./node"` → standalone client; `files: ["dist"]`;
`dependencies`: `jiti` + a tiny arg parser (or hand-rolled — the `"."` entry imports neither);
`devDependencies`: `tsup`, `typescript`, `vitest`, `tsx`; scripts `build`/`test`/`typecheck`/
`prepublishOnly`. **Invariant:** `src/index.ts` and its transitive imports stay zero-dependency
and otherwise unchanged.

### 2. Config & auth (standalone client)

`meta-manifest.config.ts` (safe to commit; secret from env):

```ts
import { defineConfig } from "meta-manifest";

export default defineConfig({
  shop: "my-store.myshopify.com",
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  apiVersion: "2026-07",           // optional; defaults to DEFAULT_API_VERSION in config.ts
  schema: "./src/schema.ts",       // where pull writes, diff/push read
});
```

`defineConfig` is an identity helper for types. `src/node/client.ts` —
`createAdminClient({ shop, accessToken, apiVersion })` — returns an `AdminGraphQLClient` that
POSTs to `https://{shop}/admin/api/{apiVersion}/graphql.json` with `X-Shopify-Access-Token`,
returns `{ data, errors }`, and throws core's `SyncTransportError` on non-OK/network failure —
the same contract the app's `makeClient` honored, so `pull`/`diff`/`push` behave identically.

### 3. CLI commands

| Command | Behavior | Exit |
|---|---|---|
| `mm init` | Scaffold `meta-manifest.config.ts` + starter `schema.ts`; print next steps. No network. | 0 / 1 |
| `mm pull` | `pullAll` (paginated enumerate) → codegen → write `config.schema` (overwrite; warn if exists). | 0 / 1 |
| `mm diff` | Load `schema.ts`, `pull(types)`, `normalize` → `diff`, print plan. Read-only. | 0 / 1 |
| `mm push` | `diff` then `push` (topo-ordered, destructive-gated); `--allow-destructive`. Print per-op results. | 0 / 1 / 2 |

Commands are **pure functions** (`runPull/runDiff/runPush({ client, config, ... })`); only
`src/cli/index.ts` loads config + constructs the real client, so every command is unit-testable
against a fake client — matching core's dependency-injection style. The presentation helpers
`opTarget`/`isDestructive`/`describeOp`/`describeResult` are lifted verbatim from the deleted
app route into `src/cli/format.ts`.

**One new query.** Existing pull is BY TYPE (`metaobjectDefinitionByType`), which serves
`diff`/`push` (the local schema supplies the types). Codegen `pull` bootstraps from a store with
no local schema, so it needs an **enumeration** query (`metaobjectDefinitions(first, after)`,
paginated) added to `sync/client.ts`, plus a `pullAll()` in `sync/pull.ts`. This is the only
change to the existing sync layer.

### 4. Codegen (`src/codegen.ts`)

Inverse of `toDefinitionInput()`: `generateSchemaSource(defs: RemoteDefinition[]): string`.

- Each definition → `defineMetaobject("<handle>", { name, ...fields })`, where `handle` is the
  `$app:`-stripped base type (schema's `.handle`; `define.ts` sets `type = "$app:" + handle`).
- Each `RemoteField` (`type: string` + `validations: {name,value}[]`) → the matching `m.*` call
  via the reverse map below.
- References (`metaobject_reference` / `list.metaobject_reference`) resolve to a **local const**
  identified by reading the `metaobject_definition_type` **and** `metaobject_definition_types`
  validations; emitted consts are **topologically ordered** (referenced types first), using the
  same edge logic as `referenceEdges` (`push.ts`) but over `RemoteField.validations`.
- Identifiers PascalCased from type (`product_spec → ProductSpec`); trailing
  `export const schemas = [...]`.
- Formatting: emit tidy source; run through `prettier` only if the user's project resolves it,
  else leave as-is. No hard `prettier` dependency. Unmapped types/validations → `// TODO: unmapped …`
  comment + warning, never silently dropped.
- **v1 filters `pullAll` to app-owned definitions** (reserved `$app:` types) because
  `defineMetaobject` only models app-owned types; store-native definitions can't round-trip
  through this package. Non-app definitions are skipped with a logged notice.
- **Correctness bar:** `pull` then `diff` reports **no changes** (round-trip fidelity).

**Reverse map (Shopify `type` + validations → `m.*`):**

| Shopify `type` | Builder | Validations → options |
|---|---|---|
| `single_line_text_field` | `m.text` | `min`,`max`→num; `regex`→str; `choices`→JSON.parse |
| `multi_line_text_field` | `m.multilineText` | `min`,`max`,`regex` |
| `number_integer` | `m.integer` | `min`,`max` |
| `number_decimal` | `m.decimal` | `min`,`max`,`max_precision`→`maxPrecision` |
| `boolean` | `m.boolean` | — |
| `date` | `m.date` | `min`,`max` (ISO) |
| `date_time` | `m.dateTime` | `min`,`max` (ISO) |
| `url` | `m.url` | `allowed_domains`→`allowedDomains` (JSON.parse) |
| `color` | `m.color` | — |
| `json` | `m.json` | — |
| `money` | `m.money` | — |
| `dimension`/`weight`/`volume` | `m.dimension`/`m.weight`/`m.volume` | — |
| `rating` | `m.rating` | `min`,`max` **required** — extract from validations |
| `product_reference`/`variant_reference`/`collection_reference`/`page_reference` | `m.product`/`m.variant`/`m.collection`/`m.page` | — |
| `file_reference` | `m.file` | `file_type_options`→`accept` (JSON.parse) |
| `metaobject_reference` | `m.ref(<LocalConst>)` | `metaobject_definition_type`(s) → target const |
| `list.<X>` | `m.list(m.<X>(…), { min?, max? })` | inner validations + `list.min`→`min`, `list.max`→`max` |

Exploration found **no field types without an inverse builder**.

### 5. Error handling & exit codes

- Config errors (missing file / `shop` / token / `schema`) → one-line message, **exit 1**, no stack trace.
- `SyncTransportError` → friendly message (app-style wording), **exit 1**.
- `push` with any `failed` op → print each (`describeResult`), **exit 2** (CI-detectable partial failure).
- Destructive plan without `--allow-destructive` → destructive ops become `skipped` (existing
  `push` behavior), print a "re-run with --allow-destructive" hint, **exit 0**.

### 6. Testing

Extends the existing vitest suite (`vitest.config.ts`, glob `src/**/*.test.ts`; mock clients are
hand-written dispatchers keyed on the query constants — reuse that `fakeStore` pattern). All
current field/define/diff/pull/push tests stay.

- **Codegen round-trip (headline):** from fixture `RemoteDefinition[]`, `generateSchemaSource`
  → write temp file → load via `jiti` → `normalizeLocal` → `diff` vs source → assert `[]`. Plus a
  source snapshot for representative definitions.
- **Standalone client:** `vi.stubGlobal("fetch", …)`; assert URL/method/headers/body,
  `{data,errors}` passthrough, `SyncTransportError` on non-OK.
- **`pullAll` pagination:** fake client returning `pageInfo.hasNextPage` across pages.
- **Config/loader:** fixture config via `jiti`; validation errors on missing fields.
- **Commands:** `runPull/runDiff/runPush` against a fake client + temp schema file — no network.

## Risks & call-outs

- **Heterogeneous schema array + `normalizeLocal` typing:** the app dodged this by calling
  `normalizeLocal` per schema (`[normalizeLocal(Material), normalizeLocal(Product)]`). The CLI
  loads schemas dynamically and must `schemas.map(normalizeLocal)`. Mitigation: export an
  `AnySchema` alias (`MetaobjectSchema<FieldMap>`), type loaded `schemas` as `AnySchema[]`, and
  confirm `normalizeLocal`'s parameter accepts it without generic-inference breakage (loosen its
  signature to the base schema shape if needed). Verify with `pnpm typecheck`.
- **Loading TS `schema.ts` at runtime** for `diff`/`push` uses the same `jiti` loader as config.
- **Reference validation key variance:** `m.ref` emits `metaobject_definition_type` (singular);
  Shopify/`referenceEdges` also handle `metaobject_definition_types` (plural). Codegen reads both.
- **Non-app definitions:** v1 `pull` filters to app-owned (`$app:`) types; store-native
  definitions are skipped with a notice (they can't round-trip through `defineMetaobject`).

## Verification

1. `pnpm test` — all green, especially the codegen **round-trip** (`pull → diff` == no changes).
2. `pnpm typecheck` (`tsc --noEmit`) clean — confirms the `AnySchema` typing fix.
3. `pnpm build` — `dist/` emitted with `.d.ts`; `"."` and `"./node"` exports resolve.
4. `npm pack --dry-run` — tarball contains only `dist/` + `README` + `package.json`; both bins present.
5. Smoke: in a temp dir, `node dist/cli/index.js init` scaffolds config + `schema.ts`;
   `node dist/cli/index.js --help` works.
6. End-to-end (fake or real store): set `SHOPIFY_ADMIN_TOKEN`, `mm pull` writes `schema.ts`,
   `mm diff` reports **no changes** (round-trip proof), `mm push` applies a deliberate edit.
