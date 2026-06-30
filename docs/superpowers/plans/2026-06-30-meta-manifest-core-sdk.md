# meta-manifest Core SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@meta-manifest/core`, a zero-dependency TypeScript SDK that declares Shopify metaobject definitions with a zod-style builder, validates field values, and maps schemas to/from the Shopify Admin API definition shape — fully unit-tested, no network.

**Architecture:** A `Field` base class defines a uniform codec contract (`validations()`, `toJson`/`fromJson`, `check`, `encode`, `decode`, plus a Standard Schema interface). One small module per field type implements it. `defineMetaobject()` composes a field map into a schema exposing `.type`, `.parse()`, `.encode()`, `.toDefinitionInput()`, and `~standard`. A pure `diff()` compares local schemas against pulled remote definitions to produce a push plan.

**Tech Stack:** TypeScript 5.9 (ESM, `moduleResolution: "Bundler"`), Vitest for tests (native TS, built-in `expectTypeOf`), pnpm workspaces. No runtime dependencies.

## Global Constraints

- **Zero runtime dependencies** in `@meta-manifest/core`. Dev-only: `vitest`, `typescript`. (Verbatim from spec §2.)
- **Standard Schema v1**: every field and the schema object expose a `["~standard"]` property `{ version: 1, vendor: "meta-manifest", validate }`. (Spec §2, §9.)
- **App-owned types**: `defineMetaobject("author", …)` resolves `.type` to `"$app:author"`. The `$app:` prefix is applied centrally so merchant-owned can be added later. (Spec §3.)
- **Runtime-GraphQL lane only**: this SDK never emits TOML; it targets `metaobjectDefinitionCreate`/`Update` shapes. (Spec §3 ground truth.)
- **Shopify values are strings**: `encode()` always returns a string; scalars as bare strings, complex/list types as JSON strings. Reading uses `jsonValue` (parsed). (Spec §3, §7.)
- **Field key**: 2–64 chars; **definition type**: 3–255 chars. (Spec §3.)
- **References pinned by type**: `metaobject_reference` emits a `metaobject_definition_type` validation, not a GID. (Spec §3, §10.)
- Package name: `@meta-manifest/core`. Node engine matches root (`>=20.19 <22 || >=22.12`).
- Conventional-commit messages. End every commit message with a second `-m` line: `Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv`.

## Prerequisites (execution-time, not a task)

The repo currently has **zero commits** and the Shopify template is untracked. Before running Task 1, ensure there is an initial commit and a feature branch (handled via `superpowers:using-git-worktrees`). All task commits land on that branch.

## File structure

```
packages/core/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    standard-schema.ts        # vendored Standard Schema v1 types
    fields/
      base.ts                 # Field abstract class + shared types
      text.ts                 # text, multilineText
      number.ts               # integer, decimal
      boolean.ts              # boolean
      scalar.ts               # date, dateTime, url, color, json
      money.ts                # money
      measurement.ts          # dimension, weight, volume
      rating.ts               # rating
      reference.ts            # product, variant, collection, page, file, ref
      list.ts                 # list
      index.ts                # the `m` namespace
    infer.ts                  # Infer / InferInput / required-key helpers
    define.ts                 # defineMetaobject + MetaobjectSchema
    definition-input.ts       # schema -> MetaobjectDefinitionCreateInput
    sync/
      normalize.ts            # RemoteDefinition shape + normalizers
      diff.ts                 # pure diff -> push plan
    index.ts                  # public barrel
  test/                       # co-located *.test.ts may also live next to source
  README.md
pnpm-workspace.yaml           # add packages/*
```

---

