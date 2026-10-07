import type { Field, Issue } from "./fields/base";
import type { ParseInput } from "./define";
import type { FieldMap, Infer, InferInput } from "./infer";
import type { StandardSchemaV1 } from "./standard-schema";

export type { Infer, InferInput } from "./infer";

/**
 * Canonical local spelling of the app-reserved namespace. Declarations default
 * to it; sync resolves it per scope (app → the store's `app--<id>` namespace,
 * merchant → `"custom"`), mirroring the `$app:` metaobject type canon. [design §6]
 */
export const APP_NAMESPACE = "$app";

/** Whether a namespace addresses the app-reserved space: `$app` or a `$app:<suffix>` sub-namespace. */
export function isAppReservedNamespace(namespace: string): boolean {
  return namespace === APP_NAMESPACE || namespace.startsWith(`${APP_NAMESPACE}:`);
}

/** camelCase owner → `MetafieldOwnerType` enum value (Admin API 2026-07). [design §3] */
export const METAFIELD_OWNER_TYPES = {
  product: "PRODUCT",
  productVariant: "PRODUCTVARIANT",
  customer: "CUSTOMER",
  order: "ORDER",
  draftOrder: "DRAFTORDER",
  collection: "COLLECTION",
  company: "COMPANY",
  companyLocation: "COMPANY_LOCATION",
  location: "LOCATION",
  market: "MARKET",
  page: "PAGE",
  article: "ARTICLE",
  blog: "BLOG",
  shop: "SHOP",
  sellingPlan: "SELLING_PLAN",
  discount: "DISCOUNT",
  giftCardTransaction: "GIFT_CARD_TRANSACTION",
  transfer: "TRANSFER",
  validation: "VALIDATION",
  cartTransform: "CARTTRANSFORM",
  deliveryCustomization: "DELIVERY_CUSTOMIZATION",
  paymentCustomization: "PAYMENT_CUSTOMIZATION",
  fulfillmentConstraintRule: "FULFILLMENT_CONSTRAINT_RULE",
  orderRoutingLocationRule: "ORDER_ROUTING_LOCATION_RULE",
  apiPermission: "API_PERMISSION",
} as const;

export type MetafieldOwner = keyof typeof METAFIELD_OWNER_TYPES;
export type MetafieldOwnerType = (typeof METAFIELD_OWNER_TYPES)[MetafieldOwner];

const OWNER_KEY_BY_TYPE = new Map<string, MetafieldOwner>(
  (Object.entries(METAFIELD_OWNER_TYPES) as Array<[MetafieldOwner, MetafieldOwnerType]>).map(([k, v]) => [v, k]),
);

/** camelCase owner for a `MetafieldOwnerType` enum value (display/codegen direction). */
export function metafieldOwnerKey(ownerType: string): MetafieldOwner | undefined {
  return OWNER_KEY_BY_TYPE.get(ownerType);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyField = Field<any, any, any>;

/** Metafield-only per-definition options, wrapped around the shared field builders. [design §5] */
export interface MetafieldOptions {
  pin?: boolean;
  /** Overrides the builder's description. */
  description?: string;
  access?: {
    admin?: "merchant_read" | "merchant_read_write";
    storefront?: "public_read" | "none";
    customerAccount?: "none" | "read";
  };
  capabilities?: {
    /** Also settable via the field's `filterable`; both must agree when both set. */
    adminFilterable?: boolean;
    /** PRODUCT owner only (validated). */
    smartCollectionCondition?: boolean;
    uniqueValues?: boolean;
  };
}

export type MetafieldEntry = AnyField | ({ field: AnyField } & MetafieldOptions);

export interface MetafieldSetConfig<F> {
  /** Used verbatim when present; defaults to the `$app` sentinel. [design §6] */
  namespace?: string;
  /** Per-set override of `config.scope` (drives the namespace default only). */
  scope?: "app" | "merchant";
  fields: F;
}

type UnwrapEntry<E> = E extends { field: infer G } ? G : E;
export type UnwrapEntries<F> = { [K in keyof F]: UnwrapEntry<F[K]> };

/** A `metafieldsSet`-shaped input for one value; the caller supplies `ownerId`. */
export interface MetafieldSetInput {
  key: string;
  value: string;
  type: string;
  /** Present only for explicit namespaces; `metafieldsSet` defaults to `$app`. [design §3] */
  namespace?: string;
}

export interface MetafieldSet<F extends FieldMap> {
  /** Canonical `MetafieldOwnerType` enum value, e.g. "PRODUCT". */
  readonly owner: MetafieldOwnerType;
  /** Declared namespace verbatim, or the `$app` sentinel (scope-resolved at sync time). */
  readonly namespace: string;
  /** Per-set scope override, when declared. */
  readonly scope?: "app" | "merchant";
  /** Bare fields (wrapper entries unwrapped) — `Infer<typeof set.fields>` works unchanged. */
  readonly fields: F;
  /** Per-key wrapper options (`{}` for bare entries). */
  readonly options: Record<keyof F & string, MetafieldOptions>;
  parse(input: ParseInput): { value: Infer<F>; issues?: undefined } | { value?: undefined; issues: Issue[] };
  encode(value: InferInput<F>): MetafieldSetInput[];
  readonly ["~standard"]: StandardSchemaV1.Props<InferInput<F>, Infer<F>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMetafieldSet = MetafieldSet<any>;

function toValueMap(input: ParseInput): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (Array.isArray(input)) {
    for (const f of input) map.set(f.key, "jsonValue" in f && f.jsonValue !== undefined ? f.jsonValue : f.value);
  } else {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) map.set(k, v);
  }
  return map;
}

