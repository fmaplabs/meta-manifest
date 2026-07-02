import type { FieldValidation } from "../fields/base";

const APP_PREFIX = "$app:";

/**
 * Shopify's type-based reference validations (`metaobject_definition_type` /
 * `metaobject_definition_types`) only resolve app-reserved types (`$app:…` /
 * `app--…`); a merchant-scoped (bare) target must be expressed as a definition
 * GID via the `_id` / `_ids` validation names or `metaobjectDefinitionCreate`
 * rejects the field ("Validations require that you select a metaobject").
 *
 * The schema keeps type-form validations as its canon; these helpers translate
 * at the store boundary: `refValidationsToIds` on every outgoing field input
 * (push), `refValidationsToTypes` on every pulled definition (diff/codegen).
 */
function needsId(type: string): boolean {
  return !type.startsWith(APP_PREFIX) && !type.startsWith("app--");
}

/**
 * Rewrite merchant-scope reference targets from type-form to GID-form for an
 * outgoing field input. A target with no known id passes through unchanged so
 * the API reports the real failure. A `metaobject_definition_types` array is
 * switched to `metaobject_definition_ids` only when EVERY element resolves to
 * a GID — the two names cannot be mixed in one validation.
 */
export function refValidationsToIds(
  validations: FieldValidation[],
  idByType: ReadonlyMap<string, string>,
): FieldValidation[] {
  return validations.map((v) => {
    if (v.name === "metaobject_definition_type" && needsId(v.value)) {
      const id = idByType.get(v.value);
      return id ? { name: "metaobject_definition_id", value: id } : v;
    }
    if (v.name === "metaobject_definition_types") {
      try {
        const parsed: unknown = JSON.parse(v.value);
        if (!Array.isArray(parsed)) return v;
        if (!parsed.some((t) => typeof t === "string" && needsId(t))) return v;
        const ids = parsed.map((t) => (typeof t === "string" && needsId(t) ? idByType.get(t) : undefined));
        if (ids.every((id): id is string => typeof id === "string")) {
          return { name: "metaobject_definition_ids", value: JSON.stringify(ids) };
        }
        return v;
      } catch {
        return v;
      }
    }
    return v;
  });
}

/**
 * Rewrite GID-form reference targets on a pulled definition back to the
 * canonical type-form so `diff()` compares against the schema's canon. A GID
 * outside `typeById` (an unmanaged definition) passes through unchanged.
 */
export function refValidationsToTypes(
  validations: FieldValidation[],
  typeById: ReadonlyMap<string, string>,
): FieldValidation[] {
  return validations.map((v) => {
    if (v.name === "metaobject_definition_id") {
      const type = typeById.get(v.value);
      return type ? { name: "metaobject_definition_type", value: type } : v;
    }
    if (v.name === "metaobject_definition_ids") {
      try {
        const parsed: unknown = JSON.parse(v.value);
        if (!Array.isArray(parsed)) return v;
        const types = parsed.map((g) => (typeof g === "string" ? typeById.get(g) : undefined));
        if (types.every((t): t is string => typeof t === "string")) {
          return { name: "metaobject_definition_types", value: JSON.stringify(types) };
        }
        return v;
      } catch {
        return v;
      }
    }
    return v;
  });
}
