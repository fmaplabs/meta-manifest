# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pnpm + Turborepo workspace publishing two packages:

- `packages/core` — `@fmaplabs/meta-manifest`: zero-runtime-dependency, zod-style builders for Shopify metaobject & metafield definitions, plus the pull → diff → push sync engine. Exports `.` and `./node`.
- `packages/cli` — `@fmaplabs/meta-manifest-cli`: the `mm` / `meta-manifest` CLI. Owns the `jiti` dependency and depends on core via `workspace:^`.

The CLI imports core only through the package specifiers `@fmaplabs/meta-manifest` and `@fmaplabs/meta-manifest/node`; core never imports from the CLI. Keep that direction.

Note the directory/repo name mismatch: this checkout lives at `meta-manifest-core/` but is the `fmaplabs/meta-manifest` repo. The sibling `meta-manifest-app/` directory is a separate git repo (a Shopify app with its own deploy pipeline) — not part of this workspace.

## Commands

```bash
pnpm install
pnpm build        # turbo run build  (core builds before cli; outputs dist/)
pnpm test         # turbo run test
pnpm typecheck    # turbo run typecheck
```

Per package (from `packages/core` or `packages/cli`):

```bash
pnpm test                         # vitest run
pnpm vitest run src/plan.test.ts  # single file
pnpm vitest run -t "name"         # single test by name
pnpm test:watch
```

`turbo` makes `test`/`typecheck` depend on `^build`, so core's `dist/` exists first. If you bypass turbo: CLI **typecheck** needs core built (resolves `dist/*.d.ts` via the workspace symlink); CLI **tests** do not (fixtures import `../core/src/index.ts` directly through jiti).

Run the built CLI without publishing: `node packages/cli/dist/index.js <command>`.

pnpm 12 only runs dependency build scripts allowlisted under `allowBuilds` in `pnpm-workspace.yaml` (currently just esbuild) — add new native deps there or their postinstall is silently skipped.

Releases are manual per package: bump the version by hand, then `pnpm release` (test + typecheck + publish) from that package's directory. There are no version-bump scripts — two packages would collide on the same `vX.Y.Z` git tag.

## Architecture

The pipeline is `define → pull → diff → push` (see `docs/SYNC.md` for the full walkthrough):

- **Builders** (core `src/fields/`, `define.ts`, `metafields.ts`, `entries.ts`): `m.*` field builders feed `defineMetaobject` / `defineMetafields` / `defineEntries`. Schemas implement Standard Schema (`standard-schema.ts`) and are the source of truth.
- **Sync engine** (core `src/sync/`): `pull` and `push` are the only networked edges; `diff` / `normalize` / `resolve` are pure. All network access goes through the injected `AdminGraphQLClient` interface (`sync/client.ts`), which also holds the raw GraphQL document strings as exported constants.
- **Clients** (core `src/node/`): `createAdminClient` (Admin API token) and `createCliAdminClient` (shells out to `shopify store execute` for CLI-session auth). `node/cli-client.ts` belongs to core's `./node` export — it is not part of the CLI package despite the name.
- **CLI** (`packages/cli/src/`): command dispatch in `index.ts` (`init` / `pull` / `diff` / `push`); loads the user's `meta-manifest.config.ts` and schema/entries/metafields modules via jiti (`load-config.ts`); picks the auth client in `auth.ts`; `plan.ts` + `format.ts` turn diff ops into human output.

### Constraints that aren't obvious from any single file

- **Core's public API is exactly `src/index.ts` re-exports.** tsup bundles, so anything not re-exported there does not exist in `dist` — the CLI (and consumers) cannot deep-import core modules. If the CLI needs a new core symbol, export it from core's `index.ts`.
- **Core stays zero-runtime-dependency.** jiti appears in core only as a devDependency (codegen tests execute generated modules with it).
- **The CLI is ESM-only** (uses `import.meta.url`); its tsup config must not add a CJS build. Core builds both ESM and CJS.
- **Tests fake the store by exact query match.** Fakes implement `AdminGraphQLClient` and compare incoming queries against the exported GraphQL constants (`PULL_DEFINITION_QUERY` etc.) by identity. The `*.e2e.test.ts` files also run against in-memory fakes — no live store or credentials needed; they run in CI.
- Several tests write temp fixture modules whose import paths are built from `process.cwd()` — they assume the package directory is the cwd, which vitest guarantees. Keep that in mind when moving test files between packages.

## Docs

- `README.md` — library usage, config options, metafields, seed entries, CLI flags.
- `docs/CLI.md` — CLI walkthrough end to end, auth setup, exit codes / CI usage (note: `diff` exits 0 even when there is drift).
- `docs/SYNC.md` — sync engine internals and client wiring.
- `CHANGELOG.md` — update the `## Unreleased` section with user-visible changes.
- `AGENTS.md` — auto-generated and re-added by `turbo` itself; keep it committed, don't hand-edit the managed block.
