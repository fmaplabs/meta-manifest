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
