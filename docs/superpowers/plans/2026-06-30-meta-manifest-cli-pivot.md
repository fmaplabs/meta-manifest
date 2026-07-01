# meta-manifest CLI/library pivot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `meta-manifest` Shopify app repo into a single, publishable npm package that ships a zero-dependency library plus an `mm` CLI (`init`/`pull`/`diff`/`push`) for syncing Shopify metaobject definitions.

**Architecture:** Promote `packages/core/src` to the repo root `src/`, delete the Shopify app, and add four new library modules (`config.ts`, `node/client.ts`, `codegen.ts`, plus a `pullAll` enumeration) and a `src/cli/` bin. The existing `sync/` layer is reused unchanged behind its injected `AdminGraphQLClient` interface; the CLI supplies a token-based standalone client where the app supplied a session-based one.

**Tech Stack:** TypeScript (ESM), vitest, tsup (build → ESM+CJS+.d.ts), jiti (load TS config/schema at runtime), Shopify Admin GraphQL API.

**Spec:** `docs/superpowers/specs/2026-06-30-meta-manifest-cli-pivot-design.md`

## Global Constraints

- Node engines: `>=20.19 <22 || >=22.12` (copied from current package.json).
- The `"."` library export (`src/index.ts` and everything it imports) MUST stay **zero runtime dependencies**. New deps (`jiti`) are used only by `src/cli/**` and `src/node/**`.
- Package identity: `name: "meta-manifest"`, `version: 0.1.0`, `type: "module"`, not `private`.
- Bin names: `meta-manifest` and `mm`, both → `./dist/cli/index.js`.
- Default Admin API version: `"2026-07"` (matches the validated version in `src/sync/client.ts`).
- App-owned metaobject types use the reserved `$app:` prefix; `defineMetaobject("handle", …)` yields `.type === "$app:handle"` and `.handle === "handle"`.
- TDD throughout: failing test → run (fail) → minimal impl → run (pass) → commit. Small commits.
- Tests run with `pnpm test` (`vitest run`, glob `src/**/*.test.ts`); typecheck with `pnpm typecheck` (`tsc --noEmit`).

---

## File Structure

**Promoted/moved (unchanged content):** `packages/core/src/**` → `src/**`; `packages/core/vitest.config.ts` → `vitest.config.ts`; `packages/core/docs/SYNC.md` → `docs/SYNC.md`.

**Deleted:** `app/`, `prisma/`, `extensions/`, `public/`, `.shopify/`, `.react-router/`, `build/`, `shopify.app.toml`, `shopify.web.toml`, `vite.config.ts`, `.graphqlrc.ts`, `Dockerfile`, `env.d.ts`, `.dockerignore`, `shopify.web.toml`, `pnpm-workspace.yaml`, `packages/` (after promotion).

**New library modules:**
- `src/config.ts` — `Config`, `defineConfig`, `validateConfig`, `DEFAULT_API_VERSION`.
- `src/sync/client.ts` (modify) — add `LIST_DEFINITIONS_QUERY`.
- `src/sync/pull.ts` (modify) — add `pullAll`.
- `src/node/client.ts` — `createAdminClient` (the `./node` subpath export).
- `src/codegen.ts` — `generateSchemaSource`.
- `src/index.ts` (modify) — re-export the new library API + `AnySchema`.

**New CLI (`src/cli/`):**
- `format.ts` — `opTarget`/`isDestructive`/`describeOp`/`describeResult` (lifted from the deleted app route).
- `plan.ts` — `planFor(client, schemas)`.
- `load-config.ts` — `loadConfig`, `loadSchemas`.
- `init.ts` / `pull.ts` / `diff.ts` / `push.ts` — `runInit`/`runPull`/`runDiff`/`runPush`.
- `index.ts` — the bin entrypoint (argv routing, exit codes).

**Packaging:** `package.json` (rewrite), `tsup.config.ts` (new), `tsconfig.json` (update), `.gitignore` (update).

---

### Task 1: Restructure repo into a single package

Mechanical move + prune. The regression guard is the **existing test suite** running green from the new location plus a clean typecheck — no new unit test.

**Files:**
- Move: `packages/core/src` → `src`, `packages/core/vitest.config.ts` → `vitest.config.ts`, `packages/core/docs/SYNC.md` → `docs/SYNC.md`
- Delete: app + tooling files (see File Structure)
- Modify: `package.json`, `tsconfig.json`, `.gitignore`

- [ ] **Step 1: Move core source up and remove the app**

```bash
git mv packages/core/src src
git mv packages/core/vitest.config.ts vitest.config.ts
mkdir -p docs && git mv packages/core/docs/SYNC.md docs/SYNC.md
git rm -r app prisma extensions public shopify.app.toml shopify.web.toml \
  vite.config.ts .graphqlrc.ts Dockerfile env.d.ts .dockerignore pnpm-workspace.yaml
rm -rf .shopify .react-router build packages
```

- [ ] **Step 2: Rewrite `package.json`** (build/exports/bin are added in Task 10; dev tooling only here)

```json
{
  "name": "meta-manifest",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=20.19 <22 || >=22.12" },
  "author": "kyle",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "jiti": "^2.4.2"
  },
  "devDependencies": {
    "tsup": "^8.3.5",
    "tsx": "^4.19.0",
    "typescript": "^5.9.3",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Update `tsconfig.json`** so `include` points at the flat `src/` and strictness stays on. Replace its body with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "declaration": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Update `.gitignore`** — ensure `node_modules`, `dist`, and `.env` are ignored (append any missing):

```
node_modules
dist
.env
```

- [ ] **Step 5: Install and verify existing tests + typecheck pass from the new layout**

Run: `pnpm install && pnpm test && pnpm typecheck`
Expected: all existing `src/**/*.test.ts` pass; `tsc --noEmit` reports no errors. (`@types/node` comes in via `tsx`/`vitest`; if `tsc` errors on missing node types, add `@types/node` to devDependencies and re-run.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: collapse app into single package (promote core to src/)"
```

---

### Task 2: Config module

**Files:**
- Create: `src/config.ts`
- Test: `src/config.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `interface Config { shop: string; accessToken: string; apiVersion?: string; schema: string }`, `defineConfig(c: Config): Config`, `validateConfig(raw: unknown): Config`, `const DEFAULT_API_VERSION = "2026-07"`.

- [ ] **Step 1: Write the failing test**

```ts
// src/config.test.ts
import { describe, it, expect } from "vitest";
import { defineConfig, validateConfig, DEFAULT_API_VERSION } from "./config";

