import { expect, it } from "vitest";
import { m } from "./index";

it("exposes the full v1 builder surface", () => {
  const expected = [
    "text", "multilineText", "integer", "decimal", "boolean",
    "date", "dateTime", "url", "color", "json",
    "money", "dimension", "weight", "volume", "rating",
    "product", "variant", "collection", "page", "file", "ref", "list",
  ];
  expect(Object.keys(m).sort()).toEqual([...expected].sort());
});

it("builders produce fields with a shopifyType", () => {
  expect(m.text().shopifyType).toBe("single_line_text_field");
  expect(m.list(m.ref({ type: "$app:author" })).shopifyType).toBe("list.metaobject_reference");
});
