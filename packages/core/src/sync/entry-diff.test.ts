import { describe, expect, it } from "vitest";
import { defineMetaobject } from "../define";
import { defineEntries, entryRef } from "../entries";
import { m } from "../fields/index";
import { diffEntries } from "./entry-diff";
import type { PulledEntry } from "./entry-pull";
import { resolveEntries } from "./entry-resolve";

const Book = defineMetaobject("book", {
  name: "Book",
  fields: { title: m.text({ required: true }), price: m.money() },
});
const Author = defineMetaobject("author", {
  name: "Author",
  fields: { name: m.text({ required: true }), favoriteBook: m.ref(Book) },
});
const schemas = [Book, Author];

function resolved(sets: Parameters<typeof resolveEntries>[0]) {
  const { entries, issues } = resolveEntries(sets, schemas);
  expect(issues).toEqual([]);
  return entries;
}

const BOOK_GID = "gid://shopify/Metaobject/11";
const bookRemote: PulledEntry = {
  id: BOOK_GID,
  type: "$app:book",
  handle: "persuasion",
  fields: [
    { key: "title", value: "Persuasion" },
    { key: "price", value: '{"amount":"12.50","currency_code":"USD"}' },
  ],
};

describe("diffEntries", () => {
  it("emits createEntry for entries absent remotely", () => {
    const entries = resolved([defineEntries(Book, { persuasion: { title: "Persuasion" } })]);
    expect(diffEntries(entries, [])).toEqual([{ kind: "createEntry", type: "$app:book", handle: "persuasion" }]);
  });

  it("emits nothing when declared fields match, despite wire canonicalization", () => {
    const entries = resolved([
      defineEntries(Book, { persuasion: { title: "Persuasion", price: { amount: "12.5", currencyCode: "USD" } } }),
    ]);
    expect(diffEntries(entries, [bookRemote])).toEqual([]);
  });

  it("ignores undeclared remote fields and missing remote status", () => {
    const entries = resolved([defineEntries(Book, { persuasion: { title: "Persuasion" } })]);
    const remote = { ...bookRemote, status: "DRAFT", fields: [...bookRemote.fields, { key: "extra", value: "x" }] };
    expect(diffEntries(entries, [remote])).toEqual([]);
  });

  it("emits updateEntry naming only the drifted declared fields", () => {
    const entries = resolved([
      defineEntries(Book, { persuasion: { title: "Emma", price: { amount: "12.5", currencyCode: "USD" } } }),
    ]);
    expect(diffEntries(entries, [bookRemote])).toEqual([
      { kind: "updateEntry", type: "$app:book", handle: "persuasion", changes: ["title"] },
    ]);
  });

  it("treats a declared field unset remotely as a change", () => {
    const entries = resolved([
      defineEntries(Book, { persuasion: { title: "Persuasion", price: { amount: "1", currencyCode: "USD" } } }),
    ]);
    const remote = { ...bookRemote, fields: [{ key: "title", value: "Persuasion" }, { key: "price", value: null }] };
    expect(diffEntries(entries, [remote])).toEqual([
      { kind: "updateEntry", type: "$app:book", handle: "persuasion", changes: ["price"] },
    ]);
  });

  it("resolves placeholders through pulled GIDs — matching ref is no change, unresolved is a change", () => {
    const sets = [
      defineEntries(Book, { persuasion: { title: "Persuasion" } }),
      defineEntries(Author, { jane: { name: "Jane", favoriteBook: entryRef(Book, "persuasion") } }),
    ];
    const entries = resolved(sets);
    const janeRemote: PulledEntry = {
      id: "gid://shopify/Metaobject/22",
      type: "$app:author",
      handle: "jane",
      fields: [
        { key: "name", value: "Jane" },
        { key: "favoriteBook", value: BOOK_GID },
      ],
    };
    // Book pulled → placeholder resolves to its GID → no ops at all.
    expect(diffEntries(entries, [bookRemote, janeRemote])).toEqual([]);
    // Book absent remotely → its create is planned and jane's ref can't resolve → both ops.
    expect(diffEntries(entries, [janeRemote])).toEqual([
      { kind: "createEntry", type: "$app:book", handle: "persuasion" },
      { kind: "updateEntry", type: "$app:author", handle: "jane", changes: ["favoriteBook"] },
    ]);
  });

  it("compares status case-insensitively and only when declared", () => {
    const active = resolved([defineEntries(Book, { persuasion: { title: "Persuasion" } }, { status: "active" })]);
    expect(diffEntries(active, [{ ...bookRemote, status: "ACTIVE" }])).toEqual([]);
    expect(diffEntries(active, [{ ...bookRemote, status: "DRAFT" }])).toEqual([
      { kind: "updateEntry", type: "$app:book", handle: "persuasion", changes: [], statusChange: true },
    ]);
  });
});