describe("config", () => {
  it("defineConfig returns its argument and DEFAULT_API_VERSION is 2026-07", () => {
    const c = { shop: "s.myshopify.com", accessToken: "t", schema: "./s.ts" };
    expect(defineConfig(c)).toBe(c);
    expect(DEFAULT_API_VERSION).toBe("2026-07");
  });

  it("validateConfig accepts a complete config", () => {
    const c = validateConfig({ shop: "s.myshopify.com", accessToken: "t", schema: "./s.ts" });
    expect(c.shop).toBe("s.myshopify.com");
  });

  it("validateConfig throws with the missing field named", () => {
    expect(() => validateConfig({ accessToken: "t", schema: "./s.ts" })).toThrow(/shop/);
    expect(() => validateConfig({ shop: "s", schema: "./s.ts" })).toThrow(/accessToken/);
    expect(() => validateConfig({ shop: "s", accessToken: "t" })).toThrow(/schema/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/config.test.ts`
Expected: FAIL — cannot find module `./config`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/config.ts
export const DEFAULT_API_VERSION = "2026-07";

export interface Config {
  /** e.g. "my-store.myshopify.com" */
  shop: string;
  /** Admin API access token; reference via process.env in your config file. */
  accessToken: string;
  /** Admin API version. Defaults to DEFAULT_API_VERSION. */
  apiVersion?: string;
  /** Path to the schema module whose `schemas` export drives diff/push, and pull writes. */
  schema: string;
}

/** Identity helper for type inference in `meta-manifest.config.ts`. */
export function defineConfig(config: Config): Config {
  return config;
}

/** Validate a loaded config object, throwing a one-line Error naming the first missing field. */
export function validateConfig(raw: unknown): Config {
  const c = raw as Partial<Config> | null | undefined;
  for (const key of ["shop", "accessToken", "schema"] as const) {
    if (!c || typeof c[key] !== "string" || c[key] === "") {
      throw new Error(`Invalid config: missing or empty "${key}".`);
    }
  }
  return c as Config;
}
```

- [ ] **Step 4: Re-export from `src/index.ts`** — add:

```ts
export { defineConfig, validateConfig, DEFAULT_API_VERSION } from "./config";
export type { Config } from "./config";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/config.test.ts src/index.ts
git commit -m "feat: add config module (defineConfig/validateConfig)"
```

---

### Task 3: Enumeration query + `pullAll`

Adds a paginated "list all definitions" query and a `pullAll` that returns app-owned definitions re-labeled to canonical `$app:` types. This is the only change to the existing sync layer.

**Files:**
- Modify: `src/sync/client.ts` (add `LIST_DEFINITIONS_QUERY`), `src/sync/pull.ts` (add `pullAll`), `src/index.ts`
- Test: `src/sync/pull-all.test.ts`

**Interfaces:**
- Consumes: `AdminGraphQLClient`, `execute` (from `./client`), `PulledRemote` (from `./pull`).
- Produces: `LIST_DEFINITIONS_QUERY: string`; `pullAll(client: AdminGraphQLClient, opts?: { appOwnedOnly?: boolean }): Promise<PulledRemote[]>` — `appOwnedOnly` defaults to `true`. Each returned `PulledRemote.type` is the canonical `$app:<handle>` for app-owned definitions.

- [ ] **Step 1: Write the failing test**

```ts
// src/sync/pull-all.test.ts
import { describe, it, expect } from "vitest";
import type { AdminGraphQLClient } from "./client";
import { LIST_DEFINITIONS_QUERY } from "./client";
import { pullAll } from "./pull";

/** Fake client returning two pages; one app-owned def and one store-native def. */
function fakeStore(): AdminGraphQLClient {
  const pages = [
    {
      nodes: [
        { id: "gid://shopify/MetaobjectDefinition/1", name: "Author", type: "app--111--author",
          fieldDefinitions: [{ key: "name", type: { name: "single_line_text_field" }, required: true, validations: [] }] },
      ],
      pageInfo: { hasNextPage: true, endCursor: "c1" },
    },
    {
      nodes: [
        { id: "gid://shopify/MetaobjectDefinition/2", name: "Designer", type: "designer",
          fieldDefinitions: [{ key: "n", type: { name: "single_line_text_field" }, required: false, validations: [] }] },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  ];
  return async (query, options) => {
    expect(query).toBe(LIST_DEFINITIONS_QUERY);
    const after = (options?.variables?.after as string | undefined) ?? null;
    const page = after === null ? pages[0] : pages[1];
    return { data: { metaobjectDefinitions: { nodes: page.nodes, pageInfo: page.pageInfo } } };
  };
}

describe("pullAll", () => {
  it("paginates and keeps app-owned defs, re-labeled to $app: types", async () => {
    const remote = await pullAll(fakeStore());
    expect(remote.map((r) => r.type)).toEqual(["$app:author"]);
    expect(remote[0].id).toBe("gid://shopify/MetaobjectDefinition/1");
    expect(remote[0].definition.type).toBe("$app:author");
  });

  it("appOwnedOnly:false returns store-native defs too", async () => {
    const remote = await pullAll(fakeStore(), { appOwnedOnly: false });
    expect(remote.map((r) => r.type)).toEqual(["$app:author", "designer"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/sync/pull-all.test.ts`
Expected: FAIL — `LIST_DEFINITIONS_QUERY`/`pullAll` not exported.

- [ ] **Step 3: Add the enumeration query to `src/sync/client.ts`** (after `PULL_DEFINITION_QUERY`)

```ts
export const LIST_DEFINITIONS_QUERY = `query ListMetaobjectDefinitions($after: String) {
  metaobjectDefinitions(first: 50, after: $after) {
    nodes {
      id
      name
      type
      fieldDefinitions {
        key
        name
        description
        required
        type { name }
        validations { name value }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
```

- [ ] **Step 4: Add `pullAll` to `src/sync/pull.ts`**

```ts
import { execute, PULL_DEFINITION_QUERY, LIST_DEFINITIONS_QUERY } from "./client";

interface ListResponse {
  metaobjectDefinitions: {
    nodes: PullNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

/** Convert Shopify's resolved app type ("app--<id>--<handle>") to canonical "$app:<handle>". */
function toCanonicalType(resolved: string): string | null {
  const m = /^app--\d+--(.+)$/.exec(resolved);
  return m ? `$app:${m[1]}` : null;
}

/**
 * Enumerate every metaobject definition in the store. By default returns only
 * app-owned definitions, re-labeled to canonical "$app:<handle>" types so they
 * round-trip through `defineMetaobject`. [design §3]
 */
export async function pullAll(
  client: AdminGraphQLClient,
  opts: { appOwnedOnly?: boolean } = {},
): Promise<PulledRemote[]> {
  const appOwnedOnly = opts.appOwnedOnly ?? true;
  const out: PulledRemote[] = [];
  let after: string | null = null;
  do {
    const data: ListResponse = await execute<ListResponse>(client, LIST_DEFINITIONS_QUERY, { after });
    for (const node of data.metaobjectDefinitions.nodes) {
      const canonical = toCanonicalType(node.type);
      if (appOwnedOnly && !canonical) continue;
      const type = canonical ?? node.type;
      out.push({ id: node.id, type, definition: { type, name: node.name, fieldDefinitions: node.fieldDefinitions } });
    }
    after = data.metaobjectDefinitions.pageInfo.hasNextPage ? data.metaobjectDefinitions.pageInfo.endCursor : null;
  } while (after !== null);
  return out;
}
```

- [ ] **Step 5: Export `pullAll` from `src/index.ts`** — extend the pull export line:

```ts
export { pull, pullAll } from "./sync/pull";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/sync/pull-all.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/sync/client.ts src/sync/pull.ts src/index.ts src/sync/pull-all.test.ts
git commit -m "feat: add metaobjectDefinitions enumeration + pullAll"
```

---

### Task 4: Standalone token-based Admin client

**Files:**
- Create: `src/node/client.ts`
- Test: `src/node/client.test.ts`

**Interfaces:**
- Consumes: `AdminGraphQLClient`, `SyncTransportError` (from `../sync/client`), `DEFAULT_API_VERSION` (from `../config`).
- Produces: `createAdminClient(opts: { shop: string; accessToken: string; apiVersion?: string }): AdminGraphQLClient`.

- [ ] **Step 1: Write the failing test**

```ts
// src/node/client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createAdminClient } from "./client";
import { SyncTransportError } from "../sync/client";

afterEach(() => vi.unstubAllGlobals());

describe("createAdminClient", () => {
  it("POSTs to the shop graphql endpoint with the token header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createAdminClient({ shop: "s.myshopify.com", accessToken: "tok", apiVersion: "2026-07" });
    const res = await client("query { ok }", { variables: { a: 1 } });
    expect(res).toEqual({ data: { ok: true } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://s.myshopify.com/admin/api/2026-07/graphql.json");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as any).headers["X-Shopify-Access-Token"]).toBe("tok");
    expect(JSON.parse((init as any).body)).toEqual({ query: "query { ok }", variables: { a: 1 } });
  });

  it("throws SyncTransportError on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    const client = createAdminClient({ shop: "s.myshopify.com", accessToken: "tok" });
    await expect(client("query { ok }")).rejects.toBeInstanceOf(SyncTransportError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/node/client.test.ts`
Expected: FAIL — cannot find module `./client` under `src/node`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/node/client.ts
import type { AdminGraphQLClient } from "../sync/client";
import { SyncTransportError } from "../sync/client";
import { DEFAULT_API_VERSION } from "../config";

/**
 * Build an AdminGraphQLClient that talks directly to a store using an Admin API
 * access token — the CLI's standalone equivalent of the app's session-based
 * `admin.graphql` wrapper. [design §2]
 */
export function createAdminClient(opts: {
  shop: string;
  accessToken: string;
  apiVersion?: string;
}): AdminGraphQLClient {
  const version = opts.apiVersion ?? DEFAULT_API_VERSION;
  const endpoint = `https://${opts.shop}/admin/api/${version}/graphql.json`;
  return async (query, options) => {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": opts.accessToken },
        body: JSON.stringify({ query, variables: options?.variables }),
      });
    } catch (cause) {
      throw new SyncTransportError(`Request to ${opts.shop} failed`, cause);
    }
    if (!res.ok) {
      throw new SyncTransportError(`Admin API returned HTTP ${res.status}`, await res.text().catch(() => null));
    }
    return res.json() as Promise<{ data?: unknown; errors?: unknown }>;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/node/client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/node/client.ts src/node/client.test.ts
git commit -m "feat: add standalone token-based Admin GraphQL client"
```

---

### Task 5: Codegen — `RemoteDefinition[]` → schema source

The inverse of `toDefinitionInput()`. The headline test is **round-trip fidelity**: source generated from `normalizeLocal(schema)` re-normalizes to an empty `diff`.

**Files:**
- Create: `src/codegen.ts`
- Test: `src/codegen.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `RemoteDefinition`, `RemoteField` (from `./sync/normalize`), `FieldValidation` (from `./fields/base`).
- Produces: `generateSchemaSource(defs: RemoteDefinition[]): string`.

**Reverse map** (Shopify `type` → `m.*`): `single_line_text_field`→`text`, `multi_line_text_field`→`multilineText`, `number_integer`→`integer`, `number_decimal`→`decimal`, `boolean`→`boolean`, `date`→`date`, `date_time`→`dateTime`, `url`→`url`, `color`→`color`, `json`→`json`, `money`→`money`, `dimension`/`weight`/`volume`→same, `rating`→`rating` (needs min/max), `product_reference`→`product`, `variant_reference`→`variant`, `collection_reference`→`collection`, `page_reference`→`page`, `file_reference`→`file`, `metaobject_reference`→`ref`, `list.<X>`→`list`.

- [ ] **Step 1: Write the failing test** (round-trip via the fields the app already exercises)

```ts
// src/codegen.test.ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { defineMetaobject, m } from "./index";
import { normalizeLocal, normalizeRemote } from "./sync/normalize";
import { diff } from "./sync/diff";
import { generateSchemaSource } from "./codegen";
import type { RemoteDefinition } from "./sync/normalize";
import type { AnySchema } from "./index";

const Material = defineMetaobject("material", {
  name: "Material",
  fields: { name: m.text({ required: true, max: 80 }), density: m.weight() },
});
const Product = defineMetaobject("product_spec", {
  name: "Product Spec",
  fields: {
    title: m.text({ required: true, max: 120 }),
    price: m.money(),
    specs: m.list(m.ref(Material)),
    rating: m.rating({ min: 1, max: 5 }),
  },
});

describe("generateSchemaSource", () => {
  it("round-trips: generated source re-normalizes to an empty diff", async () => {
    const local: RemoteDefinition[] = [normalizeLocal(Material), normalizeLocal(Product)];
    const source = generateSchemaSource(local);

    const dir = mkdtempSync(join(tmpdir(), "mm-codegen-"));
    const file = join(dir, "schema.ts");
    // Rewrite the package import to the built source under test.
    writeFileSync(file, source.replace('from "meta-manifest"', `from ${JSON.stringify(join(process.cwd(), "src/index.ts"))}`));

    const jiti = createJiti(import.meta.url);
    const mod = await jiti.import<{ schemas: AnySchema[] }>(file);
    const regenerated = mod.schemas.map(normalizeLocal);

    // Compare each generated definition against its origin — no create/add/remove/change ops.
    const plan = diff(regenerated, local);
    expect(plan).toEqual([]);
  });

  it("emits references in dependency order (Material before Product)", () => {
    const source = generateSchemaSource([normalizeLocal(Material), normalizeLocal(Product)]);
    expect(source.indexOf("const Material")).toBeLessThan(source.indexOf("const ProductSpec"));
    expect(source).toContain("m.list(m.ref(Material))");
    expect(source).toContain('export const schemas = [Material, ProductSpec]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/codegen.test.ts`
Expected: FAIL — cannot find module `./codegen`.

- [ ] **Step 3: Write the implementation**

```ts
// src/codegen.ts
import type { RemoteDefinition, RemoteField } from "./sync/normalize";
import type { FieldValidation } from "./fields/base";

const APP_PREFIX = "$app:";

/** Shopify scalar/reference type → m.* builder name (no special construction). */
const SIMPLE: Record<string, string> = {
  single_line_text_field: "text",
  multi_line_text_field: "multilineText",
  number_integer: "integer",
  number_decimal: "decimal",
  boolean: "boolean",
  date: "date",
  date_time: "dateTime",
  url: "url",
  color: "color",
  json: "json",
  money: "money",
  dimension: "dimension",
  weight: "weight",
  volume: "volume",
  product_reference: "product",
  variant_reference: "variant",
  collection_reference: "collection",
  page_reference: "page",
  file_reference: "file",
};

function handleOf(type: string): string {
  return type.startsWith(APP_PREFIX) ? type.slice(APP_PREFIX.length) : type;
}

function identOf(type: string): string {
  return handleOf(type)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
}

function v(validations: FieldValidation[], name: string): string | undefined {
  return validations.find((x) => x.name === name)?.value;
}

/** Reference target ($app: type) from a metaobject_reference field's validations. */
function refTarget(field: RemoteField): string | undefined {
  const single = v(field.validations, "metaobject_definition_type");
  if (single) return single;
  const many = v(field.validations, "metaobject_definition_types");
  if (many) {
    try {
      const arr = JSON.parse(many);
      if (Array.isArray(arr) && arr.length) return String(arr[0]);
    } catch {
      /* fall through */
    }
  }
  return undefined;
}

/** Build the options-object literal source (e.g. `{ required: true, max: 120 }`), or "". */
function optsLiteral(entries: string[]): string {
  return entries.length ? `{ ${entries.join(", ")} }` : "";
}

/** Number/string/JSON-array validation → option entries for scalar builders. */
function scalarEntries(field: RemoteField, warnings: string[]): string[] {
  const e: string[] = [];
  if (field.required) e.push("required: true");
  const num = (name: string, opt: string) => {
    const val = v(field.validations, name);
    if (val !== undefined) e.push(`${opt}: ${Number(val)}`);
  };
  const str = (name: string, opt: string) => {
    const val = v(field.validations, name);
    if (val !== undefined) e.push(`${opt}: ${JSON.stringify(val)}`);
  };
  const jsonArr = (name: string, opt: string) => {
    const val = v(field.validations, name);
    if (val !== undefined) {
      try {
        e.push(`${opt}: ${JSON.stringify(JSON.parse(val))}`);
      } catch {
        warnings.push(`could not parse "${name}" on field "${field.key}"`);
      }
    }
  };
  num("min", "min");
  num("max", "max");
  str("regex", "regex");
  jsonArr("choices", "choices");
  num("max_precision", "maxPrecision");
  jsonArr("allowed_domains", "allowedDomains");
  jsonArr("file_type_options", "accept");
  return e;
}

function scalarCall(builder: string, field: RemoteField, warnings: string[]): string {
  const lit = optsLiteral(scalarEntries(field, warnings));
  return lit ? `m.${builder}(${lit})` : `m.${builder}()`;
}

/** Build the m.* call source for a single field. */
function fieldCall(field: RemoteField, typeToIdent: Map<string, string>, warnings: string[]): string {
  const type = field.type;

  if (type === "rating") {
    const min = v(field.validations, "min");
    const max = v(field.validations, "max");
    const e = [`min: ${Number(min ?? 1)}`, `max: ${Number(max ?? 5)}`];
    if (field.required) e.unshift("required: true");
    if (min === undefined || max === undefined) warnings.push(`rating field "${field.key}" missing min/max`);
    return `m.rating(${optsLiteral(e)})`;
  }

  if (type === "metaobject_reference") {
    const target = refTarget(field);
    const ident = target ? typeToIdent.get(target) : undefined;
    if (!ident) {
      warnings.push(`unresolved reference on field "${field.key}"`);
      return `m.json() /* TODO: unmapped reference */`;
    }
    return field.required ? `m.ref(${ident}, { required: true })` : `m.ref(${ident})`;
  }

  if (type.startsWith("list.")) {
    const inner = type.slice("list.".length);
    const listEntries: string[] = [];
    if (field.required) listEntries.push("required: true");
    const min = v(field.validations, "list.min");
    const max = v(field.validations, "list.max");
    if (min !== undefined) listEntries.push(`min: ${Number(min)}`);
    if (max !== undefined) listEntries.push(`max: ${Number(max)}`);
    const listOpts = optsLiteral(listEntries);
    let innerCall: string;
    if (inner === "metaobject_reference") {
      const target = refTarget(field);
      const ident = target ? typeToIdent.get(target) : undefined;
      if (!ident) {
        warnings.push(`unresolved list reference on field "${field.key}"`);
        return `m.json() /* TODO: unmapped list reference */`;
      }
      innerCall = `m.ref(${ident})`;
    } else if (SIMPLE[inner]) {
      // Inner scalar validations (min/max/regex/…) live on the same field; reuse scalarEntries
      // but drop list.* names (already consumed above).
      innerCall = scalarCall(SIMPLE[inner], { ...field, required: false }, warnings);
    } else {
      warnings.push(`unmapped list element type "${inner}" on field "${field.key}"`);
      return `m.json() /* TODO: unmapped list element ${inner} */`;
    }
    return listOpts ? `m.list(${innerCall}, ${listOpts})` : `m.list(${innerCall})`;
  }

  if (SIMPLE[type]) return scalarCall(SIMPLE[type], field, warnings);

  warnings.push(`unmapped field type "${type}" on field "${field.key}"`);
  return `m.json() /* TODO: unmapped type ${type} */`;
}

function defSource(def: RemoteDefinition, typeToIdent: Map<string, string>, warnings: string[]): string {
  const ident = typeToIdent.get(def.type)!;
  const handle = handleOf(def.type);
  const fields = def.fields
    .map((f) => `    ${f.key}: ${fieldCall(f, typeToIdent, warnings)},`)
    .join("\n");
  const name = def.name ? `\n  name: ${JSON.stringify(def.name)},` : "";
  return `export const ${ident} = defineMetaobject(${JSON.stringify(handle)}, {${name}
  fields: {
${fields}
  },
});`;
}

/** Edges: def.type → set of $app: types it references (for topological ordering). */
function referencedTypes(def: RemoteDefinition): Set<string> {
  const out = new Set<string>();
  for (const f of def.fields) {
    if (f.type === "metaobject_reference" || f.type === "list.metaobject_reference") {
      const t = refTarget(f);
      if (t) out.add(t);
    }
  }
  return out;
}

/** Kahn topological sort: referenced definitions emitted before referencing ones. */
function orderDefs(defs: RemoteDefinition[]): RemoteDefinition[] {
  const byType = new Map(defs.map((d) => [d.type, d]));
  const deps = new Map(defs.map((d) => [d.type, referencedTypes(d)]));
  const ordered: RemoteDefinition[] = [];
  const placed = new Set<string>();
  let progress = true;
  while (ordered.length < defs.length && progress) {
    progress = false;
    for (const d of defs) {
      if (placed.has(d.type)) continue;
      const unmet = [...(deps.get(d.type) ?? [])].filter((t) => byType.has(t) && !placed.has(t) && t !== d.type);
      if (unmet.length === 0) {
        ordered.push(d);
        placed.add(d.type);
        progress = true;
      }
    }
  }
  // Any remaining (cycles) appended in input order.
  for (const d of defs) if (!placed.has(d.type)) ordered.push(d);
  return ordered;
}

/**
 * Generate `schema.ts` source (using `defineMetaobject`/`m`) from remote definitions.
 * Definitions are emitted in dependency order so `m.ref(...)` points at a declared const.
 * Unmapped types/validations become `// TODO: unmapped …` and are logged via console.warn.
 */
export function generateSchemaSource(defs: RemoteDefinition[]): string {
  const ordered = orderDefs(defs);
  const typeToIdent = new Map(ordered.map((d) => [d.type, identOf(d.type)]));
  const warnings: string[] = [];
  const blocks = ordered.map((d) => defSource(d, typeToIdent, warnings));
  const idents = ordered.map((d) => typeToIdent.get(d.type)!);
  const header = `import { defineMetaobject, m } from "meta-manifest";`;
  const body = blocks.join("\n\n");
  const footer = `export const schemas = [${idents.join(", ")}];`;
  for (const w of warnings) console.warn(`[meta-manifest] codegen: ${w}`);
  return `${header}\n\n${body}\n\n${footer}\n`;
}
```

- [ ] **Step 4: Add the `AnySchema` export to `src/index.ts`** (needed by the test and by the CLI loader)

```ts
import type { MetaobjectSchema } from "./define";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySchema = MetaobjectSchema<any>;
export { generateSchemaSource } from "./codegen";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/codegen.test.ts`
Expected: PASS (2 tests). If the round-trip `diff` is non-empty, print `generateSchemaSource(local)` and the plan to see which field's options differ, and adjust `scalarEntries`/`fieldCall` for that type.

- [ ] **Step 6: Commit**

```bash
git add src/codegen.ts src/codegen.test.ts src/index.ts
git commit -m "feat: add schema codegen (RemoteDefinition -> defineMetaobject source)"
```

---

### Task 6: CLI formatting helpers (lifted from the app)

**Files:**
- Create: `src/cli/format.ts`
- Test: `src/cli/format.test.ts`

**Interfaces:**
- Consumes: `DiffOp`, `PushOpResult` (from `../index`).
- Produces: `opTarget(op: DiffOp): string`, `isDestructive(op: DiffOp): boolean`, `describeOp(op: DiffOp): string`, `describeResult(r: PushOpResult): string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/cli/format.test.ts
import { describe, it, expect } from "vitest";
import { describeOp, describeResult, isDestructive, opTarget } from "./format";
import type { DiffOp } from "../index";

const remove: DiffOp = { kind: "removeField", type: "$app:author", key: "legacy", destructive: true };
const add: DiffOp = { kind: "addField", type: "$app:author", field: { key: "bio", type: "multi_line_text_field", required: false, validations: [] } };

describe("format", () => {
  it("opTarget renders type.field for field ops", () => {
    expect(opTarget(add)).toBe("$app:author.bio");
    expect(opTarget(remove)).toBe("$app:author.legacy");
  });
  it("isDestructive + describeOp mark destructive ops", () => {
    expect(isDestructive(remove)).toBe(true);
    expect(describeOp(remove)).toContain("· destructive");
  });
  it("describeResult formats a failed op with its user errors", () => {
    const line = describeResult({ op: add, status: "failed", userErrors: [{ message: "bad" }] });
    expect(line).toContain("✗ failed (bad)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/cli/format.test.ts`
Expected: FAIL — cannot find module `./format`.

- [ ] **Step 3: Write the implementation** (verbatim from the deleted `app/routes/app.metaobjects.tsx`)

```ts
// src/cli/format.ts
import type { DiffOp, PushOpResult } from "../index";

export function opTarget(op: DiffOp): string {
  if (op.kind === "addField") return `${op.type}.${op.field.key}`;
  if ("key" in op) return `${op.type}.${op.key}`;
  return op.type;
}

export function isDestructive(op: DiffOp): boolean {
  return "destructive" in op && op.destructive === true;
}

export function describeOp(op: DiffOp): string {
  return `${op.kind}: ${opTarget(op)}${isDestructive(op) ? " · destructive" : ""}`;
}

export function describeResult(r: PushOpResult): string {
  const head = `${r.op.kind}: ${opTarget(r.op)}`;
  switch (r.status) {
    case "applied":
      return `✓ applied — ${head}`;
    case "skipped":
      return `– skipped (${r.reason}) — ${head}`;
    case "blocked":
      return `⚠ blocked (${r.reason}) — ${head}`;
    case "failed":
      return `✗ failed (${r.userErrors.map((e) => e.message).join("; ")}) — ${head}`;
  }
}
```

- [ ] **Step 4: Ensure `DiffOp`/`PushOpResult` are exported from `src/index.ts`** (they already are per current exports — confirm the `export type { DiffOp }` and `export type { … PushOpResult … }` lines exist; add if missing).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/cli/format.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/cli/format.ts src/cli/format.test.ts
git commit -m "feat: add CLI formatting helpers (lifted from app route)"
```

---

### Task 7: Config + schema loaders (`jiti`) and `planFor`

**Files:**
- Create: `src/cli/load-config.ts`, `src/cli/plan.ts`
- Test: `src/cli/load-config.test.ts`, `src/cli/plan.test.ts`

**Interfaces:**
- Consumes: `validateConfig`/`Config` (from `../config`), `AnySchema` (from `../index`), `pull`, `diff`, `normalizeLocal`, `normalizeRemote` (from `../index`).
- Produces:
  - `loadConfig(configPath?: string): Promise<Config>` — resolves `meta-manifest.config.ts` (default) relative to cwd, loads its default export via `jiti`, validates it.
  - `loadSchemas(schemaPath: string): Promise<AnySchema[]>` — loads the `schemas` export from the schema module.
  - `planFor(client: AdminGraphQLClient, schemas: AnySchema[]): Promise<{ plan: DiffOp[]; remote: PulledRemote[] }>`.

- [ ] **Step 1: Write the failing test for the loader**

```ts
// src/cli/load-config.test.ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, loadSchemas } from "./load-config";

function tmp(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mm-load-"));
  const file = join(dir, name);
  writeFileSync(file, contents);
  return file;
}

describe("loadConfig / loadSchemas", () => {
  it("loads and validates a config default export", async () => {
    const file = tmp("meta-manifest.config.ts",
      `export default { shop: "s.myshopify.com", accessToken: "t", schema: "./schema.ts" };`);
    const config = await loadConfig(file);
    expect(config.shop).toBe("s.myshopify.com");
  });

  it("throws when a required field is missing", async () => {
    const file = tmp("bad.config.ts", `export default { accessToken: "t", schema: "./s.ts" };`);
    await expect(loadConfig(file)).rejects.toThrow(/shop/);
  });

  it("loads the schemas array from a schema module", async () => {
    const idx = JSON.stringify(join(process.cwd(), "src/index.ts"));
    const file = tmp("schema.ts",
      `import { defineMetaobject, m } from ${idx};
       export const A = defineMetaobject("a", { name: "A", fields: { n: m.text() } });
       export const schemas = [A];`);
    const schemas = await loadSchemas(file);
    expect(schemas.map((s) => s.type)).toEqual(["$app:a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/cli/load-config.test.ts`
Expected: FAIL — cannot find module `./load-config`.

- [ ] **Step 3: Write the loader implementation**

```ts
// src/cli/load-config.ts
import { resolve } from "node:path";
import { createJiti } from "jiti";
import { validateConfig } from "../config";
import type { Config } from "../config";
import type { AnySchema } from "../index";

const jiti = createJiti(import.meta.url);

/** Load and validate meta-manifest.config.ts (default: ./meta-manifest.config.ts). */
export async function loadConfig(configPath = "meta-manifest.config.ts"): Promise<Config> {
  const abs = resolve(process.cwd(), configPath);
  const mod = await jiti.import<{ default?: unknown }>(abs);
  return validateConfig(mod.default);
}

/** Load the `schemas` export from a schema module. */
export async function loadSchemas(schemaPath: string): Promise<AnySchema[]> {
  const abs = resolve(process.cwd(), schemaPath);
  const mod = await jiti.import<{ schemas?: unknown }>(abs);
  if (!Array.isArray(mod.schemas)) {
    throw new Error(`Schema module "${schemaPath}" must export a \`schemas\` array.`);
  }
  return mod.schemas as AnySchema[];
}
```

- [ ] **Step 4: Run loader test to verify it passes**

Run: `pnpm vitest run src/cli/load-config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for `planFor`**

```ts
// src/cli/plan.test.ts
import { describe, it, expect } from "vitest";
import type { AdminGraphQLClient } from "../index";
import { PULL_DEFINITION_QUERY } from "../sync/client";
import { defineMetaobject, m } from "../index";
import { planFor } from "./plan";

const A = defineMetaobject("a", { name: "A", fields: { n: m.text({ required: true }) } });

describe("planFor", () => {
  it("plans a create when the type is absent remotely", async () => {
    const client: AdminGraphQLClient = async (query) => {
      expect(query).toBe(PULL_DEFINITION_QUERY);
      return { data: { metaobjectDefinitionByType: null } };
    };
    const { plan, remote } = await planFor(client, [A]);
    expect(remote).toEqual([]);
    expect(plan.map((op) => op.kind)).toEqual(["createDefinition"]);
  });
});
```

- [ ] **Step 6: Run planFor test to verify it fails**

Run: `pnpm vitest run src/cli/plan.test.ts`
Expected: FAIL — cannot find module `./plan`.

- [ ] **Step 7: Write `planFor`** (lifted/generalized from the app's `planFor`)

```ts
// src/cli/plan.ts
import type { AdminGraphQLClient, DiffOp, PulledRemote } from "../index";
import { diff, normalizeLocal, normalizeRemote, pull } from "../index";
import type { AnySchema } from "../index";

/** Pull the schemas' types, normalize, and diff local↔remote. */
export async function planFor(
  client: AdminGraphQLClient,
  schemas: AnySchema[],
): Promise<{ plan: DiffOp[]; remote: PulledRemote[] }> {
  const types = schemas.map((s) => s.type);
  const localDefs = schemas.map(normalizeLocal);
  const remote = await pull(client, types);
  const plan = diff(localDefs, remote.map((r) => normalizeRemote(r.definition)));
  return { plan, remote };
}
```

- [ ] **Step 8: Confirm `index.ts` exports** `pull`, `diff`, `normalizeLocal`, `normalizeRemote`, `PulledRemote`, `DiffOp`, `AdminGraphQLClient` (all present per current exports; `PULL_DEFINITION_QUERY` is imported from `../sync/client` directly in the test). Run planFor test:

Run: `pnpm vitest run src/cli/plan.test.ts`
Expected: PASS (1 test). Confirms the `AnySchema[]` typing fix — `schemas.map(normalizeLocal)` typechecks. Run `pnpm typecheck` to be sure.

- [ ] **Step 9: Commit**

```bash
git add src/cli/load-config.ts src/cli/load-config.test.ts src/cli/plan.ts src/cli/plan.test.ts
git commit -m "feat: add jiti config/schema loaders and planFor"
```

---

### Task 8: `runInit`

**Files:**
- Create: `src/cli/init.ts`
- Test: `src/cli/init.test.ts`

**Interfaces:**
- Produces: `runInit(opts?: { cwd?: string }): Promise<{ created: string[] }>` — scaffolds `meta-manifest.config.ts` and `src/schema.ts` if absent (never overwrites), returns the created paths.

- [ ] **Step 1: Write the failing test**

```ts
// src/cli/init.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "./init";

describe("runInit", () => {
  it("scaffolds config + schema, and does not overwrite on re-run", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mm-init-"));
    const first = await runInit({ cwd });
    expect(first.created).toContain("meta-manifest.config.ts");
    expect(existsSync(join(cwd, "meta-manifest.config.ts"))).toBe(true);
    expect(readFileSync(join(cwd, "src/schema.ts"), "utf8")).toContain("defineMetaobject");

    const second = await runInit({ cwd });
    expect(second.created).toEqual([]); // nothing overwritten
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/cli/init.test.ts`
Expected: FAIL — cannot find module `./init`.

- [ ] **Step 3: Write the implementation**

```ts
// src/cli/init.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CONFIG_TEMPLATE = `import { defineConfig } from "meta-manifest";

export default defineConfig({
  shop: "my-store.myshopify.com",
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  schema: "./src/schema.ts",
});
`;

const SCHEMA_TEMPLATE = `import { defineMetaobject, m } from "meta-manifest";

export const Author = defineMetaobject("author", {
  name: "Author",
  fields: {
    name: m.text({ required: true, max: 120 }),
    bio: m.multilineText(),
  },
});

export const schemas = [Author];
`;

/** Scaffold config + schema files, never overwriting existing ones. */
export async function runInit(opts: { cwd?: string } = {}): Promise<{ created: string[] }> {
  const cwd = opts.cwd ?? process.cwd();
  const created: string[] = [];
  const write = (rel: string, contents: string) => {
    const abs = join(cwd, rel);
    if (existsSync(abs)) return;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
    created.push(rel);
  };
  write("meta-manifest.config.ts", CONFIG_TEMPLATE);
  write("src/schema.ts", SCHEMA_TEMPLATE);
  if (created.length) {
    console.log(`Created: ${created.join(", ")}`);
    console.log("Next: set SHOPIFY_ADMIN_TOKEN in your env, edit meta-manifest.config.ts, then run `mm diff`.");
  } else {
    console.log("Nothing to do — config and schema already exist.");
  }
  return { created };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/cli/init.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/cli/init.ts src/cli/init.test.ts
git commit -m "feat: add mm init scaffolding"
```

---

### Task 9: `runDiff` and `runPush`

**Files:**
- Create: `src/cli/diff.ts`, `src/cli/push.ts`
- Test: `src/cli/commands.test.ts`

**Interfaces:**
- Consumes: `planFor` (Task 7), `describeOp`/`describeResult`/`isDestructive` (Task 6), `push` (from `../index`), `AnySchema`, `AdminGraphQLClient`.
- Produces:
  - `runDiff(args: { client: AdminGraphQLClient; schemas: AnySchema[] }): Promise<DiffOp[]>` — prints the plan, returns it.
  - `runPush(args: { client: AdminGraphQLClient; schemas: AnySchema[]; allowDestructive?: boolean }): Promise<PushResult>` — plans, pushes, prints results.

Note: both take `schemas` (already loaded) rather than `config` so they stay pure and unit-testable; the bin (Task 11) does the loading.

- [ ] **Step 1: Write the failing test** (create flow end-to-end against a fake store)

```ts
// src/cli/commands.test.ts
import { describe, it, expect } from "vitest";
import type { AdminGraphQLClient } from "../index";
import { CREATE_DEFINITION_MUTATION, PULL_DEFINITION_QUERY } from "../sync/client";
import { defineMetaobject, m } from "../index";
import { runDiff } from "./diff";
import { runPush } from "./push";

const A = defineMetaobject("a", { name: "A", fields: { n: m.text({ required: true }) } });

function fakeStore(): AdminGraphQLClient {
  let counter = 0;
  return async (query, options) => {
    if (query === PULL_DEFINITION_QUERY) return { data: { metaobjectDefinitionByType: null } };
    if (query === CREATE_DEFINITION_MUTATION) {
      const def = options?.variables?.definition as { type: string };
      counter += 1;
      return { data: { metaobjectDefinitionCreate: {
        metaobjectDefinition: { id: `gid://shopify/MetaobjectDefinition/${counter}`, type: def.type },
        userErrors: [] } } };
    }
    return { data: {} };
  };
}

describe("runDiff / runPush", () => {
  it("runDiff returns the create plan", async () => {
    const plan = await runDiff({ client: fakeStore(), schemas: [A] });
    expect(plan.map((op) => op.kind)).toEqual(["createDefinition"]);
  });
  it("runPush applies the plan and reports ok", async () => {
    const result = await runPush({ client: fakeStore(), schemas: [A] });
    expect(result.ok).toBe(true);
    expect(result.counts.applied).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/cli/commands.test.ts`
Expected: FAIL — cannot find module `./diff`.

- [ ] **Step 3: Write `runDiff`**

```ts
// src/cli/diff.ts
import type { AdminGraphQLClient, DiffOp } from "../index";
import type { AnySchema } from "../index";
import { planFor } from "./plan";
import { describeOp } from "./format";

export async function runDiff(args: { client: AdminGraphQLClient; schemas: AnySchema[] }): Promise<DiffOp[]> {
  const { plan } = await planFor(args.client, args.schemas);
  if (plan.length === 0) {
    console.log("Everything is in sync — nothing to apply.");
  } else {
    console.log(`${plan.length} change${plan.length === 1 ? "" : "s"} would be applied:`);
    for (const op of plan) console.log(`  ${describeOp(op)}`);
  }
  return plan;
}
```

- [ ] **Step 4: Write `runPush`**

```ts
// src/cli/push.ts
import type { AdminGraphQLClient, PushResult } from "../index";
import type { AnySchema } from "../index";
import { push } from "../index";
import { planFor } from "./plan";
import { describeResult, isDestructive } from "./format";

export async function runPush(args: {
  client: AdminGraphQLClient;
  schemas: AnySchema[];
  allowDestructive?: boolean;
}): Promise<PushResult> {
  const { plan, remote } = await planFor(args.client, args.schemas);
  const definitions = args.schemas.map((s) => s.toDefinitionInput());
  const result = await push(args.client, plan, { definitions, remote }, { allowDestructive: args.allowDestructive });

  for (const r of result.results) console.log(`  ${describeResult(r)}`);
  console.log(
    `applied ${result.counts.applied} · skipped ${result.counts.skipped} · ` +
      `blocked ${result.counts.blocked} · failed ${result.counts.failed}`,
  );
  if (!args.allowDestructive && plan.some(isDestructive)) {
    console.log("Some destructive changes were skipped. Re-run with --allow-destructive to apply them.");
  }
  return result;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/cli/commands.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/cli/diff.ts src/cli/push.ts src/cli/commands.test.ts
git commit -m "feat: add runDiff and runPush commands"
```

---

### Task 10: `runPull` (codegen to disk)

**Files:**
- Create: `src/cli/pull.ts`
- Test: `src/cli/pull-cmd.test.ts`

**Interfaces:**
- Consumes: `pullAll` (Task 3), `generateSchemaSource` (Task 5), `normalizeRemote` (from `../index`).
- Produces: `runPull(args: { client: AdminGraphQLClient; schemaPath: string; force?: boolean }): Promise<{ written: string; count: number }>` — enumerates app-owned defs, generates source, writes `schemaPath` (warns if it exists and `force` is not set, but still writes), returns the path + definition count.

- [ ] **Step 1: Write the failing test**

```ts
// src/cli/pull-cmd.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AdminGraphQLClient } from "../index";
import { LIST_DEFINITIONS_QUERY } from "../sync/client";
import { runPull } from "./pull";

function fakeStore(): AdminGraphQLClient {
  return async (query) => {
    expect(query).toBe(LIST_DEFINITIONS_QUERY);
    return { data: { metaobjectDefinitions: {
      nodes: [{ id: "gid://shopify/MetaobjectDefinition/1", name: "Author", type: "app--111--author",
        fieldDefinitions: [{ key: "name", type: { name: "single_line_text_field" }, required: true, validations: [] }] }],
      pageInfo: { hasNextPage: false, endCursor: null } } } };
  };
}

describe("runPull", () => {
  it("writes generated schema source containing the pulled definition", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-pull-"));
    const out = join(dir, "schema.ts");
    const res = await runPull({ client: fakeStore(), schemaPath: out });
    expect(res.count).toBe(1);
    const src = readFileSync(out, "utf8");
    expect(src).toContain('defineMetaobject("author"');
    expect(src).toContain("m.text(");
    expect(src).toContain("export const schemas = [Author]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/cli/pull-cmd.test.ts`
Expected: FAIL — cannot find module `./pull`.

- [ ] **Step 3: Write the implementation** (with optional prettier)

```ts
// src/cli/pull.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AdminGraphQLClient } from "../index";
import { generateSchemaSource, normalizeRemote, pullAll } from "../index";

/** Format source with the user's local prettier if available; otherwise return as-is. */
async function maybeFormat(source: string): Promise<string> {
  try {
    const prettier: any = await import("prettier");
    return await prettier.format(source, { parser: "typescript" });
  } catch {
    return source;
  }
}

export async function runPull(args: {
  client: AdminGraphQLClient;
  schemaPath: string;
  force?: boolean;
}): Promise<{ written: string; count: number }> {
  const remote = await pullAll(args.client); // app-owned only
  const defs = remote.map((r) => normalizeRemote(r.definition));
  const source = await maybeFormat(generateSchemaSource(defs));

  const abs = resolve(process.cwd(), args.schemaPath);
  if (existsSync(abs) && !args.force) {
    console.warn(`Overwriting existing ${args.schemaPath}.`);
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, source);
  console.log(`Wrote ${defs.length} definition${defs.length === 1 ? "" : "s"} to ${args.schemaPath}.`);
  return { written: abs, count: defs.length };
}
```

- [ ] **Step 4: Export `normalizeRemote` from `src/index.ts`** — confirm present (current exports include `normalizeLocal, normalizeRemote`). Run:

Run: `pnpm vitest run src/cli/pull-cmd.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/cli/pull.ts src/cli/pull-cmd.test.ts
git commit -m "feat: add mm pull (codegen to disk)"
```

---

### Task 11: CLI entrypoint (argv routing + exit codes)

**Files:**
- Create: `src/cli/index.ts`
- Test: `src/cli/args.test.ts`

**Interfaces:**
- Consumes: `runInit`/`runDiff`/`runPush`/`runPull`, `loadConfig`/`loadSchemas`, `createAdminClient` (from `../node/client`), `SyncTransportError`.
- Produces: `parseArgs(argv: string[]): { command?: string; config?: string; allowDestructive: boolean; force: boolean; help: boolean }` (exported for testing) and a `main(argv)` that dispatches and sets exit codes.

- [ ] **Step 1: Write the failing test** (parser is the unit worth testing; command wiring is covered by Tasks 8–10)

```ts
// src/cli/args.test.ts
import { describe, it, expect } from "vitest";
import { parseArgs } from "./index";

describe("parseArgs", () => {
  it("parses command and flags", () => {
    expect(parseArgs(["push", "--allow-destructive"])).toMatchObject({ command: "push", allowDestructive: true });
    expect(parseArgs(["pull", "--force"])).toMatchObject({ command: "pull", force: true });
    expect(parseArgs(["diff", "--config", "custom.ts"])).toMatchObject({ command: "diff", config: "custom.ts" });
    expect(parseArgs(["--help"])).toMatchObject({ help: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/cli/args.test.ts`
Expected: FAIL — cannot find module `./index` (or `parseArgs` not exported).

- [ ] **Step 3: Write the entrypoint**

```ts
// src/cli/index.ts
import { SyncTransportError } from "../sync/client";
import { createAdminClient } from "../node/client";
import { loadConfig, loadSchemas } from "./load-config";
import { runInit } from "./init";
import { runDiff } from "./diff";
import { runPush } from "./push";
import { runPull } from "./pull";

export interface Args {
  command?: string;
  config?: string;
  allowDestructive: boolean;
  force: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { allowDestructive: false, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--allow-destructive") args.allowDestructive = true;
    else if (a === "--force") args.force = true;
    else if (a === "--config") args.config = argv[++i];
    else if (!a.startsWith("-") && !args.command) args.command = a;
  }
  return args;
}

const HELP = `meta-manifest — sync Shopify metaobject definitions

Usage: mm <command> [options]

Commands:
  init                 Scaffold meta-manifest.config.ts + src/schema.ts
  pull                 Enumerate remote definitions and write schema source
  diff                 Show the changes a push would apply
  push                 Apply local schema to the store

Options:
  --config <path>      Config file (default: meta-manifest.config.ts)
  --allow-destructive  Apply destructive changes on push
  --force              Overwrite schema on pull without warning
  -h, --help           Show this help`;

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help || !args.command) {
    console.log(HELP);
    return args.command ? 0 : args.help ? 0 : 1;
  }
  try {
    if (args.command === "init") {
      await runInit();
      return 0;
    }
    const config = await loadConfig(args.config);
    const client = createAdminClient(config);
    if (args.command === "pull") {
      await runPull({ client, schemaPath: config.schema, force: args.force });
      return 0;
    }
    const schemas = await loadSchemas(config.schema);
    if (args.command === "diff") {
      await runDiff({ client, schemas });
      return 0;
    }
    if (args.command === "push") {
      const result = await runPush({ client, schemas, allowDestructive: args.allowDestructive });
      return result.counts.failed > 0 ? 2 : 0;
    }
    console.error(`Unknown command: ${args.command}`);
    console.log(HELP);
    return 1;
  } catch (err) {
    if (err instanceof SyncTransportError) console.error(`Sync failed: Shopify rejected a request.`);
    else console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

// Invoked as the bin. Guarded so importing this module in tests (which read
// `parseArgs`) does not trigger process.exit — vitest sets process.env.VITEST.
if (process.env.VITEST === undefined) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/cli/args.test.ts`
Expected: PASS (1 test). The `VITEST` guard keeps the import side-effect from exiting the worker.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/args.test.ts
git commit -m "feat: add CLI entrypoint (argv routing + exit codes)"
```

---

### Task 12: Build + packaging (tsup, exports, bin) and full verification

**Files:**
- Create: `tsup.config.ts`
- Modify: `package.json`

**Interfaces:** none (packaging).

- [ ] **Step 1: Add `tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "node/client": "src/node/client.ts",
    "cli/index": "src/cli/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  banner: { js: "" },
});
```

- [ ] **Step 2: Add build/exports/bin to `package.json`** (merge into Task 1's file)

```json
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./node": { "types": "./dist/node/client.d.ts", "import": "./dist/node/client.js", "require": "./dist/node/client.cjs" }
  },
  "bin": { "meta-manifest": "./dist/cli/index.js", "mm": "./dist/cli/index.js" },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "pnpm build"
  }
}
```

- [ ] **Step 3: Add a shebang to the built bin.** tsup does not add one automatically; set the cli banner in `tsup.config.ts` to inject it only for the cli entry by using a per-entry `esbuildOptions` is not supported, so instead prepend the shebang in `src/cli/index.ts` as the very first line:

```ts
#!/usr/bin/env node
```

(TypeScript tolerates a leading shebang. Re-run `pnpm test` to confirm nothing broke.)

- [ ] **Step 4: Build and verify outputs**

Run: `pnpm build`
Expected: `dist/index.{js,cjs,d.ts}`, `dist/node/client.{js,cjs,d.ts}`, `dist/cli/index.{js,cjs,d.ts}` are emitted with no errors.

- [ ] **Step 5: Smoke-test the built CLI**

Run: `node dist/cli/index.js --help`
Expected: prints the usage text, exit 0.

Run: `cd "$(mktemp -d)" && node "$OLDPWD/dist/cli/index.js" init && ls`
Expected: `meta-manifest.config.ts` and `src/schema.ts` created; then `cd "$OLDPWD"`.

- [ ] **Step 6: Verify the publish surface**

Run: `npm pack --dry-run`
Expected: tarball lists only `dist/**`, `package.json`, and `README.md`; both `meta-manifest` and `mm` bins present under `bin`.

- [ ] **Step 7: Full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all tests green (including the codegen round-trip), no type errors.

- [ ] **Step 8: Commit**

```bash
git add tsup.config.ts package.json src/cli/index.ts
git commit -m "build: add tsup build, exports, and bin"
```

---

### Task 13: Docs — README + CHANGELOG

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Rewrite `README.md`** to cover: install (`npm i -D meta-manifest`), library usage (`defineMetaobject`, `m`, `Infer`, `parse`/`encode` — carry over the existing `packages/core/README.md` examples), CLI usage (`mm init` / `pull` / `diff` / `push`), the `meta-manifest.config.ts` shape and `SHOPIFY_ADMIN_TOKEN` env var, and a "Roadmap: runtime query client" note. Use the config + command snippets from the spec verbatim.

- [ ] **Step 2: Update `CHANGELOG.md`** — add a `## 0.1.0` entry: "Pivot to standalone npm package + `mm` CLI (init/pull/diff/push); library unchanged."

- [ ] **Step 3: Final full verification**

Run: `pnpm test && pnpm typecheck && pnpm build && npm pack --dry-run`
Expected: all green; tarball surface correct.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: rewrite README + changelog for the CLI/library package"
```

---

## Verification (end-to-end)

1. `pnpm test` — all green; the **codegen round-trip** test (`src/codegen.test.ts`) is the key correctness gate.
2. `pnpm typecheck` — clean; confirms the `AnySchema` fix lets `schemas.map(normalizeLocal)` compile.
3. `pnpm build` + `npm pack --dry-run` — `dist/` emitted with `.d.ts`; tarball contains only `dist` + `README` + `package.json`; both bins present.
4. Built-CLI smoke: `node dist/cli/index.js init` scaffolds; `--help` works.
5. **Live store (manual, requires a dev store + token):** set `SHOPIFY_ADMIN_TOKEN`, point `meta-manifest.config.ts` at the store, then:
   - `mm push` to create the starter definition, `mm diff` → "in sync".
   - `mm pull` into a fresh file → `mm diff` reports **no changes** (round-trip proof on real data).
   - **Reference-validation check:** if a store with `m.ref`/`m.list(m.ref(...))` fields yields a non-empty `mm diff` right after `mm pull`/`mm push`, Shopify is returning reference validations as `metaobject_definition_id` (GID) rather than `metaobject_definition_type`. Fix: in `pullAll`, build an `id → canonicalType` map across all enumerated nodes and rewrite `metaobject_definition_id` validations to `metaobject_definition_type` before returning. (Deferred from v1 unless observed — the app's existing sync suggests the type form is returned.)

## Open follow-ups (not in this plan)
- Runtime query client for metaobject **entries** (tento parity) — roadmapped.
- Codegen of `access`/`capabilities` (not compared by `diff`, so cosmetic; emit `// TODO` when non-default).
- Publishing to npm (`npm publish --access public`) — left to the user.
