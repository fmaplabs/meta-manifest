# meta-manifest — networked sync adapter (`pull` + `push`) (design)

**Date:** 2026-06-30
**Status:** Approved (awaiting spec review)
**Scope of this spec:** the networked sync adapter — `pull` and `push` — in `@meta-manifest/core`. The embedded-app
dashboard UI is a separate follow-on spec.

## 1. Context & goals

The `@meta-manifest/core` SDK core is built and shipped: `defineMetaobject` + the `m.*` builders, all value codecs,
the Standard Schema interfaces, `toDefinitionInput()`, `normalizeLocal`/`normalizeRemote`, and a pure `diff()` that
plans a sync. See [the core SDK design](2026-06-30-meta-manifest-schema-driven-metaobjects-design.md) (§10 deferred the
networked lane) and the implemented plan `docs/superpowers/plans/2026-06-30-meta-manifest-core-sdk.md`.

This phase adds the **networked half** of the sync engine:

1. `pull(client, types)` — read a store's current metaobject definitions for the given `$app:` types and normalize them.
2. `push(client, plan, sources, options)` — apply a `diff()` plan to a store via `metaobjectDefinitionCreate` /
   `metaobjectDefinitionUpdate`.

It is still **SDK-first and unit-testable with no live store**: both functions take an *injected* GraphQL client, so the
whole adapter is exercised against an in-memory fake. The embedded app is the eventual consumer (it provides the real
client and, later, the dashboard).

## 2. Decisions (locked)

| #   | Decision              | Choice                                                                                                                                                              |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | First slice           | **Adapter only, no UI.** `pull` + `push`, tested against a mocked client. The dashboard is a separate later spec.                                                   |
| 2   | Architecture          | **In-core, dependency-injected client.** `pull`/`push` live in `@meta-manifest/core/src/sync` and accept a minimal `AdminGraphQLClient` we define. Core stays zero-runtime-dep. |
| 3   | Destructive ops       | **Safe by default + opt-in.** `push` applies safe ops and *skips* destructive ones (`removeField`, `changeFieldType`) unless called with `{ allowDestructive: true }`. Skipped ops are reported. |
| 4   | Push failure model    | **Best-effort + structured result.** Attempt every op whose dependencies succeeded; return a per-op outcome list (`applied` \| `skipped` \| `blocked` \| `failed`). Never throw on `userErrors`; throw only on transport / top-level GraphQL errors. |
| 5   | Pull strategy         | **By-type.** Loop `metaobjectDefinitionByType` over the requested `$app:` types. No pagination. `metaobjectDefinitions` list-all is a later "whole store" concern. |

## 3. Verified Shopify ground truth (Admin API 2026-04)

Confirmed against shopify.dev docs and validated with the GraphQL schema validator (not memory). These drive the design;
the implementation plan must not re-derive them.

- **Update is by ID, not type.** `metaobjectDefinitionUpdate(id: ID!, definition: MetaobjectDefinitionUpdateInput!)`. The
  GID must come from a prior read. → `pull` **must capture each definition's `id`**, and `push` must thread a
  `type → id` map for every update/add/remove-field op.
- **`metaobjectDefinitionByType` returns the *resolved* type.** Querying `type: "$app:author"` returns
  `type: "app--<appId>--author"`. Since `normalizeLocal` emits `$app:author`, a `diff()` keyed on the `type` string would
  never match local↔remote. → `pull` **re-labels** each result with the *requested* `$app:` type as the canonical key.
- **Field operations are a tagged union.** `MetaobjectDefinitionUpdateInput.fieldDefinitions` is
  `[MetaobjectFieldDefinitionOperationInput!]`, where each element is **exactly one** of `{ create, update, delete }`.
  A field's `type` is immutable, so a type change is `delete` + `create` in one update (destructive).
- **Create input matches `toDefinitionInput()`.** `MetaobjectDefinitionCreateInput` =
  `{ type (required, immutable), name, description, displayNameKey, access, capabilities, fieldDefinitions[] }`. This is
  exactly the `MetaobjectDefinitionInput` the SDK already produces.
