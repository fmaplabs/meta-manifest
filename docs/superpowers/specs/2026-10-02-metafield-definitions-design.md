# meta-manifest — metafield definitions (design)

**Date:** 2026-10-02
**Status:** Proposed (awaiting review)
**Scope of this spec:** declaring Shopify **metafield definitions** (custom fields on built-in owner types — Product,
Customer, Order, …) in code with the existing `m` field builders, with **explicit namespace + key control**, and syncing
them through the existing `pull` → `diff` → `push` pipeline via `metafieldDefinitionCreate/Update/Delete`. Includes
typed value encode/parse for `metafieldsSet`. No metafield *value* seeding (the entries analog) in v1.

## 1. Context & goals

`@fmaplabs/meta-manifest` declares metaobject definitions and syncs them to a store. Metafields were explicitly out of
scope (`2026-06-30-meta-manifest-cli-pivot-design.md:35`). Meanwhile the airfare consumer
(`clients/airfare/.../packages/metaobjects/src/parity/`) hand-rolled metafield-definition capture/apply outside the
library — proof of demand and a source of field-tested gotchas. This spec folds that capability in:

1. Declare metafield definitions per **owner type** (`product`, `customer`, `order`, …) using the same `m.*` builders
   metaobjects use — the type/validation layer is shared by Shopify's own model.
2. Declare the **namespace and key** explicitly. A metafield "color" may live at `product.color`, not just the default
   namespace — e.g. to match definitions a theme or another system already reads.
3. Reconcile with the store: create, update (name/description/validations/access/capabilities/pin), and gated
   destructive ops (delete, type change) — same `diff`/`push` UX as metaobjects.
4. Expose typed value helpers (`encode`/`parse`) so app code gets the same Standard-Schema story `defineMetaobject`
   provides.

## 2. Decisions (locked)

| #   | Decision | Choice |
| --- | --- | --- |
| 1 | Declaration unit | **`defineMetafields(ownerType, config)` — one set per `(ownerType, namespace)`.** Multiple sets per owner type are allowed (different namespaces); a project lists sets in a `metafields` array module, mirroring `schemas`/`entries`. |
| 2 | Namespace | **Set-level `namespace` option, used verbatim when present.** Default derives from scope: app scope → `$app` (canonicalized against the store's `app--<id>`), merchant scope → `"custom"` (Shopify's admin default). No per-field namespace — a field in a different namespace is a different set. |
| 3 | Key | **The object key in `fields` is the metafield key**, exactly as metaobject fields work. Non-identifier keys use quoted object keys (`"color-primary": m.color()`); no separate `key` option. |
| 4 | Per-field metafield options | A `fields` entry is either a bare `Field` or **`{ field, pin?, access?, capabilities?, description? }`** — metafield-only options wrap the field rather than polluting the shared builders. The builder's own `name`/`description` still apply when not overridden. |
| 5 | Diff identity | `(ownerType, namespace, key)` — each definition diffs independently. **Flat op set** (`createMetafield`, `updateMetafield`, `changeMetafieldType`, `removeMetafield`) in a new `sync/metafield-diff.ts`, not a widened `DiffOp` union (metafields have no nested field evolution; precedent: `entry-diff.ts`). |
| 6 | Destructive gating | `removeMetafield` and `changeMetafieldType` (delete + recreate — `type` is immutable) gated behind `--allow-destructive`. Deleting an `$app`-namespace definition **requires `deleteAllAssociatedMetafields: true`** (wipes all values store-wide, async) — the plan output must say so explicitly. |
| 7 | Ordering | Metafield pushes run **after metaobject definition creates, before entries** (a `metaobject_reference` metafield depends on the target definition existing). `m.ref`/`m.mixedRef` targets resolve through the same scope/type rewrite as metaobject fields. |
| 8 | Pull | `mm diff`/`mm push` fetch only the `(ownerType, namespace)` pairs declared locally — unmanaged definitions are never compared or touched (upsert-only philosophy, as entries). `mm pull` codegen of metafields is **v1-minimal**: only when `metafields` is configured, re-pulling the declared `(ownerType, namespace)` pairs; no store-wide bootstrap enumeration. |
| 9 | `required` | Metafield definitions have **no required concept**; `required: true` on a builder affects local value typing (`Infer`) and `encode`/`parse` only, and is excluded from the definition diff. Documented, not an error. |
| 10 | Pin | `pin?: boolean` maps to create input `pin` and update input `pin` (no separate pin/unpin mutation calls needed). Unpinning reconciles via update. |

## 3. Verified Shopify ground truth

Confirmed against shopify.dev Admin API docs (2026-07) during research, not memory.

