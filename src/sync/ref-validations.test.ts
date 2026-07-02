import { describe, expect, it } from "vitest";
import { refValidationsToIds, refValidationsToTypes } from "./ref-validations";

const GID_A = "gid://shopify/MetaobjectDefinition/1";
const GID_B = "gid://shopify/MetaobjectDefinition/2";

const idByType = new Map([
  ["author", GID_A],
  ["publisher", GID_B],
]);
const typeById = new Map([
  [GID_A, "author"],
  [GID_B, "publisher"],
]);

describe("refValidationsToIds", () => {
  it("rewrites a bare (merchant-scope) single ref target to its definition GID", () => {
    expect(refValidationsToIds([{ name: "metaobject_definition_type", value: "author" }], idByType)).toEqual([
      { name: "metaobject_definition_id", value: GID_A },
    ]);
  });

  it("leaves app-reserved targets in type-form", () => {
    const appScoped = [{ name: "metaobject_definition_type", value: "$app:author" }];
    const resolved = [{ name: "metaobject_definition_type", value: "app--1--author" }];
    expect(refValidationsToIds(appScoped, idByType)).toEqual(appScoped);
    expect(refValidationsToIds(resolved, idByType)).toEqual(resolved);
  });

  it("passes an unresolvable bare target through unchanged", () => {
    const v = [{ name: "metaobject_definition_type", value: "unknown" }];
    expect(refValidationsToIds(v, idByType)).toEqual(v);
  });

  it("rewrites a mixed-ref target list to metaobject_definition_ids when every element resolves", () => {
    const v = [{ name: "metaobject_definition_types", value: JSON.stringify(["author", "publisher"]) }];
    expect(refValidationsToIds(v, idByType)).toEqual([
      { name: "metaobject_definition_ids", value: JSON.stringify([GID_A, GID_B]) },
    ]);
  });

  it("leaves a mixed-ref list unchanged when any element cannot become a GID", () => {
    const partial = [{ name: "metaobject_definition_types", value: JSON.stringify(["author", "unknown"]) }];
    const appMixed = [{ name: "metaobject_definition_types", value: JSON.stringify(["$app:author", "author"]) }];
    expect(refValidationsToIds(partial, idByType)).toEqual(partial);
    expect(refValidationsToIds(appMixed, idByType)).toEqual(appMixed);
  });

  it("leaves non-reference validations untouched", () => {
    const v = [{ name: "max", value: "120" }];
    expect(refValidationsToIds(v, idByType)).toEqual(v);
  });
});

describe("refValidationsToTypes", () => {
  it("rewrites a known GID back to the canonical type-form", () => {
    expect(refValidationsToTypes([{ name: "metaobject_definition_id", value: GID_A }], typeById)).toEqual([
      { name: "metaobject_definition_type", value: "author" },
    ]);
  });

  it("passes an unknown GID through unchanged", () => {
    const v = [{ name: "metaobject_definition_id", value: "gid://shopify/MetaobjectDefinition/999" }];
    expect(refValidationsToTypes(v, typeById)).toEqual(v);
  });

  it("rewrites a GID list to metaobject_definition_types when every element is known", () => {
    const v = [{ name: "metaobject_definition_ids", value: JSON.stringify([GID_B, GID_A]) }];
    expect(refValidationsToTypes(v, typeById)).toEqual([
      { name: "metaobject_definition_types", value: JSON.stringify(["publisher", "author"]) },
    ]);
  });

  it("round-trips with refValidationsToIds", () => {
    const canonical = [
      { name: "metaobject_definition_type", value: "author" },
      { name: "metaobject_definition_types", value: JSON.stringify(["author", "publisher"]) },
    ];
    expect(refValidationsToTypes(refValidationsToIds(canonical, idByType), typeById)).toEqual(canonical);
  });
});