- **`userErrors` location.** Both mutations return `{ metaobjectDefinition, userErrors { field message code } }`
  (`MetaobjectUserError`). `userErrors` are per-op application errors nested in `data` — distinct from top-level GraphQL
  `errors`.
- **Scopes.** `pull` needs `read_metaobject_definitions`; `push` needs `write_metaobject_definitions`. The app's
  `shopify.app.toml` already declares `write_metaobject_definitions` (implies read). ✓
- **Version.** Operations validated against `2026-04`; the app pins `api_version = "2026-07"`. These metaobject-definition
  operations are stable across both; re-validate at `2026-07` during plan-writing.

### Validated operations (verbatim, schema-checked)

```graphql
query PullMetaobjectDefinition($type: String!) {
  metaobjectDefinitionByType(type: $type) {
    id
    name
    type
    description
    displayNameKey
    fieldDefinitions {
      key
      name
      description
      required
      type { name }
      validations { name value }
    }
    access { admin storefront }
    capabilities {
      publishable { enabled }
      translatable { enabled }
      renderable { enabled }
    }
  }
}
```

```graphql
mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
  metaobjectDefinitionCreate(definition: $definition) {
    metaobjectDefinition { id type }
    userErrors { field message code }
  }
}
```

```graphql
mutation UpdateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
  metaobjectDefinitionUpdate(id: $id, definition: $definition) {
    metaobjectDefinition { id type }
    userErrors { field message code }
  }
}
```

## 4. Architecture & placement

New files under `packages/core/src/sync/`:

- `client.ts` — the `AdminGraphQLClient` interface, the GraphQL operation strings, and error types (`SyncTransportError`).
- `pull.ts` — `pull()` + the `PulledRemote` type.
- `push.ts` — `push()` + `PushResult` / `PushOpResult` / `PushOptions` types and the topological ordering.

The committed `normalize.ts` and `diff.ts` keep their **logic and tests frozen**. The only permitted change is
**type-only**: adding `export` to `normalize.ts`'s existing `PulledDefinition` / `PulledFieldDefinition` interfaces so
`pull` can name the shape `normalizeRemote` consumes (no behavioral change, no test change). Zero new runtime
dependencies: the adapter only ever talks to the injected client. The public barrel `src/index.ts` gains `pull`,
`push`, and their types.

## 5. The injected client (zero-dep boundary)

```ts
export interface AdminGraphQLClient {
  (query: string, options?: { variables?: Record<string, unknown> }):
    Promise<{ data?: unknown; errors?: unknown }>;
}
```

The app supplies the adapter at its edge (in `app/`, **not** core):

```ts
const client: AdminGraphQLClient = async (query, options) =>
  (await admin.graphql(query, { variables: options?.variables })).json();
```

**Three error channels** — the structured result model depends on keeping them distinct:

| Channel                                    | Meaning                                   | Handling                          |
| ------------------------------------------ | ----------------------------------------- | --------------------------------- |
| Promise rejects (fetch throws)             | network/transport failure                 | `pull`/`push` reject (throw)      |
| Top-level GraphQL `errors` present         | request itself malformed / unauthorized   | throw `SyncTransportError`        |
| Mutation `userErrors` (nested in `data`)   | per-op application error                  | per-op `failed` (never thrown)    |

## 6. `pull(client, types)`

```ts
export interface PulledRemote {
  id: string;                  // remote definition GID, for update ops
  type: string;                // canonical "$app:…" (the REQUESTED type, not the resolved form)
  definition: PulledDefinition; // normalizeRemote()'s input type, exported from normalize.ts (§4)
}

export function pull(client: AdminGraphQLClient, types: readonly string[]): Promise<PulledRemote[]>;
```

- For each requested `$app:` type, issue `PullMetaobjectDefinition`.
- A `null` node (type not present on the store) is **omitted** from the result — `diff()` will then emit
  `createDefinition`.
