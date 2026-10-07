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

  it("maps customerAccount access (uppercased)", () => {
    const S = defineMetaobject("s", {
      name: "S",
      access: { customerAccount: "read" },
      fields: { a: m.text() },
    });
    expect(S.toDefinitionInput().access).toEqual({ customerAccount: "READ" });
  });

  it("maps renderable: true to { enabled: true }", () => {
    const S = defineMetaobject("s", { name: "S", capabilities: { renderable: true }, fields: { a: m.text() } });
    expect(S.toDefinitionInput().capabilities).toEqual({ renderable: { enabled: true } });
  });

  it("maps renderable object to enabled + SEO data keys", () => {
    const S = defineMetaobject("s", {
      name: "S",
      capabilities: { renderable: { metaTitleKey: "title", metaDescriptionKey: "body" } },
      fields: { title: m.text(), body: m.multilineText() },
    });
    expect(S.toDefinitionInput().capabilities).toEqual({
      renderable: { enabled: true, data: { metaTitleKey: "title", metaDescriptionKey: "body" } },
    });
  });

  it("maps onlineStore to enabled + urlHandle/createRedirects data", () => {
    const S = defineMetaobject("s", {
      name: "S",
      capabilities: { onlineStore: { urlHandle: "authors", createRedirects: true } },
      fields: { a: m.text() },
    });
    expect(S.toDefinitionInput().capabilities).toEqual({
      onlineStore: { enabled: true, data: { urlHandle: "authors", createRedirects: true } },
    });
  });

  it("maps a filterable field to adminFilterable capability", () => {
    const S = defineMetaobject("s", { name: "S", fields: { a: m.text({ filterable: true }), b: m.text() } });
    const [a, b] = S.toDefinitionInput().fieldDefinitions;
    expect(a.capabilities).toEqual({ adminFilterable: { enabled: true } });
    expect(b.capabilities).toBeUndefined();
  });

  it("throws when a renderable SEO key is not a declared field", () => {
    const S = defineMetaobject("s", {
      name: "S",
      capabilities: { renderable: { metaTitleKey: "nope" } },
      fields: { a: m.text() },
    });
    expect(() => S.toDefinitionInput()).toThrow(/metaTitleKey "nope" is not a declared field/);
  });
});