- **Mutations:** `metafieldDefinitionCreate(definition: MetafieldDefinitionInput!)`,
  `metafieldDefinitionUpdate(definition: MetafieldDefinitionUpdateInput!)`,
  `metafieldDefinitionDelete(... deleteAllAssociatedMetafields: Boolean = false)`. Query:
  `metafieldDefinitions(ownerType:, namespace:, first:, after:)` — per owner type; there is no single
  "all owner types" query.
- **Identity & immutability:** `ownerType`, `namespace`, `key`, and `type` are immutable. Updatable: `name`,
  `description`, `validations` (tightening may fail against existing values), `access`, `capabilities`,
  `constraints`, `pin`. ([Manage metafield definitions](https://shopify.dev/docs/apps/build/metafields/definitions))
- **`MetafieldDefinitionInput`:** `name`, `namespace` (optional — omitted → app-reserved namespace), `key`,
  `description`, `ownerType: MetafieldOwnerType!`, `type`, `validations: [{name, value}]`, `access`, `capabilities`,
  `pin`.
- **`MetafieldOwnerType`** (2026-07): `PRODUCT`, `PRODUCTVARIANT`, `CUSTOMER`, `ORDER`, `DRAFTORDER`, `COLLECTION`,
  `COMPANY`, `COMPANY_LOCATION`, `LOCATION`, `MARKET`, `PAGE`, `ARTICLE`, `BLOG`, `SHOP`, `SELLING_PLAN`, `DISCOUNT`,
  `GIFT_CARD_TRANSACTION`, `TRANSFER`, `VALIDATION`, plus function-owner types (`CARTTRANSFORM`,
  `DELIVERY_CUSTOMIZATION`, `PAYMENT_CUSTOMIZATION`, `FULFILLMENT_CONSTRAINT_RULE`, `ORDER_ROUTING_LOCATION_RULE`,
  `API_PERMISSION`).
- **Access:** `MetafieldAccessInput { admin, storefront, customerAccount }`; `admin` accepts **only**
  `MERCHANT_READ` / `MERCHANT_READ_WRITE` (airfare's `parity/apply/definitions.ts:51` hit this).
- **Capabilities:** `adminFilterable`, `smartCollectionCondition` (PRODUCT only), `uniqueValues` — each
  `{ enabled: Boolean! }`.
- **Types/validations are shared with metaobject fields** ("Metaobjects use the same data types" —
  [list of data types](https://shopify.dev/docs/apps/build/metafields/list-of-data-types)); so every `m.*` builder's
  `shopifyType` + `validations()` output is valid here, including `metaobject_definition_type(s)` reference
  validations and `list.min`/`list.max`.
- **Namespace canonicalization:** the store returns the app-reserved namespace as `app--<id>` (and per-store the id
  differs — airfare's `parity/stores.ts`); local `$app` must be canonicalized exactly like `pull.ts` does for
  metaobject types.
- **Values:** write via `metafieldsSet` (namespace defaults to `$app`), read via `owner.metafield(key) { jsonValue }`.
- **To verify at implementation time (not confirmed from docs):** the exact token scopes gating definition CRUD per
  owner type (believed to be the owner resource's scopes, e.g. `write_products` for PRODUCT) — confirm and document a
  scope matrix in `docs/CLI.md`.

## 4. Current-state facts that shape the work

- Field builders (`src/fields/`) need **zero changes** for the core feature: `shopifyType`, `validations()`,
  `encode`/`decode`, `jsonEquals` all apply. `filterable` (→ `adminFilterable`) already exists on
  `CommonFieldOptions` (`fields/base.ts:23`).
- The entries feature is the structural template: own declaration module (`entries.ts`), own diff/push modules
  (`sync/entry-diff.ts`, `sync/entry-push.ts`), own config key + loader (`cli/load-config.ts`), own plan section
  (`cli/plan.ts` `planEntriesFor`), pushed in a fixed phase order in `cli/push.ts`.
- All GraphQL strings live in `sync/client.ts`; the injected `AdminGraphQLClient` transport needs no change.
- `sync/resolve.ts` already rewrites `$app:` types and reference validations by scope — metafield reference
  validations must flow through the same rewrite so app/merchant graphs resolve consistently.
- Missing builders that matter more for metafields: `rich_text_field`, `link`, `customer_reference`,
  `order_reference`, `company_reference` (airfare subclasses `Field` for the first two in its `src/fields.ts`).

## 5. Public API / syntax

### 5.1 Declaration

```ts
// src/metafields/product.ts
import { defineMetafields, m } from "@fmaplabs/meta-manifest";
import Author from "../metaobjects/author";

export default defineMetafields("product", {
  // namespace omitted → "$app" (app scope) / "custom" (merchant scope)
  fields: {
    careGuide: m.text({ name: "Care Guide", max: 100 }),
    author: { field: m.ref(Author), pin: true },
    rating: { field: m.decimal({ min: 0, max: 5 }), capabilities: { adminFilterable: true } },
  },
});
```

Explicit namespace — the user-facing motivation for decision 2 (e.g. a definition the theme reads at
`product.color`):

```ts
// src/metafields/product-theme.ts — second set on the same owner type, different namespace
export default defineMetafields("product", {
  namespace: "product",
  fields: {
    color: m.color({ name: "Color" }),
    "care-instructions": m.multilineText(),   // quoted key = metafield key verbatim
  },
});
```

```ts
// src/metafields.ts — the module `metafields` in the config points at
import productApp from "./metafields/product";
import productTheme from "./metafields/product-theme";
import customer from "./metafields/customer";

export const metafields = [productApp, productTheme, customer];
```

### 5.2 Config

```ts
export default defineConfig({
  shop: "my-store.myshopify.com",
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  schema: "./src/schema.ts",
  entries: "./src/entries.ts",
  metafields: "./src/metafields.ts",   // NEW — optional, like entries
  scope: "app",
});
```

### 5.3 Types

```ts
// metafields.ts (new, alongside define.ts / entries.ts)
export type MetafieldOwner =
  | "product" | "productVariant" | "customer" | "order" | "draftOrder" | "collection"
  | "company" | "companyLocation" | "location" | "market" | "page" | "article" | "blog"
  | "shop" | "sellingPlan" | "discount" | /* …full MetafieldOwnerType list, camelCase */;

export interface MetafieldOptions {
  pin?: boolean;
  description?: string;                               // overrides the builder's description
  access?: {
    admin?: "merchant_read" | "merchant_read_write";
    storefront?: "public_read" | "none";
    customerAccount?: "none" | "read";
  };
  capabilities?: {
    adminFilterable?: boolean;                        // also settable via the field's `filterable`
    smartCollectionCondition?: boolean;               // PRODUCT only (validated)
    uniqueValues?: boolean;
  };
}

export type MetafieldEntry = AnyField | ({ field: AnyField } & MetafieldOptions);

export interface MetafieldSetConfig<F extends Record<string, MetafieldEntry>> {
  namespace?: string;        // verbatim when present; default derived from scope at sync time
  scope?: "app" | "merchant"; // per-set override of config.scope (drives the namespace default only)
  fields: F;
}

export function defineMetafields<F>(owner: MetafieldOwner, config: MetafieldSetConfig<F>): MetafieldSet<F>;
export function isMetafieldSet(x: unknown): x is AnyMetafieldSet;   // loader duck-type guard
```

`MetafieldSet` exposes (mirroring `MetaobjectSchema`): `owner` (canonical enum value), `namespace` (declared or
`"$app"` sentinel), `fields`, `encode(values)` → `metafieldsSet` metafield inputs (ownerId supplied by the caller),
`parse(metafields)` ← `{key, jsonValue}[]`, and `~standard`. `Infer<typeof set.fields>` works unchanged.

## 6. Namespace & scope resolution (sync-time)

Mirrors metaobject scope resolution (`sync/resolve.ts`):

1. Effective scope per set: set `scope` → else `config.scope` → else `"app"`.
2. Effective namespace: declared `namespace` **verbatim** if present; else `$app` (app scope) / `"custom"` (merchant
   scope).
3. `$app` is canonical locally; remote `app--<id>` namespaces are canonicalized back to `$app` when normalizing pulled
   definitions (same pattern as `toCanonicalType` in `sync/pull.ts`). Explicit namespaces compare verbatim.
4. Reference validations (`metaobject_definition_type(s)`) are rewritten to the target metaobject's effective type by
   the existing resolve step — metafield sets feed their fields through it.

Duplicate `(ownerType, namespace, key)` across all loaded sets → load-time error (same UX as duplicate metaobject
types in `load-config.ts:44`).

## 7. Diff & push

- **`sync/metafield-diff.ts`** — normalize local (from resolved sets) and remote (from
  `metafieldDefinitions(ownerType:, namespace:)` pages) into a comparable shape
  `{ ownerType, namespace, key, type, name, description, validations, access, capabilities, pin }`, then emit:
  - `createMetafield` — local only.
  - `updateMetafield` — same `type`, drift in name/description/validations/access/capabilities/pin.
  - `changeMetafieldType` — `type` differs → **destructive** (delete with `deleteAllAssociatedMetafields: true` when
    the namespace is app-reserved, then create).
  - `removeMetafield` — remote-only *within a declared `(ownerType, namespace)` pair* → **destructive**. Definitions
    in pairs meta-manifest doesn't declare are invisible (decision 8).
  - Capabilities use the enabled/disabled contract from the metaobject-options spec (`{enabled: boolean}` both ways)
    so "was on, now off" diffs correctly.
- **`sync/metafield-push.ts`** — applies ops via `metafieldDefinitionCreate`/`Update`/`Delete`; aggregates
  userErrors per op like `push.ts`. No topological ordering needed *within* metafields (no metafield→metafield
  references); the cross-phase ordering (after metaobject creates) is handled in the callers.
- **GraphQL documents** added to `sync/client.ts`: paged `metafieldDefinitions` query (fields above + `id`), and the
  three mutations.
- **CLI wiring:** `config.ts` (`metafields?: string` + validation), `load-config.ts` `loadMetafields` (array export,
  `isMetafieldSet` per element, duplicate check), `plan.ts` `planMetafieldsFor`, `diff.ts`/`push.ts`/`format.ts`
  sections (print as `product.$app.careGuide`-style identifiers), exit-code semantics unchanged (`2` on failed or
  blocked ops).
- **Token scopes:** document per-owner scope requirements in `docs/CLI.md` once verified (§3 last bullet).

## 8. Pull / codegen (v1-minimal)

When `metafields` is configured, `mm pull` additionally fetches the declared `(ownerType, namespace)` pairs and
codegens a `metafields` module next to the schema module, reusing `codegen.ts`'s `SIMPLE` map and `fieldCall()`
(same single-file overwrite caveat as schemas). Store-wide bootstrap ("discover every definition on 25 owner types")
is explicitly out of scope for v1 — revisit if demanded.

## 9. Validation & edge cases

- `smartCollectionCondition` on a non-PRODUCT owner → plan-time validation error.
- `access.admin` on merchant-scoped/non-reserved-namespace sets: same rule as metaobjects — only valid for
  app-reserved namespaces; plan-time error otherwise.
- Explicit `namespace: "$app"` is allowed and identical to the default under app scope.
- `filterable: true` on the builder and `capabilities.adminFilterable` in the wrapper must agree if both set
  (error on conflict); either alone works.
- `required` excluded from definition diffing (decision 9) — README note.
- Validation tightening may fail server-side against existing values → surfaces as a userError on the update op,
  reported per-op (not pre-checked).
- Choices validation only applies to `single_line_text_field` (already enforced by the builders).
- `m.ref` to a metaobject definition that isn't in `schemas` → same unresolved-target error metaobject fields raise.

## 10. Testing

- **Unit — declaration:** `defineMetafields` identity (owner/namespace/keys), wrapper vs bare field entries,
  `Infer`/encode/parse round-trip, `isMetafieldSet`, duplicate `(owner, ns, key)` rejection.
- **Unit — resolution:** namespace defaulting per scope, verbatim explicit namespaces, `app--<id>` ↔ `$app`
  canonicalization, reference-validation rewrite.
- **Unit — diff:** create/update/changeType/remove emission; pin + capability enabled→disabled drift; unmanaged
  namespaces untouched.
- **Unit — push:** mutation payload mapping (access enums uppercased, capabilities `{enabled}` shape,
  `deleteAllAssociatedMetafields` only for app-reserved namespaces), destructive gating, exit codes.
- **Unit — validation:** smartCollectionCondition owner check, admin-access namespace check, filterable conflict.
- **e2e:** extend the sync e2e to create → drift → update → destructive-gated delete for one PRODUCT and one
  explicit-namespace definition.

## 11. Files touched

New: `src/metafields.ts` (or `src/define-metafields.ts`), `sync/metafield-diff.ts`, `sync/metafield-push.ts`, tests.
Modified: `config.ts`, `sync/client.ts`, `sync/resolve.ts` (feed metafield fields through reference rewrite),
`cli/load-config.ts`, `cli/plan.ts`, `cli/diff.ts`, `cli/push.ts`, `cli/format.ts`, `cli/pull.ts` + `codegen.ts`
(v1-minimal), `cli/init.ts` (optional scaffold), README + `docs/SYNC.md` + `docs/CLI.md`.

## 12. Companion work (recommended, separable)

- New field builders: `m.richText()` (`rich_text_field`), `m.link()` (`link`), `m.customer()`, `m.order()`,
  `m.company()` reference builders — upstream airfare's `rich_text_field`/`link` implementations.
- README positioning note: distributed apps should prefer `shopify.app.toml` for metafield definitions;
  meta-manifest's GraphQL sync targets custom-app/merchant-store tooling (and covers what TOML can't: merchant scope,
  explicit namespaces, onlineStore-style GraphQL-only surface).
- Migrate airfare's `parity/` metafield-definition sync onto this feature once shipped.

## 13. Out of scope

- Metafield **value** seeding (the entries analog for metafields) — the `encode` helper covers app-runtime writes.
- `constraints` (resource-subtype constraints) — not needed by current consumers; additive later.
- Standard metafield definitions (`standardMetafieldDefinitionEnable`) and definition pinning order.
- Store-wide pull bootstrap across all owner types (§8).
- Dashboard/UI; `shopify.app.toml` emission.
