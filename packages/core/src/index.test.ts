import { expect, it } from "vitest";
import { defineMetaobject, diff, m, normalizeLocal } from "./index";

it("exposes the public API and runs an end-to-end define→diff", () => {
  const Author = defineMetaobject("author", {
    name: "Author",
    fields: { name: m.text({ required: true }) },
  });
  const ops = diff([normalizeLocal(Author)], []);
  expect(ops[0]).toMatchObject({ kind: "createDefinition", type: "$app:author" });
});
