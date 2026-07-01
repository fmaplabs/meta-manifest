# CLI quick start & usage guide

The `mm` CLI (also available as `meta-manifest`) keeps a Shopify store's
**metaobject definitions** in sync with schema you declare in code. You define
your definitions once with `defineMetaobject(...)`, and the CLI reconciles them
against a live store: `pull` → `diff` → `push`.

This is a narrative walk-through. For the terse command/flag/exit-code reference,
see the [`## CLI` section of the README](../README.md#cli). For the underlying
sync model (how the plan is computed, dependency ordering, error channels), see
[`SYNC.md`](./SYNC.md).

---

## 1. Install

Install into the project whose schema you want to sync:

```bash
npm i -D @fmaplabs/meta-manifest
# or
pnpm add -D @fmaplabs/meta-manifest
```

This puts both `mm` and `meta-manifest` on your `PATH` via `npx` / your package
runner. Every example below uses `npx mm …`; `npx meta-manifest …` is identical.

You need Node `>=20.19 <22 || >=22.12` (see `engines` in `package.json`).

---

## 2. Get an Admin API token

Every command except `init` talks to a store over the Admin GraphQL API, so you
need an access token with the right scopes:

| Command        | Required scope                                                    |
| -------------- | ---------------------------------------------------------------- |
| `pull`, `diff` | `read_metaobject_definitions`                                    |
| `push`         | `write_metaobject_definitions` (implies read)                   |

The simplest way to get one is a **custom app** created in the store's admin
(**Settings → Apps and sales channels → Develop apps**), which issues an Admin
API access token you grant the scopes above. See Shopify's
[custom-app / Admin API access token docs](https://help.shopify.com/en/manual/apps/app-types/custom-apps)
for the current click-path.

Provide the token before running any networked command — the config file reads it
from the environment so it's safe to commit. Either export it:

```bash
export SHOPIFY_ADMIN_TOKEN="shpat_…"
```

or put it in a `.env` file in the project root, which the CLI loads automatically
(a real exported variable wins over the file, and a missing `.env` is ignored):

```bash
# .env
SHOPIFY_ADMIN_TOKEN=shpat_…
```

---

## 3. Scaffold the project

```bash
npx mm init
```

`init` never touches the network and never overwrites existing files. It writes:

```
Created: meta-manifest.config.ts, src/schema.ts
Next: set SHOPIFY_ADMIN_TOKEN (export it or add it to .env), edit meta-manifest.config.ts, then run `mm diff`.
```

(If both files already exist you'll get `Nothing to do — config and schema already exist.`)

Two files land in your project:

**`meta-manifest.config.ts`** — safe to commit; the token comes from the environment:

```ts
import { defineConfig } from "@fmaplabs/meta-manifest";

export default defineConfig({
  shop: "my-store.myshopify.com",
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  // apiVersion: "2026-07", // optional; defaults to the package's DEFAULT_API_VERSION
  schema: "./src/schema.ts", // where pull writes, and diff/push read
  // scope: "app",           // optional; "app" (default) | "merchant" — applies to all metaobjects
  // merchantEditable: false, // optional; default admin access for app-scoped metaobjects
});
```

Edit `shop` to point at your store. `shop`, `accessToken`, and `schema` are
required — an empty or missing one aborts with
`Invalid config: missing or empty "…"`. `scope` and `merchantEditable` are
optional store-wide defaults (each metaobject can override `scope` locally) — see
the [configuration options table](../README.md#configuration-options).

**`src/schema.ts`** — a starter definition. The key requirement: the module must
export a `schemas` array. That array is what `diff` and `push` read.

```ts
import { defineMetaobject, m } from "@fmaplabs/meta-manifest";

export const Author = defineMetaobject("author", {
  name: "Author",
  fields: {
    name: m.text({ required: true, max: 120 }),
    bio: m.multilineText(),
  },
});

export const schemas = [Author];
```

`m` is the field builder namespace (`m.text`, `m.money`, `m.rating`, `m.ref`,
`m.list`, …). Beyond fields, `defineMetaobject` accepts `scope`, `displayName`,
`access` (`admin`/`storefront`/`customerAccount`), and `capabilities`
(`publishable`/`translatable`/`renderable`/`onlineStore`), and every field builder
takes `filterable` — all reconciled by `diff`/`push`. For the full field catalog
and the options table, see the
[README library section](../README.md#library-usage) /
[configuration options](../README.md#configuration-options) and [`SYNC.md`](./SYNC.md).

---

## 4. Pick your starting point

There are two ways in. Choose based on whether the store already has definitions.

### Path A — greenfield (define in code first)

You're authoring definitions from scratch. Edit `src/schema.ts` to declare what
you want, then jump to [step 5](#5-preview-with-diff). This is the flow the
`init` hint points at.

### Path B — bootstrap from an existing store (`pull`)

The store already has app-owned metaobject definitions and you want them mirrored
into code. `pull` enumerates them and **generates** `src/schema.ts` for you
(tento-style codegen):

```bash
npx mm pull
```

```
Wrote 3 definitions to ./src/schema.ts.
```

`pull` **overwrites** the schema file. If one already exists you'll see a warning
first (`Overwriting existing ./src/schema.ts.`); pass `--force` to suppress it in
scripts. `pull` reads app-owned (`$app:`) definitions only. The generated schema
captures each definition's `displayName`, `access`, `capabilities`, and per-field
`filterable`, so a follow-up `diff` round-trips cleanly. If the store has prettier
installed, the generated source is formatted with it.

After `pull`, treat `src/schema.ts` as your source of truth — edit it in code,
then continue to `diff`/`push`. Re-running `pull` throws your local edits away, so
only re-pull when you deliberately want to re-baseline from the store.

---

## 5. Preview with `diff`

`diff` loads `src/schema.ts`, reads the store, and prints the plan `push` *would*
apply. It's read-only — nothing changes.

```bash
npx mm diff
```

When there's work to do:

```
2 changes would be applied:
  createDefinition: $app:author
  addField: $app:author.bio
```

When local and remote already match:

```
Everything is in sync — nothing to apply.
```

Each line is `<kind>: <target>`, and destructive ops are tagged ` · destructive`
(e.g. `removeField: $app:author.old_field · destructive`). The op kinds are
`createDefinition`, `updateDefinition` (name/description/displayName/access/
capabilities drift), `addField`, `updateField`, `changeFieldType` (destructive),
and `removeField` (destructive) — see [`SYNC.md` §4](./SYNC.md#4-diff). An
`updateDefinition` that **disables `onlineStore`** is also destructive (it removes
live web pages).

If a metaobject's `scope` changed since it was created, `diff`/`push` print a
`Warning:` line — `type` is immutable, so the old definition is orphaned rather
than migrated (see [`SYNC.md` §3](./SYNC.md#3-pull)).

---

## 6. Apply with `push`

`push` computes the same plan and applies it. Creates are **topologically
ordered** (a referenced type is created before the type that references it), and
**destructive ops are gated** — `removeField`, `changeFieldType`, and an
`updateDefinition` that disables `onlineStore` are skipped unless you opt in.

```bash
npx mm push
```

Each op prints its outcome, followed by a summary line:

```
  ✓ applied — createDefinition: $app:author
  ✓ applied — addField: $app:author.bio
  – skipped (destructive) — removeField: $app:author.old_field
applied 2 · skipped 1 · blocked 0 · failed 0
Some destructive changes were skipped. Re-run with --allow-destructive to apply them.
```

The four op statuses:

- **`✓ applied`** — the mutation ran and succeeded.
- **`– skipped`** — a destructive op you didn't opt into.
- **`⚠ blocked`** — couldn't run (an unmet dependency, or a reference cycle among
  the types being created).
- **`✗ failed`** — the mutation ran but Shopify returned errors.

To apply the destructive ops too:

```bash
npx mm push --allow-destructive
```

> ⚠️ `--allow-destructive` lets `push` remove fields, change field types, and
> disable `onlineStore` (removing live web pages) on the store. Run `diff` first
> and read the ` · destructive` lines so you know exactly what will be dropped.

---

## 7. Flags & alternate configs

The full flag list lives in the [README](../README.md#flags). The three you'll
reach for:

- `--config <path>` — use a config file other than `meta-manifest.config.ts`.
  Handy for per-environment configs:

  ```bash
  npx mm diff --config ./staging.config.ts
  npx mm push --config ./prod.config.ts --allow-destructive
  ```

- `--allow-destructive` — apply `removeField` / `changeFieldType` / `onlineStore`
  disable on `push`.
- `--force` — skip the "overwriting" warning on `pull`.

`mm --help` (or `-h`) prints usage and exits.

---

## 8. Exit codes & CI

The exit codes are what a CI gate keys off of:

| Code | Meaning                                                                             |
| ---- | ---------------------------------------------------------------------------------- |
| `0`  | Success. **Also returned when destructive ops were skipped** — a skip is not a failure. |
| `1`  | A config or transport error (bad/missing config, Shopify rejected a request).      |
| `2`  | **`push` only** — one or more ops `failed` **or** `blocked`, so the store is partially applied. |

The important subtleties:

- **Skipped ≠ failure.** A `push` that skips destructive ops (because you didn't
  pass `--allow-destructive`) still exits `0`. Only `failed` and `blocked` ops
  drive the exit-`2` path.
- **Only `push` can exit `2`.** `pull` and `diff` are `0` on success, `1` on error.

A typical CI pipeline previews on every PR and applies on merge:

```bash
# On a pull request — surface the plan, fail the job only on config/transport errors.
# Note: diff exits 0 even when there IS drift (there's no --check mode), so don't
# wire it up as a "fail if out of sync" gate — it only fails on a config/transport error.
npx mm diff

# On merge to main — apply non-destructive changes; a non-zero exit fails the job.
npx mm push
```

Because a partial `push` exits `2`, CI catches it automatically — e.g. a
reference cycle among newly-created definitions leaves `blocked` ops and a
non-zero exit. Inspect the per-op lines in the log to see which. Keep
`--allow-destructive` off in automated pushes unless the destructive change is
intentional and reviewed.

---

## Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| `Invalid config: missing or empty "shop"` (or `accessToken` / `schema`) | The config's required field is unset. Check
`meta-manifest.config.ts` (or the `--config` file). Because the config reads the token via
`process.env.SHOPIFY_ADMIN_TOKEN!`, **an unset token surfaces here as `accessToken`** — export it or add it to `.env` (step 2). |
| `Schema module "…" must export a schemas array.` | `src/schema.ts` doesn't `export const schemas = [...]`. Add it. |
| `Sync failed: Shopify rejected a request.` (exit 1) | The request reached Shopify and was refused — a bad or expired
token (present but rejected), a wrong `shop`, or missing scopes. |
| `push` exits `2` with `⚠ blocked` lines | Ops couldn't run — an unmet dependency or a reference cycle among created
types. See [`SYNC.md` §5](./SYNC.md#5-push). |
| `push` exits `2` with `✗ failed` lines | Shopify returned `userErrors` for that op (e.g. an invalid validation). The message is in the line. |
| Destructive changes won't apply | Expected — pass `--allow-destructive` (covers `removeField`, `changeFieldType`, and `onlineStore` disable). |
| `Warning: "…" is merchant-scoped but an app-owned "$app:…" already exists` | You changed a definition's `scope` after it was created. `type` is immutable, so `push` creates a new merchant-owned definition and orphans the app-owned one; migrate entries manually ([`SYNC.md` §3](./SYNC.md#3-pull)). |
| `pull` warns it's overwriting | Expected — it regenerates the file. Pass `--force` to silence, or commit first so you can diff the regeneration. |

---

## Command summary

| Command | What it does | Network | Exits |
| ------- | ------------ | ------- | ----- |
| `mm init` | Scaffold `meta-manifest.config.ts` + `src/schema.ts` (never overwrites). | no | 0 / 1 |
| `mm pull` | Generate `schema.ts` from the store's app-owned definitions. | yes | 0 / 1 |
| `mm diff` | Print the plan `push` would apply. Read-only. | yes | 0 / 1 |
| `mm push` | Apply the plan (ordered, destructive-gated). | yes | 0 / 1 / 2 |

See also: [README CLI reference](../README.md#cli) · [SYNC.md sync model](./SYNC.md).