- For a present node, build a `PulledRemote`:
  - `id` ← `node.id`.
  - `type` ← the **requested** `$app:` string (override the resolved `app--…` form Shopify returns).
  - `definition` ← `{ type: <requested>, name, fieldDefinitions }` in the `PulledDefinition` shape that
    `normalizeRemote` already accepts.
- The caller diffs with the existing pure functions:
  `diff(localSchemas.map(normalizeLocal), pulled.map(p => normalizeRemote(p.definition)))`.

## 7. `push(client, plan, sources, options?)`

```ts
export interface PushOptions {
  allowDestructive?: boolean; // default false
}

export function push(
  client: AdminGraphQLClient,
  plan: DiffOp[],                                  // from diff(): WHICH ops to apply
  sources: {
    definitions: MetaobjectDefinitionInput[];      // schemas.map(s => s.toDefinitionInput()) — full-fidelity payloads
    remote: PulledRemote[];                         // from pull(): supplies type → GID
  },
  options?: PushOptions,
): Promise<PushResult>;
```

`plan` decides *which* ops to run. `sources.definitions` supplies the **full-fidelity** create/field payloads (this is
why `push` does not read the lossy `RemoteDefinition` carried inside the plan — see §9). `sources.remote` supplies the
GID needed for every update. Internally `push` builds two lookups: `type → MetaobjectDefinitionInput` and
`type → remote GID` (augmented with GIDs of definitions created during this run).

### Op → mutation mapping

| `DiffOp.kind`     | Mutation                                                                                                | Notes                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `createDefinition`| `metaobjectDefinitionCreate(definition)` — full input from the `definitions` lookup                    | capture the new GID for dependents                 |
| `addField`        | `metaobjectDefinitionUpdate(id, { fieldDefinitions: [{ create: <full field input> }] })`               | field input pulled from the type's definition      |
| `updateField`     | `metaobjectDefinitionUpdate(id, { fieldDefinitions: [{ update: { key, name, description, required, validations } }] })` | `key` identifies the field         |
| `removeField` *(destructive)* | `metaobjectDefinitionUpdate(id, { fieldDefinitions: [{ delete: { key } }] })`              | skipped unless `allowDestructive`                  |
| `changeFieldType` *(destructive)* | `metaobjectDefinitionUpdate(id, { fieldDefinitions: [{ delete: { key } }, { create: <full field input> }] })` | type is immutable → delete+create; skipped unless `allowDestructive` |

All `create`/`update` **field payloads are sourced from `sources.definitions`** (the full local field input), never from
the lossy `op` in the plan — the plan only selects *which* field and *which* operation. A side effect: when an
`updateField` fires (because `required`/`validations` changed), it sends the full field input, so the field's
`name`/`description` are corrected opportunistically too; they are simply not *independently* detected (see §9).

### Ordering, cycles, and dependency-aware skipping

- **Topological sort.** `createDefinition` ops are ordered by reference dependency. Edges are read from each definition's
  fields' validations: a `metaobject_definition_type` (or list `metaobject_definition_types`) value naming another
  `$app:` type in this run is a dependency. Acyclic graphs run in dependency order, **single pass, never emitting a
  forward reference** — correct regardless of the §11 open question about forward refs at create time.
- **Cycles.** Detected cycles return their `createDefinition` ops as **`blocked`** (reason:
  `"reference cycle — two-pass create deferred"`). The two-pass create-then-update strategy is an explicit deferral
  (§10); the best-effort result model already carries `blocked`.
- **Dependency-aware skipping.** If a `createDefinition` `failed` (or is `blocked`), every op targeting that type and its
  transitive dependents becomes `blocked` rather than being attempted.
- **Missing GID.** An `addField`/`updateField`/`removeField`/`changeFieldType` whose type has no known GID and is not
  created this run becomes `blocked` (guard against inconsistent inputs; should not occur when `pull`+`diff` are
  consistent).

## 8. Result shape (best-effort, structured)

