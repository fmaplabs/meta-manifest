import { describe, expect, it } from "vitest";
import { defineMetaobject } from "../define";
import { defineEntries, entryRef, type AnyEntries } from "../entries";
import { m } from "../fields/index";
import { UPSERT_ENTRY_MUTATION, type AdminGraphQLClient } from "./client";
import { diffEntries, type EntryOp } from "./entry-diff";
import type { PulledEntry } from "./entry-pull";
import { pushEntries } from "./entry-push";
import { resolveEntries, type ResolvedEntry } from "./entry-resolve";

const Book = defineMetaobject("book", {
  name: "Book",
  fields: { title: m.text({ required: true }), author: m.ref({ type: "$app:author" }) },
});
const Author = defineMetaobject("author", {
  name: "Author",
  fields: {
    name: m.text({ required: true }),
    favoriteBook: m.ref(Book),
    mentor: m.ref({ type: "$app:author" }),
  },
});
const schemas = [Book, Author];

function resolved(sets: AnyEntries[]): ResolvedEntry[] {
  const { entries, issues } = resolveEntries(sets, schemas);
  expect(issues).toEqual([]);
  return entries;
}

type Call = { variables?: Record<string, unknown> };

function recordingClient(config: { failKeys?: string[] } = {}) {
  const calls: Call[] = [];
  let nextId = 1;
  const idByKey = new Map<string, string>();
  const client: AdminGraphQLClient = async (query, options) => {
    if (query !== UPSERT_ENTRY_MUTATION) throw new Error("unexpected query");
    calls.push({ variables: options?.variables });
    const h = options?.variables?.handle as { type: string; handle: string };
    const key = `${h.type}/${h.handle}`;
    if (config.failKeys?.includes(key)) {
      return { data: { metaobjectUpsert: { metaobject: null, userErrors: [{ message: `nope: ${key}` }] } } };
    }
    const id = idByKey.get(key) ?? `gid://shopify/Metaobject/${nextId++}`;
    idByKey.set(key, id);
    return { data: { metaobjectUpsert: { metaobject: { id, handle: h.handle }, userErrors: [] } } };
  };
  return { client, calls };
}

const createOp = (type: string, handle: string): EntryOp => ({ kind: "createEntry", type, handle });

