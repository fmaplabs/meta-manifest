import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AdminGraphQLClient } from "../index";
import { LIST_DEFINITIONS_QUERY } from "../sync/client";
import { runPull } from "./pull";

function fakeStore(): AdminGraphQLClient {
  return async (query) => {
    expect(query).toBe(LIST_DEFINITIONS_QUERY);
    return { data: { metaobjectDefinitions: {
      nodes: [{ id: "gid://shopify/MetaobjectDefinition/1", name: "Author", type: "app--111--author",
        fieldDefinitions: [{ key: "name", type: { name: "single_line_text_field" }, required: true, validations: [] }] }],
      pageInfo: { hasNextPage: false, endCursor: null } } } };
  };
}

describe("runPull", () => {
  it("writes generated schema source containing the pulled definition", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-pull-"));
    const out = join(dir, "schema.ts");
    const res = await runPull({ client: fakeStore(), schemaPath: out });
    expect(res.count).toBe(1);
    const src = readFileSync(out, "utf8");
    expect(src).toContain('defineMetaobject("author"');
    expect(src).toContain("m.text(");
    expect(src).toContain("export const schemas = [Author]");
  });
});