```ts
export type PushOpResult =
  | { op: DiffOp; status: "applied"; id?: string }
  | { op: DiffOp; status: "skipped"; reason: "destructive" }
  | { op: DiffOp; status: "blocked"; reason: string }
  | { op: DiffOp; status: "failed"; userErrors: { field?: string[]; message: string; code?: string }[] };

export interface PushResult {
  results: PushOpResult[];
  counts: { applied: number; skipped: number; blocked: number; failed: number };
  ok: boolean; // failed === 0 && blocked === 0
}
```

`push` never throws on `userErrors` (they become `failed` entries). It throws only on a transport rejection or top-level
GraphQL `errors`.

## 9. Known limitation: diff blindness on update (inherited)

The committed `RemoteDefinition` is intentionally lossy — it carries only
`{ type, name?, fields: [{ key, type, required, validations }] }`. Consequences this phase **accepts**:

- `push` cannot trust the plan's `createDefinition.definition` (lossy) as a create payload, so it sources full payloads
  from `sources.definitions` (= `toDefinitionInput()`). `createDefinition` is therefore **full-fidelity**.
- `diff()` is **blind** to changes in field `name`/`description` and definition-level
  `name`/`description`/`displayNameKey`/`access`/`capabilities`. Those changes to an **already-existing** definition will
  **not** sync. This is a defensible v1 cut, stated here explicitly. A follow-up that enriches `normalize` + `diff`
  (without breaking their committed tests) covers it. **Do not change `diff`/`normalize` behavior in this phase** — the
  only permitted edit is the type-only `export` described in §4.

## 10. Out of scope (this spec)

- **Two-pass cycle creation** (create-stripped-then-update for reference cycles) → `blocked` + deferred.
- **`metaobjectDefinitions` list-all / pagination** ("show the whole store") → deferred; `pull` is by-type only.
- **Enriching `diff`/`normalize`** to detect metadata/field-rename changes (see §9) → named follow-up.
- **Rate-limit / cost handling and idempotency keys** → unnecessary under the 32-definition app cap; the
  pull→diff→push loop self-corrects on re-run.
- **Live-store verification** of the §11 open questions → mock tests validate planning/ordering/protocol, **not** live
  Shopify conformance.
- **The embedded-app dashboard UI** → its own later spec.
- Metaobject **entry** CRUD (the SDK already has `encode`/`parse`; wiring `metaobjectUpsert`/reads is separate).

## 11. Open questions (resolve when the live lane lands, not blocking)

- Does `metaobject_definition_type` resolve at **create** time for a not-yet-created target? If yes, ordering is moot;
  if no, dependency-ordered creates (this design) are required and cycles need the deferred two-pass. The design is
  correct **either way** for acyclic graphs because it never emits a forward reference.
- Exact stored JSON for `rating` (carried from the core spec §14) — only matters for value read/write, not definitions.
- Re-validate the three operations against `2026-07` (the app's pinned version) during plan-writing.

## 12. Testing strategy (TDD, no network)

A `FakeAdminClient` implementing `AdminGraphQLClient`: an in-memory map of definitions keyed by resolved type, returning
the validated response shapes, programmable to inject `userErrors`, top-level `errors`, and transport throws.

- **pull:** by-type hit and miss (miss → omitted); resolved-type → `$app:` relabeling; `id` capture;
  `normalizeRemote(pulled.definition)` round-trips to the expected `RemoteDefinition`.
- **push:** each op→mutation mapping (assert the variables passed to the client); topological ordering (a referenced
  type is created before its referencer); `removeField`/`changeFieldType` skipped by default and applied under
  `allowDestructive`; a failed dependency blocks its dependents; a reference cycle yields `blocked`; `userErrors` →
  `failed`; transport throw propagates; `counts`/`ok` aggregation.
- **drift guard:** the operation strings used by the adapter are asserted equal to the schema-validated documents in §3.

## 13. Public API additions (barrel)

`src/index.ts` additionally exports:

- values: `pull`, `push`.
- types: `AdminGraphQLClient`, `PulledRemote`, `PushOptions`, `PushResult`, `PushOpResult`, `SyncTransportError`.
