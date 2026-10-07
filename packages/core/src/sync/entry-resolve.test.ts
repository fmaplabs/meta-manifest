import { describe, expect, it } from "vitest";
import { defineMetaobject } from "../define";
import { defineEntries, entryRef, type AnyEntries } from "../entries";
import { m } from "../fields/index";
import { placeholderRefs, resolveEntries, substituteFieldValue } from "./entry-resolve";

const Book = defineMetaobject("book", {
  name: "Book",
  fields: { title: m.text({ required: true }) },
});
const Author = defineMetaobject("author", {
  name: "Author",
  fields: {
    name: m.text({ required: true }),
    favoriteBook: m.ref(Book),
    books: m.list(m.ref(Book)),
    rating: m.rating({ min: 0, max: 5 }),
  },
});
const schemas = [Book, Author];

describe("placeholderRefs / substituteFieldValue", () => {
  it("extracts placeholders from scalars and arrays, ignoring GIDs", () => {
    expect(placeholderRefs(entryRef(Book, "b1"))).toEqual([{ type: "$app:book", handle: "b1" }]);
    expect(placeholderRefs([entryRef(Book, "b1"), "gid://shopify/Metaobject/9"])).toEqual([
      { type: "$app:book", handle: "b1" },
    ]);
    expect(placeholderRefs("plain")).toEqual([]);
  });

  it("substitutes resolvable placeholders and reports the rest", () => {
    const gid = (type: string, handle: string) => (handle === "known" ? `gid://x/${type}` : undefined);
    expect(substituteFieldValue("$entry:book/known", gid)).toEqual({ value: "gid://x/book", unresolved: [] });
    const r = substituteFieldValue(["$entry:book/known", "$entry:book/nope", "gid://y"], gid);
    expect(r.value).toEqual(["gid://x/book", "$entry:book/nope", "gid://y"]);
    expect(r.unresolved).toEqual([{ type: "book", handle: "nope" }]);
  });
});

describe("resolveEntries", () => {
  it("resolves valid entries with refs collected and placeholders kept", () => {
    const sets = [
      defineEntries(Book, { persuasion: { title: "Persuasion" } }),
      defineEntries(
        Author,
        { "jane-austen": { name: "Jane Austen", favoriteBook: entryRef(Book, "persuasion") } },
        { status: "active" },
      ),
    ];
    const { entries, issues } = resolveEntries(sets, schemas);
    expect(issues).toEqual([]);
    expect(entries.map((e) => `${e.type}/${e.handle}`)).toEqual(["$app:book/persuasion", "$app:author/jane-austen"]);
    const jane = entries[1];
    expect(jane.status).toBe("active");
    expect(jane.value.favoriteBook).toBe("$entry:$app:book/persuasion");
    expect(jane.refs).toEqual([{ fieldKey: "favoriteBook", type: "$app:book", handle: "persuasion" }]);
  });

  it("rewrites placeholder targets and entry types to the effective (merchant) scope", () => {
    const sets = [
      defineEntries(Book, { persuasion: { title: "Persuasion" } }),
      defineEntries(Author, { jane: { name: "Jane", books: [entryRef(Book, "persuasion")] } }),
    ];
    const { entries, issues } = resolveEntries(sets, schemas, { scope: "merchant" });
    expect(issues).toEqual([]);
    expect(entries.map((e) => e.type)).toEqual(["book", "author"]);
    expect(entries[1].value.books).toEqual(["$entry:book/persuasion"]);
    expect(entries[1].refs).toEqual([{ fieldKey: "books", type: "book", handle: "persuasion" }]);
  });

  it("flags entries whose schema is not in the schema module", () => {
    const Ghost = defineMetaobject("ghost", { name: "Ghost", fields: { n: m.text() } });
    const { issues } = resolveEntries([defineEntries(Ghost, { g: { n: "x" } })], schemas);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/\$app:ghost/);
  });

  it("flags duplicate (type, handle) pairs across sets", () => {
    const sets = [
      defineEntries(Book, { persuasion: { title: "A" } }),
      defineEntries(Book, { persuasion: { title: "B" } }),
    ];
    const { issues } = resolveEntries(sets, schemas);
    expect(issues.some((i) => /declared more than once/.test(i.message))).toBe(true);
  });

  it("flags bad handles, missing required fields, and unknown fields", () => {
    const sets: AnyEntries[] = [
      defineEntries(Book, {
        "Bad Handle": { title: "x" },
        "no-title": {} as never,
        extra: { title: "x", nope: 1 } as never,
      }),
    ];
    const { issues } = resolveEntries(sets, schemas);
    expect(issues.some((i) => /Invalid entry handle/.test(i.message))).toBe(true);
    expect(issues.some((i) => /missing required field "title"/.test(i.message))).toBe(true);
    expect(issues.some((i) => /unknown field "nope"/.test(i.message))).toBe(true);
  });

  it("round-trips field values and surfaces constraint issues with paths", () => {
    const sets: AnyEntries[] = [defineEntries(Author, { jane: { name: "Jane", rating: { value: 9 } } })];
    const { issues } = resolveEntries(sets, schemas);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/between 0 and 5/);
    expect(issues[0].path).toEqual(["$app:author/jane", "rating"]);
  });

  it("rejects placeholders in non-ref fields and to wrong target types", () => {
    const sets: AnyEntries[] = [
      defineEntries(Author, {
        jane: { name: entryRef(Book, "persuasion"), favoriteBook: entryRef(Author, "jane") } as never,
      }),
    ];
    const { issues } = resolveEntries(sets, schemas);
    expect(issues.some((i) => /not a metaobject reference field/.test(i.message))).toBe(true);
    expect(issues.some((i) => /only accepts: \$app:book/.test(i.message))).toBe(true);
  });

  it("rejects placeholders to undeclared entries", () => {
    const sets = [defineEntries(Author, { jane: { name: "Jane", favoriteBook: entryRef(Book, "nowhere") } })];
    const { issues } = resolveEntries(sets, schemas);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/undeclared entry "\$app:book\/nowhere"/);
  });

  it("accepts raw GIDs in ref fields without declaring anything", () => {
    const sets = [defineEntries(Author, { jane: { name: "Jane", favoriteBook: "gid://shopify/Metaobject/1" } })];
    const { entries, issues } = resolveEntries(sets, schemas);
    expect(issues).toEqual([]);
    expect(entries[0].refs).toEqual([]);
    expect(entries[0].value.favoriteBook).toBe("gid://shopify/Metaobject/1");
  });

  it("rejects an invalid status", () => {
    const set = { schema: Book, entries: { b: { title: "x" } }, status: "published" } as unknown as AnyEntries;
    const { issues } = resolveEntries([set], schemas);
    expect(issues.some((i) => /status must be/.test(i.message))).toBe(true);
  });
});
