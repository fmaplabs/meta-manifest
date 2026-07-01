import { describe, expect, it } from "vitest";
import { defineMetaobject, m, resolveDefinitions } from "../index";

describe("resolveDefinitions", () => {
  it("resolves effective scope: override > config > default", () => {
    const AppDefault = defineMetaobject("a", { name: "A", fields: { n: m.text() } });
    const MerchantOverride = defineMetaobject("b", { name: "B", scope: "merchant", fields: { n: m.text() } });

    expect(resolveDefinitions([AppDefault], {})[0].type).toBe("$app:a"); // default app
    expect(resolveDefinitions([AppDefault], { scope: "merchant" })[0].type).toBe("a"); // config
    expect(resolveDefinitions([MerchantOverride], { scope: "app" })[0].type).toBe("b"); // override beats config
  });

  it("rewrites single and list reference targets to the referenced object's effective type", () => {
    const Author = defineMetaobject("author", { name: "Author", scope: "merchant", fields: { name: m.text() } });
    const Book = defineMetaobject("book", {
      name: "Book",
      fields: { author: m.ref(() => Author), coAuthors: m.list(m.ref(() => Author)) },
    });
    const defs = resolveDefinitions([Author, Book], {});
    const book = defs.find((d) => d.type === "$app:book")!;
    const author = book.fieldDefinitions.find((f) => f.key === "author")!;
    const co = book.fieldDefinitions.find((f) => f.key === "coAuthors")!;
    expect(author.validations).toContainEqual({ name: "metaobject_definition_type", value: "author" });
    expect(co.validations).toContainEqual({ name: "metaobject_definition_type", value: "author" });
  });

  it("resolves a mixed app/merchant graph, keeping app targets canonical", () => {
    const Tag = defineMetaobject("tag", { name: "Tag", fields: { label: m.text() } }); // app (default)
    const Post = defineMetaobject("post", { name: "Post", scope: "merchant", fields: { tag: m.ref(() => Tag) } });
    const defs = resolveDefinitions([Tag, Post], {});
    const post = defs.find((d) => d.type === "post")!;
    expect(defs.some((d) => d.type === "$app:tag")).toBe(true); // app stays canonical
    expect(post.fieldDefinitions[0].validations).toContainEqual({
      name: "metaobject_definition_type",
      value: "$app:tag",
    });
  });

  it("defaults app-scope admin from merchantEditable; omits admin for merchant scope", () => {
    const App = defineMetaobject("a", { name: "A", fields: { n: m.text() } });
    expect(resolveDefinitions([App], {})[0].access?.admin).toBe("MERCHANT_READ");
    expect(resolveDefinitions([App], { merchantEditable: true })[0].access?.admin).toBe("MERCHANT_READ_WRITE");

    const Merchant = defineMetaobject("b", { name: "B", scope: "merchant", fields: { n: m.text() } });
    expect(resolveDefinitions([Merchant], { merchantEditable: true })[0].access?.admin).toBeUndefined();
  });

  it("keeps an explicit app-scope admin over the merchantEditable default", () => {
    const App = defineMetaobject("a", { name: "A", access: { admin: "merchant_read" }, fields: { n: m.text() } });
    expect(resolveDefinitions([App], { merchantEditable: true })[0].access?.admin).toBe("MERCHANT_READ");
  });

  it("throws when a merchant-scoped metaobject sets an explicit access.admin", () => {
    const Bad = defineMetaobject("bad", {
      name: "Bad",
      scope: "merchant",
      access: { admin: "merchant_read_write" },
      fields: { n: m.text() },
    });
    expect(() => resolveDefinitions([Bad], {})).toThrow(/merchant-scoped but sets access\.admin/);
  });
});
