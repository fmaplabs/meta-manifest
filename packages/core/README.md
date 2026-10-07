# @fmaplabs/meta-manifest

A zero-runtime-dependency, zod-style builder for Shopify **metaobject & metafield
definitions**, plus the `pull` → `diff` → `push` primitives that keep a store's
definitions in sync with schema declared in code. This is the library package; the
companion CLI is [`@fmaplabs/meta-manifest-cli`](https://www.npmjs.com/package/@fmaplabs/meta-manifest-cli)
(`mm` / `meta-manifest`).

`meta-manifest` is **not** a runtime client for querying metaobject *entries* — it
declares definitions, validates values against them, and syncs the definitions
themselves. It can also declare seed entries and upsert them on push, but it never
enumerates, queries, or deletes store data.

## Install

```bash
npm i -D @fmaplabs/meta-manifest @fmaplabs/meta-manifest-cli
# or: pnpm add -D @fmaplabs/meta-manifest @fmaplabs/meta-manifest-cli
```

## Declaring metaobjects

Declare a metaobject with `defineMetaobject` and the `m` field builders. Schemas
implement [Standard Schema](https://github.com/standard-schema/standard-schema).

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
Author.toDefinitionInput();  // MetaobjectDefinitionCreateInput
Author.parse(fields);        // Shopify {key, jsonValue}[] -> typed, validated
Author.encode({ name: "Ursula" }); // typed -> [{ key, value }] for metaobjectUpsert
```

The full builder catalog: `m.text`, `m.multilineText`, `m.richText`, `m.integer`,
`m.decimal`, `m.boolean`, `m.date`, `m.dateTime`, `m.url`, `m.color`, `m.json`,
`m.link`, `m.money`, `m.dimension`, `m.weight`, `m.volume`, `m.rating`, the resource
references `m.product`, `m.variant`, `m.collection`, `m.page`, `m.file`, `m.customer`,
`m.order`, `m.company`, `m.companyLocation`, the metaobject references `m.ref` /
`m.mixedRef` (pass a thunk — `m.ref(() => Book)` — for forward/circular references),
and `m.list(...)` around any of them.

Beyond metaobjects:

- **`defineMetafields`** — metafield definitions on built-in owner types (Product,
  Customer, Order, …), one set per `(ownerType, namespace)`, with the same `m.*`
  builders and typed `encode`/`parse` helpers.
- **`defineEntries`** — upsert-only seed entries declared by handle, with
  `entryRef(Target, "handle")` for references between declared entries.
- **`defineConfig`** — the `meta-manifest.config.ts` shape the CLI loads.

See the [repository README](https://github.com/fmaplabs/meta-manifest#readme) for the
full option tables (access, capabilities, scope, pinning), multi-file schema layout,
and seed-entry semantics.

## Sync primitives

The sync engine is exported directly for programmatic use: `pull` / `pullAll`, `diff`,
`push`, and their metafield and entry counterparts (`pullMetafields`, `diffMetafields`,
`pushMetafields`, `pullEntries`, `diffEntries`, `pushEntries`), plus the
`normalizeLocal` / `normalizeRemote` helpers they build on. `diff`/`normalize` are
pure; only `pull` and `push` touch the network, through an injected
`AdminGraphQLClient` — the raw GraphQL documents are exported as constants, so tests
can fake a store by exact query match. `generateSchemaSource` /
`generateMetafieldsSource` are the codegen behind `mm pull`.

The walkthrough of the sync model (reconciliation, destructive-change gating,
dependency ordering) is in
[`docs/SYNC.md`](https://github.com/fmaplabs/meta-manifest/blob/HEAD/docs/SYNC.md).

## `@fmaplabs/meta-manifest/node`

The root export is runtime-agnostic. Node-only client factories live under the
`./node` subpath:

```ts
import { createAdminClient, createCliAdminClient } from "@fmaplabs/meta-manifest/node";

const client = createAdminClient({
  shop: "my-store.myshopify.com",
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
});
```

- `createAdminClient` — Admin API access-token auth.
- `createCliAdminClient` — shells out to `shopify store execute`, reusing a
  `shopify store auth` session (the CLI's `auth: "cli"` mode).

## Docs

- [Repository README](https://github.com/fmaplabs/meta-manifest#readme) — full library guide.
- [`docs/CLI.md`](https://github.com/fmaplabs/meta-manifest/blob/HEAD/docs/CLI.md) — CLI walkthrough, auth setup, CI usage.
- [`docs/SYNC.md`](https://github.com/fmaplabs/meta-manifest/blob/HEAD/docs/SYNC.md) — sync engine internals and client wiring.
- [`CHANGELOG.md`](https://github.com/fmaplabs/meta-manifest/blob/HEAD/CHANGELOG.md)

## License

MIT
