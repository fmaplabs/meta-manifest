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
