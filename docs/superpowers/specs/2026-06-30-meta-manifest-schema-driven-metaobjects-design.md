# meta-manifest — schema-driven metaobjects (design)

**Date:** 2026-06-30
**Status:** Proposed (awaiting review)
**Scope of this spec:** the schema/SDK core. Networked push/pull and the dashboard UI are designed here at a high level but deferred to follow-on specs.

## 1. Context & goals

meta-manifest is a Shopify embedded app (React Router template: Polaris web components, `admin.graphql()`, Prisma session storage). Its purpose is to let developers:

1. Declare Shopify **metaobject definitions** declaratively, using a zod-style schema-validator syntax.
2. Push and pull those definitions to/from a merchant's store at runtime.
3. Validate metaobject field values against the declared schema.

The product is **SDK-first**: a code-first TypeScript library (`@meta-manifest/core`) is the primary deliverable; the embedded app is a consumer that provides the push/pull/diff dashboard. Code-first is the right call because the entire value of a zod-style builder — static type inference and autocomplete — only exists in code.

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Core shape | TypeScript SDK, code-first fluent builder. Embedded app is a dashboard. |
| 2 | Engine & deps | Purpose-built, zero runtime dependency. Implements the **Standard Schema** (`~standard`) interface. Lossless typed-JS ⟷ Shopify-wire parse/serialize in both directions. |
| 3 | Ownership | App-owned (`$app:`) types for v1; the `type` identifier is kept abstract so merchant-owned / general management can be layered on later without reworking the syntax. |
| 4 | First build | **Core SDK + unit tests, no network.** Field builders + codecs, `defineMetaobject`, inference, Standard Schema, `toDefinitionInput()`, and a pure `diff()`. Live push/pull adapter + dashboard are the next phase. |

## 3. Verified Shopify ground truth

These were confirmed against shopify.dev docs (not memory) and drive the design. Record them so the implementation plan does not re-derive.