function isWrapper(entry: MetafieldEntry): entry is { field: AnyField } & MetafieldOptions {
  return typeof entry === "object" && entry !== null && "field" in entry;
}

/** Author-time checks for one entry's metafield options. [design §9] */
function validateOptions(owner: MetafieldOwner, namespace: string, key: string, field: AnyField, opts: MetafieldOptions): void {
  if (opts.capabilities?.smartCollectionCondition && owner !== "product") {
    throw new Error(`Metafield "${key}": capabilities.smartCollectionCondition is only valid on the "product" owner (got "${owner}").`);
  }
  if (field.filterable && opts.capabilities?.adminFilterable === false) {
    throw new Error(
      `Metafield "${key}": the builder sets filterable: true but capabilities.adminFilterable is false — they must agree.`,
    );
  }
  if (opts.access?.admin != null && !isAppReservedNamespace(namespace)) {
    throw new Error(
      `Metafield "${key}": access.admin is only valid for app-reserved-namespace definitions (namespace "${namespace}").`,
    );
  }
}

// Same loose `F` constraint as `defineMetaobject` (see src/define.ts): a
// `MetafieldEntry` contextual type would pollute `Req` inference of inline
// builder calls. Entry-ness is enforced by the conditional return type.
export function defineMetafields<F extends Record<string, unknown>>(
  owner: MetafieldOwner,
  config: MetafieldSetConfig<F>,
): UnwrapEntries<F> extends FieldMap ? MetafieldSet<UnwrapEntries<F>> : never {
  const ownerType = METAFIELD_OWNER_TYPES[owner];
  if (ownerType === undefined) {
    throw new Error(`Unknown metafield owner "${String(owner)}". Valid owners: ${Object.keys(METAFIELD_OWNER_TYPES).join(", ")}.`);
  }
  // A per-set merchant scope resolves the `$app` sentinel here, so `encode`,
  // validation, and duplicate detection all see the real "custom" namespace; a
  // merchant `config.scope` is only visible at sync time (resolve). [design §6]
  const declared = config.namespace ?? APP_NAMESPACE;
  const namespace = declared === APP_NAMESPACE && config.scope === "merchant" ? "custom" : declared;

  const fields: Record<string, AnyField> = {};
  const options: Record<string, MetafieldOptions> = {};
  for (const [key, raw] of Object.entries(config.fields as Record<string, MetafieldEntry>)) {
    const { field, opts } = isWrapper(raw) ? (({ field: f, ...rest }) => ({ field: f, opts: rest }))(raw) : { field: raw, opts: {} };
    validateOptions(owner, namespace, key, field, opts);
    fields[key] = field;
    options[key] = opts;
  }
  const entries = Object.entries(fields);

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

  function encode(value: Record<string, unknown>): MetafieldSetInput[] {
    const result: MetafieldSetInput[] = [];
    for (const [key, field] of entries) {
      const v = value[key];
      if (v === undefined) continue;
      const input: MetafieldSetInput = { key, value: field.encode(v), type: field.shopifyType };
      if (namespace !== APP_NAMESPACE) input.namespace = namespace;
      result.push(input);
    }
    return result;
  }

  const set = {
    owner: ownerType,
    namespace,
    ...(config.scope !== undefined ? { scope: config.scope } : {}),
    fields,
    options,
    parse,
    encode,
    ["~standard"]: {
      version: 1 as const,
      vendor: "@fmaplabs/meta-manifest",
      validate: (input: unknown) => parse(input as ParseInput),
    },
  };
  return set as unknown as UnwrapEntries<F> extends FieldMap ? MetafieldSet<UnwrapEntries<F>> : never;
}

/** Whether a value is a `defineMetafields(...)` set — the loader's per-element check. */
export function isMetafieldSet(value: unknown): value is AnyMetafieldSet {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<AnyMetafieldSet>;
  return (
    typeof s.owner === "string" &&
    typeof s.namespace === "string" &&
    typeof s.fields === "object" &&
    s.fields !== null &&
    typeof s.parse === "function" &&
    typeof s.encode === "function"
  );
}
