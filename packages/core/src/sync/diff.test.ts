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
