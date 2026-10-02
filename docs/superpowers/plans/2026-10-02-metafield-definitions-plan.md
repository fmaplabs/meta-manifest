# Implement Shopify metafield definitions in meta-manifest

## Context

meta-manifest declares and syncs Shopify **metaobject** definitions; metafields (custom fields on built-in owners like
Product/Customer/Order) have been explicitly out of scope, and the airfare consumer hand-rolled its own
metafield-definition sync as a workaround. The design is settled in
**`docs/superpowers/specs/2026-10-02-metafield-definitions-design.md`** (the source of truth for every decision —
API shape, explicit namespace/key control such as `product.color`, flat diff keyed by `(ownerType, namespace, key)`,
destructive gating, v1-minimal pull). This plan executes that spec.

Key reuse: the `m.*` field builders (`src/fields/`) work unchanged — metafields share the metaobject type/validation
system. The **entries feature is the structural template** throughout: `src/entries.ts`, `sync/entry-diff.ts`,
`sync/entry-push.ts`, `loadEntries` in `cli/load-config.ts`, `planEntriesFor` in `cli/plan.ts`, phase ordering in
`cli/push.ts`.

## Phase 1 — Declaration API

- New `src/metafields.ts`: `defineMetafields(owner, { namespace?, scope?, fields })`, `MetafieldOwner` union
  (camelCase → `MetafieldOwnerType` enum map), `MetafieldEntry` (bare `Field` or `{ field, pin?, description?,
  access?, capabilities? }` wrapper), `MetafieldSet` with `owner`, `namespace`, `fields`, `encode`, `parse`,
  `~standard`, and an `isMetafieldSet` guard (mirror `isMetaobjectSchema`, `src/define.ts:119`).
- Reuse `Infer`/`InferInput` (`src/infer.ts`) and the `Field` codecs (`src/fields/base.ts`) for encode/parse.
- Export from the package index.
- Author-time validations (spec §9): `smartCollectionCondition` only on product owner; `filterable` vs
  `capabilities.adminFilterable` conflict; `access.admin` only for app-reserved namespaces.

## Phase 2 — Resolution + GraphQL + diff/push core

- Namespace/scope resolution (spec §6): effective namespace = declared verbatim, else `$app` (app scope) / `"custom"`
  (merchant scope); feed metafield fields through the existing reference rewrite in `sync/resolve.ts`
  (`resolveDefinitions`, line 78); canonicalize remote `app--<id>` namespaces to `$app` (pattern:
  `toCanonicalType` in `sync/pull.ts`).
- `sync/client.ts`: add paged `metafieldDefinitions(ownerType:, namespace:)` query (name, description, type,
  validations, access, capabilities, pin, id) and `metafieldDefinitionCreate` / `Update` / `Delete` mutations.
- New `sync/metafield-diff.ts`: normalize local/remote; emit `createMetafield`, `updateMetafield`,
  `changeMetafieldType` (destructive: delete + recreate; `type`/`namespace`/`key`/`ownerType` are immutable),
  `removeMetafield` (destructive; only within declared `(ownerType, namespace)` pairs). Capabilities use the
  `{enabled: boolean}` both-ways contract so disabling diffs correctly.
- New `sync/metafield-push.ts`: apply ops, uppercase access enums (`MERCHANT_READ[_WRITE]` only), set
  `deleteAllAssociatedMetafields: true` for app-reserved-namespace deletes, aggregate userErrors per op like
  `sync/push.ts`.

## Phase 3 — CLI wiring

- `src/config.ts`: optional `metafields` path + `validateConfig`.
- `cli/load-config.ts`: `loadMetafields` (array export, `isMetafieldSet` per element, duplicate
  `(ownerType, namespace, key)` rejection — same UX as duplicate types at line 44).
- `cli/plan.ts` `planMetafieldsFor`; sections in `cli/diff.ts` / `cli/push.ts` / `cli/format.ts` printing
  `product.$app.careGuide`-style identifiers. Push order: metaobject defs → **metafield defs** → entries.
  Destructive ops gated behind `--allow-destructive`; exit codes unchanged (2 = failed/blocked).
- Verify + document the per-owner token-scope requirements in `docs/CLI.md` (spec §3 flags this as unconfirmed;
  likely the owner resource's scopes, e.g. `write_products`).

## Phase 4 — New field builders

Builders metafields commonly need that `src/fields/` lacks today (usable by metaobjects too):

- `m.richText()` → `rich_text_field` and `m.link()` → `link`: **upstream the airfare implementations** — it already
  subclasses the exported `Field` for both in
  `/home/kyle/dev/work/clients/airfare/code/monorepo/packages/metaobjects/src/fields.ts` (adapt to internal subclass
  style, keep its wire-format handling; rich text is a JSON wire format, link is `{text?, url}`).
- Reference builders following the existing factory pattern in `src/fields/reference.ts:68-77`:
  `m.customer()` → `customer_reference`, `m.order()` → `order_reference`, `m.company()` → `company_reference`,
  `m.companyLocation()` → `company_location_reference`. All work inside `m.list(...)` like the existing references.
- Register in the `m` object (`src/fields/index.ts:11-35`), add to codegen's `SIMPLE`/`fieldCall()` mapping
  (`src/codegen.ts:17`), README field-type table, and unit tests (encode/decode round-trip, validations, list
  wrapping) matching the existing per-builder test style.

## Phase 5 — Pull/codegen (v1-minimal), scaffold, docs

- `cli/pull.ts` + `src/codegen.ts`: when `metafields` is configured, re-pull declared `(ownerType, namespace)` pairs
  and codegen the metafields module (reuse `SIMPLE` map and `fieldCall()`). No store-wide discovery.
- `cli/init.ts`: optional metafields scaffold.
- README (library usage + multi-file section), `docs/SYNC.md` (new op kinds, ordering, destructive semantics,
  `required` is local-typing-only), `docs/CLI.md` (scopes).

## Testing / verification

- Unit tests per phase, colocated `*.test.ts` as existing: declaration (identity, wrapper entries, Infer/encode/parse
  round-trip, duplicate rejection), resolution (namespace defaulting, verbatim namespaces, `app--<id>`
  canonicalization, ref rewrite), diff (all four ops, pin/capability drift, unmanaged namespaces untouched), push
  (payload mapping, destructive gating, `deleteAllAssociatedMetafields` only for app namespaces), validations, new
  builders (round-trips, list wrapping, codegen mapping).
- Run the full suite + typecheck/build with the repo's existing scripts (`package.json`).
- e2e against a dev store (airfare dev config pattern): declare one `$app` PRODUCT metafield and one explicit
  `product.color`; `mm diff` → `mm push` → re-diff clean → mutate (rename, pin, tighten validation) → update path →
  destructive delete gated without `--allow-destructive`.

## Out of scope (per spec §12–13)

Metafield value seeding; `constraints`; standard definitions; store-wide pull bootstrap. (New field builders are now
in scope — Phase 4.)
