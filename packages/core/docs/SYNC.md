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

The runnable version of everything below is in
[`../examples/schema.ts`](../examples/schema.ts) and
[`../examples/sync.ts`](../examples/sync.ts):

```bash
pnpm --filter @meta-manifest/core example
```

---

## 1. Define your schemas

See [`../examples/schema.ts`](../examples/schema.ts). The example defines
`Material` and `Product`, where `Product.specs` is a `list(ref(Material))` — a
reference that makes `Product` depend on `Material`.

```ts
import { defineMetaobject, m } from "@meta-manifest/core";

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

In this repo's Shopify React Router app, `authenticate.admin(request)` yields an
`admin.graphql(query, { variables })` that returns a `Response`. Adapting it is
one line:

```ts
// app/routes/app.metaobjects.sync.tsx
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import type { AdminGraphQLClient } from "@meta-manifest/core";

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const client: AdminGraphQLClient = (query, options) =>
    admin.graphql(query, options).then((response) => response.json());

  // ...pull → diff → push (sections 3–5)...
}
```

> **Prerequisite.** `@meta-manifest/core` is a private workspace package, so add
> it to the app's dependencies first: `"@meta-manifest/core": "workspace:*"` in
> the root `package.json`, then `pnpm install`. (Nothing in the app imports it
> yet.)

The client is the *only* Shopify-specific glue. Everything else is pure data.

---

## 3. Pull

`pull(client, types)` reads the current definition for each `$app:` type. A type
that doesn't exist yet is simply **omitted** from the result (so `diff` will emit
a create for it). Each returned entry carries the definition's GID `id`, which
`push` needs to update fields later.

```ts
import { pull } from "@meta-manifest/core";

const types = [Material.type, Product.type]; // ["$app:material", "$app:product_spec"]
const remote = await pull(client, types); // PulledRemote[]  (missing types absent)
```

---

## 4. Diff

`diff` is pure — no client, no network. It compares **normalized** local schemas
against **normalized** remote definitions and returns a plan.

```ts
import { diff, normalizeLocal, normalizeRemote } from "@meta-manifest/core";

// ⚠️ Normalize each schema individually. `schemas.map(normalizeLocal)` does NOT
// typecheck: a heterogeneous array of schemas can't unify normalizeLocal's
// generic parameter. Call it once per schema.
const local = [normalizeLocal(Material), normalizeLocal(Product)];

const plan = diff(local, remote.map((r) => normalizeRemote(r.definition)));
```

The plan is a list of `DiffOp`s:

| `kind`            | When                                          | Destructive? |
| ----------------- | --------------------------------------------- | ------------ |
| `createDefinition`| type doesn't exist remotely                   | no           |
| `addField`        | local field missing remotely                  | no           |
| `updateField`     | `required` or `validations` changed           | no           |
| `changeFieldType` | field's `type` changed                        | **yes**      |
| `removeField`     | remote field not in local schema              | **yes**      |

Destructive ops carry `destructive: true`. `diff` never talks to the store, so
you can inspect, log, or gate on the plan before pushing anything.

---

## 5. Push

`push` applies the plan. It needs two extra inputs beyond the plan:

- `definitions` — the `toDefinitionInput()` output of each local schema, used to
  build create/update payloads.
- `remote` — the `PulledRemote[]` from step 3, which carries the GIDs that
  field updates target.

```ts
import { push } from "@meta-manifest/core";

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
- **`blocked`** — couldn't run: a dependency wasn't created, a reference cycle,
  or no GID/definition available.
- **`failed`** — the mutation ran but Shopify returned `userErrors`.

Note `skipped` does **not** make `ok` false — only `failed` and `blocked` do.

### Destructive ops are opt-in

`removeField` and `changeFieldType` are skipped by default. Pass
`{ allowDestructive: true }` to apply them:

```ts
await push(client, plan, { definitions, remote }, { allowDestructive: true });
```

### Dependency ordering & cycles

`createDefinition` ops run in dependency order: a referenced type is created
before the type that references it (edges are read from each field's
`metaobject_definition_type` validation). Types entangled in a reference **cycle**
can't be ordered and come back `blocked` (`reason: "reference cycle …"`); a
type whose dependency failed or was blocked is `blocked` too. Field-level ops on
a definition that wasn't created this run are also `blocked`.

---

## 6. Errors: thrown vs. reported

Two failure channels, deliberately kept separate:

- **`SyncTransportError`** (thrown) — a transport failure or a top-level GraphQL
  `errors` payload. This aborts the `push`/`pull`. Catch it around the call.
- **`failed` op results** (not thrown) — per-op `userErrors` (e.g. an invalid
  validation). The push continues; the bad op is recorded as `failed` and
  `ok` becomes false. Inspect `result.results` to see which.

```ts
import { SyncTransportError } from "@meta-manifest/core";

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

## 7. Putting it together (server action)

```ts
// app/routes/app.metaobjects.sync.tsx
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  diff, normalizeLocal, normalizeRemote, pull, push,
  type AdminGraphQLClient,
} from "@meta-manifest/core";
import { Material, Product, schemas } from "../metaobjects/schema"; // your defineMetaobject(...) file

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const client: AdminGraphQLClient = (query, options) =>
    admin.graphql(query, options).then((r) => r.json());

  const types = schemas.map((s) => s.type);
  const local = [normalizeLocal(Material), normalizeLocal(Product)]; // per schema — see §4
  const definitions = schemas.map((s) => s.toDefinitionInput());

  const remote = await pull(client, types);
  const plan = diff(local, remote.map((r) => normalizeRemote(r.definition)));
  const result = await push(client, plan, { definitions, remote });

  return { plan, counts: result.counts, ok: result.ok };
}
```

---

## Running the example

```bash
pnpm --filter @meta-manifest/core example
```

Expected output (verbatim):

```
Scenario A — empty store
  plan: createDefinition, createDefinition
    createDefinition $app:material: applied
    createDefinition $app:product_spec: applied
  counts: {"applied":2,"skipped":0,"blocked":0,"failed":0}  ok: true
  create order: $app:material → $app:product_spec  (referenced type first)

Scenario B — drifted store (allowDestructive: false, the default)
  plan: updateField, addField, removeField
    updateField $app:product_spec.title: applied
    addField $app:product_spec.rating: applied
    removeField $app:product_spec.sku: skipped  ← destructive
  counts: {"applied":2,"skipped":1,"blocked":0,"failed":0}  ok: true

Scenario B — same plan, allowDestructive: true
  plan: updateField, addField, removeField
    updateField $app:product_spec.title: applied
    addField $app:product_spec.rating: applied
    removeField $app:product_spec.sku: applied
  counts: {"applied":3,"skipped":0,"blocked":0,"failed":0}  ok: true
```

The example injects an **in-file fake `AdminGraphQLClient`** so it runs offline
with no store. In a real app, that fake is the only thing you replace — with the
`admin.graphql` wiring from §2.
