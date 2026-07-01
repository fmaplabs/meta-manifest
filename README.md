# meta-manifest

A zero-dependency, zod-style builder for Shopify **metaobject definitions**, plus a CLI
(`mm` / `meta-manifest`) that keeps a store's definitions in sync with schema declared in code.
Think [tento](https://github.com/drizzle-team/tento), but scoped to metaobject-definition
schema/migrations rather than a runtime query client (see [Roadmap](#roadmap-runtime-query-client)
below).

`meta-manifest` is **not** a runtime client for reading/writing metaobject *entries* — it declares
definitions, validates values against them, and syncs the definitions themselves (create/update
fields) to a store via `pull` → `diff` → `push`.

## Install

```bash
npm i -D @fmaplabs/meta-manifest
# or
pnpm add -D @fmaplabs/meta-manifest
```

## Library usage

Declare a metaobject with `defineMetaobject` and the `m` field builders. Implements
[Standard Schema](https://github.com/standard-schema/standard-schema).

```ts
import { defineMetaobject, m, type Infer } from "@fmaplabs/meta-manifest";

export const Author = defineMetaobject("author", {
  name: "Author",
  displayName: "name",
  access: { storefront: "public_read" },
  fields: {
    name: m.text({ required: true, max: 120 }),
    bio: m.multilineText(),
    rating: m.rating({ min: 1, max: 5 }),
  },
});

type AuthorValue = Infer<typeof Author.fields>;

Author.type;                 // "$app:author"
Author.toDefinitionInput();  // MetaobjectDefinitionCreateInput (for metaobjectDefinitionCreate)
Author.parse(fields);        // Shopify {key, jsonValue}[] -> typed, validated
Author.encode({ name: "Ursula" }); // typed -> [{ key, value }] for metaobjectUpsert
```

References between metaobjects are declared with `m.ref(...)` / `m.list(m.ref(...))`:

```ts
export const Book = defineMetaobject("book", {
  name: "Book",
  fields: {
    title: m.text({ required: true }),
    author: m.ref(Author),
  },
});
```

For the full `pull` → `diff` → `push` sync model (how local schema and a live store are
reconciled, destructive-change gating, dependency ordering, error handling), see
[`docs/SYNC.md`](./docs/SYNC.md).

## CLI

The CLI drives sync against a real store using an Admin API access token. For a
step-by-step walk-through (install → token → `init` → `pull`/`diff`/`push`, with
example output and CI usage), see the [CLI quick start & usage guide](./docs/CLI.md).

### Config

`meta-manifest.config.ts` (safe to commit — the token comes from the environment):

```ts
import { defineConfig } from "@fmaplabs/meta-manifest";

export default defineConfig({
  shop: "my-store.myshopify.com",
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  apiVersion: "2026-07",           // optional; defaults to DEFAULT_API_VERSION
  schema: "./src/schema.ts",       // where `pull` writes, `diff`/`push` read
});
```

Set `SHOPIFY_ADMIN_TOKEN` before running `pull`, `diff`, or `push` — either export it into your
shell or put it in a `.env` file in the project root, which the CLI loads automatically (real
environment variables take precedence). The token needs the `read_metaobject_definitions` scope for
`pull`/`diff`, and `write_metaobject_definitions` (which implies read) for `push`.

### Commands

| Command  | Behavior | Exit |
|----------|----------|------|
| `mm init` | Scaffold `meta-manifest.config.ts` + a starter `src/schema.ts`. No network. | 0 / 1 |
| `mm pull` | Enumerate the store's app-owned metaobject definitions and **codegen** `schema.ts` (tento-style — writes/overwrites the schema source file). | 0 / 1 |
| `mm diff` | Load `schema.ts`, compare it against the store, and print the plan. Read-only. | 0 / 1 |
| `mm push` | Diff, then apply: topologically ordered (referenced types created first) and **destructive-gated** — `removeField`/`changeFieldType` are skipped unless you pass `--allow-destructive`. | 0 / 1 / 2 |

```bash
npx mm init                    # scaffold config + schema
npx mm pull                    # bootstrap schema.ts from an existing store
npx mm diff                    # preview what push would do
npx mm push                    # apply non-destructive changes
npx mm push --allow-destructive  # also apply field removals/type changes
npx mm pull --force             # overwrite an existing schema.ts without the warning
npx mm diff --config ./staging.config.ts  # use a non-default config file
```

### Flags

- `--config <path>` — use a non-default config file instead of `meta-manifest.config.ts`.
- `--allow-destructive` — apply destructive changes (`removeField`/`changeFieldType`) on push.
- `--force` — overwrite the schema file on `pull` without the "overwriting" warning.

`mm push` exits `2` if any operation failed **or was blocked** (e.g. a reference cycle among the
definitions being created in that push — so CI can detect a partial failure), `1` on a
config/transport error, and `0` otherwise — including when destructive ops were skipped.

## Roadmap: runtime query client

v1 covers metaobject **definitions** (schema sync) only. A runtime client for reading/writing
metaobject **entries** — the tento-style query API — is not implemented yet and is tracked as a
follow-up, along with codegen of `access`/`capabilities` config.
