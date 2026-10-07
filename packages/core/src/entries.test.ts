import { describe, expect, expectTypeOf, it } from "vitest";
import { defineMetaobject } from "./define";
import { defineEntries, entryRef, HANDLE_RE, parseEntryRef, type EntryRef } from "./entries";
import { m } from "./fields/index";
import type { InferInput } from "./infer";

const Book = defineMetaobject("book", {
  name: "Book",
  fields: { title: m.text({ required: true }) },
});

const Author = defineMetaobject("author", {
  name: "Author",
  fields: {
    name: m.text({ required: true }),
    favoriteBook: m.ref(Book),
    books: m.list(m.ref(() => Book)),
    inspiration: m.mixedRef([Book, () => Book]),
  },
});

describe("entryRef", () => {
  it("builds a $entry: placeholder from the canonical type", () => {
    expect(entryRef(Book, "persuasion")).toBe("$entry:$app:book/persuasion");
    expect(entryRef(() => Book, "persuasion")).toBe("$entry:$app:book/persuasion");
  });

  it("slots into ref, list-of-ref, and mixedRef input positions", () => {
    type AuthorIn = InferInput<typeof Author.fields>;
    expectTypeOf<EntryRef>().toMatchTypeOf<NonNullable<AuthorIn["favoriteBook"]>>();
    expectTypeOf<EntryRef[]>().toMatchTypeOf<NonNullable<AuthorIn["books"]>>();
    expectTypeOf<EntryRef>().toMatchTypeOf<NonNullable<AuthorIn["inspiration"]>>();
  });
});

describe("parseEntryRef", () => {
  it("round-trips an entryRef placeholder", () => {
    expect(parseEntryRef(entryRef(Book, "persuasion"))).toEqual({ type: "$app:book", handle: "persuasion" });
  });
  it("returns null for GIDs, non-strings, and malformed placeholders", () => {
    expect(parseEntryRef("gid://shopify/Metaobject/1")).toBeNull();
    expect(parseEntryRef(42)).toBeNull();
    expect(parseEntryRef("$entry:no-slash")).toBeNull();
    expect(parseEntryRef("$entry:$app:book/")).toBeNull();
  });
});

describe("defineEntries", () => {
  it("carries the schema, entries, and optional status", () => {
    const set = defineEntries(
      Author,
      { "jane-austen": { name: "Jane Austen", favoriteBook: entryRef(Book, "persuasion") } },
      { status: "active" },
    );
    expect(set.schema).toBe(Author);
    expect(set.status).toBe("active");
    expect(Object.keys(set.entries)).toEqual(["jane-austen"]);
    expect(defineEntries(Book, { persuasion: { title: "Persuasion" } }).status).toBeUndefined();
  });

  it("type-checks entry values against InferInput", () => {
    defineEntries(Book, {
      // @ts-expect-error — title is required
      "missing-title": {},
      // @ts-expect-error — unknown is not a declared field
      "unknown-field": { title: "x", unknown: 1 },
    });
  });
});

describe("HANDLE_RE", () => {
  it("accepts kebab handles and rejects everything else", () => {
    expect(HANDLE_RE.test("jane-austen")).toBe(true);
    expect(HANDLE_RE.test("a1")).toBe(true);
    for (const bad of ["Jane", "jane--austen", "-jane", "jane-", "jane_austen", ""]) {
      expect(HANDLE_RE.test(bad)).toBe(false);
    }
  });
});
