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