### Task 1: Scaffold the `@meta-manifest/core` package

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/smoke.test.ts`

**Interfaces:**
- Produces: a runnable test command `pnpm --filter @meta-manifest/core test` and `pnpm --filter @meta-manifest/core typecheck`.

- [ ] **Step 1: Add `packages/*` to the workspace**

`pnpm-workspace.yaml` currently lists only `extensions/*`. Add `packages/*`:

```yaml
packages:
  - "extensions/*"
  - "packages/*"
```

- [ ] **Step 2: Create `packages/core/package.json`**

```json
{
  "name": "@meta-manifest/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "engines": {
    "node": ">=20.19 <22 || >=22.12"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create `packages/core/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "declaration": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    typecheck: { enabled: false },
  },
});
```

- [ ] **Step 5: Create `packages/core/src/index.ts` (placeholder barrel)**

```ts
export const version = "0.0.0";
```

- [ ] **Step 6: Write the smoke test `packages/core/src/smoke.test.ts`**

```ts
import { expect, test } from "vitest";
import { version } from "./index";

test("package is importable", () => {
  expect(version).toBe("0.0.0");
});
```

- [ ] **Step 7: Install and run**

Run: `pnpm install`
Then: `pnpm --filter @meta-manifest/core test`
Expected: 1 passed.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml packages/core
git commit -m "chore(core): scaffold @meta-manifest/core package" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

### Task 2: Standard Schema types + `Field` base class

**Files:**
- Create: `packages/core/src/standard-schema.ts`
- Create: `packages/core/src/fields/base.ts`
- Test: `packages/core/src/fields/base.test.ts`

**Interfaces:**
- Produces:
  - `StandardSchemaV1` interface + namespace (`Props`, `Result`, `Issue`, `InferInput`, `InferOutput`).
  - `type FieldValidation = { name: string; value: string }`
  - `type Issue = { message: string; path?: PropertyKey[] }`
  - `type DecodeResult<T> = { value: T; issues?: undefined } | { value?: undefined; issues: Issue[] }`
  - `abstract class Field<TOut, TIn = TOut, Req extends boolean = false>` with public `shopifyType`, `required`, `name`, `description`, `validations()`, `decode(wire)`, `encode(value)`, `["~standard"]`; protected `wireIsJson`, `toJson`, `fromJson`, `check`; phantom `_out`/`_in`/`_req`.
- Consumed by: every codec task and `define.ts`.

- [ ] **Step 1: Write `packages/core/src/standard-schema.ts`**

```ts
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output>;
  }
  export type Result<Output> = SuccessResult<Output> | FailureResult;
  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }
  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }
  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment>;
  }
  export interface PathSegment {
    readonly key: PropertyKey;
  }
  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
  export type InferInput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["input"];
  export type InferOutput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["output"];
}
```

- [ ] **Step 2: Write the failing test `packages/core/src/fields/base.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { Field, type DecodeResult, type FieldValidation, type Issue } from "./base";

// Minimal concrete field for testing the base contract.
class UpperField extends Field<string> {
  readonly shopifyType = "single_line_text_field";
  validations(): FieldValidation[] {
    return [];
  }
  protected toJson(value: string): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<string> {
    if (typeof json !== "string") return { issues: [{ message: "not a string" }] };
    return { value: json };
  }
  protected override check(value: string): Issue[] {
    return value === value.toUpperCase() ? [] : [{ message: "must be uppercase" }];
  }
}

describe("Field base", () => {
  it("decodes valid wire to a typed value", () => {
    expect(new UpperField().decode("HELLO")).toEqual({ value: "HELLO" });
  });

  it("surfaces check() issues on decode", () => {
    expect(new UpperField().decode("hello")).toEqual({ issues: [{ message: "must be uppercase" }] });
  });

  it("encodes a scalar to a bare string", () => {
    expect(new UpperField().encode("HELLO")).toBe("HELLO");
  });

  it("exposes a Standard Schema interface", () => {
    const std = new UpperField()["~standard"];
    expect(std.version).toBe(1);
    expect(std.vendor).toBe("meta-manifest");
    expect(std.validate("HELLO")).toEqual({ value: "HELLO" });
    expect(std.validate("hello")).toEqual({ issues: [{ message: "must be uppercase" }] });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @meta-manifest/core test base`
Expected: FAIL — `./base` has no export `Field`.

- [ ] **Step 4: Write `packages/core/src/fields/base.ts`**

```ts
import type { StandardSchemaV1 } from "../standard-schema";

export type FieldValidation = { name: string; value: string };
export type Issue = { message: string; path?: PropertyKey[] };
export type DecodeResult<T> =
  | { value: T; issues?: undefined }
  | { value?: undefined; issues: Issue[] };

export abstract class Field<TOut, TIn = TOut, Req extends boolean = false> {
  abstract readonly shopifyType: string;
  /** True when Shopify stores this type as a JSON string (objects, lists). */
  protected readonly wireIsJson: boolean = false;
  required = false;
  name?: string;
  description?: string;

  // Phantom type carriers (no runtime value).
  declare readonly _out: TOut;
  declare readonly _in: TIn;
  declare readonly _req: Req;

  /** Shopify definition validations, e.g. [{ name: "max", value: "120" }]. */
  abstract validations(): FieldValidation[];

  /** Typed value -> JSON representation (number/string/object). */
  protected abstract toJson(value: TIn): unknown;

  /** JSON representation -> typed value (no constraint checking). */
  protected abstract fromJson(json: unknown): DecodeResult<TOut>;

  /** Constraint validation on an already-typed value. */
  protected check(_value: TOut): Issue[] {
    return [];
  }

  /** Shopify wire (string or jsonValue) -> typed value (no constraint checking). */
  coerce(wire: unknown): DecodeResult<TOut> {
    let json = wire;
    if (this.wireIsJson && typeof wire === "string") {
      try {
        json = JSON.parse(wire);
      } catch {
        return { issues: [{ message: "Invalid JSON in field value" }] };
      }
    }
    return this.fromJson(json);
  }

  /** Shopify wire -> typed value, validated. */
  decode(wire: unknown): DecodeResult<TOut> {
    const coerced = this.coerce(wire);
    if (coerced.issues) return coerced;
    const issues = this.check(coerced.value);
    return issues.length ? { issues } : { value: coerced.value };
  }

  /** Typed value -> Shopify wire string. */
  encode(value: TIn): string {
    const json = this.toJson(value);
    return this.wireIsJson ? JSON.stringify(json) : String(json);
  }

  get ["~standard"](): StandardSchemaV1.Props<TIn, TOut> {
    return {
      version: 1,
      vendor: "meta-manifest",
      validate: (value: unknown) => {
        const issues = this.check(value as TOut);
        return issues.length ? { issues } : { value: value as TOut };
      },
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @meta-manifest/core test base`
Expected: PASS (4 tests). Then `pnpm --filter @meta-manifest/core typecheck` → no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/standard-schema.ts packages/core/src/fields/base.ts packages/core/src/fields/base.test.ts
git commit -m "feat(core): add Standard Schema types and Field base class" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

### Task 3: Text codecs (`text`, `multilineText`)

**Files:**
- Create: `packages/core/src/fields/text.ts`
- Test: `packages/core/src/fields/text.test.ts`

**Interfaces:**
- Consumes: `Field`, `FieldValidation`, `Issue`, `DecodeResult` from `./base`.
- Produces:
  - `text<R extends boolean = false>(opts?: TextOptions<R>): TextField<R>` — `shopifyType "single_line_text_field"`, supports `min`/`max`/`regex`/`choices`.
  - `multilineText<R extends boolean = false>(opts?: MultilineOptions<R>): TextField<R>` — `shopifyType "multi_line_text_field"`, supports `min`/`max`/`regex`.
  - Both produce `Field<string, string, R>`.

- [ ] **Step 1: Write the failing test `packages/core/src/fields/text.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { multilineText, text } from "./text";

describe("text", () => {
  it("emits length and choices validations", () => {
    const f = text({ max: 120, choices: ["a", "b"] });
    expect(f.shopifyType).toBe("single_line_text_field");
    expect(f.validations()).toEqual([
      { name: "max", value: "120" },
      { name: "choices", value: '["a","b"]' },
    ]);
  });

  it("round-trips a string value", () => {
    const f = text();
    expect(f.encode("hi")).toBe("hi");
    expect(f.decode("hi")).toEqual({ value: "hi" });
  });

  it("rejects values failing max length", () => {
    expect(text({ max: 2 }).decode("hello").issues?.[0]?.message).toMatch(/at most 2/);
  });

  it("rejects values outside choices", () => {
    expect(text({ choices: ["a"] }).decode("b").issues?.[0]?.message).toMatch(/one of/);
  });

  it("multilineText uses the multi-line type", () => {
    expect(multilineText().shopifyType).toBe("multi_line_text_field");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meta-manifest/core test text`
Expected: FAIL — no export `text`.

- [ ] **Step 3: Write `packages/core/src/fields/text.ts`**

```ts
import { Field, type DecodeResult, type FieldValidation, type Issue } from "./base";

export interface TextOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
  min?: number;
  max?: number;
  regex?: string;
  choices?: readonly string[];
}
export type MultilineOptions<R extends boolean = false> = Omit<TextOptions<R>, "choices">;

class TextField<R extends boolean> extends Field<string, string, R> {
  readonly shopifyType: string;
  constructor(private readonly opts: TextOptions<R>, multiline: boolean) {
    super();
    this.shopifyType = multiline ? "multi_line_text_field" : "single_line_text_field";
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
  }
  validations(): FieldValidation[] {
    const v: FieldValidation[] = [];
    if (this.opts.min != null) v.push({ name: "min", value: String(this.opts.min) });
    if (this.opts.max != null) v.push({ name: "max", value: String(this.opts.max) });
    if (this.opts.regex != null) v.push({ name: "regex", value: this.opts.regex });
    if (this.opts.choices != null) v.push({ name: "choices", value: JSON.stringify(this.opts.choices) });
    return v;
  }
  protected toJson(value: string): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<string> {
    if (typeof json !== "string") return { issues: [{ message: `Expected string, got ${typeof json}` }] };
    return { value: json };
  }
  protected override check(value: string): Issue[] {
    const i: Issue[] = [];
    const { min, max, regex, choices } = this.opts;
    if (min != null && value.length < min) i.push({ message: `Must be at least ${min} characters` });
    if (max != null && value.length > max) i.push({ message: `Must be at most ${max} characters` });
    if (regex != null && !new RegExp(regex).test(value)) i.push({ message: `Must match ${regex}` });
    if (choices != null && !choices.includes(value)) i.push({ message: `Must be one of: ${choices.join(", ")}` });
    return i;
  }
}

export function text<R extends boolean = false>(opts: TextOptions<R> = {}): TextField<R> {
  return new TextField<R>(opts, false);
}
export function multilineText<R extends boolean = false>(opts: MultilineOptions<R> = {}): TextField<R> {
  return new TextField<R>(opts, true);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meta-manifest/core test text`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fields/text.ts packages/core/src/fields/text.test.ts
git commit -m "feat(core): add text and multilineText codecs" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

### Task 4: Number + boolean codecs (`integer`, `decimal`, `boolean`)

**Files:**
- Create: `packages/core/src/fields/number.ts`
- Create: `packages/core/src/fields/boolean.ts`
- Test: `packages/core/src/fields/number.test.ts`

**Interfaces:**
- Consumes: `Field` from `./base`.
- Produces:
  - `integer<R>(opts?): Field<number, number, R>` — `shopifyType "number_integer"`, `min`/`max`.
  - `decimal<R>(opts?): Field<number, number, R>` — `shopifyType "number_decimal"`, `min`/`max`/`maxPrecision`.
  - `boolean<R>(opts?): Field<boolean, boolean, R>` — `shopifyType "boolean"`.
  - All `wireIsJson = false` (Shopify stores `"42"`/`"true"` as bare strings; `jsonValue` returns `42`/`true`).

- [ ] **Step 1: Write the failing test `packages/core/src/fields/number.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { boolean } from "./boolean";
import { decimal, integer } from "./number";

describe("integer", () => {
  it("coerces a numeric string or number and encodes to a bare string", () => {
    expect(integer().decode("42")).toEqual({ value: 42 });
    expect(integer().decode(42)).toEqual({ value: 42 });
    expect(integer().encode(42)).toBe("42");
  });
  it("rejects non-integers and out-of-range values", () => {
    expect(integer().decode(1.5).issues?.[0]?.message).toMatch(/integer/);
    expect(integer({ max: 10 }).decode(11).issues?.[0]?.message).toMatch(/at most 10/);
  });
  it("emits min/max validations", () => {
    expect(integer({ min: 0, max: 5 }).validations()).toEqual([
      { name: "min", value: "0" },
      { name: "max", value: "5" },
    ]);
  });
});

describe("decimal", () => {
  it("round-trips and emits max_precision", () => {
    expect(decimal().decode("1.5")).toEqual({ value: 1.5 });
    expect(decimal({ maxPrecision: 2 }).validations()).toContainEqual({ name: "max_precision", value: "2" });
  });
});

describe("boolean", () => {
  it("coerces booleans and 'true'/'false' strings", () => {
    expect(boolean().decode(true)).toEqual({ value: true });
    expect(boolean().decode("false")).toEqual({ value: false });
    expect(boolean().encode(true)).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meta-manifest/core test number`
Expected: FAIL — no export `integer`.

- [ ] **Step 3: Write `packages/core/src/fields/number.ts`**

```ts
import { Field, type DecodeResult, type FieldValidation, type Issue } from "./base";

export interface NumberOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
  min?: number;
  max?: number;
}
export interface DecimalOptions<R extends boolean = false> extends NumberOptions<R> {
  maxPrecision?: number;
}

abstract class NumericField<R extends boolean> extends Field<number, number, R> {
  constructor(protected readonly opts: NumberOptions<R>) {
    super();
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
  }
  protected toJson(value: number): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<number> {
    const n = typeof json === "string" ? Number(json) : json;
    if (typeof n !== "number" || Number.isNaN(n)) return { issues: [{ message: `Expected a number, got ${json}` }] };
    return { value: n };
  }
  protected rangeIssues(value: number): Issue[] {
    const i: Issue[] = [];
    if (this.opts.min != null && value < this.opts.min) i.push({ message: `Must be at least ${this.opts.min}` });
    if (this.opts.max != null && value > this.opts.max) i.push({ message: `Must be at most ${this.opts.max}` });
    return i;
  }
  protected baseValidations(): FieldValidation[] {
    const v: FieldValidation[] = [];
    if (this.opts.min != null) v.push({ name: "min", value: String(this.opts.min) });
    if (this.opts.max != null) v.push({ name: "max", value: String(this.opts.max) });
    return v;
  }
}

class IntegerField<R extends boolean> extends NumericField<R> {
  readonly shopifyType = "number_integer";
  validations(): FieldValidation[] {
    return this.baseValidations();
  }
  protected override check(value: number): Issue[] {
    const i = this.rangeIssues(value);
    if (!Number.isInteger(value)) i.unshift({ message: "Must be an integer" });
    return i;
  }
}

class DecimalField<R extends boolean> extends NumericField<R> {
  readonly shopifyType = "number_decimal";
  constructor(private readonly decimalOpts: DecimalOptions<R>) {
    super(decimalOpts);
  }
  validations(): FieldValidation[] {
    const v = this.baseValidations();
    if (this.decimalOpts.maxPrecision != null) {
      v.push({ name: "max_precision", value: String(this.decimalOpts.maxPrecision) });
    }
    return v;
  }
  protected override check(value: number): Issue[] {
    return this.rangeIssues(value);
  }
}

export function integer<R extends boolean = false>(opts: NumberOptions<R> = {}): IntegerField<R> {
  return new IntegerField<R>(opts);
}
export function decimal<R extends boolean = false>(opts: DecimalOptions<R> = {}): DecimalField<R> {
  return new DecimalField<R>(opts);
}
```

- [ ] **Step 4: Write `packages/core/src/fields/boolean.ts`**

```ts
import { Field, type DecodeResult, type FieldValidation } from "./base";

export interface BooleanOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
}

class BooleanField<R extends boolean> extends Field<boolean, boolean, R> {
  readonly shopifyType = "boolean";
  constructor(opts: BooleanOptions<R>) {
    super();
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
  }
  validations(): FieldValidation[] {
    return [];
  }
  protected toJson(value: boolean): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<boolean> {
    if (typeof json === "boolean") return { value: json };
    if (json === "true") return { value: true };
    if (json === "false") return { value: false };
    return { issues: [{ message: `Expected a boolean, got ${json}` }] };
  }
}

export function boolean<R extends boolean = false>(opts: BooleanOptions<R> = {}): BooleanField<R> {
  return new BooleanField<R>(opts);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @meta-manifest/core test number`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/fields/number.ts packages/core/src/fields/boolean.ts packages/core/src/fields/number.test.ts
git commit -m "feat(core): add integer, decimal, and boolean codecs" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

### Task 5: Simple scalar codecs (`date`, `dateTime`, `url`, `color`, `json`)

**Files:**
- Create: `packages/core/src/fields/scalar.ts`
- Test: `packages/core/src/fields/scalar.test.ts`

**Interfaces:**
- Consumes: `Field` from `./base`.
- Produces (all `R`-generic):
  - `date(opts?): Field<string, string, R>` — `"date"`, `min`/`max`.
  - `dateTime(opts?): Field<string, string, R>` — `"date_time"`, `min`/`max`.
  - `url(opts?): Field<string, string, R>` — `"url"`, `allowedDomains`.
  - `color(opts?): Field<string, string, R>` — `"color"`, validates `#RGB`/`#RRGGBB`.
  - `json(opts?): Field<unknown, unknown, R>` — `"json"`, `wireIsJson = true`.

- [ ] **Step 1: Write the failing test `packages/core/src/fields/scalar.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { color, date, dateTime, json, url } from "./scalar";

describe("scalar codecs", () => {
  it("date round-trips ISO strings and emits min/max", () => {
    expect(date().decode("2026-06-30")).toEqual({ value: "2026-06-30" });
    expect(date({ min: "2020-01-01" }).validations()).toEqual([{ name: "min", value: "2020-01-01" }]);
  });

  it("dateTime uses the date_time type", () => {
    expect(dateTime().shopifyType).toBe("date_time");
  });

  it("url emits allowed_domains validation", () => {
    expect(url({ allowedDomains: ["shopify.com"] }).validations()).toEqual([
      { name: "allowed_domains", value: '["shopify.com"]' },
    ]);
  });

  it("color validates hex format", () => {
    expect(color().decode("#ff0000")).toEqual({ value: "#ff0000" });
    expect(color().decode("red").issues?.[0]?.message).toMatch(/hex/);
  });

  it("json parses a JSON string and re-serializes on encode", () => {
    expect(json().decode('{"a":1}')).toEqual({ value: { a: 1 } });
    expect(json().encode({ a: 1 })).toBe('{"a":1}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meta-manifest/core test scalar`
Expected: FAIL — no export `date`.

- [ ] **Step 3: Write `packages/core/src/fields/scalar.ts`**

```ts
import { Field, type DecodeResult, type FieldValidation, type Issue } from "./base";

interface BaseOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
}

abstract class StringScalarField<R extends boolean> extends Field<string, string, R> {
  constructor(opts: BaseOptions<R>) {
    super();
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
  }
  protected toJson(value: string): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<string> {
    if (typeof json !== "string") return { issues: [{ message: `Expected string, got ${typeof json}` }] };
    return { value: json };
  }
}

interface DateOptions<R extends boolean = false> extends BaseOptions<R> {
  min?: string;
  max?: string;
}
class DateField<R extends boolean> extends StringScalarField<R> {
  constructor(private readonly o: DateOptions<R>, readonly shopifyType: "date" | "date_time") {
    super(o);
  }
  validations(): FieldValidation[] {
    const v: FieldValidation[] = [];
    if (this.o.min != null) v.push({ name: "min", value: this.o.min });
    if (this.o.max != null) v.push({ name: "max", value: this.o.max });
    return v;
  }
}

interface UrlOptions<R extends boolean = false> extends BaseOptions<R> {
  allowedDomains?: readonly string[];
}
class UrlField<R extends boolean> extends StringScalarField<R> {
  readonly shopifyType = "url";
  constructor(private readonly o: UrlOptions<R>) {
    super(o);
  }
  validations(): FieldValidation[] {
    return this.o.allowedDomains != null
      ? [{ name: "allowed_domains", value: JSON.stringify(this.o.allowedDomains) }]
      : [];
  }
}

class ColorField<R extends boolean> extends StringScalarField<R> {
  readonly shopifyType = "color";
  validations(): FieldValidation[] {
    return [];
  }
  protected override check(value: string): Issue[] {
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? [] : [{ message: "Must be a hex color like #ff0000" }];
  }
}

class JsonField<R extends boolean> extends Field<unknown, unknown, R> {
  readonly shopifyType = "json";
  protected override readonly wireIsJson = true;
  constructor(opts: BaseOptions<R>) {
    super();
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
  }
  validations(): FieldValidation[] {
    return [];
  }
  protected toJson(value: unknown): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<unknown> {
    return { value: json };
  }
}

export function date<R extends boolean = false>(opts: DateOptions<R> = {}): DateField<R> {
  return new DateField<R>(opts, "date");
}
export function dateTime<R extends boolean = false>(opts: DateOptions<R> = {}): DateField<R> {
  return new DateField<R>(opts, "date_time");
}
export function url<R extends boolean = false>(opts: UrlOptions<R> = {}): UrlField<R> {
  return new UrlField<R>(opts);
}
export function color<R extends boolean = false>(opts: BaseOptions<R> = {}): ColorField<R> {
  return new ColorField<R>(opts);
}
export function json<R extends boolean = false>(opts: BaseOptions<R> = {}): JsonField<R> {
  return new JsonField<R>(opts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meta-manifest/core test scalar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fields/scalar.ts packages/core/src/fields/scalar.test.ts
git commit -m "feat(core): add date, dateTime, url, color, json codecs" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

### Task 6: Money + measurement codecs (`money`, `dimension`, `weight`, `volume`)

**Files:**
- Create: `packages/core/src/fields/money.ts`
- Create: `packages/core/src/fields/measurement.ts`
- Test: `packages/core/src/fields/money.test.ts`

**Interfaces:**
- Consumes: `Field` from `./base`.
- Produces:
  - `money<R>(opts?): Field<Money, Money, R>` where `Money = { amount: string; currencyCode: string }`, `shopifyType "money"`, `wireIsJson = true`. Wire JSON shape: `{ amount: string, currency_code: string }`.
  - `dimension<R>(opts?)`, `weight<R>(opts?)`, `volume<R>(opts?)`: `Field<Measure, Measure, R>` where `Measure = { value: number; unit: string }`, `shopifyType "dimension"|"weight"|"volume"`, `wireIsJson = true`. Wire JSON shape: `{ value: number, unit: string }`.

- [ ] **Step 1: Write the failing test `packages/core/src/fields/money.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { dimension, weight } from "./measurement";
import { money } from "./money";

describe("money", () => {
  it("decodes the wire object and encodes back to a JSON string", () => {
    const f = money();
    expect(f.shopifyType).toBe("money");
    expect(f.decode({ amount: "10.00", currency_code: "USD" })).toEqual({
      value: { amount: "10.00", currencyCode: "USD" },
    });
    expect(f.encode({ amount: "10.00", currencyCode: "USD" })).toBe('{"amount":"10.00","currency_code":"USD"}');
  });
  it("decodes a JSON-string wire value", () => {
    expect(money().decode('{"amount":"5","currency_code":"CAD"}')).toEqual({
      value: { amount: "5", currencyCode: "CAD" },
    });
  });
});

describe("measurement", () => {
  it("dimension round-trips value+unit", () => {
    expect(dimension().decode({ value: 3, unit: "CENTIMETERS" })).toEqual({
      value: { value: 3, unit: "CENTIMETERS" },
    });
    expect(weight().shopifyType).toBe("weight");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meta-manifest/core test money`
Expected: FAIL — no export `money`.

- [ ] **Step 3: Write `packages/core/src/fields/money.ts`**

```ts
import { Field, type DecodeResult, type FieldValidation } from "./base";

export interface Money {
  amount: string;
  currencyCode: string;
}
interface MoneyOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
}

class MoneyField<R extends boolean> extends Field<Money, Money, R> {
  readonly shopifyType = "money";
  protected override readonly wireIsJson = true;
  constructor(opts: MoneyOptions<R>) {
    super();
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
  }
  validations(): FieldValidation[] {
    return [];
  }
  protected toJson(value: Money): unknown {
    return { amount: value.amount, currency_code: value.currencyCode };
  }
  protected fromJson(json: unknown): DecodeResult<Money> {
    if (typeof json !== "object" || json === null) return { issues: [{ message: "Expected a money object" }] };
    const o = json as Record<string, unknown>;
    if (typeof o.amount !== "string" || typeof o.currency_code !== "string") {
      return { issues: [{ message: "money requires string amount and currency_code" }] };
    }
    return { value: { amount: o.amount, currencyCode: o.currency_code } };
  }
}

export function money<R extends boolean = false>(opts: MoneyOptions<R> = {}): MoneyField<R> {
  return new MoneyField<R>(opts);
}
```

- [ ] **Step 4: Write `packages/core/src/fields/measurement.ts`**

```ts
import { Field, type DecodeResult, type FieldValidation } from "./base";

export interface Measure {
  value: number;
  unit: string;
}
interface MeasureOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
}

class MeasurementField<R extends boolean> extends Field<Measure, Measure, R> {
  protected override readonly wireIsJson = true;
  constructor(opts: MeasureOptions<R>, readonly shopifyType: "dimension" | "weight" | "volume") {
    super();
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
  }
  validations(): FieldValidation[] {
    return [];
  }
  protected toJson(value: Measure): unknown {
    return { value: value.value, unit: value.unit };
  }
  protected fromJson(json: unknown): DecodeResult<Measure> {
    if (typeof json !== "object" || json === null) return { issues: [{ message: "Expected a measurement object" }] };
    const o = json as Record<string, unknown>;
    const value = typeof o.value === "string" ? Number(o.value) : o.value;
    if (typeof value !== "number" || Number.isNaN(value) || typeof o.unit !== "string") {
      return { issues: [{ message: "measurement requires numeric value and string unit" }] };
    }
    return { value: { value, unit: o.unit } };
  }
}

export function dimension<R extends boolean = false>(opts: MeasureOptions<R> = {}): MeasurementField<R> {
  return new MeasurementField<R>(opts, "dimension");
}
export function weight<R extends boolean = false>(opts: MeasureOptions<R> = {}): MeasurementField<R> {
  return new MeasurementField<R>(opts, "weight");
}
export function volume<R extends boolean = false>(opts: MeasureOptions<R> = {}): MeasurementField<R> {
  return new MeasurementField<R>(opts, "volume");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @meta-manifest/core test money`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/fields/money.ts packages/core/src/fields/measurement.ts packages/core/src/fields/money.test.ts
git commit -m "feat(core): add money and measurement codecs" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

### Task 7: Rating codec (`rating`)

**Files:**
- Create: `packages/core/src/fields/rating.ts`
- Test: `packages/core/src/fields/rating.test.ts`

**Interfaces:**
- Consumes: `Field` from `./base`.
- Produces: `rating<R>(opts: RatingOptions<R>): Field<Rating, RatingInput, R>` where:
  - `RatingOptions` requires `min` and `max` (the scale).
  - `Rating = { value: number; scaleMin: number; scaleMax: number }` (decoded output).
  - `RatingInput = { value: number }` (encode input; scale comes from the definition).
  - `shopifyType "rating"`, `wireIsJson = true`. Wire JSON: `{ value: string, scale_min: string, scale_max: string }`. Validations: `min`/`max` (required by Shopify).

- [ ] **Step 1: Write the failing test `packages/core/src/fields/rating.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { rating } from "./rating";

describe("rating", () => {
  it("requires min/max and emits them as validations", () => {
    expect(rating({ min: 1, max: 5 }).validations()).toEqual([
      { name: "min", value: "1" },
      { name: "max", value: "5" },
    ]);
  });
  it("decodes the wire object (string fields) into numbers", () => {
    expect(rating({ min: 1, max: 5 }).decode({ value: "4.5", scale_min: "1", scale_max: "5" })).toEqual({
      value: { value: 4.5, scaleMin: 1, scaleMax: 5 },
    });
  });
  it("encodes from a value using the definition scale", () => {
    expect(rating({ min: 1, max: 5 }).encode({ value: 4 })).toBe(
      '{"value":"4","scale_min":"1","scale_max":"5"}',
    );
  });
  it("rejects values outside the scale", () => {
    expect(rating({ min: 1, max: 5 }).decode({ value: "9", scale_min: "1", scale_max: "5" }).issues?.[0]?.message).toMatch(
      /between 1 and 5/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meta-manifest/core test rating`
Expected: FAIL — no export `rating`.

- [ ] **Step 3: Write `packages/core/src/fields/rating.ts`**

```ts
import { Field, type DecodeResult, type FieldValidation, type Issue } from "./base";

export interface Rating {
  value: number;
  scaleMin: number;
  scaleMax: number;
}
export interface RatingInput {
  value: number;
}
export interface RatingOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
  min: number;
  max: number;
}

class RatingField<R extends boolean> extends Field<Rating, RatingInput, R> {
  readonly shopifyType = "rating";
  protected override readonly wireIsJson = true;
  constructor(private readonly o: RatingOptions<R>) {
    super();
    this.required = o.required ?? false;
    this.name = o.name;
    this.description = o.description;
  }
  validations(): FieldValidation[] {
    return [
      { name: "min", value: String(this.o.min) },
      { name: "max", value: String(this.o.max) },
    ];
  }
  protected toJson(value: RatingInput): unknown {
    return { value: String(value.value), scale_min: String(this.o.min), scale_max: String(this.o.max) };
  }
  protected fromJson(json: unknown): DecodeResult<Rating> {
    if (typeof json !== "object" || json === null) return { issues: [{ message: "Expected a rating object" }] };
    const o = json as Record<string, unknown>;
    const value = Number(o.value);
    const scaleMin = Number(o.scale_min);
    const scaleMax = Number(o.scale_max);
    if ([value, scaleMin, scaleMax].some(Number.isNaN)) {
      return { issues: [{ message: "rating requires numeric value, scale_min, scale_max" }] };
    }
    return { value: { value, scaleMin, scaleMax } };
  }
  protected override check(value: Rating): Issue[] {
    return value.value < value.scaleMin || value.value > value.scaleMax
      ? [{ message: `Rating must be between ${value.scaleMin} and ${value.scaleMax}` }]
      : [];
  }
}

export function rating<R extends boolean = false>(opts: RatingOptions<R>): RatingField<R> {
  return new RatingField<R>(opts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meta-manifest/core test rating`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fields/rating.ts packages/core/src/fields/rating.test.ts
git commit -m "feat(core): add rating codec" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

### Task 8: Reference codecs (`product`, `variant`, `collection`, `page`, `file`, `ref`)

**Files:**
- Create: `packages/core/src/fields/reference.ts`
- Test: `packages/core/src/fields/reference.test.ts`

**Interfaces:**
- Consumes: `Field` from `./base`.
- Produces (all decode/encode a GID `string`, `wireIsJson = false`):
  - `product<R>`, `variant<R>`, `collection<R>`, `page<R>`: `shopifyType` `"product_reference"`, `"variant_reference"`, `"collection_reference"`, `"page_reference"`.
  - `file<R>(opts?: { accept?: ("Image"|"Video")[] })`: `"file_reference"`, emits `file_type_options` validation.
  - `ref<R>(target: TypeRef, opts?)`: `"metaobject_reference"`, emits `metaobject_definition_type` validation. `TypeRef = { type: string } | (() => { type: string })` — accepts a schema object or a thunk (for circular references); the thunk is resolved lazily inside `validations()`.
- Consumed by: `list.ts` (wraps these), `define.ts` (target objects expose `.type`).

- [ ] **Step 1: Write the failing test `packages/core/src/fields/reference.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { collection, file, product, ref } from "./reference";

describe("reference codecs", () => {
  it("product reference round-trips a GID", () => {
    const f = product();
    expect(f.shopifyType).toBe("product_reference");
    expect(f.decode("gid://shopify/Product/1")).toEqual({ value: "gid://shopify/Product/1" });
    expect(f.encode("gid://shopify/Product/1")).toBe("gid://shopify/Product/1");
  });

  it("collection uses its own type", () => {
    expect(collection().shopifyType).toBe("collection_reference");
  });

  it("file emits file_type_options from accept", () => {
    expect(file({ accept: ["Image"] }).validations()).toEqual([
      { name: "file_type_options", value: '["Image"]' },
    ]);
  });

  it("ref pins the target by metaobject_definition_type", () => {
    const f = ref({ type: "$app:author" });
    expect(f.shopifyType).toBe("metaobject_reference");
    expect(f.validations()).toEqual([{ name: "metaobject_definition_type", value: "$app:author" }]);
  });

  it("ref accepts a thunk for circular references", () => {
    const f = ref(() => ({ type: "$app:book" }));
    expect(f.validations()).toEqual([{ name: "metaobject_definition_type", value: "$app:book" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meta-manifest/core test reference`
Expected: FAIL — no export `product`.

- [ ] **Step 3: Write `packages/core/src/fields/reference.ts`**

```ts
import { Field, type DecodeResult, type FieldValidation } from "./base";

interface RefOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
}

abstract class GidField<R extends boolean> extends Field<string, string, R> {
  constructor(opts: RefOptions<R>) {
    super();
    this.required = opts.required ?? false;
    this.name = opts.name;
    this.description = opts.description;
  }
  protected toJson(value: string): unknown {
    return value;
  }
  protected fromJson(json: unknown): DecodeResult<string> {
    if (typeof json !== "string") return { issues: [{ message: `Expected a GID string, got ${typeof json}` }] };
    return { value: json };
  }
}

class SimpleRefField<R extends boolean> extends GidField<R> {
  constructor(opts: RefOptions<R>, readonly shopifyType: string) {
    super(opts);
  }
  validations(): FieldValidation[] {
    return [];
  }
}

export type FileType = "Image" | "Video";
interface FileOptions<R extends boolean = false> extends RefOptions<R> {
  accept?: readonly FileType[];
}
class FileField<R extends boolean> extends GidField<R> {
  readonly shopifyType = "file_reference";
  constructor(private readonly o: FileOptions<R>) {
    super(o);
  }
  validations(): FieldValidation[] {
    return this.o.accept != null ? [{ name: "file_type_options", value: JSON.stringify(this.o.accept) }] : [];
  }
}

export type TypeRef = { type: string } | (() => { type: string });
function resolveType(target: TypeRef): string {
  return typeof target === "function" ? target().type : target.type;
}
class MetaobjectRefField<R extends boolean> extends GidField<R> {
  readonly shopifyType = "metaobject_reference";
  constructor(private readonly target: TypeRef, opts: RefOptions<R>) {
    super(opts);
  }
  validations(): FieldValidation[] {
    return [{ name: "metaobject_definition_type", value: resolveType(this.target) }];
  }
}

export function product<R extends boolean = false>(opts: RefOptions<R> = {}) {
  return new SimpleRefField<R>(opts, "product_reference");
}
export function variant<R extends boolean = false>(opts: RefOptions<R> = {}) {
  return new SimpleRefField<R>(opts, "variant_reference");
}
export function collection<R extends boolean = false>(opts: RefOptions<R> = {}) {
  return new SimpleRefField<R>(opts, "collection_reference");
}
export function page<R extends boolean = false>(opts: RefOptions<R> = {}) {
  return new SimpleRefField<R>(opts, "page_reference");
}
export function file<R extends boolean = false>(opts: FileOptions<R> = {}) {
  return new FileField<R>(opts);
}
export function ref<R extends boolean = false>(target: TypeRef, opts: RefOptions<R> = {}) {
  return new MetaobjectRefField<R>(target, opts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meta-manifest/core test reference`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fields/reference.ts packages/core/src/fields/reference.test.ts
git commit -m "feat(core): add reference codecs (product, variant, collection, page, file, ref)" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

### Task 9: List wrapper (`list`)

**Files:**
- Create: `packages/core/src/fields/list.ts`
- Test: `packages/core/src/fields/list.test.ts`

**Interfaces:**
- Consumes: `Field` from `./base`.
- Produces: `list<E extends Field<any, any, any>, R extends boolean = false>(inner: E, opts?: ListOptions<R>): Field<InnerOut<E>[], InnerIn<E>[], R>`.
  - `shopifyType = "list." + inner.shopifyType`.
  - `wireIsJson = true`. Wire JSON is an array of each element's JSON form (uses the inner field's `toJson`/`fromJson` via protected accessors — see Step 3).
  - `validations()` = `inner.validations()` plus `list.min`/`list.max` from `opts`.

- [ ] **Step 1: Write the failing test `packages/core/src/fields/list.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { integer } from "./number";
import { product } from "./reference";
import { text } from "./text";
import { list } from "./list";

describe("list", () => {
  it("prefixes the inner shopifyType", () => {
    expect(list(text()).shopifyType).toBe("list.single_line_text_field");
    expect(list(product()).shopifyType).toBe("list.product_reference");
  });

  it("encodes a JSON array of element JSON values", () => {
    expect(list(integer()).encode([1, 2, 3])).toBe("[1,2,3]");
    expect(list(text()).encode(["a", "b"])).toBe('["a","b"]');
  });

  it("decodes from a JSON-array wire value", () => {
    expect(list(integer()).decode([1, 2])).toEqual({ value: [1, 2] });
    expect(list(integer()).decode("[1,2]")).toEqual({ value: [1, 2] });
  });

  it("merges inner validations with list.min/list.max", () => {
    expect(list(text({ max: 5 }), { min: 1, max: 10 }).validations()).toEqual([
      { name: "max", value: "5" },
      { name: "list.min", value: "1" },
      { name: "list.max", value: "10" },
    ]);
  });

  it("reports the index path of a failing element", () => {
    const result = list(integer()).decode([1, "x"]);
    expect(result.issues?.[0]?.path).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meta-manifest/core test list`
Expected: FAIL — no export `list`.

- [ ] **Step 3: Add protected JSON accessors to `Field`, then write `list.ts`**

First, add two thin protected-bridge methods to `packages/core/src/fields/base.ts` so the list wrapper can reuse an element's JSON mapping without re-running JSON.parse/stringify. Add these methods inside the `Field` class (after `encode`):

```ts
  /** Element-level JSON form (for embedding inside list values). */
  elementToJson(value: TIn): unknown {
    return this.toJson(value);
  }
  /** Element-level decode from a JSON form (coerce + check), for list elements. */
  elementFromJson(json: unknown): DecodeResult<TOut> {
    const coerced = this.fromJson(json);
    if (coerced.issues) return coerced;
    const issues = this.check(coerced.value);
    return issues.length ? { issues } : { value: coerced.value };
  }
```

Then create `packages/core/src/fields/list.ts`:

```ts
import { Field, type DecodeResult, type FieldValidation, type Issue } from "./base";

type InnerOut<E> = E extends Field<infer O, any, any> ? O : never;
type InnerIn<E> = E extends Field<any, infer I, any> ? I : never;

export interface ListOptions<R extends boolean = false> {
  name?: string;
  description?: string;
  required?: R;
  min?: number;
  max?: number;
}

class ListField<E extends Field<any, any, any>, R extends boolean> extends Field<InnerOut<E>[], InnerIn<E>[], R> {
  readonly shopifyType: string;
  protected override readonly wireIsJson = true;
  constructor(private readonly inner: E, private readonly o: ListOptions<R>) {
    super();
    this.shopifyType = `list.${inner.shopifyType}`;
    this.required = o.required ?? false;
    this.name = o.name;
    this.description = o.description;
  }
  validations(): FieldValidation[] {
    const v = [...this.inner.validations()];
    if (this.o.min != null) v.push({ name: "list.min", value: String(this.o.min) });
    if (this.o.max != null) v.push({ name: "list.max", value: String(this.o.max) });
    return v;
  }
  protected toJson(value: InnerIn<E>[]): unknown {
    return value.map((el) => this.inner.elementToJson(el));
  }
  protected fromJson(json: unknown): DecodeResult<InnerOut<E>[]> {
    if (!Array.isArray(json)) return { issues: [{ message: "Expected an array" }] };
    const out: InnerOut<E>[] = [];
    const issues: Issue[] = [];
    json.forEach((el, index) => {
      const r = this.inner.elementFromJson(el);
      if (r.issues) issues.push(...r.issues.map((i) => ({ ...i, path: [index, ...(i.path ?? [])] })));
      else out.push(r.value);
    });
    return issues.length ? { issues } : { value: out };
  }
}

export function list<E extends Field<any, any, any>, R extends boolean = false>(
  inner: E,
  opts: ListOptions<R> = {},
): ListField<E, R> {
  return new ListField<E, R>(inner, opts);
}
```

Note: because `decode()` in the base also runs `check()` (a no-op for lists), element validation happens in `fromJson` via `elementFromJson`. Keep the list's own `check` as the inherited no-op.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meta-manifest/core test list`
Expected: PASS. Then `pnpm --filter @meta-manifest/core test` (all) → green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fields/base.ts packages/core/src/fields/list.ts packages/core/src/fields/list.test.ts
git commit -m "feat(core): add list wrapper codec" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

### Task 10: The `m` namespace barrel

**Files:**
- Create: `packages/core/src/fields/index.ts`
- Test: `packages/core/src/fields/index.test.ts`

**Interfaces:**
- Consumes: every codec module from Tasks 3–9.
- Produces: `export const m = { text, multilineText, integer, decimal, boolean, date, dateTime, url, color, json, money, dimension, weight, volume, rating, product, variant, collection, page, file, ref, list }`. Also re-exports `Field` and the value types (`Money`, `Measure`, `Rating`, `TypeRef`, `FileType`).

- [ ] **Step 1: Write the failing test `packages/core/src/fields/index.test.ts`**

```ts
import { expect, it } from "vitest";
import { m } from "./index";

it("exposes the full v1 builder surface", () => {
  const expected = [
    "text", "multilineText", "integer", "decimal", "boolean",
    "date", "dateTime", "url", "color", "json",
    "money", "dimension", "weight", "volume", "rating",
    "product", "variant", "collection", "page", "file", "ref", "list",
  ];
  expect(Object.keys(m).sort()).toEqual([...expected].sort());
});

it("builders produce fields with a shopifyType", () => {
  expect(m.text().shopifyType).toBe("single_line_text_field");
  expect(m.list(m.ref({ type: "$app:author" })).shopifyType).toBe("list.metaobject_reference");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meta-manifest/core test fields/index`
Expected: FAIL — no export `m`.

- [ ] **Step 3: Write `packages/core/src/fields/index.ts`**

```ts
import { boolean } from "./boolean";
import { list } from "./list";
import { dimension, volume, weight } from "./measurement";
import { money } from "./money";
import { decimal, integer } from "./number";
import { rating } from "./rating";
import { collection, file, page, product, ref, variant } from "./reference";
import { color, date, dateTime, json, url } from "./scalar";
import { multilineText, text } from "./text";

export const m = {
  text,
  multilineText,
  integer,
  decimal,
  boolean,
  date,
  dateTime,
  url,
  color,
  json,
  money,
  dimension,
  weight,
  volume,
  rating,
  product,
  variant,
  collection,
  page,
  file,
  ref,
  list,
} as const;

export { Field } from "./base";
export type { DecodeResult, FieldValidation, Issue } from "./base";
export type { Money } from "./money";
export type { Measure } from "./measurement";
export type { Rating, RatingInput } from "./rating";
export type { FileType, TypeRef } from "./reference";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @meta-manifest/core test fields/index`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fields/index.ts packages/core/src/fields/index.test.ts
git commit -m "feat(core): assemble the m namespace barrel" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

### Task 11: `defineMetaobject` + inference

**Files:**
- Create: `packages/core/src/infer.ts`
- Create: `packages/core/src/define.ts`
- Test: `packages/core/src/define.test.ts`

**Interfaces:**
- Consumes: `Field` from `./fields/base`, `StandardSchemaV1` from `./standard-schema`.
- Produces:
  - `type FieldMap = Record<string, Field<any, any, any>>`
  - `type Infer<S>` / `type InferInput<S>` — output/input object types with required-key handling.
  - `type AccessConfig`, `type CapabilitiesConfig`, `type MetaobjectConfig<F>`.
  - `defineMetaobject<F extends Record<string, unknown>>(handle: string, config: MetaobjectConfig<F>): F extends FieldMap ? MetaobjectSchema<F> : never` (the loose constraint is required for correct `Req` inference — see the inference note below the code). `MetaobjectSchema<F extends FieldMap>` has `handle`, `type` (`"$app:"+handle`), `config`, `fields`, `parse(input)`, `encode(value)`, and `["~standard"]`. (`toDefinitionInput()` is added in Task 12.)
  - `parse` input: `Array<{ key: string; jsonValue?: unknown; value?: unknown }>` or `Record<string, unknown>`.

- [ ] **Step 1: Write `packages/core/src/infer.ts`**

```ts
import type { Field } from "./fields/base";

export type FieldMap = Record<string, Field<any, any, any>>;

type FieldOut<T> = T extends Field<infer O, any, any> ? O : never;
type FieldIn<T> = T extends Field<any, infer I, any> ? I : never;
type IsRequired<T> = T extends Field<any, any, true> ? true : false;

type RequiredKeys<F extends FieldMap> = {
  [K in keyof F]: IsRequired<F[K]> extends true ? K : never;
}[keyof F];
type OptionalKeys<F extends FieldMap> = Exclude<keyof F, RequiredKeys<F>>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type Infer<F extends FieldMap> = Simplify<
  { [K in RequiredKeys<F>]: FieldOut<F[K]> } & { [K in OptionalKeys<F>]?: FieldOut<F[K]> }
>;
export type InferInput<F extends FieldMap> = Simplify<
  { [K in RequiredKeys<F>]: FieldIn<F[K]> } & { [K in OptionalKeys<F>]?: FieldIn<F[K]> }
>;
```

- [ ] **Step 2: Write the failing test `packages/core/src/define.test.ts`**

```ts
import { describe, expect, expectTypeOf, it } from "vitest";
import { m } from "./fields/index";
import { defineMetaobject, type Infer } from "./define";

const Author = defineMetaobject("author", {
  name: "Author",
  displayName: "name",
  fields: {
    name: m.text({ required: true, max: 120 }),
    bio: m.multilineText(),
    rating: m.rating({ min: 1, max: 5 }),
  },
});

describe("defineMetaobject", () => {
  it("resolves an app-owned type", () => {
    expect(Author.type).toBe("$app:author");
  });

  it("parses a Shopify field array into a typed object", () => {
    const result = Author.parse([
      { key: "name", jsonValue: "Ursula" },
      { key: "rating", jsonValue: { value: "5", scale_min: "1", scale_max: "5" } },
    ]);
    expect(result).toEqual({ value: { name: "Ursula", rating: { value: 5, scaleMin: 1, scaleMax: 5 } } });
  });

  it("reports an error for a missing required field", () => {
    const result = Author.parse([]);
    expect(result.issues?.[0]?.path).toEqual(["name"]);
  });

  it("encodes a typed object into Shopify {key,value} entries", () => {
    expect(Author.encode({ name: "Ursula" })).toEqual([{ key: "name", value: "Ursula" }]);
  });

  it("infers required vs optional keys", () => {
    expectTypeOf<Infer<typeof Author.fields>>().toMatchTypeOf<{ name: string }>();
    expectTypeOf<Infer<typeof Author.fields>>().toEqualTypeOf<{
      name: string;
      bio?: string;
      rating?: { value: number; scaleMin: number; scaleMax: number };
    }>();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @meta-manifest/core test define`
Expected: FAIL — no export `defineMetaobject`.

- [ ] **Step 4: Write `packages/core/src/define.ts`**

```ts
import type { Field, Issue } from "./fields/base";
import { type FieldMap, type Infer, type InferInput } from "./infer";
import type { StandardSchemaV1 } from "./standard-schema";

export type { Infer, InferInput } from "./infer";

export interface AccessConfig {
  admin?: "merchant_read" | "merchant_read_write";
  storefront?: "public_read" | "none";
}
export interface CapabilitiesConfig {
  publishable?: boolean;
  translatable?: boolean;
  renderable?: boolean;
}
export interface MetaobjectConfig<F> {
  name: string;
  description?: string;
  displayName?: keyof F & string;
  access?: AccessConfig;
  capabilities?: CapabilitiesConfig;
  fields: F;
}

export type ParseInput =
  | ReadonlyArray<{ key: string; jsonValue?: unknown; value?: unknown }>
  | Record<string, unknown>;

export interface MetaobjectSchema<F extends FieldMap> {
  readonly handle: string;
  readonly type: string;
  readonly config: MetaobjectConfig<F>;
  readonly fields: F;
  parse(input: ParseInput): { value: Infer<F>; issues?: undefined } | { value?: undefined; issues: Issue[] };
  encode(value: InferInput<F>): Array<{ key: string; value: string }>;
  readonly ["~standard"]: StandardSchemaV1.Props<InferInput<F>, Infer<F>>;
}

function toValueMap(input: ParseInput): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (Array.isArray(input)) {
    for (const f of input) map.set(f.key, "jsonValue" in f && f.jsonValue !== undefined ? f.jsonValue : f.value);
  } else {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) map.set(k, v);
  }
  return map;
}

// F is constrained only to `Record<string, unknown>` rather than `FieldMap`. A
// `Field<...>` constraint would supply a contextual type whose `Req` slot is
// `any`, which pollutes the `R` inference of inline builder calls
// (`m.text({ required: true })`) at the call site and breaks required-vs-optional
// key detection. The loose constraint avoids that; field-map-ness is enforced via
// the conditional return type instead (`never` when `fields` isn't a field map).
export function defineMetaobject<F extends Record<string, unknown>>(
  handle: string,
  config: MetaobjectConfig<F>,
): F extends FieldMap ? MetaobjectSchema<F> : never {
  const type = `$app:${handle}`;
  const entries = Object.entries(config.fields as FieldMap) as Array<[string, Field<any, any, any>]>;

  function parse(input: ParseInput) {
    const values = toValueMap(input);
    const out: Record<string, unknown> = {};
    const issues: Issue[] = [];
    for (const [key, field] of entries) {
      if (!values.has(key) || values.get(key) === undefined || values.get(key) === null) {
        if (field.required) issues.push({ message: `Missing required field "${key}"`, path: [key] });
        continue;
      }
      const r = field.decode(values.get(key));
      if (r.issues) issues.push(...r.issues.map((i) => ({ ...i, path: [key, ...(i.path ?? [])] })));
      else out[key] = r.value;
    }
    return issues.length ? { issues } : { value: out };
  }

  function encode(value: Record<string, unknown>) {
    const result: Array<{ key: string; value: string }> = [];
    for (const [key, field] of entries) {
      const v = value[key];
      if (v === undefined) continue;
      result.push({ key, value: field.encode(v) });
    }
    return result;
  }

  const schemaRef = {
    handle,
    type,
    config,
    fields: config.fields,
    parse,
    encode,
    ["~standard"]: {
      version: 1 as const,
      vendor: "meta-manifest",
      validate: (input: unknown) => parse(input as ParseInput),
    },
  };
  return schemaRef as unknown as F extends FieldMap ? MetaobjectSchema<F> : never;
}
```

> **Inference note (load-bearing):** the loose `F extends Record<string, unknown>` constraint + conditional return type is required, not stylistic. A `Field`-mentioning constraint poisons the per-field `Req` inference of inline `m.*({ required: true })` calls (collapsing `Req` to `any`/`boolean`), which silently breaks required-vs-optional key detection in `Infer`. Verified: required inference, the `displayName` key-constraint, and rejection of non-field values all hold with this signature. `schemaRef` is a loosely-typed literal cast to the precise schema type at `return`; `parse`/`encode` are loosely typed internally and the external `MetaobjectSchema<F>` type supplies the precise `Infer`/`InferInput` surface.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @meta-manifest/core test define`
Expected: PASS. Then `pnpm --filter @meta-manifest/core typecheck` → clean (validates the `expectTypeOf` assertions compile).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/infer.ts packages/core/src/define.ts packages/core/src/define.test.ts
git commit -m "feat(core): add defineMetaobject and type inference" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

### Task 12: `toDefinitionInput` (schema → Shopify definition input)

**Files:**
- Create: `packages/core/src/definition-input.ts`
- Modify: `packages/core/src/define.ts` (attach `toDefinitionInput` to the schema)
- Test: `packages/core/src/definition-input.test.ts`

**Interfaces:**
- Consumes: `MetaobjectSchema`, `AccessConfig`, `CapabilitiesConfig` from `./define`.
- Produces:
  - `interface MetaobjectDefinitionInput { type; name; description?; displayNameKey?; access?; capabilities?; fieldDefinitions: FieldDefinitionInput[] }`
  - `interface FieldDefinitionInput { key; name; description?; required: boolean; type: string; validations: FieldValidation[] }`
  - `toDefinitionInput(schema): MetaobjectDefinitionInput`
  - `MetaobjectSchema` gains a `toDefinitionInput(): MetaobjectDefinitionInput` method.

- [ ] **Step 1: Write the failing test `packages/core/src/definition-input.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { defineMetaobject } from "./define";
import { m } from "./fields/index";

const Author = defineMetaobject("author", {
  name: "Author",
  displayName: "name",
  access: { admin: "merchant_read_write", storefront: "public_read" },
  capabilities: { publishable: true },
  fields: {
    name: m.text({ name: "Author Name", required: true, max: 120 }),
    bio: m.multilineText(),
  },
});

describe("toDefinitionInput", () => {
  it("maps a schema to a MetaobjectDefinitionCreateInput", () => {
    expect(Author.toDefinitionInput()).toEqual({
      type: "$app:author",
      name: "Author",
      displayNameKey: "name",
      access: { admin: "MERCHANT_READ_WRITE", storefront: "PUBLIC_READ" },
      capabilities: { publishable: { enabled: true } },
      fieldDefinitions: [
        { key: "name", name: "Author Name", required: true, type: "single_line_text_field", validations: [{ name: "max", value: "120" }] },
        { key: "bio", name: "bio", required: false, type: "multi_line_text_field", validations: [] },
      ],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meta-manifest/core test definition-input`
Expected: FAIL — `Author.toDefinitionInput` is not a function.

- [ ] **Step 3: Write `packages/core/src/definition-input.ts`**

```ts
import type { AccessConfig, CapabilitiesConfig, MetaobjectSchema } from "./define";
import type { FieldMap } from "./infer";
import type { FieldValidation } from "./fields/base";

export interface FieldDefinitionInput {
  key: string;
  name: string;
  description?: string;
  required: boolean;
  type: string;
  validations: FieldValidation[];
}
export interface MetaobjectDefinitionInput {
  type: string;
  name: string;
  description?: string;
  displayNameKey?: string;
  access?: { admin?: string; storefront?: string };
  capabilities?: Record<string, { enabled: boolean }>;
  fieldDefinitions: FieldDefinitionInput[];
}

function mapAccess(access?: AccessConfig): MetaobjectDefinitionInput["access"] {
  if (!access) return undefined;
  const out: { admin?: string; storefront?: string } = {};
  if (access.admin) out.admin = access.admin.toUpperCase();
  if (access.storefront) out.storefront = access.storefront.toUpperCase();
  return out;
}

function mapCapabilities(caps?: CapabilitiesConfig): MetaobjectDefinitionInput["capabilities"] {
  if (!caps) return undefined;
  const out: Record<string, { enabled: boolean }> = {};
  for (const [k, v] of Object.entries(caps)) if (v != null) out[k] = { enabled: v };
  return Object.keys(out).length ? out : undefined;
}

export function toDefinitionInput<F extends FieldMap>(schema: MetaobjectSchema<F>): MetaobjectDefinitionInput {
  const { config } = schema;
  const fieldDefinitions: FieldDefinitionInput[] = Object.entries(schema.fields).map(([key, field]) => {
    const def: FieldDefinitionInput = {
      key,
      name: field.name ?? key,
      required: field.required,
      type: field.shopifyType,
      validations: field.validations(),
    };
    if (field.description != null) def.description = field.description;
    return def;
  });

  const out: MetaobjectDefinitionInput = {
    type: schema.type,
    name: config.name,
    fieldDefinitions,
  };
  if (config.description != null) out.description = config.description;
  if (config.displayName != null) out.displayNameKey = config.displayName;
  const access = mapAccess(config.access);
  if (access) out.access = access;
  const capabilities = mapCapabilities(config.capabilities);
  if (capabilities) out.capabilities = capabilities;
  return out;
}
```

- [ ] **Step 4: Wire `toDefinitionInput` into the schema in `packages/core/src/define.ts`**

Add the import at the top of `define.ts`:

```ts
import { toDefinitionInput, type MetaobjectDefinitionInput } from "./definition-input";
```

Add the method to the `MetaobjectSchema` interface (after `encode`):

```ts
  toDefinitionInput(): MetaobjectDefinitionInput;
```

`define.ts` already builds a `const schemaRef = {...}` literal (loosely typed) and returns it via a cast. Add ONE line to that existing `schemaRef` literal (after `encode,`). The standalone `toDefinitionInput` only reads `type`/`config`/`fields`, so cast `schemaRef` to `MetaobjectSchema<FieldMap>` when passing it (`FieldMap` is already imported in `define.ts` from `./infer`):

```ts
    toDefinitionInput: () => toDefinitionInput(schemaRef as unknown as MetaobjectSchema<FieldMap>),
```

So the existing `schemaRef` literal becomes (the `return schemaRef as unknown as ...` line is UNCHANGED from Task 11 — do not alter it):

```ts
  const schemaRef = {
    handle,
    type,
    config,
    fields: config.fields,
    parse,
    encode,
    toDefinitionInput: () => toDefinitionInput(schemaRef as unknown as MetaobjectSchema<FieldMap>),
    ["~standard"]: {
      version: 1 as const,
      vendor: "meta-manifest",
      validate: (input: unknown) => parse(input as ParseInput),
    },
  };
  return schemaRef as unknown as F extends FieldMap ? MetaobjectSchema<F> : never;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @meta-manifest/core test definition-input`
Expected: PASS. Then `pnpm --filter @meta-manifest/core test` (all) → green; `typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/definition-input.ts packages/core/src/define.ts packages/core/src/definition-input.test.ts
git commit -m "feat(core): map schemas to MetaobjectDefinitionCreateInput" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

### Task 13: Sync — `normalize` + pure `diff`

**Files:**
- Create: `packages/core/src/sync/normalize.ts`
- Create: `packages/core/src/sync/diff.ts`
- Test: `packages/core/src/sync/diff.test.ts`

**Interfaces:**
- Consumes: `MetaobjectSchema` + `toDefinitionInput` (via `schema.toDefinitionInput()`), `FieldValidation`.
- Produces:
  - `interface RemoteField { key: string; type: string; required: boolean; validations: FieldValidation[] }`
  - `interface RemoteDefinition { type: string; name?: string; fields: RemoteField[] }`
  - `normalizeLocal(schema): RemoteDefinition` — from `schema.toDefinitionInput()`.
  - `normalizeRemote(def): RemoteDefinition` — from a pulled Shopify definition shape `{ type, name?, fieldDefinitions: [{ key, type: { name } | string, required, validations: [{name,value}] }] }`.
  - `type DiffOp` (tagged union): `createDefinition` | `addField` | `updateField` | `removeField` | `changeFieldType`. `removeField` and `changeFieldType` carry `destructive: true`.
  - `diff(local: RemoteDefinition[], remote: RemoteDefinition[]): DiffOp[]` — pure.

- [ ] **Step 1: Write the failing test `packages/core/src/sync/diff.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { defineMetaobject } from "../define";
import { m } from "../fields/index";
import { diff } from "./diff";
import { normalizeLocal, normalizeRemote } from "./normalize";

const Author = defineMetaobject("author", {
  name: "Author",
  fields: { name: m.text({ required: true, max: 120 }), bio: m.multilineText() },
});

describe("normalize", () => {
  it("normalizes a local schema", () => {
    expect(normalizeLocal(Author)).toEqual({
      type: "$app:author",
      name: "Author",
      fields: [
        { key: "name", type: "single_line_text_field", required: true, validations: [{ name: "max", value: "120" }] },
        { key: "bio", type: "multi_line_text_field", required: false, validations: [] },
      ],
    });
  });

  it("normalizes a pulled remote definition", () => {
    const remote = normalizeRemote({
      type: "$app:author",
      name: "Author",
      fieldDefinitions: [{ key: "name", type: { name: "single_line_text_field" }, required: true, validations: [] }],
    });
    expect(remote.fields[0]).toEqual({ key: "name", type: "single_line_text_field", required: true, validations: [] });
  });
});

describe("diff", () => {
  it("creates a definition that does not exist remotely", () => {
    const ops = diff([normalizeLocal(Author)], []);
    expect(ops).toEqual([{ kind: "createDefinition", type: "$app:author", definition: normalizeLocal(Author) }]);
  });

  it("adds a field that is missing remotely", () => {
    const remote = normalizeRemote({
      type: "$app:author",
      name: "Author",
      fieldDefinitions: [{ key: "name", type: { name: "single_line_text_field" }, required: true, validations: [{ name: "max", value: "120" }] }],
    });
    const ops = diff([normalizeLocal(Author)], [remote]);
    expect(ops).toEqual([{ kind: "addField", type: "$app:author", field: { key: "bio", type: "multi_line_text_field", required: false, validations: [] } }]);
  });

  it("flags a field type change as destructive", () => {
    const remote = normalizeRemote({
      type: "$app:author",
      name: "Author",
      fieldDefinitions: [
        { key: "name", type: { name: "number_integer" }, required: true, validations: [] },
        { key: "bio", type: { name: "multi_line_text_field" }, required: false, validations: [] },
      ],
    });
    const ops = diff([normalizeLocal(Author)], [remote]);
    expect(ops).toContainEqual({
      kind: "changeFieldType",
      type: "$app:author",
      key: "name",
      from: "number_integer",
      to: "single_line_text_field",
      destructive: true,
    });
  });

  it("flags a removed field as destructive", () => {
    const remote = normalizeRemote({
      type: "$app:author",
      name: "Author",
      fieldDefinitions: [
        { key: "name", type: { name: "single_line_text_field" }, required: true, validations: [{ name: "max", value: "120" }] },
        { key: "bio", type: { name: "multi_line_text_field" }, required: false, validations: [] },
        { key: "legacy", type: { name: "single_line_text_field" }, required: false, validations: [] },
      ],
    });
    const ops = diff([normalizeLocal(Author)], [remote]);
    expect(ops).toContainEqual({ kind: "removeField", type: "$app:author", key: "legacy", destructive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meta-manifest/core test diff`
Expected: FAIL — no export `normalizeLocal`.

- [ ] **Step 3: Write `packages/core/src/sync/normalize.ts`**

```ts
import type { MetaobjectSchema } from "../define";
import type { FieldMap } from "../infer";
import type { FieldValidation } from "../fields/base";

export interface RemoteField {
  key: string;
  type: string;
  required: boolean;
  validations: FieldValidation[];
}
export interface RemoteDefinition {
  type: string;
  name?: string;
  fields: RemoteField[];
}

export function normalizeLocal<F extends FieldMap>(schema: MetaobjectSchema<F>): RemoteDefinition {
  const def = schema.toDefinitionInput();
  return {
    type: def.type,
    name: def.name,
    fields: def.fieldDefinitions.map((f) => ({
      key: f.key,
      type: f.type,
      required: f.required,
      validations: f.validations,
    })),
  };
}

interface PulledFieldDefinition {
  key: string;
  type: { name: string } | string;
  required: boolean;
  validations?: FieldValidation[];
}
interface PulledDefinition {
  type: string;
  name?: string;
  fieldDefinitions: PulledFieldDefinition[];
}

export function normalizeRemote(def: PulledDefinition): RemoteDefinition {
  return {
    type: def.type,
    name: def.name,
    fields: def.fieldDefinitions.map((f) => ({
      key: f.key,
      type: typeof f.type === "string" ? f.type : f.type.name,
      required: f.required,
      validations: f.validations ?? [],
    })),
  };
}
```

- [ ] **Step 4: Write `packages/core/src/sync/diff.ts`**

```ts
import type { FieldValidation } from "../fields/base";
import type { RemoteDefinition, RemoteField } from "./normalize";

export type DiffOp =
  | { kind: "createDefinition"; type: string; definition: RemoteDefinition }
  | { kind: "addField"; type: string; field: RemoteField }
  | { kind: "updateField"; type: string; key: string; changes: Partial<RemoteField> }
  | { kind: "changeFieldType"; type: string; key: string; from: string; to: string; destructive: true }
  | { kind: "removeField"; type: string; key: string; destructive: true };

function sameValidations(a: FieldValidation[], b: FieldValidation[]): boolean {
  const norm = (v: FieldValidation[]) => JSON.stringify([...v].sort((x, y) => x.name.localeCompare(y.name)));
  return norm(a) === norm(b);
}

export function diff(local: RemoteDefinition[], remote: RemoteDefinition[]): DiffOp[] {
  const ops: DiffOp[] = [];
  const remoteByType = new Map(remote.map((d) => [d.type, d]));

  for (const localDef of local) {
    const remoteDef = remoteByType.get(localDef.type);
    if (!remoteDef) {
      ops.push({ kind: "createDefinition", type: localDef.type, definition: localDef });
      continue;
    }
    const remoteFields = new Map(remoteDef.fields.map((f) => [f.key, f]));
    const localKeys = new Set(localDef.fields.map((f) => f.key));

    for (const lf of localDef.fields) {
      const rf = remoteFields.get(lf.key);
      if (!rf) {
        ops.push({ kind: "addField", type: localDef.type, field: lf });
        continue;
      }
      if (rf.type !== lf.type) {
        ops.push({ kind: "changeFieldType", type: localDef.type, key: lf.key, from: rf.type, to: lf.type, destructive: true });
        continue;
      }
      const changes: Partial<RemoteField> = {};
      if (rf.required !== lf.required) changes.required = lf.required;
      if (!sameValidations(rf.validations, lf.validations)) changes.validations = lf.validations;
      if (Object.keys(changes).length) {
        ops.push({ kind: "updateField", type: localDef.type, key: lf.key, changes });
      }
    }

    for (const rf of remoteDef.fields) {
      if (!localKeys.has(rf.key)) {
        ops.push({ kind: "removeField", type: localDef.type, key: rf.key, destructive: true });
      }
    }
  }

  return ops;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @meta-manifest/core test diff`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync
git commit -m "feat(core): add normalize and pure diff for sync planning" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

### Task 14: Public barrel + README

**Files:**
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/README.md`
- Test: `packages/core/src/index.test.ts`

**Interfaces:**
- Produces the package's public API: `m`, `defineMetaobject`, `Field`, types (`Infer`, `InferInput`, `MetaobjectSchema`, `MetaobjectConfig`, `AccessConfig`, `CapabilitiesConfig`, `MetaobjectDefinitionInput`, `FieldDefinitionInput`), and sync (`diff`, `normalizeLocal`, `normalizeRemote`, `RemoteDefinition`, `RemoteField`, `DiffOp`).

- [ ] **Step 1: Write the failing test `packages/core/src/index.test.ts`**

```ts
import { expect, it } from "vitest";
import { defineMetaobject, diff, m, normalizeLocal } from "./index";

it("exposes the public API and runs an end-to-end define→diff", () => {
  const Author = defineMetaobject("author", {
    name: "Author",
    fields: { name: m.text({ required: true }) },
  });
  const ops = diff([normalizeLocal(Author)], []);
  expect(ops[0]).toMatchObject({ kind: "createDefinition", type: "$app:author" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @meta-manifest/core test src/index`
Expected: FAIL — `diff`/`defineMetaobject` not exported from `./index`.

- [ ] **Step 3: Replace `packages/core/src/index.ts`**

```ts
export { m, Field } from "./fields/index";
export type { DecodeResult, FieldValidation, Issue, Money, Measure, Rating, RatingInput, FileType, TypeRef } from "./fields/index";

export { defineMetaobject } from "./define";
export type {
  Infer,
  InferInput,
  MetaobjectSchema,
  MetaobjectConfig,
  AccessConfig,
  CapabilitiesConfig,
  ParseInput,
} from "./define";

export { toDefinitionInput } from "./definition-input";
export type { MetaobjectDefinitionInput, FieldDefinitionInput } from "./definition-input";

export { diff } from "./sync/diff";
export type { DiffOp } from "./sync/diff";
export { normalizeLocal, normalizeRemote } from "./sync/normalize";
export type { RemoteDefinition, RemoteField } from "./sync/normalize";

export type { StandardSchemaV1 } from "./standard-schema";
```

Note: remove the old `export const version = "0.0.0";` line. Update `smoke.test.ts` to import `m` instead of `version`, or delete `smoke.test.ts` (the new `index.test.ts` supersedes it) — choose deletion and `git rm` it in Step 6.

- [ ] **Step 4: Write `packages/core/README.md`**

```markdown
# @meta-manifest/core

Zero-dependency, zod-style builder for Shopify metaobject definitions. Declares definitions, validates values, and maps schemas to/from the Admin API. Implements [Standard Schema](https://github.com/standard-schema/standard-schema).

## Usage

​```ts
import { defineMetaobject, m, type Infer } from "@meta-manifest/core";

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
​```

## Status

v1: schema core + value codecs + `diff()` planning. Networked push/pull and the dashboard are tracked separately.
```

(Remove the zero-width-space characters around the code fences — they are only here to keep this plan's markdown intact. Use plain triple backticks.)

- [ ] **Step 5: Run test + full suite + typecheck**

Run: `pnpm --filter @meta-manifest/core test`
Expected: ALL PASS.
Run: `pnpm --filter @meta-manifest/core typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git rm packages/core/src/smoke.test.ts
git add packages/core/src/index.ts packages/core/src/index.test.ts packages/core/README.md
git commit -m "feat(core): finalize public barrel and add README" -m "Claude-Session: https://claude.ai/code/session_011fqj6zwA49QvsmXUpkJrRv"
```

---

## Self-Review

**1. Spec coverage:**
- §2 SDK / zero-dep / Standard Schema → Tasks 1, 2 (Standard Schema everywhere). ✓
- §2 lossless parse/serialize → codec round-trip tests (Tasks 3–9), `parse`/`encode` (Task 11). ✓
- §3 app-owned `$app:` → Task 11 (`type` resolution). ✓
- §3 runtime-GraphQL lane / definition input → Task 12. ✓
- §3 reference-by-type → Task 8 (`metaobject_definition_type`). ✓
- §5 syntax (`m.*`, `defineMetaobject`, `Infer`, `parse`, `encode`, `~standard`) → Tasks 10, 11, 12. ✓
- §6 field coverage (all listed v1 types incl. measurements) → Tasks 3–9. ✓
- §7 codec model (`shopifyType`, `validations`, `decode`, `encode`, `~standard`) → Task 2 base + each codec. ✓
- §8 `defineMetaobject` composition → Tasks 11, 12. ✓
- §9 Standard Schema field + object level → Task 2 (field), Task 11 (object). ✓
- §10 normalize + pure `diff` (push/pull deferred) → Task 13. ✓
- §11 package layout → Task 1 + file structure. ✓
- §12 testing strategy (round-trip, validations, inference, diff cases) → every task. ✓
- §13 out-of-scope (networked push/pull, UI, merchant-owned) → not implemented, correct. ✓
- §14 open questions: rating shape resolved to `{value, scaleMin, scaleMax}` (Task 7); reference-by-type used (Task 8). ✓

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N"; every code step shows complete code; the README's zero-width-space note is explicit. ✓

**3. Type consistency:** `Field<TOut, TIn, Req>` signature is consistent across all codecs; `decode`/`encode`/`validations`/`toJson`/`fromJson`/`check`/`elementToJson`/`elementFromJson` names match between `base.ts` (Task 2 + the addition in Task 9) and every consumer; `MetaobjectSchema` gains `toDefinitionInput` in Task 12 exactly as referenced by Task 13's `normalizeLocal`; `RemoteDefinition`/`RemoteField`/`DiffOp` names match between `normalize.ts` and `diff.ts`. ✓

## Notes for the implementer

- **`exactOptionalPropertyTypes` is off** (tsconfig) so assigning `undefined`-able optionals (e.g. `def.description = …` only when present, but `name?: string` from `def.name`) stays simple. Keep it off.
- Task 11 inference: with the corrected loose-constraint `defineMetaobject` signature (see Task 11's inference note), the exact `expectTypeOf(...).toEqualTypeOf(...)` assertion passes as written — no relaxation needed. The earlier draft used a `Field`-mentioning constraint that poisoned `Req` inference of inline builder calls; that is fixed. The runtime assertions remain the real gate.
- The two **§14 open questions that need a live store** (does `metaobject_definition_type` accept a not-yet-created target; exact stored `rating` JSON) are intentionally deferred — they only matter once the networked push/pull phase lands, and do not block this no-network core.
