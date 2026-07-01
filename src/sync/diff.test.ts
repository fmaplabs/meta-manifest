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
      capabilities: { onlineStore: { enabled: false } },
      fields: [
        { key: "name", type: "single_line_text_field", required: true, filterable: false, validations: [{ name: "max", value: "120" }] },
        { key: "bio", type: "multi_line_text_field", required: false, filterable: false, validations: [] },
      ],
    });
  });

  it("normalizes a pulled remote definition", () => {
    const remote = normalizeRemote({
      type: "$app:author",
      name: "Author",
      fieldDefinitions: [{ key: "name", type: { name: "single_line_text_field" }, required: true, validations: [] }],
    });
    expect(remote.fields[0]).toEqual({ key: "name", type: "single_line_text_field", required: true, filterable: false, validations: [] });
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
    expect(ops).toEqual([{ kind: "addField", type: "$app:author", field: { key: "bio", type: "multi_line_text_field", required: false, filterable: false, validations: [] } }]);
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

describe("diff — definition reconciliation", () => {
  it("emits updateDefinition when name/displayName/access/capabilities drift", () => {
    const Local = defineMetaobject("author", {
      name: "Author v2",
      displayName: "name",
      access: { storefront: "public_read" },
      capabilities: { publishable: true },
      fields: { name: m.text({ required: true }) },
    });
    const remote = normalizeRemote({
      type: "$app:author",
      name: "Author",
      displayNameKey: null,
      access: { storefront: "NONE" },
      capabilities: { publishable: { enabled: false } },
      fieldDefinitions: [{ key: "name", type: { name: "single_line_text_field" }, required: true, validations: [] }],
    });
    const upd = diff([normalizeLocal(Local)], [remote]).find((o) => o.kind === "updateDefinition");
    expect(upd?.kind === "updateDefinition" && [...upd.changes].sort()).toEqual([
      "access",
      "capabilities",
      "displayNameKey",
      "name",
    ]);
    expect(upd?.kind === "updateDefinition" && upd.destructive).toBeFalsy();
  });

  it("marks an onlineStore disable as destructive", () => {
    const Local = defineMetaobject("p", { name: "P", fields: { n: m.text() } });
    const remote = normalizeRemote({
      type: "$app:p",
      name: "P",
      capabilities: { onlineStore: { enabled: true, data: { urlHandle: "p" } } },
      fieldDefinitions: [{ key: "n", type: { name: "single_line_text_field" }, required: false, validations: [] }],
    });
    const upd = diff([normalizeLocal(Local)], [remote]).find((o) => o.kind === "updateDefinition");
    expect(upd?.kind === "updateDefinition" && upd.changes).toContain("capabilities");
    expect(upd?.kind === "updateDefinition" && upd.destructive).toBe(true);
  });

  it("detects filterable drift as an updateField change", () => {
    const Local = defineMetaobject("author", { name: "Author", fields: { name: m.text({ filterable: true }) } });
    const remote = normalizeRemote({
      type: "$app:author",
      name: "Author",
      fieldDefinitions: [
        { key: "name", type: { name: "single_line_text_field" }, required: false, validations: [], capabilities: { adminFilterable: { enabled: false } } },
      ],
    });
    const ops = diff([normalizeLocal(Local)], [remote]);
    expect(ops).toContainEqual({ kind: "updateField", type: "$app:author", key: "name", changes: { filterable: true } });
  });

  it("does not reconcile a capability the local schema does not declare", () => {
    const Local = defineMetaobject("author", { name: "Author", fields: { name: m.text() } });
    const remote = normalizeRemote({
      type: "$app:author",
      name: "Author",
      capabilities: { publishable: { enabled: true }, translatable: { enabled: true } },
      fieldDefinitions: [{ key: "name", type: { name: "single_line_text_field" }, required: false, validations: [] }],
    });
    expect(diff([normalizeLocal(Local)], [remote])).toEqual([]);
  });

  it("does not drift when renderable is auto-keyed but remote reports assigned keys", () => {
    const Local = defineMetaobject("author", {
      name: "Author",
      capabilities: { renderable: true },
      fields: { name: m.text() },
    });
    const remote = normalizeRemote({
      type: "$app:author",
      name: "Author",
      capabilities: { renderable: { enabled: true, data: { metaTitleKey: "name", metaDescriptionKey: null } } },
      fieldDefinitions: [{ key: "name", type: { name: "single_line_text_field" }, required: false, validations: [] }],
    });
    expect(diff([normalizeLocal(Local)], [remote])).toEqual([]);
  });
});