describe("pushEntries — creates", () => {
  it("creates referenced entries first and resolves placeholders to fresh GIDs", async () => {
    const entries = resolved([
      defineEntries(Author, { jane: { name: "Jane", favoriteBook: entryRef(Book, "persuasion") } }),
      defineEntries(Book, { persuasion: { title: "Persuasion" } }),
    ]);
    const plan = [createOp("$app:author", "jane"), createOp("$app:book", "persuasion")];
    const { client, calls } = recordingClient();
    const result = await pushEntries(client, plan, { entries, remote: [] });

    expect(calls).toHaveLength(2);
    // The book is created first even though it is second in the plan…
    expect(calls[0].variables?.handle).toEqual({ type: "$app:book", handle: "persuasion" });
    // …so jane's create carries its GID, not the placeholder.
    expect(calls[1].variables?.metaobject).toEqual({
      fields: [
        { key: "name", value: "Jane" },
        { key: "favoriteBook", value: "gid://shopify/Metaobject/1" },
      ],
    });
    // Results stay in plan order.
    expect(result.results.map((r) => [r.op.handle, r.status])).toEqual([
      ["jane", "applied"],
      ["persuasion", "applied"],
    ]);
    expect(result.ok).toBe(true);
  });

  it("sends the publishable status with creates when the set declares one", async () => {
    const entries = resolved([defineEntries(Book, { b: { title: "B" } }, { status: "draft" })]);
    const { client, calls } = recordingClient();
    await pushEntries(client, [createOp("$app:book", "b")], { entries, remote: [] });
    expect(calls[0].variables?.metaobject).toMatchObject({ capabilities: { publishable: { status: "DRAFT" } } });
  });

  it("creates a reference cycle two-pass: deferred ref fields land in a second upsert", async () => {
    const entries = resolved([
      defineEntries(Book, { b: { title: "B", author: entryRef({ type: "$app:author" }, "a") } }),
      defineEntries(Author, { a: { name: "A", favoriteBook: entryRef(Book, "b") } }),
    ]);
    const plan = [createOp("$app:book", "b"), createOp("$app:author", "a")];
    const { client, calls } = recordingClient();
    const result = await pushEntries(client, plan, { entries, remote: [] });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(3);
    // Pass 1: the first cycle member is created without its unresolvable ref field…
    expect((calls[0].variables?.metaobject as { fields: unknown[] }).fields).toEqual([{ key: "title", value: "B" }]);
    // …and the second can already resolve its ref to the first inline.
    expect((calls[1].variables?.metaobject as { fields: unknown[] }).fields).toEqual([
      { key: "name", value: "A" },
      { key: "favoriteBook", value: "gid://shopify/Metaobject/1" },
    ]);
    // Pass 2: just the first member's deferred ref field.
    expect(calls[2].variables?.metaobject).toEqual({ fields: [{ key: "author", value: "gid://shopify/Metaobject/2" }] });
  });

  it("defers a self-reference to pass 2 with the entry's own GID", async () => {
    const entries = resolved([
      defineEntries(Author, { jane: { name: "Jane", mentor: entryRef({ type: "$app:author" }, "jane") } }),
    ]);
    const { client, calls } = recordingClient();
    const result = await pushEntries(client, [createOp("$app:author", "jane")], { entries, remote: [] });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect((calls[0].variables?.metaobject as { fields: unknown[] }).fields).toEqual([{ key: "name", value: "Jane" }]);
    expect(calls[1].variables?.metaobject).toEqual({ fields: [{ key: "mentor", value: "gid://shopify/Metaobject/1" }] });
  });

  it("blocks dependents when a dependency create fails, and reports userErrors as failed", async () => {
    const entries = resolved([
      defineEntries(Book, { persuasion: { title: "Persuasion" } }),
      defineEntries(Author, { jane: { name: "Jane", favoriteBook: entryRef(Book, "persuasion") } }),
    ]);
    const plan = [createOp("$app:book", "persuasion"), createOp("$app:author", "jane")];
    const { client, calls } = recordingClient({ failKeys: ["$app:book/persuasion"] });
    const result = await pushEntries(client, plan, { entries, remote: [] });

    expect(calls).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ status: "failed", userErrors: [{ message: "nope: $app:book/persuasion" }] });
    expect(result.results[1]).toMatchObject({ status: "blocked", reason: expect.stringContaining("$app:book/persuasion") });
    expect(result.counts).toEqual({ applied: 0, blocked: 1, failed: 1 });
    expect(result.ok).toBe(false);
  });

  it("blocks every op for a type whose definition was not created", async () => {
    const entries = resolved([defineEntries(Book, { b: { title: "B" } })]);
    const { client, calls } = recordingClient();
    const result = await pushEntries(client, [createOp("$app:book", "b")], {
      entries,
      remote: [],
      failedDefinitionTypes: new Set(["$app:book"]),
    });
    expect(calls).toHaveLength(0);
    expect(result.results[0]).toMatchObject({ status: "blocked", reason: expect.stringContaining('definition "$app:book"') });
  });
});

describe("pushEntries — updates", () => {
  const remote: PulledEntry[] = [
    {
      id: "gid://shopify/Metaobject/9",
      type: "$app:book",
      handle: "b",
      fields: [{ key: "title", value: "Old" }],
      status: "DRAFT",
    },
  ];

  it("writes only the drifted fields plus the drifted status", async () => {
    const entries = resolved([defineEntries(Book, { b: { title: "New" } }, { status: "active" })]);
    const plan = diffEntries(entries, remote);
    expect(plan).toEqual([{ kind: "updateEntry", type: "$app:book", handle: "b", changes: ["title"], statusChange: true }]);

    const { client, calls } = recordingClient();
    const result = await pushEntries(client, plan, { entries, remote });
    expect(calls[0].variables).toEqual({
      handle: { type: "$app:book", handle: "b" },
      metaobject: {
        fields: [{ key: "title", value: "New" }],
        capabilities: { publishable: { status: "ACTIVE" } },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("sends a status-only update without a fields key", async () => {
    const entries = resolved([defineEntries(Book, { b: { title: "Old" } }, { status: "active" })]);
    const plan = diffEntries(entries, remote);
    expect(plan).toEqual([{ kind: "updateEntry", type: "$app:book", handle: "b", changes: [], statusChange: true }]);

    const { client, calls } = recordingClient();
    await pushEntries(client, plan, { entries, remote });
    expect(calls[0].variables?.metaobject).toEqual({ capabilities: { publishable: { status: "ACTIVE" } } });
  });
});
