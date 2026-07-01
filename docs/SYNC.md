# Syncing metaobject definitions (`pull` + `push`)

Your `defineMetaobject(...)` schemas are the source of truth. The sync adapter
reads what a store currently has, computes the difference, and applies it:

```
define ─▶ pull ─▶ diff ─▶ push
  │         │       │        │
  │         │       │        └─ apply the plan to the store (create/update)
  │         │       └────────── pure: local vs remote → a list of ops
  │         └────────────────── read current definitions from the store
  └──────────────────────────── your schemas (this repo's source of truth)
```

Only the two edges (`pull`, `push`) touch the network, and they do it through a
client **you inject** — the package itself has zero runtime dependencies and no
knowledge of how you talk to Shopify.

A runnable version of everything below (define → pull → diff → push, against a
fake in-memory store) is [`../src/sync/sync.e2e.test.ts`](../src/sync/sync.e2e.test.ts):

```bash
pnpm test
```

If you just want a store synced without writing this glue yourself, use the CLI
instead: `mm pull` / `mm diff` / `mm push` drive this exact model against a real
store over an Admin API token — see the root [`README.md`](../README.md#cli).

---

## 1. Define your schemas

The example below defines `Material` and `Product`, where `Product.specs` is a
`list(ref(Material))` — a reference that makes `Product` depend on `Material`.

```ts
import { defineMetaobject, m } from "@fmaplabs/meta-manifest";

export const Material = defineMetaobject("material", {
  name: "Material",
  fields: { name: m.text({ required: true, max: 80 }), density: m.weight() },
});

export const Product = defineMetaobject("product_spec", {
  name: "Product Spec",
  fields: {
    title: m.text({ required: true, max: 120 }),
    price: m.money(),
    specs: m.list(m.ref(Material)), // ← dependency edge: Product → Material
    rating: m.rating({ min: 1, max: 5 }),
  },
});

export const schemas = [Material, Product];
```

---

## 2. Wiring the client

`pull` and `push` take an `AdminGraphQLClient` — a single function that runs a
GraphQL document and returns the raw `{ data, errors }`:

```ts
export interface AdminGraphQLClient {
  (query: string, options?: { variables?: Record<string, unknown> }):
    Promise<{ data?: unknown; errors?: unknown }>;
}
```

The package ships a ready-made standalone client for Node — `createAdminClient`
from the `@fmaplabs/meta-manifest/node` subpath export — which is what the CLI uses
internally:

```ts
import { createAdminClient } from "@fmaplabs/meta-manifest/node";

const client = createAdminClient({
  shop: "my-store.myshopify.com",
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  // apiVersion is optional; defaults to DEFAULT_API_VERSION
});
```

It POSTs to `https://{shop}/admin/api/{apiVersion}/graphql.json` with an
`X-Shopify-Access-Token` header, returns `{ data, errors }`, and throws
`SyncTransportError` on a non-OK response or network failure.

If you're embedding sync in your own app (Shopify-embedded or otherwise) instead
of using the CLI, adapt whatever GraphQL-executing function you already have to
the same shape:

```ts
import type { AdminGraphQLClient } from "@fmaplabs/meta-manifest";

const client: AdminGraphQLClient = (query, options) =>
  myExistingAdminFetcher(query, options?.variables).then((response) => response.json());
```

The client is the *only* Shopify-specific glue. Everything else is pure data.

---

## 3. Pull

`pull(client, types)` reads the current definition for each `$app:` type. A type
that doesn't exist yet is simply **omitted** from the result (so `diff` will emit
a create for it). Each returned entry carries the definition's GID `id`, which
`push` needs to update fields later.

```ts
import { pull } from "@fmaplabs/meta-manifest";

const types = [Material.type, Product.type]; // ["$app:material", "$app:product_spec"]
const remote = await pull(client, types); // PulledRemote[]  (missing types absent)
```

### App vs. merchant scope