- **App-owned types CAN be created at runtime.** `metaobjectDefinitionCreate` accepts `type: "$app:author"` (stored/resolved as `app--<appId>--author`). So app-owned + runtime push is coherent.
- **Runtime lane vs TOML lane do not mix.** Definitions declared in `shopify.app.toml` are **read-only through the Admin API** (mutations error). meta-manifest manages definitions exclusively through GraphQL mutations, so its managed types must **not** also be TOML-declared. (The template's existing `[metaobjects.app.example]` TOML block is the read-only lane and is unrelated to meta-manifest-managed types.)
- **Values are always strings.** Read/write through the Admin API stores every field value as a string or JSON-string regardless of type. Reading complex types back, prefer `jsonValue` (parsed JSON scalar; available since API 2024-07).
- **Definition input shapes.**
  - `MetaobjectDefinitionCreateInput`: `type` (required, 3–255 chars, alphanumeric/hyphen/underscore; `$app:` prefix allowed), `name`, `description`, `displayNameKey`, `access` (`{ admin, storefront }`), `capabilities`, `fieldDefinitions[]`.
  - `MetaobjectFieldDefinitionCreateInput`: `key` (required, 2–64 chars), `name`, `description`, `required` (default false), `type` (required), `validations: [{ name, value }]`.
  - `type` cannot be changed after creation.
- **References are pinned via `validations`.** `metaobject_reference` supports either `metaobject_definition_id` (a GID) **or** `metaobject_definition_type` (a type string, e.g. `$app:author`). Pinning **by type** makes push order-independent for acyclic schemas. Lists/mixed use the plural `…_ids` / `…_types`.
- **Type-change safety.** Most field types report `supportsDefinitionMigrations: false`, so changing a field's type is destructive. A `metafieldDefinitionTypes` introspection query returns the authoritative type list, supported validations, and the migration flag at runtime.
- **App-scoped limits (for awareness):** 32 metaobject definitions, 64 fields per definition.

## 4. Architecture

Three layers in `@meta-manifest/core`, consumed by the embedded app:

1. **Schema/builder core** — `defineMetaobject` + the `m.*` field builders. Pure, zero-dep. The source of truth.
2. **Codec layer** — per-field-type `encode`/`decode` between typed JS and Shopify's string/JSON-string wire format, plus the Standard Schema interface for value validation.
3. **Sync engine** — `toDefinitionInput()` (schema → Shopify definition input), `pull` + normalize, a pure `diff()` producing a push plan, and `push` applying it. **v1 includes `toDefinitionInput()`, normalize, and pure `diff()`; the networked `push`/`pull` adapter and dashboard are deferred.**

Design for isolation: each field type is its own small codec module; `define`, `infer`, `standard-schema`, `definition-input`, and `sync` are separate, independently testable units.

## 5. Public API / syntax

```ts
// schema/author.ts
import { defineMetaobject, m } from "@meta-manifest/core";

export const Author = defineMetaobject("author", {
  name: "Author",
  displayName: "name",                       // → displayNameKey
  access: { storefront: "public_read" },
  capabilities: { publishable: true },
  fields: {
    name:    m.text({ name: "Author Name", required: true, max: 120 }),
    bio:     m.multilineText({ name: "Bio" }),
    avatar:  m.file({ name: "Avatar", accept: ["Image"] }),
    rating:  m.rating({ min: 1, max: 5 }),
    website: m.url(),
    tags:    m.list(m.text({ choices: ["new", "featured", "classic"] })),
  },
});
```

```ts
// schema/book.ts
import { defineMetaobject, m } from "@meta-manifest/core";
import { Author } from "./author";

export const Book = defineMetaobject("book", {
  name: "Book",
  displayName: "title",
  fields: {
    title:       m.text({ required: true }),
    price:       m.money(),
    publishedOn: m.date(),
    author:      m.ref(Author),          // metaobject_reference, pinned by type "$app:author"
    related:     m.list(m.ref(Author)),  // list.metaobject_reference
  },
});
```

```ts
type AuthorValue = Infer<typeof Author>;
// { name: string; bio?: string; avatar?: string;
//   rating?: { value: number; min: number; max: number };
//   website?: string; tags?: string[] }

Author.type;                         // "$app:author" (resolved app-owned identifier)
Author.toDefinitionInput();          // → MetaobjectDefinitionCreateInput (for push)
Author.parse(metaobjectFields);      // Shopify {key, jsonValue}[] OR {key: value} record → typed, validated (read/pull)
Author.encode({ name: "Ursula" });   // typed object → [{ key, value }] for metaobjectUpsert (write)
Author["~standard"];                 // Standard Schema v1 interface for the typed object
```

### API decisions

- `m` is a namespace object of field builders. Each builder exposes **only** the option keys Shopify supports for that type, so invalid validations fail at compile time.
- `fields` is an **object map** (keys become Shopify field `key`s and drive type inference).
- `defineMetaobject(handle, config)` takes the bare handle; the engine applies the `$app:` prefix for app-owned v1. Abstracted so a future `{ owner: "merchant" }` drops the prefix.
- `m.ref(Schema)` accepts a schema object directly; `m.ref(() => Schema)` thunk form supports circular references (resolved lazily at build time).
- Type helpers: `Infer<typeof S>` (output / parsed shape) and `InferInput<typeof S>` (encode input shape).

## 6. Field-type coverage (v1)

The v1 builder set covers all four codec patterns. Adding a type later is one codec module.

**Scalar (string wire):** `m.text` (min/max/regex/choices), `m.multilineText` (min/max/regex), `m.integer` (min/max), `m.decimal` (min/max/maxPrecision), `m.boolean`, `m.date` (min/max), `m.dateTime` (min/max), `m.url` (allowedDomains), `m.color`, `m.json`.

**JSON-object wire:** `m.money` (`{amount, currency_code}`), `m.rating` (`{value, scale_min, scale_max}`; `min`/`max` required), `m.dimension` / `m.weight` / `m.volume` (`{value, unit}`, shared measurement codec).

**Reference (GID string wire):** `m.ref` (metaobject_reference, pinned by type), `m.product`, `m.variant`, `m.collection`, `m.page`, `m.file` (file_reference, `accept` → file_type_options).

**List:** `m.list(inner)` wraps any of the above (JSON-array wire; `min`/`max` → list.min/list.max).

**Deferred (post-v1, same patterns):** `rich_text_field`, `mixed_reference`, taxonomy/article/company/customer/order references, and the long-tail measurement units (power, pressure, etc.).

## 7. Codec model

Every builder node implements:

- `shopifyType: string` — e.g. `"single_line_text_field"`, `"list.metaobject_reference"`.
- `validations(): { name: string; value: string }[]` — e.g. `max: 120` → `[{ name: "max", value: "120" }]`.
- `decode(wire: unknown): Result<TOut>` — Shopify wire (string or `jsonValue`) → typed JS, validated.
- `encode(value: TIn): string` — typed JS → Shopify wire string.
- `["~standard"]` — Standard Schema v1 wrapper over `decode` for the typed value.

Exact JSON shapes for `money` / `rating` / measurement types are pinned from docs (and optionally cross-checked against `metafieldDefinitionTypes` introspection) during implementation. References encode/decode GID strings. `m.list` wraps an inner codec and (de)serializes a JSON array.

## 8. `defineMetaobject` composition

Returns a schema object exposing:

- `.type` — resolved identifier (`$app:<handle>` for app-owned).
- `.toDefinitionInput()` — `MetaobjectDefinitionCreateInput` (name, description, displayNameKey from `displayName`, access, capabilities, and `fieldDefinitions` built from each field's `shopifyType` + `validations()` + `required`/`name`/`description`).
- `.parse(fields)` — accepts `MetaobjectField[]` (`{ key, jsonValue|value }`) or a `{ key: value }` record → typed, validated object. Each field decoded by its codec; required-field and validation errors aggregated.
- `.encode(value)` — typed object → `[{ key, value }]` for `metaobjectUpsert`.
- `["~standard"]` — object-level Standard Schema interface.

## 9. Validation & Standard Schema

The Standard Schema v1 interface (`{ "~standard": { version: 1, vendor: "meta-manifest", validate } }`) is implemented at both the field and object level over the parsed/typed value, so meta-manifest schemas drop into any Standard-Schema-aware tool (form libraries, tRPC, etc.). Validation surfaces structured issues (`{ message, path }`) rather than throwing.

## 10. Sync engine (design; mostly deferred)

- `pull(admin, types)` — query `metaobjectDefinitionByType` / `metaobjectDefinitions`, normalize to an internal `RemoteDefinition` shape.
- `diff(localSchemas[], remote[])` — pure function → a plan of `createDefinition`, `addField`, `updateField` (name/description/required/validations), with `removeField` and field type-changes flagged **destructive/unsafe** (most types are non-migratable).
- `push(admin, plan)` — execute via `metaobjectDefinitionCreate` / `metaobjectDefinitionUpdate` (`MetaobjectFieldDefinitionOperationInput` create/update/delete). Topologically sorted by reference dependency; reference-by-type makes acyclic graphs single-pass, cycles get a create-then-update pass.

**v1 implements:** `toDefinitionInput()`, the normalize function, and the pure `diff()` (fully unit-testable, no network). **Deferred:** the networked `pull`/`push` adapter and the dashboard.

## 11. Package layout

Add a pnpm workspace package consumed by `app/`:

- `pnpm-workspace.yaml`: add `packages/*` (currently only `extensions/*`).
- `packages/core/` (`@meta-manifest/core`):
  - `src/fields/` — one module per codec (`text.ts`, `number.ts`, `boolean.ts`, `date.ts`, `money.ts`, `rating.ts`, `measurement.ts`, `reference.ts`, `list.ts`, …) + a shared field-node type.
  - `src/define.ts` — `defineMetaobject`.
  - `src/infer.ts` — `Infer` / `InferInput` type helpers.
  - `src/standard-schema.ts` — Standard Schema interface + types.
  - `src/definition-input.ts` — schema → `MetaobjectDefinitionCreateInput`.
  - `src/sync/` — `normalize.ts`, `diff.ts` (pure); networked `push.ts`/`pull.ts` stubbed/deferred.
  - `src/index.ts` — public exports (`defineMetaobject`, `m`, `Infer`, …).

## 12. Testing strategy (TDD)

Test-driven, no network. Per codec: round-trip `encode(decode(x)) === x` on representative wire values, validation pass/fail cases, and the emitted `validations()` array. Per schema: `toDefinitionInput()` snapshot, `parse()` of a realistic `metaobjectFields` payload, required/invalid-field error aggregation, and inference type-level checks (`expectTypeOf` or equivalent). `diff()`: create/add-field/update-field/destructive-change cases. Standard Schema conformance for a representative field and an object.

## 13. Out of scope (this spec)

- Networked `push` / `pull` against a live store.
- The embedded-app dashboard UI.
- Merchant-owned / general (Terraform-style) management of arbitrary store definitions.
- Metaobject **entry** CRUD UI (the SDK provides `encode`/`parse`; wiring `metaobjectUpsert`/reads into the app is later).
- Deferred field types listed in §6.

## 14. Open questions (resolve during implementation, not blocking)

- Exact stored JSON shape for `rating` (definition validations are `min`/`max`; the value JSON uses `scale_min`/`scale_max`) — pin against a real definition/docs.
- Whether `metaobject_definition_type` is accepted at create time for a **not-yet-created** target (affects whether circular refs need the two-pass create-then-update, or only acyclic ordering benefits). Default the engine to by-type with a two-pass fallback.
- Final naming of the published package (`@meta-manifest/core` vs internal-only).
