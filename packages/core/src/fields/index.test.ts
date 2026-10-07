import { expect, it } from "vitest";
import { m } from "./index";

it("exposes the full builder surface", () => {
  const expected = [
    "text", "multilineText", "richText", "integer", "decimal", "boolean",
    "date", "dateTime", "url", "color", "json", "link",
    "money", "dimension", "weight", "volume", "rating",
    "product", "variant", "collection", "page", "file",
    "customer", "order", "company", "companyLocation", "ref", "mixedRef", "list",
  ];
  expect(Object.keys(m).sort()).toEqual([...expected].sort());
});

it("builders produce fields with a shopifyType", () => {
  expect(m.text().shopifyType).toBe("single_line_text_field");
  expect(m.list(m.ref({ type: "$app:author" })).shopifyType).toBe("list.metaobject_reference");
  expect(m.mixedRef([{ type: "$app:author" }]).shopifyType).toBe("mixed_reference");
  expect(m.list(m.mixedRef([{ type: "$app:author" }])).shopifyType).toBe("list.mixed_reference");
});