`Author.type` is always the canonical `$app:author`. Whether a definition is
**app-scoped** (`$app:<handle>`) or **merchant-scoped** (bare `<handle>`) is
resolved at sync time from `config.scope` (default `"app"`) and any per-metaobject
`scope` override. The CLI resolves this for you; when wiring sync yourself, run
schemas through `resolveDefinitions(schemas, config)` to get the effective
`MetaobjectDefinitionInput[]` (definition `type` and reference targets rewritten
to each metaobject's effective scope), then pull/diff/push those.

> `type` is immutable, so changing a definition's scope after it's created makes
> `pull` look under the new type and orphan the old definition (`mm diff`/`push`
> warn when they detect this). Migrating scope is manual — recreate the entries
> under the new type.

---

## 4. Diff

`diff` is pure — no client, no network. It compares **normalized** local schemas
against **normalized** remote definitions and returns a plan.

```ts
import { diff, normalizeLocal, normalizeRemote } from "@fmaplabs/meta-manifest";

// ⚠️ Normalize each schema individually. `schemas.map(normalizeLocal)` does NOT
// typecheck: a heterogeneous array of schemas can't unify normalizeLocal's
// generic parameter. Call it once per schema.
const local = [normalizeLocal(Material), normalizeLocal(Product)];

const plan = diff(local, remote.map((r) => normalizeRemote(r.definition)));
```

The plan is a list of `DiffOp`s:

| `kind`            | When                                                        | Destructive?      |
| ----------------- | ----------------------------------------------------------- | ----------------- |
| `createDefinition`| type doesn't exist remotely                                 | no                |
| `updateDefinition`| `name`/`description`/`displayNameKey`/`access`/`capabilities` drifted | when it disables `onlineStore` |
| `addField`        | local field missing remotely                                | no                |
| `updateField`     | `required`, `validations`, or `filterable` changed          | no                |
| `changeFieldType` | field's `type` changed                                      | **yes**           |
| `removeField`     | remote field not in local schema                            | **yes**           |

Destructive ops carry `destructive: true`. `diff` never talks to the store, so
you can inspect, log, or gate on the plan before pushing anything.

### Reconciling definition metadata (`updateDefinition`)

Beyond fields, `diff` reconciles the definition's `name`, `description`,
`displayNameKey`, `access` (`admin`/`storefront`/`customerAccount`), and
`capabilities` (`publishable`/`translatable`/`renderable`/`onlineStore`). To keep
existing definitions quiet, only what the local schema **declares** is compared:

- A capability the schema doesn't mention is left as-is (not forced off). Write
  `publishable: false` to actively disable one. `onlineStore` is the exception —
  per Shopify it has no "off" object, so **omitting it disables** web-page
  rendering (and that disable is gated destructive, since it removes live pages).
- `renderable` SEO keys are compared only when you set them, so `renderable: true`
  (Shopify auto-assigns the keys) doesn't churn against the assigned values.
- `access.admin` is only meaningful on app-scoped types; it's compared only when
  declared (or defaulted from `merchantEditable`), so merchant-scoped definitions
  never drift on it.

> `capabilities.onlineStore` is set via GraphQL only — it isn't expressible in
> `shopify.app.toml`, so declaring it here is the way to publish entries as web
> pages.

---

## 5. Push

`push` applies the plan. It needs two extra inputs beyond the plan:

- `definitions` — the `toDefinitionInput()` output of each local schema, used to
  build create/update payloads.
- `remote` — the `PulledRemote[]` from step 3, which carries the GIDs that
  field updates target.

```ts
import { push } from "@fmaplabs/meta-manifest";

const result = await push(client, plan, {
  definitions: [Material.toDefinitionInput(), Product.toDefinitionInput()],
  remote,
});
```

### Result shape

```ts
interface PushResult {
  results: PushOpResult[]; // one per plan op, in plan order
  counts: { applied: number; skipped: number; blocked: number; failed: number };
  ok: boolean;             // true when nothing failed AND nothing was blocked
}
```

Each op ends in one of four statuses:

- **`applied`** — the mutation ran and succeeded (`id` included).
- **`skipped`** — a destructive op you didn't opt into (`reason: "destructive"`).
- **`blocked`** — couldn't run: a dependency wasn't created (its create failed or
  was itself blocked), or no GID/definition available.
- **`failed`** — the mutation ran but Shopify returned `userErrors`.

Note `skipped` does **not** make `ok` false — only `failed` and `blocked` do.

### Destructive ops are opt-in

`removeField`, `changeFieldType`, and an `updateDefinition` that **disables
`onlineStore`** are skipped by default. Pass `{ allowDestructive: true }` to
apply them:

```ts
await push(client, plan, { definitions, remote }, { allowDestructive: true });
```

### Dependency ordering & cycles

`createDefinition` ops run in dependency order: a referenced type is created
before the type that references it (edges are read from each field's
`metaobject_definition_type` / `metaobject_definition_types` validations). Types
entangled in a reference **cycle** can't be ordered, so they're created **two-pass**:
each is created first with its cycle-breaking reference fields stripped, then a
follow-up `metaobjectDefinitionUpdate` adds those fields once every member of the
cycle exists. A type whose dependency failed or was blocked is `blocked` (and if a
cycle member's create fails, the deferred ref fields pointing at it are `blocked`).
Field-level ops on a definition that wasn't created this run are also `blocked`.

> A cycle member whose fields are *all* cycle-breaking references has an empty
> pass-1 field set, which Shopify rejects (a definition needs at least one field);
> it surfaces as a `failed` create. Give such a definition at least one non-reference
> field so the two-pass create has something to create first.

---

## 6. Errors: thrown vs. reported

Two failure channels, deliberately kept separate:

- **`SyncTransportError`** (thrown) — a transport failure or a top-level GraphQL
  `errors` payload. This aborts the `push`/`pull`. Catch it around the call.
- **`failed` op results** (not thrown) — per-op `userErrors` (e.g. an invalid
  validation). The push continues; the bad op is recorded as `failed` and
  `ok` becomes false. Inspect `result.results` to see which.

```ts
import { SyncTransportError } from "@fmaplabs/meta-manifest";

try {
  const result = await push(client, plan, { definitions, remote });
  if (!result.ok) {
    // some ops were blocked/failed — inspect result.results
  }
} catch (err) {
  if (err instanceof SyncTransportError) {
    // transport / top-level GraphQL failure — err.errors has the payload
  }
  throw err;
}
```

---

## 7. Putting it together (standalone script)

This is the same wiring `mm push` does under the hood, using the built-in
Node client instead of a Shopify-app session:

```ts
import { createAdminClient } from "@fmaplabs/meta-manifest/node";
import { diff, normalizeLocal, normalizeRemote, pull, push } from "@fmaplabs/meta-manifest";
import { Material, Product, schemas } from "./schema"; // your defineMetaobject(...) file

const client = createAdminClient({
  shop: "my-store.myshopify.com",
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
});

const types = schemas.map((s) => s.type);
const local = [normalizeLocal(Material), normalizeLocal(Product)]; // per schema — see §4
const definitions = schemas.map((s) => s.toDefinitionInput());

const remote = await pull(client, types);
const plan = diff(local, remote.map((r) => normalizeRemote(r.definition)));
const result = await push(client, plan, { definitions, remote });

console.log(plan, result.counts, result.ok);
```

If you're embedding sync in your own Shopify app instead, swap `createAdminClient`
for an `AdminGraphQLClient` adapter around your existing session-based GraphQL
call (see §2) — everything else here is identical.

---

## Running the example

There's no separate example script — the equivalent scenarios are exercised
directly by the test suite:

```bash
pnpm test
```

[`../src/sync/sync.e2e.test.ts`](../src/sync/sync.e2e.test.ts) runs define →
pull → diff → push end-to-end against a fake, in-file `AdminGraphQLClient` (an
empty store, asserting referenced-type-first create ordering).
[`../src/sync/push.test.ts`](../src/sync/push.test.ts) covers the rest of the
scenarios described above against the same kind of fake client — destructive
ops skipped by default and applied under `allowDestructive: true`, two-pass
creation of reference cycles (and `blocked` ops from missing dependencies),
`failed` ops from `userErrors`, and the `counts`/`ok` aggregation. Both use a hand-written fake
client (keyed on the query/mutation constants exported from
[`../src/sync/client.ts`](../src/sync/client.ts)) instead of a real store, so
they run fully offline. In a real app, that fake is the only thing you'd
replace — with the client wiring from §2.
