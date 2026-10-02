import type { RemoteAccess, RemoteCapabilities, RemoteDefinition, RemoteField } from "./sync/normalize";
import type { FieldValidation } from "./fields/base";
import type { PulledMetafieldDefinition } from "./sync/metafield-pull";
import { APP_NAMESPACE, metafieldOwnerKey } from "./metafields";

const APP_PREFIX = "$app:";

/** A bare (non-`$app:`) type is merchant-scoped. [design §9] */
function isMerchant(type: string): boolean {
  return !type.startsWith(APP_PREFIX);
}

/** `filterable: true` option entry when the field is used as an admin filter. */
function filterableEntry(field: RemoteField): string[] {
  return field.filterable ? ["filterable: true"] : [];
}

/** Shopify scalar/reference type → m.* builder name (no special construction). */
const SIMPLE: Record<string, string> = {
  single_line_text_field: "text",
  multi_line_text_field: "multilineText",
  rich_text_field: "richText",
  link: "link",
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
  customer_reference: "customer",
  order_reference: "order",
  company_reference: "company",
  company_location_reference: "companyLocation",
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

/** All reference targets from a mixed_reference field's `metaobject_definition_types` validation. */
function refTargets(field: RemoteField): string[] {
  const many = v(field.validations, "metaobject_definition_types");
  if (many) {
    try {
      const arr = JSON.parse(many);
      if (Array.isArray(arr)) return arr.map(String);
    } catch {
      /* fall through */
    }
  }
  const single = v(field.validations, "metaobject_definition_type");
  return single ? [single] : [];
}

/** `[() => Author, () => Publisher]` target-list literal, or undefined if any target is unmapped. */
function mixedTargetsLiteral(field: RemoteField, typeToIdent: Map<string, string>, warnings: string[]): string | undefined {
  const targets = refTargets(field);
  const idents = targets.map((t) => typeToIdent.get(t));
  if (!targets.length || idents.some((i) => !i)) {
    warnings.push(`unresolved mixed reference on field "${field.key}"`);
    return undefined;
  }
  return `[${idents.map((i) => `() => ${i}`).join(", ")}]`;
}

/** Build the options-object literal source (e.g. `{ required: true, max: 120 }`), or "". */
function optsLiteral(entries: string[]): string {
  return entries.length ? `{ ${entries.join(", ")} }` : "";
}

/** Number/string/JSON-array validation → option entries for scalar builders. */
function scalarEntries(field: RemoteField, warnings: string[], builder: string): string[] {
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
  // `date`/`date_time` store min/max as ISO date strings, not numbers — emit them as
  // quoted string literals so they round-trip (Number("2020-01-01") is NaN).
  if (builder === "date" || builder === "dateTime") {
    str("min", "min");
    str("max", "max");
  } else {
    num("min", "min");
    num("max", "max");
  }
  str("regex", "regex");
  jsonArr("choices", "choices");
  num("max_precision", "maxPrecision");
  jsonArr("allowed_domains", "allowedDomains");
  jsonArr("file_type_options", "accept");
  return e;
}

function scalarCall(builder: string, field: RemoteField, warnings: string[], extra: string[] = [], lead: string[] = []): string {
  const lit = optsLiteral([...lead, ...scalarEntries(field, warnings, builder), ...extra]);
  return lit ? `m.${builder}(${lit})` : `m.${builder}()`;
}

/** Build the m.* call source for a single field. `lead` entries open the options literal. */
function fieldCall(field: RemoteField, typeToIdent: Map<string, string>, warnings: string[], lead: string[] = []): string {
  const type = field.type;

  if (type === "rating") {
    const min = v(field.validations, "min");
    const max = v(field.validations, "max");
    const e = [`min: ${Number(min ?? 1)}`, `max: ${Number(max ?? 5)}`];
    if (field.required) e.unshift("required: true");
    e.unshift(...lead);
    e.push(...filterableEntry(field));
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
    const refEntries: string[] = [...lead];
    if (field.required) refEntries.push("required: true");
    refEntries.push(...filterableEntry(field));
    const opts = optsLiteral(refEntries);
    return opts ? `m.ref(() => ${ident}, ${opts})` : `m.ref(() => ${ident})`;
  }

  if (type === "mixed_reference") {
    const arr = mixedTargetsLiteral(field, typeToIdent, warnings);
    if (!arr) return `m.json() /* TODO: unmapped mixed reference */`;
    const refEntries: string[] = [...lead];
    if (field.required) refEntries.push("required: true");
    refEntries.push(...filterableEntry(field));
    const opts = optsLiteral(refEntries);
    return opts ? `m.mixedRef(${arr}, ${opts})` : `m.mixedRef(${arr})`;
  }

  if (type.startsWith("list.")) {
    const inner = type.slice("list.".length);
    const listEntries: string[] = [...lead];
    if (field.required) listEntries.push("required: true");
    const min = v(field.validations, "list.min");
    const max = v(field.validations, "list.max");
    if (min !== undefined) listEntries.push(`min: ${Number(min)}`);
    if (max !== undefined) listEntries.push(`max: ${Number(max)}`);
    listEntries.push(...filterableEntry(field));
    const listOpts = optsLiteral(listEntries);
    let innerCall: string;
    if (inner === "metaobject_reference") {
      const target = refTarget(field);
      const ident = target ? typeToIdent.get(target) : undefined;
      if (!ident) {
        warnings.push(`unresolved list reference on field "${field.key}"`);
        return `m.json() /* TODO: unmapped list reference */`;
      }
      innerCall = `m.ref(() => ${ident})`;
    } else if (inner === "mixed_reference") {
      const arr = mixedTargetsLiteral(field, typeToIdent, warnings);
      if (!arr) return `m.json() /* TODO: unmapped list mixed reference */`;
      innerCall = `m.mixedRef(${arr})`;
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

  if (SIMPLE[type]) return scalarCall(SIMPLE[type], field, warnings, filterableEntry(field), lead);

  warnings.push(`unmapped field type "${type}" on field "${field.key}"`);
  return `m.json() /* TODO: unmapped type ${type} */`;
}

/** Non-default access options as a config-object literal, or "" when all default. [design §9] */
function accessSource(access: RemoteAccess | undefined): string {
  if (!access) return "";
  const parts: string[] = [];
  if (access.admin === "MERCHANT_READ_WRITE") parts.push(`admin: "merchant_read_write"`);
  if (access.storefront === "PUBLIC_READ") parts.push(`storefront: "public_read"`);
  if (access.customerAccount === "READ") parts.push(`customerAccount: "read"`);
  return parts.length ? `{ ${parts.join(", ")} }` : "";
}

/** Enabled capabilities as a config-object literal, or "" when none are on. [design §9] */
function capabilitiesSource(caps: RemoteCapabilities | undefined): string {
  if (!caps) return "";
  const parts: string[] = [];
  if (caps.publishable?.enabled) parts.push(`publishable: true`);
  if (caps.translatable?.enabled) parts.push(`translatable: true`);
  if (caps.renderable?.enabled) {
    const d = caps.renderable.data;
    const dparts: string[] = [];
    if (d?.metaTitleKey != null) dparts.push(`metaTitleKey: ${JSON.stringify(d.metaTitleKey)}`);
    if (d?.metaDescriptionKey != null) dparts.push(`metaDescriptionKey: ${JSON.stringify(d.metaDescriptionKey)}`);
    parts.push(dparts.length ? `renderable: { ${dparts.join(", ")} }` : `renderable: true`);
  }
  if (caps.onlineStore?.enabled && caps.onlineStore.data?.urlHandle != null) {
    parts.push(`onlineStore: { urlHandle: ${JSON.stringify(caps.onlineStore.data.urlHandle)} }`);
  }
  return parts.length ? `{ ${parts.join(", ")} }` : "";
}

/** The definition-level config entries (scope/name/displayName/description/access/capabilities). */
function defConfigLines(def: RemoteDefinition): string {
  const lines: string[] = [];
  if (isMerchant(def.type)) lines.push(`  scope: "merchant",`);
  if (def.name) lines.push(`  name: ${JSON.stringify(def.name)},`);
  if (def.description != null) lines.push(`  description: ${JSON.stringify(def.description)},`);
  if (def.displayNameKey != null) lines.push(`  displayName: ${JSON.stringify(def.displayNameKey)},`);
  const access = accessSource(def.access);
  if (access) lines.push(`  access: ${access},`);
  const caps = capabilitiesSource(def.capabilities);
  if (caps) lines.push(`  capabilities: ${caps},`);
  return lines.length ? `\n${lines.join("\n")}` : "";
}

function defSource(def: RemoteDefinition, typeToIdent: Map<string, string>, warnings: string[]): string {
  const ident = typeToIdent.get(def.type)!;
  const handle = handleOf(def.type);
  const fields = def.fields
    .map((f) => `    ${f.key}: ${fieldCall(f, typeToIdent, warnings)},`)
    .join("\n");
  return `export const ${ident} = defineMetaobject(${JSON.stringify(handle)}, {${defConfigLines(def)}
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
    } else if (f.type === "mixed_reference" || f.type === "list.mixed_reference") {
      for (const t of refTargets(f)) out.add(t);
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
  const header = `import { defineMetaobject, m } from "@fmaplabs/meta-manifest";`;
  const body = blocks.join("\n\n");
  const footer = `export const schemas = [${idents.join(", ")}];`;
  for (const w of warnings) console.warn(`[meta-manifest] codegen: ${w}`);
  return `${header}\n\n${body}\n\n${footer}\n`;
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Object keys that aren't identifiers (e.g. "care-instructions") are quoted verbatim. */
function fieldKeySource(key: string): string {
  return IDENT_RE.test(key) ? key : JSON.stringify(key);
}

function pascal(s: string): string {
  return s
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
}

/** Declarable, non-default access options for a metafield wrapper, or "". */
function metafieldAccessSource(def: PulledMetafieldDefinition): string {
  const parts: string[] = [];
  if (def.namespace.startsWith(APP_NAMESPACE) && def.access?.admin === "MERCHANT_READ_WRITE") {
    parts.push(`admin: "merchant_read_write"`);
  }
  if (def.access?.storefront === "PUBLIC_READ") parts.push(`storefront: "public_read"`);
  if (def.access?.customerAccount === "READ") parts.push(`customerAccount: "read"`);
  return parts.length ? `{ ${parts.join(", ")} }` : "";
}

/** The `{ field, ... }` wrapper entries a metafield definition needs beyond its builder. */
function metafieldWrapperEntries(def: PulledMetafieldDefinition): string[] {
  const entries: string[] = [];
  if (def.pin) entries.push("pin: true");
  if (def.description != null) entries.push(`description: ${JSON.stringify(def.description)}`);
  const access = metafieldAccessSource(def);
  if (access) entries.push(`access: ${access}`);
  const caps: string[] = [];
  if (def.capabilities.smartCollectionCondition.enabled) caps.push("smartCollectionCondition: true");
  if (def.capabilities.uniqueValues.enabled) caps.push("uniqueValues: true");
  if (caps.length) entries.push(`capabilities: { ${caps.join(", ")} }`);
  return entries;
}

/** The `RemoteField` shape `fieldCall` consumes (`adminFilterable` → builder `filterable`). */
function toRemoteField(def: PulledMetafieldDefinition): RemoteField {
  return {
    key: def.key,
    type: def.type,
    required: false,
    filterable: def.capabilities.adminFilterable.enabled,
    validations: def.validations,
  };
}

/**
 * Generate a metafields-module source (using `defineMetafields`/`m`) from pulled
 * metafield definitions: one set per `(ownerType, namespace)`. Reference targets
 * are emitted as inline `({ type: "…" })` TypeRefs, so the module needs no
 * imports from the schema module. [design §8]
 */
export function generateMetafieldsSource(defs: PulledMetafieldDefinition[]): string {
  const groups = new Map<string, { ownerType: string; namespace: string; defs: PulledMetafieldDefinition[] }>();
  for (const def of defs) {
    const key = `${def.ownerType}/${def.namespace}`;
    const group = groups.get(key) ?? { ownerType: def.ownerType, namespace: def.namespace, defs: [] };
    group.defs.push(def);
    groups.set(key, group);
  }

  // Every type-form reference target maps to an inline `({ type })` expression;
  // GID-form targets (unmanaged/merchant definitions) stay unmapped → TODO.
  const typeToIdent = new Map<string, string>();
  for (const def of defs) {
    for (const t of refTargets(toRemoteField(def))) {
      if (!t.startsWith("gid://")) typeToIdent.set(t, `({ type: ${JSON.stringify(t)} })`);
    }
  }

  const warnings: string[] = [];
  const blocks: string[] = [];
  const idents: string[] = [];
  for (const group of groups.values()) {
    const ownerKey = metafieldOwnerKey(group.ownerType) ?? group.ownerType;
    const ident = pascal(ownerKey) + (group.namespace === APP_NAMESPACE ? "App" : pascal(group.namespace));
    idents.push(ident);
    const nsLine = group.namespace === APP_NAMESPACE ? "" : `\n  namespace: ${JSON.stringify(group.namespace)},`;
    const fields = group.defs
      .map((def) => {
        const lead = def.name != null && def.name !== def.key ? [`name: ${JSON.stringify(def.name)}`] : [];
        const call = fieldCall(toRemoteField(def), typeToIdent, warnings, lead);
        const wrapper = metafieldWrapperEntries(def);
        const value = wrapper.length ? `{ field: ${call}, ${wrapper.join(", ")} }` : call;
        return `    ${fieldKeySource(def.key)}: ${value},`;
      })
      .join("\n");
    blocks.push(`export const ${ident} = defineMetafields(${JSON.stringify(ownerKey)}, {${nsLine}
  fields: {
${fields}
  },
});`);
  }

  const header = `import { defineMetafields, m } from "@fmaplabs/meta-manifest";`;
  const footer = `export const metafields = [${idents.join(", ")}];`;
  for (const w of warnings) console.warn(`[meta-manifest] codegen: ${w}`);
  return `${header}\n\n${blocks.join("\n\n")}\n\n${footer}\n`;
}
